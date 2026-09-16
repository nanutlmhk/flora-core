from fastapi import APIRouter, Depends, HTTPException
from psycopg import Connection

from ..database import connection
from ..device_writer import device_writer
from .auth_leaf import current_user

router = APIRouter(prefix="/api/case", tags=["Vector writer"])


@router.get("/{case_id}/writer-status")
def writer_status(case_id: int, database: Connection = Depends(connection)):
    if not database.execute("SELECT 1 FROM cases WHERE id=%s", (case_id,)).fetchone():
        raise HTTPException(404, "not found")
    return {"writer": device_writer.status(case_id), "enabled": device_writer.enabled, "source": "vector"}


@router.post("/{case_id}/writer-refetch")
def writer_refetch(case_id: int, _: dict = Depends(current_user), database: Connection = Depends(connection)):
    if not database.execute("SELECT 1 FROM cases WHERE id=%s AND status='active'", (case_id,)).fetchone():
        raise HTTPException(404, "active case not found")
    device_writer.refetch(case_id)
    return {"ok": True}
