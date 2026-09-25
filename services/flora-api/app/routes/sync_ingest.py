import hashlib
import hmac
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from psycopg import Connection
from psycopg.types.json import Jsonb

from ..database import connection


router = APIRouter(prefix="/api/sync/v1", tags=["leaf-canopy-sync"])


class SyncMessage(BaseModel):
    message_id: uuid.UUID
    entity_type: str = Field(min_length=1, max_length=80)
    entity_id: str = Field(min_length=1, max_length=160)
    operation: Literal["upsert", "delete"] = "upsert"
    revision: int = Field(ge=0)
    occurred_at: datetime
    payload: dict[str, Any] = Field(default_factory=dict)


class SyncBatch(BaseModel):
    leaf_id: str = Field(min_length=1, max_length=120)
    hospital_id: str = Field(min_length=1, max_length=120)
    display_name: str = Field(min_length=1, max_length=160)
    software_version: str | None = Field(default=None, max_length=80)
    observed_location: dict[str, Any] | None = None
    applied_config_version: int = Field(default=0, ge=0)
    messages: list[SyncMessage] = Field(default_factory=list, max_length=500)


def require_sync_secret(authorization: str | None = Header(default=None)) -> None:
    expected = os.getenv("FLORA_SYNC_SHARED_SECRET", "").strip()
    supplied = ""
    if authorization and authorization.lower().startswith("bearer "):
        supplied = authorization[7:].strip()
    if not expected or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="invalid synchronization credentials")


def _global_case_id(hospital_id: str, leaf_id: str, source_case_id: str) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_URL, f"flora:{hospital_id}:{leaf_id}:case:{source_case_id}")


@router.post("/batch", dependencies=[Depends(require_sync_secret)])
def ingest_batch(batch: SyncBatch, database: Connection = Depends(connection)) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    accepted = 0
    duplicates = 0
    with database.transaction():
        database.execute(
            """
            INSERT INTO sync_leaf_node
              (leaf_id, hospital_id, display_name, software_version, last_seen_at, metadata)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (leaf_id) DO UPDATE SET
              hospital_id = EXCLUDED.hospital_id,
              display_name = EXCLUDED.display_name,
              software_version = EXCLUDED.software_version,
              last_seen_at = EXCLUDED.last_seen_at,
              metadata = sync_leaf_node.metadata || EXCLUDED.metadata
            """,
            (
                batch.leaf_id,
                batch.hospital_id,
                batch.display_name,
                batch.software_version,
                now,
                Jsonb({"observed_location": batch.observed_location or {}}),
            ),
        )
        database.execute(
            """UPDATE canopy_leaf_assignment
               SET applied_version=GREATEST(applied_version,%s),updated_at=(extract(epoch from clock_timestamp())*1000)::bigint
               WHERE leaf_id=%s""",
            (batch.applied_config_version, batch.leaf_id),
        )
        for message in batch.messages:
            inserted = database.execute(
                """
                INSERT INTO sync_message
                  (leaf_id, message_id, entity_type, entity_id, operation, revision, occurred_at, payload)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (leaf_id, message_id) DO NOTHING
                RETURNING id
                """,
                (
                    batch.leaf_id,
                    message.message_id,
                    message.entity_type,
                    message.entity_id,
                    message.operation,
                    message.revision,
                    message.occurred_at,
                    Jsonb(message.payload),
                ),
            ).fetchone()
            if not inserted:
                duplicates += 1
                continue
            accepted += 1
            if message.entity_type != "case_snapshot":
                continue
            case = message.payload.get("case") or {}
            global_case_id = _global_case_id(batch.hospital_id, batch.leaf_id, message.entity_id)
            database.execute(
                """
                INSERT INTO sync_case_index
                  (global_case_id, hospital_id, leaf_id, source_case_id, case_code, hn, status,
                   start_time, discharge_time, revision, snapshot, last_synced_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (leaf_id, source_case_id) DO UPDATE SET
                  case_code = EXCLUDED.case_code,
                  hn = EXCLUDED.hn,
                  status = EXCLUDED.status,
                  start_time = EXCLUDED.start_time,
                  discharge_time = EXCLUDED.discharge_time,
                  revision = EXCLUDED.revision,
                  snapshot = EXCLUDED.snapshot,
                  last_synced_at = EXCLUDED.last_synced_at
                WHERE EXCLUDED.revision >= sync_case_index.revision
                """,
                (
                    global_case_id,
                    batch.hospital_id,
                    batch.leaf_id,
                    message.entity_id,
                    case.get("case_code"),
                    case.get("hn"),
                    str(case.get("status") or "UNKNOWN").upper(),
                    case.get("start_time"),
                    case.get("discharge_time"),
                    message.revision,
                    Jsonb(message.payload),
                    now,
                ),
            )
        assignment = database.execute(
            """SELECT desired_config,desired_version,applied_version
               FROM canopy_leaf_assignment WHERE leaf_id=%s""",
            (batch.leaf_id,),
        ).fetchone()
    return {
        "ok": True,
        "accepted": accepted,
        "duplicates": duplicates,
        "server_time": now,
        "configuration": assignment["desired_config"] if assignment else None,
        "desired_config_version": assignment["desired_version"] if assignment else 0,
        "applied_config_version": assignment["applied_version"] if assignment else 0,
    }


@router.get("/fingerprint")
def fingerprint() -> dict[str, str]:
    secret = os.getenv("FLORA_SYNC_SHARED_SECRET", "").encode("utf-8")
    return {"protocol": "flora-sync-v1", "key_fingerprint": hashlib.sha256(secret).hexdigest()[:12]}
