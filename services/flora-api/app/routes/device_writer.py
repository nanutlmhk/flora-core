from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg import Connection

from ..database import connection
from ..device_writer import device_writer
from .auth_leaf import require_permission

router = APIRouter(prefix="/api/case", tags=["Vector writer"], dependencies=[Depends(require_permission("case.read"))])


@router.get("/device-status")
def source_device_status(online_window_sec: int = Query(default=30, ge=1, le=3600)):
    try:
        return device_writer.source_status(online_window_sec)
    except Exception as error:
        raise HTTPException(503, f"device source unavailable: {error}") from error


@router.get("/{case_id}/writer-status")
def writer_status(case_id: int, database: Connection = Depends(connection)):
    if not database.execute("SELECT 1 FROM cases WHERE id=%s", (case_id,)).fetchone():
        raise HTTPException(404, "not found")
    return {"writer": device_writer.status(case_id), "enabled": device_writer.enabled, "source": "vector"}


@router.post("/{case_id}/writer-refetch")
def writer_refetch(case_id: int, _: dict = Depends(require_permission("case.chart")), database: Connection = Depends(connection)):
    if not database.execute("SELECT 1 FROM cases WHERE id=%s AND status='active'", (case_id,)).fetchone():
        raise HTTPException(404, "active case not found")
    device_writer.refetch(case_id)
    return {"ok": True}
