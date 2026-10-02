import json
import time
from typing import Any

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from . import settings

pool = ConnectionPool(settings.DATABASE_URL, min_size=1, max_size=5, open=False,
                      kwargs={"row_factory": dict_row, "autocommit": True})


def now_ms() -> int:
    return int(time.time() * 1000)


def fetch_all(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    with pool.connection() as connection:
        return connection.execute(sql, params).fetchall()


def fetch_one(sql: str, params: tuple = ()) -> dict[str, Any] | None:
    with pool.connection() as connection:
        return connection.execute(sql, params).fetchone()


def execute(sql: str, params: tuple = ()) -> None:
    with pool.connection() as connection:
        connection.execute(sql, params)


def upsert_device_types(types: list[dict[str, Any]], source: str) -> int:
    current = now_ms()
    with pool.connection() as connection:
        for item in types:
            connection.execute(
                """INSERT INTO gateway_device_type
                     (code,label,category,protocol,controller,parser,image,default_options,source,haber_version,synced_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (code) DO UPDATE SET label=excluded.label, category=excluded.category,
                     protocol=excluded.protocol, controller=excluded.controller, parser=excluded.parser,
                     image=excluded.image, default_options=excluded.default_options, source=excluded.source,
                     haber_version=excluded.haber_version, synced_at=excluded.synced_at""",
                (item["code"], item["label"], item.get("category", "device"), item["protocol"], item["controller"],
                 item["parser"], item.get("image") or settings.PARSER_IMAGE, Jsonb(item.get("default_options") or {}),
                 source, str(item.get("version") or ""), current),
            )
    return len(types)


def store_license(license_: dict[str, Any], tenant_id: str | None) -> None:
    execute(
        """INSERT INTO gateway_license (id,gateway_id,tenant_id,max_devices,allowed_types,expires_at,bundle_id,raw,synced_at)
           VALUES (1,%s,%s,%s,%s,%s,%s,%s,%s)
           ON CONFLICT (id) DO UPDATE SET gateway_id=excluded.gateway_id, tenant_id=excluded.tenant_id,
             max_devices=excluded.max_devices, allowed_types=excluded.allowed_types, expires_at=excluded.expires_at,
             bundle_id=excluded.bundle_id, raw=excluded.raw, synced_at=excluded.synced_at""",
        (settings.GATEWAY_ID, tenant_id, int(license_.get("max_devices", 0)), list(license_.get("allowed_types") or []),
         license_.get("expires_at"), license_.get("bundle_id"), Jsonb(license_), now_ms()),
    )


def instance_row(row: dict[str, Any]) -> dict[str, Any]:
    if isinstance(row.get("options"), str):
        row["options"] = json.loads(row["options"])
    return row
