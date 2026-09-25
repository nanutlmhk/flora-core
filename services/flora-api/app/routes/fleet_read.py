import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg import Connection

from ..database import connection
from .auth_canopy import read_token


router = APIRouter(
    prefix="/api/fleet",
    tags=["canopy-fleet"],
    dependencies=[Depends(read_token)],
)


@router.get("/leaves")
def leaves(database: Connection = Depends(connection)) -> dict:
    rows = database.execute(
        """
        SELECT leaf.leaf_id, leaf.hospital_id, leaf.display_name, leaf.software_version,
               leaf.last_seen_at, leaf.registered_at,
               assignment.desired_config#>>'{location,hospitalName}' AS hospital_name,
               assignment.desired_config#>>'{location,buildingName}' AS building_name,
               assignment.desired_config#>>'{location,careUnitName}' AS care_unit_name,
               assignment.desired_config#>>'{location,roomName}' AS room_name,
               assignment.desired_config#>>'{location,bedName}' AS bed_name,
               assignment.desired_version, assignment.applied_version,
               CASE WHEN assignment.leaf_id IS NULL THEN 'unassigned'
                    WHEN assignment.applied_version >= assignment.desired_version THEN 'synced'
                    WHEN assignment.applied_version = 0 THEN 'pending'
                    ELSE 'outdated' END AS config_status,
               CASE WHEN leaf.last_seen_at >= now() - interval '90 seconds' THEN 'online'
                    WHEN leaf.last_seen_at >= now() - interval '10 minutes' THEN 'delayed'
                    ELSE 'offline' END AS connection_status
        FROM sync_leaf_node leaf
        LEFT JOIN canopy_leaf_assignment assignment ON assignment.leaf_id=leaf.leaf_id
        ORDER BY coalesce(assignment.desired_config#>>'{location,hospitalName}', leaf.hospital_id),
                 assignment.desired_config#>>'{location,buildingName}',
                 assignment.desired_config#>>'{location,careUnitName}',
                 assignment.desired_config#>>'{location,roomName}', leaf.display_name, leaf.leaf_id
        """
    ).fetchall()
    return {"rows": rows}


@router.get("/active-cases")
def active_cases(database: Connection = Depends(connection)) -> dict:
    rows = database.execute(
        """
        SELECT c.global_case_id, c.hospital_id, c.leaf_id, l.display_name AS leaf_name,
               c.source_case_id, c.case_code, c.hn, c.status, c.start_time,
               c.discharge_time, c.last_synced_at,
               COALESCE(NULLIF(c.snapshot->'case'->>'admission_source', ''), 'unknown') AS admission_source,
               COALESCE(NULLIF(c.snapshot#>>'{patient,row,source}', ''),
                        NULLIF(c.snapshot->'case'->>'admission_source', ''), 'unknown') AS source_system,
               CASE WHEN l.last_seen_at >= now() - interval '90 seconds' THEN 'live'
                    WHEN l.last_seen_at >= now() - interval '10 minutes' THEN 'delayed'
                    ELSE 'offline' END AS sync_status
        FROM sync_case_index c
        JOIN sync_leaf_node l ON l.leaf_id = c.leaf_id
        WHERE upper(c.status) = 'ACTIVE'
        ORDER BY c.start_time DESC NULLS LAST, c.last_synced_at DESC
        """
    ).fetchall()
    return {"rows": rows}


@router.get("/cases")
def cases(
    status: str | None = Query(default=None, max_length=24),
    limit: int = Query(default=50, ge=1, le=500),
    database: Connection = Depends(connection),
) -> dict:
    normalized_status = str(status or "").strip().upper()
    if normalized_status and normalized_status not in {"ACTIVE", "DISCHARGED", "ARCHIVED"}:
        raise HTTPException(status_code=400, detail="invalid case status")
    rows = database.execute(
        """
        SELECT c.global_case_id, c.hospital_id, c.leaf_id, l.display_name AS leaf_name,
               c.source_case_id, c.case_code, c.hn, c.status, c.start_time,
               c.discharge_time, c.last_synced_at,
               COALESCE(NULLIF(c.snapshot->'case'->>'admission_source', ''), 'unknown') AS admission_source,
               COALESCE(NULLIF(c.snapshot#>>'{patient,row,source}', ''),
                        NULLIF(c.snapshot->'case'->>'admission_source', ''), 'unknown') AS source_system,
               CASE WHEN l.last_seen_at >= now() - interval '90 seconds' THEN 'live'
                    WHEN l.last_seen_at >= now() - interval '10 minutes' THEN 'delayed'
                    ELSE 'offline' END AS sync_status
        FROM sync_case_index c
        JOIN sync_leaf_node l ON l.leaf_id = c.leaf_id
        WHERE (%s = '' OR upper(c.status) = %s)
        ORDER BY c.last_synced_at DESC, c.start_time DESC NULLS LAST
        LIMIT %s
        """,
        (normalized_status, normalized_status, limit),
    ).fetchall()
    return {"rows": rows}


@router.get("/cases/{global_case_id}/snapshot")
def case_snapshot(global_case_id: uuid.UUID, database: Connection = Depends(connection)) -> dict:
    row = database.execute(
        """
        SELECT c.global_case_id, c.hospital_id, c.leaf_id, l.display_name AS leaf_name,
               c.source_case_id, c.status, c.revision, c.last_synced_at, c.snapshot
        FROM sync_case_index c
        JOIN sync_leaf_node l ON l.leaf_id = c.leaf_id
        WHERE c.global_case_id = %s
        """,
        (global_case_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="synchronized case not found")
    return row
