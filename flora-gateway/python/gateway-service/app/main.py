"""Flora Gateway Service: manages device instances, controllers and the license.

Device types and the gateway's device license come from Haber (in Flora Canopy).
Each enabled device instance runs as its own device-medical-service container.
"""
from __future__ import annotations

import asyncio
import json
import logging
import tomllib
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
import tomli_w
from aiokafka import AIOKafkaProducer
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from psycopg.types.json import Jsonb

from . import db, docker_ops, settings

log = logging.getLogger("gateway-service")
STATE: dict[str, Any] = {"haber": {"status": "never", "error": None, "last_sync": None}, "producer": None}


# ------------------------------------------------------------------ lifecycle

@asynccontextmanager
async def lifespan(_: FastAPI):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    db.pool.open(wait=True, timeout=60)
    task = asyncio.create_task(background_loop())
    yield
    task.cancel()
    if STATE["producer"]:
        await STATE["producer"].stop()
    db.pool.close()


app = FastAPI(title="Flora Gateway Service", lifespan=lifespan)


def require_admin(request: Request) -> None:
    if request.method in {"GET", "HEAD", "OPTIONS"} or not settings.ADMIN_KEY:
        return
    if request.headers.get("x-gateway-key") != settings.ADMIN_KEY:
        raise HTTPException(401, "x-gateway-key required")


async def background_loop() -> None:
    seeded = False
    while True:
        try:
            await haber_checkin()
        except Exception as error:  # Haber/Canopy may be offline; keep the last license
            STATE["haber"].update(status="offline", error=str(error))
            log.warning("haber check-in failed: %s", error)
        try:
            if not seeded:
                seeded = seed_instances()
            await asyncio.to_thread(reconcile)
        except Exception as error:
            log.warning("reconcile failed: %s", error)
        await asyncio.sleep(settings.SYNC_INTERVAL_SEC)


# ------------------------------------------------------------------ Haber + license

async def haber_checkin() -> dict[str, Any]:
    if not settings.HABER_URL:
        STATE["haber"].update(status="disabled", error=None)
        return {}
    instances = db.fetch_all("SELECT device_id, device_type, leaf_id, pod, enabled FROM gateway_device_instance")
    async with httpx.AsyncClient(timeout=5) as client:
        response = await client.post(
            f"{settings.HABER_URL}/api/haber/v1/gateways/{settings.GATEWAY_ID}/checkin",
            headers={"authorization": f"Bearer {settings.HABER_TOKEN}"},
            json={"gateway_id": settings.GATEWAY_ID, "version": "0.1.0", "devices": instances},
        )
        response.raise_for_status()
        payload = response.json()
    db.upsert_device_types(payload.get("device_types") or [], "haber")
    if payload.get("license"):
        db.store_license(payload["license"], payload.get("tenant_id"))
    STATE["haber"].update(status="ok", error=None, last_sync=db.now_ms(), tenant_id=payload.get("tenant_id"))
    return payload


def license_state() -> dict[str, Any]:
    row = db.fetch_one("SELECT * FROM gateway_license WHERE id=1")
    used = db.fetch_one("SELECT count(*) AS n FROM gateway_device_instance WHERE enabled")["n"]
    if row is None:
        return {"valid": not settings.LICENSE_REQUIRED, "reason": "no license received from Haber", "used": used}
    if (row["raw"] or {}).get("revoked"):
        return {"valid": False, "reason": "license revoked by Flora Root", "used": used, **row}
    if row["expires_at"] is not None and row["expires_at"] < db.now_ms():
        return {"valid": False, "reason": "license expired", "used": used, **row}
    return {"valid": True, "reason": None, "used": used, **row}


def check_license(device_type: str, adding: bool) -> None:
    state = license_state()
    if not state["valid"]:
        raise HTTPException(403, f"device license invalid: {state['reason']}")
    if state.get("allowed_types") and device_type not in state["allowed_types"]:
        raise HTTPException(403, f"device type {device_type} is not licensed")
    if adding and state.get("max_devices") is not None and state["used"] >= state["max_devices"]:
        raise HTTPException(403, f"device limit reached ({state['max_devices']})")


# ------------------------------------------------------------------ instances

class InstanceIn(BaseModel):
    device_id: str = Field(pattern=r"^[A-Za-z0-9_.-]{1,80}$")
    device_type: str
    pod: str = Field(description="controller.pod-id, e.g. socket.or-monitor")
    label: str | None = None
    leaf_id: str | None = None
    options: dict[str, Any] = {}
    enabled: bool = True


def get_type(code: str) -> dict[str, Any]:
    row = db.fetch_one("SELECT * FROM gateway_device_type WHERE code=%s", (code,))
    if row is None:
        raise HTTPException(404, f"unknown device type {code}; sync from Haber first")
    return row


def start_instance(device_id: str) -> dict[str, Any]:
    instance = db.instance_row(db.fetch_one("SELECT * FROM gateway_device_instance WHERE device_id=%s", (device_id,)))
    container_id = docker_ops.start_parser(instance, get_type(instance["device_type"]))
    db.execute("UPDATE gateway_device_instance SET container_id=%s, updated_at=%s WHERE device_id=%s",
               (container_id, db.now_ms(), device_id))
    return {"device_id": device_id, "container_id": container_id}


def reconcile() -> dict[str, Any]:
    """Parser containers follow the instance table and the license."""
    states = docker_ops.parser_states()
    licensed = license_state()["valid"]
    started, stopped = [], []
    for instance in db.fetch_all("SELECT * FROM gateway_device_instance"):
        running = states.get(instance["device_id"], {}).get("status") == "running"
        wanted = instance["enabled"] and licensed
        if wanted and not running:
            try:
                start_instance(instance["device_id"])
                started.append(instance["device_id"])
            except Exception as error:
                log.warning("cannot start %s: %s", instance["device_id"], error)
        elif not wanted and instance["device_id"] in states:
            docker_ops.stop_parser(instance["device_id"])
            stopped.append(instance["device_id"])
    return {"started": started, "stopped": stopped, "licensed": licensed}


def seed_instances() -> bool:
    """Creates demo/site instances from FLORA_GATEWAY_SEED once their types exist."""
    path = Path(settings.SEED_PATH)
    if not path.exists():
        return True
    pending = False
    for item in json.loads(path.read_text()):
        if db.fetch_one("SELECT 1 FROM gateway_device_instance WHERE device_id=%s", (item["device_id"],)):
            continue
        if not db.fetch_one("SELECT 1 FROM gateway_device_type WHERE code=%s", (item["device_type"],)):
            pending = True
            continue
        insert_instance(InstanceIn(**item))
        log.info("seeded device instance %s", item["device_id"])
    return not pending


def insert_instance(payload: InstanceIn) -> None:
    current = db.now_ms()
    db.execute(
        """INSERT INTO gateway_device_instance (device_id,label,device_type,pod,leaf_id,options,enabled,created_at,updated_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (payload.device_id, payload.label, payload.device_type, payload.pod, payload.leaf_id,
         Jsonb(payload.options), payload.enabled, current, current),
    )


@app.get("/api/instances")
def list_instances():
    states = docker_ops.parser_states()
    rows = [db.instance_row(row) for row in db.fetch_all("SELECT * FROM gateway_device_instance ORDER BY device_id")]
    for row in rows:
        row["container"] = states.get(row["device_id"])
    return {"rows": rows}


@app.post("/api/instances", dependencies=[Depends(require_admin)], status_code=201)
def create_instance(payload: InstanceIn):
    get_type(payload.device_type)
    if db.fetch_one("SELECT 1 FROM gateway_device_instance WHERE device_id=%s", (payload.device_id,)):
        raise HTTPException(409, "device_id already exists")
    check_license(payload.device_type, adding=payload.enabled)
    insert_instance(payload)
    return start_instance(payload.device_id) if payload.enabled else {"device_id": payload.device_id}


@app.post("/api/instances/{device_id}/restart", dependencies=[Depends(require_admin)])
def restart_instance(device_id: str):
    instance = db.fetch_one("SELECT device_type FROM gateway_device_instance WHERE device_id=%s", (device_id,))
    if instance is None:
        raise HTTPException(404, "device not found")
    check_license(instance["device_type"], adding=False)
    return start_instance(device_id)


@app.post("/api/instances/{device_id}/enabled/{enabled}", dependencies=[Depends(require_admin)])
def set_enabled(device_id: str, enabled: bool):
    instance = db.fetch_one("SELECT device_type, enabled FROM gateway_device_instance WHERE device_id=%s", (device_id,))
    if instance is None:
        raise HTTPException(404, "device not found")
    if enabled and not instance["enabled"]:
        check_license(instance["device_type"], adding=True)
    db.execute("UPDATE gateway_device_instance SET enabled=%s, updated_at=%s WHERE device_id=%s",
               (enabled, db.now_ms(), device_id))
    return reconcile()


@app.delete("/api/instances/{device_id}", dependencies=[Depends(require_admin)])
def delete_instance(device_id: str):
    docker_ops.stop_parser(device_id)
    db.execute("DELETE FROM gateway_device_instance WHERE device_id=%s", (device_id,))
    return {"deleted": device_id}


@app.post("/api/instances/reconcile", dependencies=[Depends(require_admin)])
def reconcile_now():
    return reconcile()


# ------------------------------------------------------------------ controllers + config

@app.get("/api/controllers")
async def controllers():
    async with httpx.AsyncClient(timeout=2) as client:
        async def one(name: str, url: str):
            try:
                response = await client.get(f"{url}/status")
                return name, {"reachable": True, **response.json()}
            except Exception as error:
                return name, {"reachable": False, "error": str(error), "pods": []}
        results = await asyncio.gather(*(one(name, url) for name, url in settings.CONTROLLERS.items()))
    return dict(results)


@app.post("/api/controllers/{service}/restart", dependencies=[Depends(require_admin)])
def restart_controller(service: str):
    if service not in settings.CONTROLLERS and service != "server":
        raise HTTPException(404, "unknown controller")
    try:
        return {"restarted": docker_ops.restart_service(service)}
    except LookupError as error:
        raise HTTPException(404, str(error)) from None


def read_config() -> dict[str, Any]:
    return tomllib.loads(Path(settings.CONFIG_PATH).read_text())


@app.get("/api/config")
def get_config():
    return read_config()


@app.put("/api/config/{section}", dependencies=[Depends(require_admin)])
def put_config(section: str, body: dict[str, Any], restart: bool = True):
    """Replaces one controller section (e.g. its `pods` list) and restarts it."""
    if section not in settings.CONFIG_SECTIONS:
        raise HTTPException(404, "unknown config section")
    config = read_config()
    config[section] = {**config.get(section, {}), **body}
    path = Path(settings.CONFIG_PATH)
    path.write_text(tomli_w.dumps(config))
    restarted = docker_ops.restart_service(settings.CONFIG_SECTIONS[section]) if restart else None
    return {"section": section, "config": config[section], "restarted": restarted}


# ------------------------------------------------------------------ device commands

class CommandIn(BaseModel):
    payload: str
    encoding: str = "utf8"
    connection: int | None = None


@app.post("/api/pods/{pod}/command", dependencies=[Depends(require_admin)])
async def send_command(pod: str, body: CommandIn):
    if STATE["producer"] is None:
        producer = AIOKafkaProducer(bootstrap_servers=settings.KAFKA_BROKERS,
                                    value_serializer=lambda value: json.dumps(value).encode())
        await producer.start()
        STATE["producer"] = producer
    topic = "gw.cmd." + "".join(c if c.isalnum() or c in "._-" else "_" for c in pod)
    meta = {"connection": body.connection} if body.connection else {}
    await STATE["producer"].send_and_wait(topic, {"pod": pod, "encoding": body.encoding, "payload": body.payload,
                                                  "meta": meta, "issued_at": db.now_ms()})
    return {"sent": True, "topic": topic}


# ------------------------------------------------------------------ read models

@app.get("/health")
def health():
    db.fetch_one("SELECT 1")
    return {"status": "OK", "component": "gateway-service", "gateway_id": settings.GATEWAY_ID}


@app.get("/api/device-types")
def device_types():
    return {"rows": db.fetch_all("SELECT * FROM gateway_device_type ORDER BY code")}


@app.get("/api/license")
def license_info():
    return {**license_state(), "haber": STATE["haber"]}


@app.post("/api/haber/sync", dependencies=[Depends(require_admin)])
async def haber_sync():
    try:
        payload = await haber_checkin()
    except Exception as error:
        STATE["haber"].update(status="offline", error=str(error))
        raise HTTPException(502, f"haber unreachable: {error}") from None
    seed_instances()
    return {"device_types": len(payload.get("device_types") or []), "license": payload.get("license")}


@app.get("/api/logs")
def logs(limit: int = 100):
    return {"rows": db.fetch_all("SELECT * FROM gateway_log ORDER BY ts DESC LIMIT %s", (min(limit, 500),))}


@app.get("/api/devices/status")
async def devices_status():
    async with httpx.AsyncClient(timeout=3) as client:
        response = await client.get(f"{settings.DATA_SERVER_URL}/api/devices/status")
        return response.json()


@app.get("/api/devices/{device_id}/latest")
async def device_latest(device_id: str, seconds: int = 120):
    end = db.now_ms()
    async with httpx.AsyncClient(timeout=3) as client:
        response = await client.get(f"{settings.DATA_SERVER_URL}/api/observations",
                                    params={"from": end - seconds * 1000, "to": end + 1, "device_id": device_id})
        return response.json()


@app.get("/")
def index():
    return FileResponse(Path(__file__).parent / "static" / "index.html")
