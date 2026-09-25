import time
from typing import Any, Literal

from fastapi import APIRouter, Body, Depends, HTTPException
from psycopg import Connection
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from ..clinical import text
from ..database import connection
from .auth_canopy import read_token


router = APIRouter(prefix="/api/fleet/control", tags=["canopy-control-plane"])

LOCATION_PARENT = {
    "hospital": None,
    "building": "hospital",
    "care_unit": "building",
    "room": "care_unit",
    "bed": "room",
}


def now_ms() -> int:
    return int(time.time() * 1000)


def require_admin(user: dict[str, Any] = Depends(read_token)) -> dict[str, Any]:
    if str(user.get("role") or "").lower() not in {"admin", "system_admin"}:
        raise HTTPException(status_code=403, detail="Canopy administrator access required")
    return user


class LocationInput(BaseModel):
    parent_id: int | None = None
    kind: Literal["hospital", "building", "care_unit", "room", "bed"]
    name: str = Field(min_length=1, max_length=160)
    code: str | None = Field(default=None, max_length=80)
    sort_order: int = 0
    is_active: bool = True


class GroupInput(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=500)
    is_active: bool = True


class GroupMembersInput(BaseModel):
    leaf_ids: list[str] = Field(default_factory=list, max_length=1000)


class AssignmentInput(BaseModel):
    bed_location_id: int
    timezone: str = Field(default="Asia/Bangkok", min_length=1, max_length=80)
    date_format: Literal["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] = "DD/MM/YYYY"
    time_format: Literal["24h", "12h"] = "24h"


class GroupSettingsInput(BaseModel):
    timezone: str = Field(default="Asia/Bangkok", min_length=1, max_length=80)
    date_format: Literal["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] = "DD/MM/YYYY"
    time_format: Literal["24h", "12h"] = "24h"


def validate_location_parent(database: Connection, kind: str, parent_id: int | None) -> None:
    expected = LOCATION_PARENT[kind]
    if expected is None:
        if parent_id is not None:
            raise HTTPException(status_code=400, detail="Hospital cannot have a parent location")
        return
    if parent_id is None:
        raise HTTPException(status_code=400, detail=f"{kind} requires a {expected} parent")
    parent = database.execute("SELECT kind FROM canopy_location WHERE id=%s", (parent_id,)).fetchone()
    if not parent or parent["kind"] != expected:
        raise HTTPException(status_code=400, detail=f"{kind} must be inside a {expected}")


def location_path(database: Connection, bed_location_id: int) -> dict[str, str]:
    rows = database.execute(
        """
        WITH RECURSIVE lineage AS (
          SELECT id, parent_id, kind, name FROM canopy_location WHERE id=%s AND is_active
          UNION ALL
          SELECT parent.id, parent.parent_id, parent.kind, parent.name
          FROM canopy_location parent JOIN lineage child ON child.parent_id=parent.id
          WHERE parent.is_active
        )
        SELECT kind, name FROM lineage
        """,
        (bed_location_id,),
    ).fetchall()
    names = {row["kind"]: row["name"] for row in rows}
    missing = [kind for kind in LOCATION_PARENT if kind not in names]
    if missing or not rows or rows[0]["kind"] != "bed":
        raise HTTPException(status_code=400, detail="Select a bed in a complete active location hierarchy")
    return {
        "hospitalName": names["hospital"],
        "buildingName": names["building"],
        "careUnitName": names["care_unit"],
        "roomName": names["room"],
        "bedName": names["bed"],
    }


def write_assignment(
    database: Connection,
    leaf_id: str,
    bed_location_id: int,
    settings: dict[str, str],
) -> dict[str, Any]:
    if not database.execute("SELECT 1 FROM sync_leaf_node WHERE leaf_id=%s", (leaf_id,)).fetchone():
        raise HTTPException(status_code=404, detail="Leaf not found")
    location = location_path(database, bed_location_id)
    version = now_ms()
    desired = {
        "version": version,
        "location": location,
        "timezone": settings["timezone"],
        "dateFormat": settings["date_format"],
        "timeFormat": settings["time_format"],
    }
    return database.execute(
        """
        INSERT INTO canopy_leaf_assignment
          (leaf_id, bed_location_id, desired_config, desired_version, applied_version, assigned_at, updated_at)
        VALUES (%s,%s,%s,%s,0,%s,%s)
        ON CONFLICT (leaf_id) DO UPDATE SET
          bed_location_id=excluded.bed_location_id,
          desired_config=excluded.desired_config,
          desired_version=excluded.desired_version,
          updated_at=excluded.updated_at
        RETURNING *
        """,
        (leaf_id, bed_location_id, Jsonb(desired), version, version, version),
    ).fetchone()


def ensure_location(database: Connection, parent_id: int | None, kind: str, name: str) -> int:
    existing = database.execute(
        """SELECT id FROM canopy_location
           WHERE coalesce(parent_id,0)=coalesce(%s,0) AND lower(name)=lower(%s) LIMIT 1""",
        (parent_id, name),
    ).fetchone()
    if existing:
        return existing["id"]
    current = now_ms()
    return database.execute(
        """INSERT INTO canopy_location(parent_id,kind,name,is_active,sort_order,created_at,updated_at)
           VALUES (%s,%s,%s,true,0,%s,%s) RETURNING id""",
        (parent_id, kind, name, current, current),
    ).fetchone()["id"]


@router.get("", dependencies=[Depends(require_admin)])
def control_plane(database: Connection = Depends(connection)) -> dict[str, Any]:
    locations = database.execute(
        "SELECT * FROM canopy_location ORDER BY sort_order, name, id"
    ).fetchall()
    groups = database.execute(
        """
        SELECT group_row.*,
               coalesce(array_agg(member.leaf_id ORDER BY member.leaf_id)
                 FILTER (WHERE member.leaf_id IS NOT NULL), '{}') AS leaf_ids
        FROM canopy_leaf_group group_row
        LEFT JOIN canopy_leaf_group_member member ON member.group_id=group_row.id
        GROUP BY group_row.id ORDER BY group_row.name
        """
    ).fetchall()
    leaves = database.execute(
        """
        SELECT leaf.leaf_id, leaf.hospital_id, leaf.display_name, leaf.software_version,
               leaf.last_seen_at, assignment.bed_location_id, assignment.desired_config,
               assignment.desired_version, assignment.applied_version,
               CASE WHEN assignment.leaf_id IS NULL THEN 'unassigned'
                    WHEN assignment.applied_version >= assignment.desired_version THEN 'synced'
                    WHEN assignment.applied_version = 0 THEN 'pending'
                    ELSE 'outdated' END AS config_status
        FROM sync_leaf_node leaf
        LEFT JOIN canopy_leaf_assignment assignment ON assignment.leaf_id=leaf.leaf_id
        ORDER BY leaf.display_name, leaf.leaf_id
        """
    ).fetchall()
    return {"locations": locations, "groups": groups, "leaves": leaves}


@router.post("/locations", dependencies=[Depends(require_admin)])
def create_location(payload: LocationInput, database: Connection = Depends(connection)) -> dict[str, Any]:
    validate_location_parent(database, payload.kind, payload.parent_id)
    current = now_ms()
    with database.transaction():
        row = database.execute(
            """INSERT INTO canopy_location(parent_id,kind,code,name,is_active,sort_order,created_at,updated_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
            (payload.parent_id, payload.kind, text(payload.code), payload.name.strip(), payload.is_active,
             payload.sort_order, current, current),
        ).fetchone()
    return row


@router.put("/locations/{location_id}", dependencies=[Depends(require_admin)])
def update_location(location_id: int, payload: LocationInput, database: Connection = Depends(connection)) -> dict[str, Any]:
    validate_location_parent(database, payload.kind, payload.parent_id)
    current = now_ms()
    with database.transaction():
        row = database.execute(
            """UPDATE canopy_location SET parent_id=%s,kind=%s,code=%s,name=%s,is_active=%s,
               sort_order=%s,updated_at=%s WHERE id=%s RETURNING *""",
            (payload.parent_id, payload.kind, text(payload.code), payload.name.strip(), payload.is_active,
             payload.sort_order, current, location_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Location not found")
        affected = database.execute(
            """
            WITH RECURSIVE descendants AS (
              SELECT id FROM canopy_location WHERE id=%s
              UNION ALL SELECT child.id FROM canopy_location child
              JOIN descendants parent ON child.parent_id=parent.id
            )
            SELECT assignment.* FROM canopy_leaf_assignment assignment
            WHERE assignment.bed_location_id IN (SELECT id FROM descendants)
            """,
            (location_id,),
        ).fetchall()
        for assignment in affected:
            old = assignment["desired_config"] or {}
            write_assignment(database, assignment["leaf_id"], assignment["bed_location_id"], {
                "timezone": str(old.get("timezone") or "Asia/Bangkok"),
                "date_format": str(old.get("dateFormat") or "DD/MM/YYYY"),
                "time_format": str(old.get("timeFormat") or "24h"),
            })
    return row


@router.post("/groups", dependencies=[Depends(require_admin)])
def create_group(payload: GroupInput, database: Connection = Depends(connection)) -> dict[str, Any]:
    current = now_ms()
    with database.transaction():
        return database.execute(
            """INSERT INTO canopy_leaf_group(name,description,is_active,created_at,updated_at)
               VALUES (%s,%s,%s,%s,%s) RETURNING *""",
            (payload.name.strip(), payload.description.strip(), payload.is_active, current, current),
        ).fetchone()


@router.put("/groups/{group_id}", dependencies=[Depends(require_admin)])
def update_group(group_id: int, payload: GroupInput, database: Connection = Depends(connection)) -> dict[str, Any]:
    with database.transaction():
        row = database.execute(
            """UPDATE canopy_leaf_group SET name=%s,description=%s,is_active=%s,updated_at=%s
               WHERE id=%s RETURNING *""",
            (payload.name.strip(), payload.description.strip(), payload.is_active, now_ms(), group_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Group not found")
    return row


@router.put("/groups/{group_id}/members", dependencies=[Depends(require_admin)])
def update_group_members(group_id: int, payload: GroupMembersInput, database: Connection = Depends(connection)) -> dict[str, Any]:
    leaf_ids = list(dict.fromkeys(value.strip() for value in payload.leaf_ids if value.strip()))
    current = now_ms()
    with database.transaction():
        if not database.execute("SELECT 1 FROM canopy_leaf_group WHERE id=%s", (group_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Group not found")
        existing = database.execute(
            "SELECT leaf_id FROM sync_leaf_node WHERE leaf_id=ANY(%s)", (leaf_ids,)
        ).fetchall() if leaf_ids else []
        if len(existing) != len(leaf_ids):
            raise HTTPException(status_code=400, detail="One or more Leafs do not exist")
        database.execute("DELETE FROM canopy_leaf_group_member WHERE group_id=%s", (group_id,))
        for leaf_id in leaf_ids:
            database.execute(
                "INSERT INTO canopy_leaf_group_member(group_id,leaf_id,created_at) VALUES (%s,%s,%s)",
                (group_id, leaf_id, current),
            )
    return {"ok": True, "group_id": group_id, "leaf_ids": leaf_ids}


@router.put("/leaves/{leaf_id}/assignment", dependencies=[Depends(require_admin)])
def assign_leaf(leaf_id: str, payload: AssignmentInput, database: Connection = Depends(connection)) -> dict[str, Any]:
    with database.transaction():
        return write_assignment(database, leaf_id, payload.bed_location_id, {
            "timezone": payload.timezone,
            "date_format": payload.date_format,
            "time_format": payload.time_format,
        })


@router.post("/leaves/{leaf_id}/adopt-observed", dependencies=[Depends(require_admin)])
def adopt_observed_location(leaf_id: str, database: Connection = Depends(connection)) -> dict[str, Any]:
    leaf = database.execute(
        "SELECT metadata FROM sync_leaf_node WHERE leaf_id=%s", (leaf_id,)
    ).fetchone()
    if not leaf:
        raise HTTPException(status_code=404, detail="Leaf not found")
    observed = (leaf["metadata"] or {}).get("observed_location") or {}
    names = [
        ("hospital", text(observed.get("hospitalName"))),
        ("building", text(observed.get("buildingName"))),
        ("care_unit", text(observed.get("careUnitName"))),
        ("room", text(observed.get("roomName"))),
        ("bed", text(observed.get("bedName"))),
    ]
    if any(not name for _, name in names):
        raise HTTPException(status_code=400, detail="Leaf has not reported a complete location yet")
    with database.transaction():
        parent_id = None
        for kind, name in names:
            parent_id = ensure_location(database, parent_id, kind, name)
        return write_assignment(database, leaf_id, int(parent_id), {
            "timezone": text(observed.get("timezone")) or "Asia/Bangkok",
            "date_format": text(observed.get("dateFormat")) or "DD/MM/YYYY",
            "time_format": text(observed.get("timeFormat")) or "24h",
        })


@router.put("/groups/{group_id}/settings", dependencies=[Depends(require_admin)])
def apply_group_settings(group_id: int, payload: GroupSettingsInput, database: Connection = Depends(connection)) -> dict[str, Any]:
    with database.transaction():
        assignments = database.execute(
            """SELECT assignment.* FROM canopy_leaf_group_member member
               JOIN canopy_leaf_assignment assignment ON assignment.leaf_id=member.leaf_id
               WHERE member.group_id=%s""",
            (group_id,),
        ).fetchall()
        for assignment in assignments:
            write_assignment(database, assignment["leaf_id"], assignment["bed_location_id"], {
                "timezone": payload.timezone,
                "date_format": payload.date_format,
                "time_format": payload.time_format,
            })
    return {"ok": True, "updated": len(assignments)}
