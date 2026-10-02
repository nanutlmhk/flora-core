"""Haber: the device registry inside Flora Canopy (one per hospital).

- Pulls the hospital's license bundle from Flora Root and verifies its Ed25519
  signature. The verified bundle is cached, so the hospital keeps running when
  the cloud is unreachable, until the bundle expires.
- Publishes the device catalog (Device Type, Image) to every Flora Gateway.
- Splits the hospital's gateway-device entitlement across gateways (Device License).
- Reports hospital usage (Leaves, gateways, devices) back to Root.
"""
from __future__ import annotations

import asyncio
import base64
import hmac
import json
import logging
import os
import sqlite3
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
import psycopg
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

log = logging.getLogger("haber")
ROOT_URL = os.getenv("FLORA_ROOT_URL", "http://host.docker.internal:7100").rstrip("/")
TENANT_ID = os.getenv("FLORA_TENANT_ID", "hospital-01")
TENANT_KEY = os.getenv("FLORA_ROOT_TENANT_KEY", "")
# Pin Root's key in production; without it the first key seen is trusted (demo).
PINNED_KEY = os.getenv("FLORA_ROOT_PUBLIC_KEY", "").strip()
GATEWAY_TOKEN = os.getenv("HABER_GATEWAY_TOKEN", "")
CANOPY_DB_URL = os.getenv("CANOPY_DATABASE_URL", "")
SYNC_INTERVAL = int(os.getenv("HABER_ROOT_SYNC_SEC", "20"))
DB_PATH = os.getenv("HABER_DB_PATH", "/data/haber.db")
CATALOG = json.loads((Path(__file__).parent / "catalog.json").read_text())
STATE: dict[str, Any] = {"root": {"status": "never", "error": None, "last_sync": None}}


def now_ms() -> int:
    return int(time.time() * 1000)


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


# ------------------------------------------------------------------ local store

def db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with db() as connection:
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS gateway (
              gateway_id TEXT PRIMARY KEY, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
              version TEXT, devices TEXT NOT NULL DEFAULT '[]');
        """)


def kv_get(key: str) -> Any:
    with db() as connection:
        row = connection.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
    return json.loads(row["value"]) if row else None


def kv_set(key: str, value: Any) -> None:
    with db() as connection:
        connection.execute("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                           (key, json.dumps(value)))


# ------------------------------------------------------------------ Root sync

def verify(envelope: dict[str, Any], keys: dict[str, str]) -> dict[str, Any]:
    public = keys.get(envelope.get("key_id", ""))
    if not public:
        raise ValueError(f"unknown signing key {envelope.get('key_id')}")
    try:
        Ed25519PublicKey.from_public_bytes(base64.b64decode(public)).verify(
            base64.b64decode(envelope["signature"]), canonical(envelope["bundle"]))
    except InvalidSignature:
        raise ValueError("bundle signature is invalid") from None
    return envelope["bundle"]


async def sync_root() -> None:
    headers = {"authorization": f"Bearer {TENANT_KEY}"}
    async with httpx.AsyncClient(timeout=5) as client:
        keys = kv_get("root_keys") or {}
        if PINNED_KEY:
            keys = {"pinned": PINNED_KEY} | keys
        if not keys or not PINNED_KEY:
            response = await client.get(f"{ROOT_URL}/api/v1/keys")
            response.raise_for_status()
            fetched = {item["key_id"]: item["public_key"] for item in response.json()["keys"]}
            if PINNED_KEY and PINNED_KEY not in fetched.values():
                raise ValueError("Root key does not match FLORA_ROOT_PUBLIC_KEY")
            keys = {**keys, **fetched}
            kv_set("root_keys", keys)
        response = await client.get(f"{ROOT_URL}/api/v1/tenants/{TENANT_ID}/bundle", headers=headers)
        response.raise_for_status()
        envelope = response.json()
        bundle = verify(envelope, keys)
        kv_set("bundle", envelope)
        STATE["root"].update(status="ok", error=None, last_sync=now_ms(), verified=True)
        await client.post(f"{ROOT_URL}/api/v1/tenants/{TENANT_ID}/heartbeat", headers=headers, json={
            "canopy_version": "1.2.2", "bundle_id": bundle["bundle_id"], "usage": usage()})


async def root_loop() -> None:
    while True:
        try:
            await sync_root()
        except Exception as error:
            STATE["root"].update(status="offline", error=str(error))
            log.warning("root sync failed: %s", error)
        await asyncio.sleep(SYNC_INTERVAL)


def current_bundle() -> dict[str, Any] | None:
    envelope = kv_get("bundle")
    if not envelope:
        return None
    keys = kv_get("root_keys") or {}
    try:
        return verify(envelope, keys)
    except ValueError:
        return None


# ------------------------------------------------------------------ usage

def canopy_leaves() -> list[dict[str, Any]]:
    if not CANOPY_DB_URL:
        return []
    try:
        with psycopg.connect(CANOPY_DB_URL, connect_timeout=3) as connection:
            rows = connection.execute(
                "SELECT leaf_id, coalesce(canopy_display_name, display_name) AS name, hospital_id, "
                "extract(epoch FROM last_seen_at)*1000 AS last_seen FROM sync_leaf_node ORDER BY leaf_id").fetchall()
    except Exception as error:
        log.warning("cannot read Canopy leaves: %s", error)
        return []
    return [{"leaf_id": r[0], "name": r[1], "hospital_id": r[2], "last_seen": int(r[3] or 0)} for r in rows]


def gateways() -> list[dict[str, Any]]:
    with db() as connection:
        rows = connection.execute("SELECT * FROM gateway ORDER BY gateway_id").fetchall()
    return [{**dict(row), "devices": json.loads(row["devices"])} for row in rows]


def usage() -> dict[str, Any]:
    leaves = canopy_leaves()
    known = gateways()
    devices = sum(len([d for d in gateway["devices"] if d.get("enabled", True)]) for gateway in known)
    return {"leaves": len(leaves), "gateways": len(known), "gateway_devices": devices,
            "leaf_ids": [leaf["leaf_id"] for leaf in leaves]}


# ------------------------------------------------------------------ app

@asynccontextmanager
async def lifespan(_: FastAPI):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    init_db()
    task = asyncio.create_task(root_loop())
    yield
    task.cancel()


app = FastAPI(title="Flora Canopy Haber", lifespan=lifespan)


class Checkin(BaseModel):
    gateway_id: str
    version: str | None = None
    devices: list[dict[str, Any]] = []


@app.post("/api/haber/v1/gateways/{gateway_id}/checkin")
def gateway_checkin(gateway_id: str, body: Checkin, request: Request):
    supplied = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    if not GATEWAY_TOKEN or not hmac.compare_digest(supplied, GATEWAY_TOKEN):
        raise HTTPException(401, "invalid gateway token")
    bundle = current_bundle()
    if bundle is None:
        raise HTTPException(503, "no verified license bundle from Flora Root yet")
    entitlements = bundle["entitlements"]
    known = {gateway["gateway_id"]: gateway for gateway in gateways()}
    if gateway_id not in known and len(known) >= entitlements["max_gateways"]:
        raise HTTPException(403, f"gateway limit reached ({entitlements['max_gateways']})")
    current = now_ms()
    with db() as connection:
        connection.execute(
            """INSERT INTO gateway (gateway_id, first_seen, last_seen, version, devices) VALUES (?,?,?,?,?)
               ON CONFLICT(gateway_id) DO UPDATE SET last_seen=excluded.last_seen, version=excluded.version,
                 devices=excluded.devices""",
            (gateway_id, current, current, body.version, json.dumps(body.devices)))
    others = sum(len([d for d in gateway["devices"] if d.get("enabled", True)])
                 for gid, gateway in known.items() if gid != gateway_id)
    licensed = "gateway" in entitlements["modules"]
    max_devices = max(0, entitlements["max_gateway_devices"] - others) if licensed else 0
    allowed = set(entitlements.get("device_types") or [])
    return {
        "gateway_id": gateway_id,
        "tenant_id": bundle["tenant"]["tenant_id"],
        "license": {
            "max_devices": max_devices,
            "allowed_types": sorted(allowed),
            "expires_at": bundle["expires_at"],
            "bundle_id": bundle["bundle_id"],
            "revoked": bool(bundle.get("revoked")),
            "issued_by": "flora-root",
        },
        "device_types": [item for item in CATALOG["device_types"] if not allowed or item["code"] in allowed],
        "images": CATALOG["images"],
        "global_config": bundle.get("global_config", {}),
    }


@app.post("/api/haber/v1/root/sync")
async def force_root_sync():
    try:
        await sync_root()
    except Exception as error:
        STATE["root"].update(status="offline", error=str(error))
        raise HTTPException(502, str(error)) from None
    return overview()


@app.get("/api/haber/v1/device-types")
def device_types():
    return {"rows": CATALOG["device_types"]}


@app.get("/api/haber/v1/images")
def images():
    return {"rows": CATALOG["images"]}


@app.get("/api/haber/v1/overview")
def overview():
    bundle = current_bundle()
    return {
        "server_ts": now_ms(),
        "tenant_id": TENANT_ID,
        "root": {"url": ROOT_URL, **STATE["root"]},
        "bundle": bundle,
        "license_valid": bool(bundle and bundle["expires_at"] > now_ms()),
        "usage": usage(),
        "leaves": canopy_leaves(),
        "gateways": gateways(),
        "catalog": CATALOG,
    }


@app.get("/health")
def health():
    return {"status": "OK", "component": "haber", "root": STATE["root"]["status"]}


@app.get("/")
def index():
    return FileResponse(Path(__file__).parent / "static" / "index.html")
