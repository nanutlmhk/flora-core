import uuid

from fastapi import APIRouter, Depends, HTTPException
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
        SELECT leaf_id, hospital_id, display_name, software_version, last_seen_at, registered_at,
               CASE WHEN last_seen_at >= now() - interval '90 seconds' THEN 'online'
                    WHEN last_seen_at >= now() - interval '10 minutes' THEN 'delayed'
                    ELSE 'offline' END AS connection_status
        FROM sync_leaf_node
        ORDER BY hospital_id, display_name, leaf_id
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
