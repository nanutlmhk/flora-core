import http.cookiejar
import json
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import Response

from .auth_canopy import read_token


router = APIRouter(
    prefix="/api/fleet/legacy",
    tags=["canopy-legacy-archive"],
    dependencies=[Depends(read_token)],
)

ARCHIVE_URL = os.getenv(
    "FLORA_INNOVIAN_ARCHIVE_URL", "http://host.docker.internal:8000/api/v1"
).rstrip("/")
ARCHIVE_SUBJECT = os.getenv("FLORA_INNOVIAN_ARCHIVE_SUBJECT", "hospital-nit").strip()
ARCHIVE_KEY = os.getenv("FLORA_INNOVIAN_ARCHIVE_KEY", "").strip()
ARCHIVE_TIMEOUT = float(os.getenv("FLORA_INNOVIAN_ARCHIVE_TIMEOUT_SECONDS", "30"))
MAX_CASE_MINUTES = int(os.getenv("FLORA_INNOVIAN_MAX_CASE_MINUTES", "1440"))

_cookies = http.cookiejar.CookieJar()
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_cookies))
_auth_lock = threading.Lock()


def _json_request(path: str, query: dict[str, Any] | None = None, retry: bool = True) -> Any:
    suffix = ""
    if query:
        suffix = "?" + urllib.parse.urlencode({key: value for key, value in query.items() if value not in (None, "")})
    headers = {"Accept": "application/json"}
    if ARCHIVE_KEY:
        headers["X-Anora-Archive-Key"] = ARCHIVE_KEY
    request = urllib.request.Request(f"{ARCHIVE_URL}{path}{suffix}", headers=headers)
    try:
        with _opener.open(request, timeout=ARCHIVE_TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        if error.code == 401 and retry and not ARCHIVE_KEY:
            _login()
            return _json_request(path, query, retry=False)
        detail = ""
        try:
            payload = json.loads(error.read().decode("utf-8"))
            detail = str(payload.get("detail") or payload.get("error") or "")
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass
        if error.code == 404:
            raise HTTPException(status_code=404, detail=detail or "Innovian archive case not found") from error
        raise HTTPException(
            status_code=503,
            detail=f"Innovian archive request failed ({error.code}){': ' + detail if detail else ''}",
        ) from error
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=503, detail="Innovian archive service is unavailable") from error


def _pdf_request(path: str, payload: dict[str, Any], retry: bool = True) -> tuple[bytes, str | None, str | None]:
    headers = {"Accept": "application/pdf", "Content-Type": "application/json"}
    if ARCHIVE_KEY:
        headers["X-Anora-Archive-Key"] = ARCHIVE_KEY
    request = urllib.request.Request(
        f"{ARCHIVE_URL}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with _opener.open(request, timeout=max(ARCHIVE_TIMEOUT, 90)) as response:
            content_type = response.headers.get_content_type()
            body = response.read()
            if content_type != "application/pdf" or not body.startswith(b"%PDF-"):
                raise HTTPException(status_code=502, detail="Innovian archive returned an invalid PDF")
            disposition = response.headers.get("Content-Disposition", "")
            match = re.search(r'filename="?([^";]+)', disposition, re.IGNORECASE)
            destination = response.headers.get("X-Anora-EPHIS-Relative-Path")
            return body, match.group(1).strip() if match else None, destination
    except urllib.error.HTTPError as error:
        if error.code == 401 and retry and not ARCHIVE_KEY:
            _login()
            return _pdf_request(path, payload, retry=False)
        detail = ""
        try:
            error_payload = json.loads(error.read().decode("utf-8"))
            detail = str(error_payload.get("detail") or error_payload.get("error") or "")
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass
        raise HTTPException(
            status_code=422 if error.code == 422 else 503,
            detail=detail or f"Innovian report request failed ({error.code})",
        ) from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise HTTPException(status_code=503, detail="Innovian report service is unavailable") from error


def _login() -> None:
    if not ARCHIVE_SUBJECT:
        raise HTTPException(status_code=503, detail="Innovian archive authentication is not configured")
    with _auth_lock:
        body = json.dumps({"subject": ARCHIVE_SUBJECT}).encode("utf-8")
        request = urllib.request.Request(
            f"{ARCHIVE_URL}/auth/login",
            data=body,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        try:
            with _opener.open(request, timeout=ARCHIVE_TIMEOUT):
                return
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
            raise HTTPException(status_code=503, detail="Innovian archive authentication failed") from error


def _iso_ms(value: Any) -> int | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return int(parsed.timestamp() * 1000)
    except (TypeError, ValueError):
        return None


def _first_text(*values: Any) -> str:
    for value in values:
        normalized = str(value or "").strip()
        if normalized:
            return normalized
    return ""


def _age_text(date_of_birth: Any, at: Any) -> str:
    try:
        born = datetime.fromisoformat(str(date_of_birth)).date()
        reference = datetime.fromisoformat(str(at).replace("Z", "+00:00")).date()
        years = reference.year - born.year - ((reference.month, reference.day) < (born.month, born.day))
        return f"{max(0, years)} yr"
    except (TypeError, ValueError):
        return ""


PARAMETER_ALIASES = {
    "HR": "hr", "HEART RATE": "hr", "PULSE": "pr", "PR": "pr", "SPO2": "spo2",
    "NBP S": "nibp_sys", "NIBP S": "nibp_sys", "NIBP SYS": "nibp_sys",
    "NBP M": "nibp_map", "NIBP M": "nibp_map", "NIBP MAP": "nibp_map",
    "NBP D": "nibp_dia", "NIBP D": "nibp_dia", "NIBP DIA": "nibp_dia",
    "ART S": "art_sys", "ABP S": "art_sys", "ART SYS": "art_sys",
    "ART M": "art_map", "ABP M": "art_map", "ART MAP": "art_map",
    "ART D": "art_dia", "ABP D": "art_dia", "ART DIA": "art_dia",
    "CVP": "cvp", "TEMP": "temperature", "TEMPERATURE": "temperature",
    "RR": "rr", "ETCO2": "et_co2", "ETCO2-": "et_co2", "INCO2": "fi_co2",
    "FIO2": "fio2", "ETO2": "et_o2", "PIP": "airway_pressure_peak",
    "PIP-": "airway_pressure_peak", "PPLAT": "airway_pressure_plateau",
    "PMEAN": "airway_pressure_mean", "PEEP": "peep_total", "PEEP-": "peep_total",
    "VT": "tidal_volume_exp", "VTEMAND": "tidal_volume_exp", "MV": "minute_volume_exp",
    "MV-": "minute_volume_exp", "XMAC": "mac", "MAC": "mac",
    "INSEV": "fi_agent", "INISO": "fi_agent", "INDES": "fi_agent", "INHAL": "fi_agent",
    "ETSEV": "et_agent", "ETISO": "et_agent", "ETDES": "et_agent", "ETHAL": "et_agent",
}


def _parameter_key(label: str) -> str:
    normalized = re.sub(r"\s+", " ", label.strip()).upper()
    if normalized in PARAMETER_ALIASES:
        return PARAMETER_ALIASES[normalized]
    safe = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_") or "parameter"
    return f"innovian_{safe}"


def _numeric(value: Any) -> float | int | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric.is_integer():
        return int(numeric)
    return round(numeric, 2)


def _display_value(value: Any) -> Any:
    numeric = _numeric(value)
    return numeric if numeric is not None else value


def _action_value(action: dict[str, Any], names: tuple[str, ...]) -> tuple[Any, str | None]:
    normalized = {str(item.get("label") or "").strip().lower(): item for item in action.get("values") or []}
    for name in names:
        item = normalized.get(name.lower())
        if item is not None and item.get("value") is not None:
            return item.get("value"), item.get("unit")
    for item in action.get("values") or []:
        if item.get("value") is not None:
            return item.get("value"), item.get("unit")
    return None, None


def _item_kind(category: str) -> str:
    if category in {"fluid", "blood"}:
        return "fluid"
    if category in {"urine", "blood_loss", "output"}:
        return "output"
    return "med"


def _build_io(records: list[dict[str, Any]], case_end: int) -> tuple[list[dict], list[dict]]:
    actions = [action for row in records for action in (row.get("actions") or [])]
    grouped: dict[str, list[dict[str, Any]]] = {}
    for action in actions:
        category = str(action.get("category") or "medication")
        label = _first_text(action.get("label"), "Innovian administration")
        key = str(action.get("source_id") or f"{category}:{label}") if category == "drip" else f"{category}:{label}"
        grouped.setdefault(key, []).append(action)

    runs: list[dict] = []
    events: list[dict] = []
    segment_id = 1
    event_id = 1
    for item_id, (_, group) in enumerate(grouped.items(), start=1):
        group.sort(key=lambda item: _iso_ms(item.get("occurred_at")) or 0)
        first = group[0]
        category = str(first.get("category") or "medication")
        label = _first_text(first.get("label"), "Innovian administration")
        kind = _item_kind(category)
        is_drip = category == "drip"
        name, _, detail = label.partition(" · ")
        run = {
            "id": item_id, "case_id": 0, "item_id": item_id, "kind": kind,
            "started_at": _iso_ms(first.get("occurred_at")) or 0,
            "stopped_at": _iso_ms(group[-1].get("occurred_at")) or case_end,
            "entry_mode": "drip" if is_drip else "bolus",
            "item_name": name or label, "item_code": f"innovian-{item_id}",
            "item_unit": "", "item_category": category,
            "route": detail or None, "note": "Migrated from Innovian", "segments": [],
        }
        if is_drip:
            current_rate = current_dose = None
            rate_unit = dose_unit = None
            for index, action in enumerate(group):
                values = {str(item.get("label") or "").strip().lower(): item for item in action.get("values") or []}
                if "rate" in values:
                    current_rate, rate_unit = values["rate"].get("value"), values["rate"].get("unit")
                if "dose" in values:
                    current_dose, dose_unit = values["dose"].get("value"), values["dose"].get("unit")
                start = _iso_ms(action.get("occurred_at")) or 0
                end = (_iso_ms(group[index + 1].get("occurred_at")) if index + 1 < len(group) else case_end) or case_end
                if end <= start or not ((_numeric(current_rate) or 0) > 0 or (_numeric(current_dose) or 0) > 0):
                    continue
                run["segments"].append({
                    "id": segment_id, "run_id": item_id, "ts_from": start, "ts_to": end,
                    "rate_value": _numeric(current_rate), "rate_unit": rate_unit,
                    "dose_value": _numeric(current_dose), "dose_unit": dose_unit,
                })
                segment_id += 1
            unit = dose_unit or rate_unit
            run["item_unit"] = unit or ""
        else:
            for action in group:
                value, unit = _action_value(
                    action,
                    ("dose",) if kind == "med" else ("volume", "amount", "dose"),
                )
                timestamp = _iso_ms(action.get("occurred_at")) or 0
                events.append({
                    "id": event_id, "case_id": 0, "item_id": item_id, "kind": kind,
                    "event_ts": timestamp,
                    "dose_value": _numeric(value) if kind == "med" else None,
                    "dose_unit": unit if kind == "med" else None,
                    "volume_ml": _numeric(value) if kind != "med" else None,
                    "note": "Migrated from Innovian",
                })
                event_id += 1
                if unit and not run["item_unit"]:
                    run["item_unit"] = unit
        runs.append(run)
    return runs, events


def _normalize_snapshot(summary: dict[str, Any], context: dict[str, Any], forms: dict[str, Any], pages: list[dict[str, Any]]) -> dict:
    records = [record for page in pages for record in page.get("records") or []]
    form_rows = forms.get("items") or []
    range_info = next((page.get("range") for page in pages if page.get("range")), {}) or {}
    start = _iso_ms(range_info.get("start") or summary.get("started_at")) or 0
    end = _iso_ms(range_info.get("end") or summary.get("completed_at")) or start
    parameter_meta: dict[str, dict[str, str]] = {}
    timeline: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    event_id = 1
    for record in records:
        timestamp = _iso_ms(record.get("time"))
        if timestamp is None:
            continue
        payload: dict[str, Any] = {}
        for source_group in ("trend", "discrete", "vent"):
            for label, measurement in (record.get(source_group) or {}).items():
                item = measurement if isinstance(measurement, dict) else {"value": measurement}
                value = item.get("value")
                if value is None:
                    continue
                key = _parameter_key(str(label))
                if key in {"fi_agent", "et_agent"} and key in payload:
                    previous = _numeric(payload[key]) or 0
                    candidate = _numeric(value)
                    if candidate is None or abs(candidate) <= abs(previous):
                        continue
                payload[key] = _display_value(value)
                parameter_meta[key] = {"label": str(label), "unit": str(item.get("unit") or "").strip()}
        if payload:
            timeline.append({"ts_minute": timestamp, "payload": payload})
        for source_event in record.get("events") or []:
            events.append({
                "id": event_id, "event_ts": _iso_ms(source_event.get("occurred_at")) or timestamp,
                "event_type": "event", "title": _first_text(source_event.get("name"), source_event.get("code"), "Innovian event"),
                "source": "innovian",
            })
            event_id += 1

    for note in context.get("notes") or []:
        timestamp = _iso_ms(note.get("occurred_at"))
        if timestamp is None or note.get("source_deleted"):
            continue
        events.append({
            "id": event_id, "event_ts": timestamp, "event_type": "note",
            "title": _first_text(note.get("note_name"), note.get("note_type"), note.get("text"), "Innovian note"),
            "source": "innovian",
        })
        event_id += 1

    io_runs, io_events = _build_io(records, end)
    detail_available = bool(
        timeline
        or events
        or io_runs
        or io_events
        or form_rows
        or context.get("staff")
        or context.get("notes")
    )
    patient = summary.get("patient") or {}
    demographics = context.get("demographics") or {}
    procedure = summary.get("procedure") or {}
    detailed = summary.get("context") or {}
    migration = summary.get("migration") or {}
    allergies = [{
        "id": index, "allergen": _first_text(item.get("label"), item.get("description"), "Recorded allergy"),
        "reaction": item.get("reaction"), "source": "innovian",
    } for index, item in enumerate(context.get("allergies") or [], start=1) if not item.get("source_deleted")]
    diagnosis_name = _first_text(detailed.get("diagnosis_name"), procedure.get("diagnosis"))
    procedure_name = _first_text(detailed.get("procedure_name"), procedure.get("name"))
    source_case_id = str(summary.get("source_case_id") or "")
    snapshot = {
        "origin": "innovian_archive",
        "source": {
            "system": "innovian", "case_id": source_case_id,
            "mapping_profile": migration.get("mapping_profile"),
            "migrated_at": migration.get("migrated_at"), "status": migration.get("status"),
        },
        "coverage": {
            "minutes_loaded": len(records),
            "minutes_total": int(range_info.get("total_minutes") or len(records)),
            "truncated": bool((range_info.get("total_minutes") or 0) > len(records)),
            "staff_count": len(context.get("staff") or []),
            "note_count": len(context.get("notes") or []),
            "form_count": len(form_rows),
            "detail_available": detail_available,
            "index_only": not detail_available,
        },
        "case": {
            "id": source_case_id, "case_code": f"Innovian #{source_case_id}", "status": "ARCHIVED",
            "start_time": _iso_ms(summary.get("started_at")) or start,
            "discharge_time": _iso_ms(summary.get("completed_at")) or end,
            "admission_source": "innovian",
        },
        "patient": {"row": {
            "patient_name": _first_text(detailed.get("patient_name"), patient.get("display_name")),
            "hn": _first_text(detailed.get("hn"), patient.get("reference")),
            "an": _first_text(detailed.get("encounter_number"), patient.get("encounter_number")),
            "date_of_birth": detailed.get("date_of_birth") or patient.get("date_of_birth"),
            "sex": _first_text(detailed.get("gender"), patient.get("gender")),
            "age_text": _age_text(detailed.get("date_of_birth") or patient.get("date_of_birth"), summary.get("started_at")),
            "asa_status": detailed.get("asa_status") or patient.get("asa_status"),
            "national_id": demographics.get("national_id"),
            "blood_group_text": demographics.get("blood_type"),
            "weight_kg": demographics.get("admission_weight"),
            "weight_unit": demographics.get("weight_unit"),
            "height_cm": demographics.get("height"),
            "height_unit": demographics.get("height_unit"),
            "hospital_admitted_at": demographics.get("hospital_admitted_at"),
            "nationality": demographics.get("nationality"),
            "language": demographics.get("language"),
            "religion": demographics.get("religion"),
            "race": demographics.get("race"),
            "ethnicity": demographics.get("ethnicity"),
            "marital_status": demographics.get("marital_status"),
            "address_line_1": demographics.get("address_line_1"),
            "address_line_2": demographics.get("address_line_2"),
            "city": demographics.get("city"),
            "state_or_province": demographics.get("state_or_province"),
            "postal_code": demographics.get("postal_code"),
            "country_code": demographics.get("country_code"),
            "ward_location": demographics.get("ward_location"),
            "source_patient_id": demographics.get("source_patient_id"),
            "patient_code": demographics.get("patient_code"),
            "booking_number": demographics.get("booking_number"),
            "booking_management": demographics.get("booking_management"),
            "procedure_function_type": demographics.get("procedure_function_type"),
            "primary_care_md": demographics.get("primary_care_md"),
            "primary_care_rn": demographics.get("primary_care_rn"),
            "hospital_code": demographics.get("hospital_code"),
            "surgical_specialty": demographics.get("surgical_specialty"),
            "patient_status": demographics.get("patient_status"),
            "source": "innovian",
        }},
        "timeline": {"rows": timeline}, "events": {"rows": events},
        "io_runs": {"rows": io_runs}, "io_events": {"rows": io_events},
        "allergies": {"rows": allergies},
        "diagnosis": {"rows": ([{"id": 1, "diagnosis_text": diagnosis_name, "icd_code": detailed.get("diagnosis_code")} ] if diagnosis_name else [])},
        "procedures": {"rows": ([{"id": 1, "procedure_text": procedure_name, "icd_code": detailed.get("procedure_code")} ] if procedure_name else [])},
        "staff": {"rows": context.get("staff") or []},
        "forms": {"rows": form_rows},
        "parameter_meta": parameter_meta,
        "window": {"from": start, "to": end},
    }
    return {
        "snapshot": snapshot, "leaf_name": "Innovian archive",
        "last_synced_at": migration.get("migrated_at") or summary.get("completed_at"),
    }


@router.get("/status")
def legacy_status() -> dict:
    result = _json_request("/archive/cases", {"source": "innovian", "limit": 1})
    return {"available": True, "has_cases": bool(result.get("items")), "has_more": bool(result.get("has_more"))}


@router.get("/cases")
def legacy_cases(
    query: str | None = Query(default=None, max_length=160),
    from_date: str | None = Query(default=None, alias="from", max_length=10),
    to_date: str | None = Query(default=None, alias="to", max_length=10),
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None, max_length=200),
) -> dict:
    return _json_request("/archive/cases", {
        "source": "innovian", "query": query, "from": from_date, "to": to_date,
        "limit": limit, "cursor": cursor,
    })


@router.get("/cases/{archive_case_id}/snapshot")
def legacy_case_snapshot(archive_case_id: uuid.UUID) -> dict:
    summary = _json_request(f"/archive/cases/{archive_case_id}")
    context = _json_request(f"/archive/cases/{archive_case_id}/clinical-context")
    forms = _json_request(f"/archive/cases/{archive_case_id}/forms")
    pages: list[dict[str, Any]] = []
    offset = 0
    while offset < MAX_CASE_MINUTES:
        page = _json_request(
            f"/archive/cases/{archive_case_id}/minute-records",
            {"offset_minutes": offset, "limit_minutes": min(360, MAX_CASE_MINUTES - offset)},
        )
        pages.append(page)
        loaded = len(page.get("records") or [])
        if not page.get("has_more") or loaded == 0:
            break
        offset += loaded
    return _normalize_snapshot(summary, context, forms, pages)


@router.get("/cases/{archive_case_id}/report-options")
def legacy_report_options(archive_case_id: uuid.UUID) -> dict:
    return _json_request(f"/archive/cases/{archive_case_id}/report-options")


@router.post("/cases/{archive_case_id}/report.pdf")
def legacy_report_pdf(
    archive_case_id: uuid.UUID,
    payload: dict[str, Any] = Body(...),
) -> Response:
    sections = payload.get("sections")
    if (
        not isinstance(sections, list)
        or not 1 <= len(sections) <= 24
        or any(not isinstance(section, str) or not section.strip() for section in sections)
        or len(set(sections)) != len(sections)
    ):
        raise HTTPException(status_code=422, detail="Select between 1 and 24 unique report sections")
    report, filename, destination = _pdf_request(
        f"/archive/cases/{archive_case_id}/report.pdf",
        {"sections": sections},
    )
    output_filename = filename or f"flora-legacy-{archive_case_id}.pdf"
    headers = {
        "Content-Disposition": f'inline; filename="{output_filename}"',
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
    }
    if destination:
        headers["X-Flora-EPHIS-Relative-Path"] = destination
    return Response(
        report,
        media_type="application/pdf",
        headers=headers,
    )
