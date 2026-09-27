import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from psycopg import Connection
from pydantic import BaseModel, Field

from ..database import connection
from ..services.innovian_report import build_innovian_report
from .auth_canopy import read_token


router = APIRouter(
    prefix="/api/fleet/legacy",
    tags=["canopy-legacy-archive"],
    dependencies=[Depends(read_token)],
)


class LegacyReportRequest(BaseModel):
    sections: list[str] = Field(min_length=1, max_length=24)

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


def _minute(value: datetime) -> datetime:
    return value.replace(second=0, microsecond=0)


def _decode_trend_sample(encoded: int, exponent: int, decimal_places: int) -> int | float | None:
    source_word = ((encoded & 0xFF) << 8) | ((encoded >> 8) & 0xFF)
    if source_word >= 32000:
        return None
    return round(source_word * (10 ** exponent), decimal_places)


def _action_category(source_type: int | None, label: str | None) -> str:
    normalized = str(label or "").upper()
    if source_type == 1:
        return "blood" if any(token in normalized for token in ("LPRC", "PRC", "FFP", "LPPC", "PLT", "BLOOD")) else "fluid"
    if source_type == 2:
        return "drip"
    if source_type == 3:
        return "medication"
    if "URINE" in normalized:
        return "urine"
    if "BLOOD" in normalized and ("LOST" in normalized or "LOSS" in normalized):
        return "blood_loss"
    return "output"


def _display_value(value: Any) -> Any:
    numeric = _numeric(value)
    return numeric if numeric is not None else value


def _encounter_case_ids(database: Connection, archive_case_id: uuid.UUID, row: dict[str, Any]) -> list[uuid.UUID]:
    ids = [archive_case_id]
    companions = database.execute(
        """SELECT sibling.id
           FROM archive_case sibling
           LEFT JOIN archive_case_context sibling_context ON sibling_context.archive_case_id=sibling.id
           WHERE sibling.id<>%s AND sibling.source_system='innovian'
             AND sibling.started_at IS NOT DISTINCT FROM %s
             AND sibling.completed_at IS NOT DISTINCT FROM %s
             AND (
               (%s::text IS NOT NULL AND sibling_context.hn=%s::text)
               OR (%s::text IS NOT NULL AND sibling.patient_reference=%s::text)
             )""",
        (
            archive_case_id, row.get("started_at"), row.get("completed_at"),
            row.get("hn"), row.get("hn"), row.get("patient_reference"), row.get("patient_reference"),
        ),
    ).fetchall()
    ids.extend(item["id"] for item in companions)
    return ids


def _best_encounter_forms(database: Connection, case_ids: list[uuid.UUID], preferred_case_id: uuid.UUID) -> list[dict[str, Any]]:
    candidates = database.execute(
        """SELECT form.id,form.archive_case_id,form.source_form_id,form.source_original_form_id,
                  form.name,form.layout,form.source_created_at,form.source_updated_at,
                  count(field.id) FILTER (
                    WHERE field.value->>'kind'<>'empty' OR nullif(field.raw_value,'') IS NOT NULL
                  ) AS populated_fields
           FROM archive_form form
           LEFT JOIN archive_form_field field ON field.archive_form_id=form.id
           WHERE form.archive_case_id=ANY(%s)
           GROUP BY form.id
           ORDER BY lower(form.name),populated_fields DESC,
                    (form.archive_case_id=%s) DESC,form.source_created_at NULLS LAST,form.id""",
        (case_ids, preferred_case_id),
    ).fetchall()
    selected: dict[str, dict[str, Any]] = {}
    for form in candidates:
        key = str(form.get("name") or "Clinical form").strip().lower()
        selected.setdefault(key, dict(form))
    return list(selected.values())


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
                "event_kind": source_event.get("kind"),
                "source_state": source_event.get("source_state"),
                "memo": source_event.get("memo"),
                "care_unit": source_event.get("care_unit"),
                "source": "innovian",
            })
            event_id += 1

    for note in context.get("notes") or []:
        timestamp = _iso_ms(note.get("occurred_at"))
        if timestamp is None or note.get("source_deleted"):
            continue
        # The notes importer stores real UTC instants; this legacy snapshot's
        # chart clock uses Bangkok wall-time encoded as UTC, like case/trends.
        if note.get("time_quality") == "source_mapped":
            timestamp += 7 * 60 * 60_000
        events.append({
            "id": event_id, "event_ts": timestamp, "event_type": "note",
            "title": _first_text(note.get("note_name"), note.get("note_type"), note.get("text"), "Innovian note"),
            "memo": note.get("text"),
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
            "admission_source": "innovian", "case_type": detailed.get("case_type"),
            "care_unit": detailed.get("care_unit"), "location": detailed.get("location"),
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
def legacy_status(database: Connection = Depends(connection)) -> dict:
    count = database.execute(
        "SELECT count(*) AS count FROM archive_case WHERE source_system='innovian'"
    ).fetchone()["count"]
    return {"available": True, "has_cases": count > 0, "has_more": count > 1, "count": count, "source": "canopy_postgresql"}


@router.get("/cases")
def legacy_cases(
    query: str | None = Query(default=None, max_length=160),
    from_date: str | None = Query(default=None, alias="from", max_length=10),
    to_date: str | None = Query(default=None, alias="to", max_length=10),
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None, max_length=200),
    database: Connection = Depends(connection),
) -> dict:
    try:
        offset = max(0, int(cursor or "0"))
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Invalid archive cursor") from error
    clauses = ["a.source_system='innovian'"]
    params: dict[str, Any] = {"limit": limit + 1, "offset": offset}
    if query and query.strip():
        clauses.append("(a.source_case_id ILIKE %(query)s OR a.patient_reference ILIKE %(query)s OR c.hn ILIKE %(query)s OR c.encounter_number ILIKE %(query)s OR c.patient_name ILIKE %(query)s OR c.procedure_name ILIKE %(query)s)")
        params["query"] = f"%{query.strip()}%"
    if from_date:
        clauses.append("a.started_at >= %(from_date)s::date")
        params["from_date"] = from_date
    if to_date:
        clauses.append("a.started_at < (%(to_date)s::date + interval '1 day')")
        params["to_date"] = to_date
    records = database.execute(
        f"""SELECT a.id,a.source_case_id,a.patient_reference,a.patient_snapshot,a.procedure_snapshot,
                   a.started_at,a.completed_at,a.migration_status,a.mapping_profile,a.created_at,
                   c.hn,c.encounter_number,c.patient_name,c.gender,c.asa_status,c.procedure_name,
                   c.location,c.care_unit,c.diagnosis_name
            FROM archive_case a LEFT JOIN archive_case_context c ON c.archive_case_id=a.id
            WHERE {' AND '.join(clauses)}
            ORDER BY a.started_at DESC NULLS LAST,a.id DESC
            LIMIT %(limit)s OFFSET %(offset)s""",
        params,
    ).fetchall()
    has_more = len(records) > limit
    items = []
    for row in records[:limit]:
        patient = row.get("patient_snapshot") or {}
        procedure = row.get("procedure_snapshot") or {}
        items.append({
            "id": str(row["id"]), "origin": "innovian_archive", "source_case_id": row["source_case_id"],
            "patient": {
                "reference": row.get("hn") or row.get("patient_reference") or patient.get("reference"),
                "display_name": row.get("patient_name") or patient.get("display_name"),
                "encounter_number": row.get("encounter_number") or patient.get("encounter_number"),
                "gender": row.get("gender") or patient.get("gender"),
                "asa_status": row.get("asa_status") or patient.get("asa_status"),
            },
            "procedure": {
                "name": row.get("procedure_name") or procedure.get("name"),
                "location": row.get("location") or procedure.get("location"),
                "care_unit": row.get("care_unit") or procedure.get("care_unit"),
                "diagnosis": row.get("diagnosis_name") or procedure.get("diagnosis"),
            },
            "started_at": row.get("started_at"), "completed_at": row.get("completed_at"),
            "migration": {"status": row.get("migration_status"), "mapping_profile": row.get("mapping_profile"), "migrated_at": row.get("created_at")},
        })
    return {"items": items, "has_more": has_more, "next_cursor": str(offset + limit) if has_more else None}


def _clinical_archive_payload(database: Connection, archive_case_id: uuid.UUID, row: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    demographics = database.execute(
        "SELECT * FROM archive_patient_demographics WHERE archive_case_id=%s", (archive_case_id,)
    ).fetchone() or {}
    allergies = database.execute(
        "SELECT * FROM archive_allergy WHERE archive_case_id=%s ORDER BY recorded_at NULLS LAST,id", (archive_case_id,)
    ).fetchall()
    notes = database.execute(
        "SELECT * FROM archive_note WHERE archive_case_id=%s ORDER BY occurred_at NULLS LAST,id", (archive_case_id,)
    ).fetchall()

    case_start = row.get("started_at")
    case_end = row.get("completed_at") or case_start
    if case_start is None or case_end is None:
        return dict(demographics), {"allergies": [dict(item) for item in allergies], "notes": [dict(item) for item in notes]}, []
    range_start, range_end = _minute(case_start), _minute(case_end)
    total_minutes = max(1, int((range_end - range_start).total_seconds() // 60) + 1)
    loaded_minutes = min(total_minutes, 2880)
    window_end = range_start + timedelta(minutes=loaded_minutes)
    records = {
        range_start + timedelta(minutes=index): {
            "time": range_start + timedelta(minutes=index),
            "trend": {}, "discrete": {}, "vent": {}, "events": [], "actions": [],
        }
        for index in range(loaded_minutes)
    }
    observation_case_ids = _encounter_case_ids(database, archive_case_id, row)
    # Innovian can store one encounter in companion case records (for example,
    # anesthesia data in one record and PACU observations in the next). Merge
    # only observations from exact encounter twins; the source case remains the
    # report identity and no historical PDF participates in generation.

    segments = database.execute(
        """SELECT parameter_code,parameter_label,unit,source_parameter_id,sample_interval_ms,
                  encoded_samples,exponent,decimal_places,observed_start_at
           FROM archive_vital_series_segment
           WHERE archive_case_id=%s AND observed_start_at < %s
             AND coalesce(observed_end_at,observed_start_at) >= %s
           ORDER BY observed_start_at""",
        (archive_case_id, window_end, range_start),
    ).fetchall()
    for segment in segments:
        if segment.get("sample_interval_ms") != 60000 or segment.get("observed_start_at") is None:
            continue
        label = segment.get("parameter_code") or segment.get("parameter_label")
        for index, encoded in enumerate(segment.get("encoded_samples") or []):
            observed_at = segment["observed_start_at"] + timedelta(minutes=index)
            bucket = records.get(_minute(observed_at))
            value = _decode_trend_sample(encoded, segment.get("exponent") or 0, segment.get("decimal_places") or 0)
            if bucket is not None and value is not None:
                bucket["trend"][label] = {"value": value, "unit": segment.get("unit"), "parameter_id": segment.get("source_parameter_id")}

    for table, default_group in (("archive_observation", "discrete"), ("archive_device_parameter", None)):
        select_prefix = "parameter_code,parameter_label" if table == "archive_observation" else "NULL::text AS parameter_code,parameter_label"
        select_quality = ",time_quality" if table == "archive_observation" else ""
        query_start = range_start - timedelta(hours=7) if table == "archive_observation" else range_start
        case_filter = "archive_case_id=ANY(%s)" if table == "archive_observation" else "archive_case_id=%s"
        case_argument = observation_case_ids if table == "archive_observation" else archive_case_id
        rows = database.execute(
            f"""SELECT {select_prefix},unit,value_number,value_text,observed_at{select_quality}{',source_kind' if table == 'archive_device_parameter' else ''}
                FROM {table} WHERE {case_filter} AND observed_at >= %s AND observed_at < %s
                ORDER BY observed_at,id""",
            (case_argument, query_start, window_end),
        ).fetchall()
        for item in rows:
            observed_at = item.get("observed_at")
            bucket = records.get(_minute(observed_at)) if observed_at else None
            # Innovian's discrete source-mapped timestamps were persisted as
            # UTC instants even though the case/event clock is Bangkok wall
            # time. Prefer the original time, but apply the documented +07:00
            # offset when that is the only timestamp that lands in the case.
            if bucket is None and table == "archive_observation" and item.get("time_quality") == "source_mapped" and observed_at:
                bucket = records.get(_minute(observed_at + timedelta(hours=7)))
            group = default_group or item.get("source_kind")
            if bucket is None or group not in ("discrete", "vent"):
                continue
            # Numeric Innovian parameter IDs are provenance, not display or
            # semantic keys. The human label maps to HR/SpO2/NBP/etc.
            label = item.get("parameter_label") or item.get("parameter_code")
            bucket[group][label] = {"value": _display_value(item.get("value_number") if item.get("value_number") is not None else item.get("value_text")), "unit": item.get("unit")}

    events = database.execute(
        """SELECT source_event_code,source_event_name,source_event_kind,occurred_at,care_unit,source_state,memo
           FROM archive_event WHERE archive_case_id=%s AND occurred_at >= %s AND occurred_at < %s
           ORDER BY occurred_at,id""", (archive_case_id, range_start, window_end)
    ).fetchall()
    for item in events:
        bucket = records.get(_minute(item["occurred_at"]))
        if bucket is not None:
            bucket["events"].append({
                "code": item.get("source_event_code"),
                "name": item.get("source_event_name"),
                "kind": item.get("source_event_kind"),
                "source_state": item.get("source_state"),
                "memo": item.get("memo"),
                "care_unit": item.get("care_unit"),
                "occurred_at": item.get("occurred_at"),
            })

    measurements = database.execute(
        """SELECT infusion.id AS infusion_id,infusion.label,infusion.source_type,
                  component.label AS component_label,component.unit,
                  measurement.value_number,measurement.value_text,measurement.observed_at
           FROM archive_infusion infusion
           JOIN archive_infusion_component component ON component.archive_infusion_id=infusion.id
           JOIN archive_infusion_measurement measurement ON measurement.archive_infusion_component_id=component.id
           WHERE infusion.archive_case_id=%s AND measurement.observed_at >= %s AND measurement.observed_at < %s
           ORDER BY measurement.observed_at,infusion.source_paraminstance,component.display_order""",
        (archive_case_id, range_start, window_end),
    ).fetchall()
    grouped: dict[tuple[Any, Any], dict[str, Any]] = {}
    for item in measurements:
        key = (item["infusion_id"], item["observed_at"])
        action = grouped.setdefault(key, {"source_id": str(item["infusion_id"]), "category": _action_category(item.get("source_type"), item.get("label")), "label": item.get("label") or "Innovian administration", "occurred_at": item["observed_at"], "values": []})
        action["values"].append({"label": item.get("component_label"), "value": _display_value(item.get("value_number") if item.get("value_number") is not None else item.get("value_text")), "unit": item.get("unit")})
    for action in grouped.values():
        bucket = records.get(_minute(action["occurred_at"]))
        if bucket is not None:
            bucket["actions"].append(action)

    outputs = database.execute(
        """SELECT id,source_paraminstance,source_cid,label,unit,value_number,value_text,occurred_at
           FROM archive_fluid_io WHERE archive_case_id=%s AND occurred_at >= %s AND occurred_at < %s
           ORDER BY occurred_at,id""", (archive_case_id, range_start, window_end)
    ).fetchall()
    for item in outputs:
        bucket = records.get(_minute(item["occurred_at"]))
        if bucket is not None:
            bucket["actions"].append({"source_id": f"output:{item.get('source_paraminstance') or item.get('source_cid') or item['id']}", "category": _action_category(4, item.get("label")), "label": item.get("label") or "Output", "occurred_at": item["occurred_at"], "values": [{"label": "Amount", "value": _display_value(item.get("value_number") if item.get("value_number") is not None else item.get("value_text")), "unit": item.get("unit")}]})

    page = {"range": {"start": range_start, "end": range_end, "total_minutes": total_minutes}, "records": list(records.values())}
    context = {"demographics": dict(demographics), "allergies": [dict(item) for item in allergies], "notes": [dict(item) for item in notes]}
    return dict(demographics), context, [page]


@router.get("/cases/{archive_case_id}/snapshot")
def legacy_case_snapshot(archive_case_id: uuid.UUID, database: Connection = Depends(connection)) -> dict:
    row = database.execute(
        """SELECT a.*,c.source_poid,c.hn,c.encounter_number,c.patient_name,c.date_of_birth,c.gender,
                  c.asa_status,c.order_number,c.procedure_code,c.procedure_name,c.diagnosis_code,
                  c.diagnosis_name,c.case_type,c.care_unit,c.location
           FROM archive_case a LEFT JOIN archive_case_context c ON c.archive_case_id=a.id
           WHERE a.id=%s AND a.source_system='innovian'""", (archive_case_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Innovian archive case not found")
    release = database.execute(
        """SELECT status FROM archive_import_year_status
           WHERE archive_year=extract(year from %s::timestamptz)::integer
             AND status IN ('ready_for_verification','verified')""",
        (row.get("started_at"),),
    ).fetchone()
    if not release:
        patient_source = row.get("patient_snapshot") or {}
        procedure_source = row.get("procedure_snapshot") or {}
        patient = {
            **patient_source, "patient_name": row.get("patient_name") or patient_source.get("display_name"),
            "hn": row.get("hn") or row.get("patient_reference") or patient_source.get("reference"),
            "an": row.get("encounter_number") or patient_source.get("encounter_number"),
            "date_of_birth": row.get("date_of_birth") or patient_source.get("date_of_birth"),
            "sex": row.get("gender") or patient_source.get("gender"),
            "asa_status": row.get("asa_status") or patient_source.get("asa_status"),
            "source_patient_id": row.get("source_poid"), "source": "innovian",
        }
        start, end = _iso_ms(row.get("started_at")) or 0, _iso_ms(row.get("completed_at")) or 0
        snapshot = {
            "origin": "innovian_archive",
            "source": {"system": "innovian", "case_id": row["source_case_id"], "mapping_profile": row.get("mapping_profile"), "migrated_at": row.get("created_at"), "status": "index_only"},
            "coverage": {"minutes_loaded": 0, "minutes_total": 0, "truncated": False, "staff_count": 0, "note_count": 0, "form_count": 0, "detail_available": False, "index_only": True},
            "case": {"id": row["source_case_id"], "case_code": f"Innovian #{row['source_case_id']}", "status": "ARCHIVED", "start_time": start, "discharge_time": end, "admission_source": "innovian", "case_type": row.get("case_type"), "care_unit": row.get("care_unit"), "location": row.get("location")},
            "patient": {"row": patient}, "timeline": {"rows": []}, "events": {"rows": []},
            "io_runs": {"rows": []}, "io_events": {"rows": []}, "allergies": {"rows": []},
            "diagnosis": {"rows": ([{"id": 1, "diagnosis_text": row.get("diagnosis_name"), "icd_code": row.get("diagnosis_code")}] if row.get("diagnosis_name") else [])},
            "procedures": {"rows": ([{"id": 1, "procedure_text": row.get("procedure_name") or procedure_source.get("name"), "icd_code": row.get("procedure_code")}] if row.get("procedure_name") or procedure_source.get("name") else [])},
            "staff": {"rows": []}, "forms": {"rows": []}, "parameter_meta": {}, "window": {"from": start, "to": end},
        }
        return {"snapshot": snapshot, "leaf_name": "Innovian archive", "last_synced_at": row.get("created_at") or row.get("completed_at")}
    staff = database.execute(
        """SELECT id,source_staff_id,display_name,display_name AS name,role,staff_group,entered_at,exited_at,
                  time_quality,source_deleted FROM archive_staff_assignment
           WHERE archive_case_id=%s ORDER BY entered_at NULLS LAST,display_name""", (archive_case_id,)
    ).fetchall()
    events = database.execute(
        """SELECT id,occurred_at AS event_ts,source_event_kind AS event_type,source_event_name AS title,
                  source_event_code,source_state,memo,care_unit,'innovian' AS source
           FROM archive_event WHERE archive_case_id=%s ORDER BY occurred_at NULLS LAST,id""", (archive_case_id,)
    ).fetchall()
    encounter_case_ids = _encounter_case_ids(database, archive_case_id, row)
    form_rows = _best_encounter_forms(database, encounter_case_ids, archive_case_id)
    forms_by_id = {form["id"]: {**dict(form), "fields": []} for form in form_rows}
    if forms_by_id:
        fields = database.execute(
            """SELECT archive_form_id,id,source_grid_cell_id,source_component_id,component_type,name,title,
                      raw_value,value,choices,position FROM archive_form_field
               WHERE archive_form_id=ANY(%s) ORDER BY archive_form_id,source_grid_cell_id""",
            (list(forms_by_id),),
        ).fetchall()
        for field in fields:
            forms_by_id[field["archive_form_id"]]["fields"].append(dict(field))
    patient_source = row.get("patient_snapshot") or {}
    procedure_source = row.get("procedure_snapshot") or {}
    patient = {
        **patient_source, "patient_name": row.get("patient_name") or patient_source.get("display_name"),
        "hn": row.get("hn") or row.get("patient_reference") or patient_source.get("reference"),
        "an": row.get("encounter_number") or patient_source.get("encounter_number"),
        "date_of_birth": row.get("date_of_birth") or patient_source.get("date_of_birth"),
        "sex": row.get("gender") or patient_source.get("gender"), "asa_status": row.get("asa_status") or patient_source.get("asa_status"),
        "age_text": _age_text(row.get("date_of_birth") or patient_source.get("date_of_birth"), row.get("started_at")),
        "source_patient_id": row.get("source_poid"), "source": "innovian",
    }
    _, context, pages = _clinical_archive_payload(database, archive_case_id, row)
    context.update({
        "staff": [dict(item) for item in staff],
        "patient_name": patient.get("patient_name"), "hn": patient.get("hn"),
        "encounter_number": patient.get("an"), "date_of_birth": patient.get("date_of_birth"),
        "gender": patient.get("sex"), "asa_status": patient.get("asa_status"),
        "procedure_name": row.get("procedure_name") or procedure_source.get("name"),
        "procedure_code": row.get("procedure_code"), "diagnosis_name": row.get("diagnosis_name"),
        "diagnosis_code": row.get("diagnosis_code"), "case_type": row.get("case_type"),
        "care_unit": row.get("care_unit"), "location": row.get("location"),
    })
    summary = {
        "source_case_id": row["source_case_id"], "started_at": row.get("started_at"),
        "completed_at": row.get("completed_at"), "patient": patient_source,
        "procedure": procedure_source, "context": context,
        "migration": {"status": row.get("migration_status"), "mapping_profile": row.get("mapping_profile"), "migrated_at": row.get("created_at")},
    }
    return _normalize_snapshot(summary, context, {"items": list(forms_by_id.values())}, pages)


@router.get("/cases/{archive_case_id}/report-options")
def legacy_report_options(archive_case_id: uuid.UUID, database: Connection = Depends(connection)) -> dict:
    case = database.execute(
        """SELECT a.source_case_id,a.migration_status,a.started_at,a.completed_at,a.patient_reference,
                  c.patient_name,c.hn,c.care_unit,
                  release.status AS release_status
           FROM archive_case a
           LEFT JOIN archive_case_context c ON c.archive_case_id=a.id
           LEFT JOIN archive_import_year_status release
             ON release.archive_year=extract(year from a.started_at)::integer
           WHERE a.id=%s AND a.source_system='innovian'""", (archive_case_id,)
    ).fetchone()
    if not case:
        raise HTTPException(status_code=404, detail="Innovian archive case not found")
    if case.get("release_status") not in {"ready_for_verification", "verified"}:
        raise HTTPException(
            status_code=409,
            detail=f"Innovian archive reports for {case['started_at'].year} are still being validated",
        )
    forms = _best_encounter_forms(database, _encounter_case_ids(database, archive_case_id, case), archive_case_id)
    care_unit = str(case.get("care_unit") or "").strip().upper()
    form_names = [str(form.get("name") or "").strip().lower() for form in forms]
    has_anesthesia = care_unit == "ANESTH" or any(name in {"anesthesia report", "anesthesia check list"} for name in form_names)
    has_pacu = care_unit == "PACU" or any(name == "pacu" or name.startswith("pacu (") for name in form_names)
    sections = []
    if has_anesthesia:
        sections.append({"id": f"anes:{archive_case_id}", "case_id": case["source_case_id"], "kind": "chart", "report_type": "anesthesia_chart", "title": "Anesthesia Report", "care_unit": care_unit, "classification_evidence": "Anesthesia form or care-unit evidence", "default": care_unit != "PACU"})
    if has_pacu:
        sections.append({"id": f"pacu:{archive_case_id}", "case_id": case["source_case_id"], "kind": "chart", "report_type": "pacu_chart", "title": "Post Anesthetic Care Unit", "care_unit": care_unit, "classification_evidence": "PACU form or care-unit evidence", "default": care_unit == "PACU" or not has_anesthesia})
    for form in forms:
        name = str(form["name"] or "Clinical form")
        lowered = name.lower()
        report_type = "clinical_form"
        if lowered == "anesthesia report": report_type = "anesthesia_form"
        elif "check list" in lowered or "checklist" in lowered: report_type = "anesthesia_checklist"
        elif "ambulatory" in lowered: report_type = "post_anesthetic_ambulatory"
        elif lowered == "pacu": report_type = "post_anesthetic_record"
        elif lowered == "pain": report_type = "nerve_block_form"
        sections.append({"id": f"form:{form['id']}", "case_id": case["source_case_id"], "kind": "form", "report_type": report_type, "title": name, "care_unit": care_unit or None, "started_at": form.get("source_created_at"), "source_form_id": form.get("source_form_id"), "classification_evidence": f"Innovian form: {name}", "default": True})
    return {"case_id": case["source_case_id"], "patient": case.get("patient_name"), "sections": sections, "status": case.get("migration_status") or "partial", "template_version": "flora-canopy-1", "classification_version": "canopy-postgresql-1", "warnings": []}


@router.post("/cases/{archive_case_id}/report.pdf")
def legacy_report_pdf(
    archive_case_id: uuid.UUID,
    request: LegacyReportRequest,
    database: Connection = Depends(connection),
) -> Response:
    catalog = legacy_report_options(archive_case_id, database)
    allowed = {str(section["id"]) for section in catalog["sections"]}
    selected = [str(section) for section in request.sections]
    if len(selected) != len(set(selected)) or any(section not in allowed for section in selected):
        raise HTTPException(status_code=422, detail="Invalid Innovian report section selection")
    wrapper = legacy_case_snapshot(archive_case_id, database)
    snapshot = wrapper["snapshot"]
    try:
        payload = build_innovian_report(snapshot, selected)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    patient_container = snapshot.get("patient") if isinstance(snapshot.get("patient"), dict) else {}
    patient = patient_container.get("row") if isinstance(patient_container.get("row"), dict) else {}
    hn = re.sub(r"[^A-Za-z0-9_-]+", "-", str(patient.get("hn") or catalog["case_id"])).strip("-")
    filename = f"{hn}-{catalog['case_id']}.pdf"
    return Response(
        payload,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Cache-Control": "no-store, private",
            "X-Content-Type-Options": "nosniff",
            "X-Flora-Report-Origin": "canopy-postgresql-generated",
            "X-Flora-Report-Template": "innovian-compatible-v1",
        },
    )
