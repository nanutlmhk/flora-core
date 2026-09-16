import json
import re
import time
from datetime import datetime

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from psycopg import Connection

from ..database import connection
from .auth_leaf import current_user

router = APIRouter(prefix="/api/ephis", tags=["EPHIS"])


def summary(database: Connection) -> dict:
    return dict(database.execute("""SELECT count(*) AS total_rows,min(admit_date) AS first_admit_date,
      max(admit_date) AS last_admit_date,max(imported_at) AS last_imported_at FROM ephis_daily_case""").fetchone())


@router.get("/import-status")
def import_status(database: Connection = Depends(connection)):
    return summary(database)


@router.get("/daily-summary")
def daily_summary(from_date: str = Query("", alias="from"), to: str = "", database: Connection = Depends(connection)):
    rows = database.execute("""SELECT admit_date,count(*) AS case_count FROM ephis_daily_case
      WHERE (%s='' OR admit_date >= %s) AND (%s='' OR admit_date <= %s)
      GROUP BY admit_date ORDER BY admit_date DESC""", (from_date, from_date, to, to)).fetchall()
    return {"rows": rows}


@router.get("/daily-cases")
def daily_cases(admit_date: str = "", hn: str = "", database: Connection = Depends(connection)):
    query = hn.strip().lower()
    rows = database.execute("""SELECT hn,admit_date,admit_datetime,raw_admit_value FROM ephis_daily_case
      WHERE (%s='' OR admit_date=%s) AND (%s='' OR lower(hn) LIKE %s)
      ORDER BY admit_date DESC,coalesce(admit_datetime,admit_date) DESC,hn""",
      (admit_date, admit_date, query, f"%{query}%" if query else "")).fetchall()
    return {"rows": rows}


def parse_date(value: str):
    value = value.strip()
    for pattern in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%Y %H:%M", "%m/%d/%Y %H:%M:%S"):
        try:
            parsed = datetime.strptime(value, pattern)
            return parsed.strftime("%Y-%m-%d"), parsed.strftime("%Y-%m-%dT%H:%M:%S") if "%H" in pattern else None
        except ValueError:
            pass
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.strftime("%Y-%m-%d"), parsed.strftime("%Y-%m-%dT%H:%M:%S")
    except ValueError as error:
        raise ValueError(value) from error


@router.post("/import-daily-cases")
def import_daily_cases(payload: dict = Body(...), _: dict = Depends(current_user), database: Connection = Depends(connection)):
    lines = [line.rstrip("\r") for line in str(payload.get("tsvText") or "").splitlines() if line.strip()]
    if len(lines) < 2:
        raise HTTPException(400, "TSV must include a header row and at least one data row")
    headers = lines[0].split("\t")
    normalized = {re.sub(r"[^a-z0-9]+", "", value.lower()): index for index, value in enumerate(headers)}
    hn_index = next((normalized[key] for key in ("hn", "patid", "patientid") if key in normalized), None)
    date_index = next((normalized[key] for key in ("admitdate", "admitdatetime", "admitdt") if key in normalized), None)
    if hn_index is None or date_index is None:
        raise HTTPException(400, "TSV requires HN and admit date columns")
    rows = []
    for line_number, line in enumerate(lines[1:], 2):
        values = line.split("\t") + [""] * len(headers)
        hn, raw = values[hn_index].strip(), values[date_index].strip()
        if not hn or not raw:
            continue
        try:
            admit_date, admit_datetime = parse_date(raw)
        except ValueError:
            raise HTTPException(400, f"Unable to parse admit date on row {line_number}: {raw}")
        rows.append((hn, admit_date, admit_datetime, raw, json.dumps(dict(zip(headers, values)), ensure_ascii=False)))
    if not rows:
        raise HTTPException(400, "No valid daily case rows found in TSV")
    imported_at = int(time.time() * 1000)
    with database.transaction():
        if payload.get("replaceExisting", True):
            database.execute("DELETE FROM ephis_daily_case")
        for row in rows:
            database.execute("""INSERT INTO ephis_daily_case(hn,admit_date,admit_datetime,raw_admit_value,source_payload,imported_at)
              VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (hn,admit_date,coalesce(admit_datetime,''))
              DO UPDATE SET raw_admit_value=excluded.raw_admit_value,source_payload=excluded.source_payload,imported_at=excluded.imported_at""", row + (imported_at,))
    result = summary(database)
    result.update(ok=True, imported_rows=len(rows), imported_at=imported_at)
    return result
