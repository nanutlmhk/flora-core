"""Generate Innovian-style archive reports from Canopy PostgreSQL snapshots.

No source PDF is read or copied. Every value is derived from the selected
archive case. The layout intentionally follows the information hierarchy of
the historical Innovian ANES/POST/PACU output so reports remain familiar.
"""

from __future__ import annotations

from datetime import datetime, timezone
from io import BytesIO
from math import ceil
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, Table, TableStyle


PAGE_W, PAGE_H = A4
MARGIN = 10
GRID = colors.HexColor("#202020")
SHADE = colors.HexColor("#d9d9d9")
LIGHT = colors.HexColor("#eeeeee")
THAI_FONT = "FloraArchiveThai"


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _rows(value: Any) -> list[dict[str, Any]]:
    source = _record(value).get("rows")
    return [item for item in source or [] if isinstance(item, dict)]


def _text(value: Any, fallback: str = "-") -> str:
    if value is None:
        return fallback
    output = str(value).strip()
    return output if output and output.lower() not in {"null", "undefined"} else fallback


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        output = float(value)
        return output if abs(output) < 1_000_000 else None
    except (TypeError, ValueError):
        return None


def _date(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    try:
        if isinstance(value, (int, float)) or str(value).isdigit():
            return datetime.fromtimestamp(float(value) / 1000, timezone.utc)
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


def _stamp(value: Any, fmt: str = "%d-%b-%Y %H:%M") -> str:
    parsed = _date(value)
    return parsed.strftime(fmt) if parsed else "-"


def _floor_time(value: int, minutes: int) -> int:
    step = minutes * 60_000
    return value - value % step


def _ceil_time(value: int, minutes: int) -> int:
    step = minutes * 60_000
    return ((value + step - 1) // step) * step


def _ms(value: Any) -> int:
    parsed = _date(value)
    return int(parsed.timestamp() * 1000) if parsed else 0


def _fonts() -> tuple[str, str]:
    regular_name, bold_name = "FloraArchive", "FloraArchiveBold"
    if regular_name in pdfmetrics.getRegisteredFontNames():
        return regular_name, bold_name if bold_name in pdfmetrics.getRegisteredFontNames() else regular_name
    candidates = (Path("/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf"),)
    regular = next((item for item in candidates if item.is_file()), None)
    if not regular:
        return "Helvetica", "Helvetica-Bold"
    pdfmetrics.registerFont(TTFont(regular_name, str(regular)))
    thai = Path("/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf")
    if thai.is_file() and THAI_FONT not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont(THAI_FONT, str(thai)))
    bold = regular.with_name(regular.name.replace("Regular", "Bold"))
    if bold.is_file():
        pdfmetrics.registerFont(TTFont(bold_name, str(bold)))
        return regular_name, bold_name
    return regular_name, regular_name


def _line(canvas: Canvas, x1: float, y1: float, x2: float, y2: float, width: float = .45) -> None:
    canvas.setStrokeColor(GRID)
    canvas.setLineWidth(width)
    canvas.line(x1, y1, x2, y2)


def _box(canvas: Canvas, x: float, y: float, width: float, height: float, fill=None) -> None:
    canvas.setStrokeColor(GRID)
    canvas.setLineWidth(.45)
    if fill:
        canvas.setFillColor(fill)
        canvas.rect(x, y, width, height, stroke=1, fill=1)
    else:
        canvas.rect(x, y, width, height, stroke=1, fill=0)


def _fit(canvas: Canvas, value: Any, x: float, y: float, width: float, font: str, size: float = 7, align: str = "left") -> None:
    text = _text(value)
    if any("\u0e00" <= character <= "\u0e7f" for character in text) and THAI_FONT in pdfmetrics.getRegisteredFontNames():
        font = THAI_FONT
    while size > 4.5 and pdfmetrics.stringWidth(text, font, size) > width:
        size -= .4
    if pdfmetrics.stringWidth(text, font, size) > width:
        while text and pdfmetrics.stringWidth(text + "...", font, size) > width:
            text = text[:-1]
        text += "..."
    canvas.setFont(font, size)
    canvas.setFillColor(colors.black)
    if align == "center":
        canvas.drawCentredString(x + width / 2, y, text)
    elif align == "right":
        canvas.drawRightString(x + width, y, text)
    else:
        canvas.drawString(x, y, text)


def _cell(canvas: Canvas, x: float, y: float, width: float, height: float, label: str, value: Any, font: str, bold: str) -> None:
    _box(canvas, x, y, width, height)
    canvas.setFont(font, 4.5)
    canvas.drawString(x + 2, y + height - 5.5, label)
    _fit(canvas, value, x + 2, y + 3, width - 4, bold, 7)


def _header(canvas: Canvas, snapshot: dict[str, Any], title: str, page: int, pages: int, font: str, bold: str) -> float:
    patient = _record(_record(snapshot.get("patient")).get("row"))
    case = _record(snapshot.get("case"))
    diagnoses = _rows(snapshot.get("diagnosis"))
    procedures = _rows(snapshot.get("procedures"))
    allergies = _rows(snapshot.get("allergies"))
    top, left, width = PAGE_H - MARGIN, MARGIN, PAGE_W - MARGIN * 2
    name_w, title_w = 145, 290
    _box(canvas, left, top - 55, width, 55)
    _line(canvas, left + name_w, top - 55, left + name_w, top)
    _line(canvas, left + name_w + title_w, top - 55, left + name_w + title_w, top)
    _line(canvas, left + name_w, top - 27, left + name_w + title_w, top - 27)
    canvas.setFont(font, 5)
    canvas.drawString(left + 2, top - 7, "Patient")
    _fit(canvas, patient.get("patient_name"), left + 3, top - 23, name_w - 6, font, 11)
    _fit(canvas, title, left + name_w, top - 18, title_w, bold, 12, "center")
    _fit(canvas, "NEUROLOGICAL INSTITUTE OF THAILAND", left + name_w, top - 45, title_w, font, 9, "center")

    y = top - 75
    values = [
        ("Patient ID", patient.get("hn"), 72), ("ID Card No.(POID)", patient.get("national_id") or patient.get("source_patient_id"), 108),
        ("Date of Birth", _stamp(patient.get("date_of_birth"), "%d-%b-%Y"), 73), ("Age", patient.get("age_text"), 44),
        ("Blood Type", patient.get("blood_group_text"), 48), ("ASA Status", patient.get("asa_status"), 52),
        ("Gender", patient.get("sex"), 60), ("Weight", f"{_text(patient.get('weight_kg'))} {_text(patient.get('weight_unit'), 'kg')}", 58),
        ("Height", f"{_text(patient.get('height_cm'))} {_text(patient.get('height_unit'), 'cm')}", width - 515),
    ]
    x = left
    for label, value, cell_w in values:
        _cell(canvas, x, y, cell_w, 20, label, value, font, bold)
        x += cell_w
    y -= 20
    half = width / 2
    diagnosis = diagnoses[0].get("diagnosis_text") if diagnoses else "-"
    procedure = procedures[0].get("procedure_text") if procedures else "-"
    _cell(canvas, left, y, half, 20, "Diagnosis", diagnosis, font, bold)
    _cell(canvas, left + half, y, 90, 20, "Hospital Admit Date", _stamp(patient.get("hospital_admitted_at") or case.get("start_time"), "%d-%b-%Y"), font, bold)
    _cell(canvas, left + half + 90, y, half - 90, 20, "Allergies", "; ".join(_text(item.get("allergen")) for item in allergies) or "No allergy information", font, bold)
    y -= 20
    _cell(canvas, left, y, half, 20, "Procedure", procedure, font, bold)
    _cell(canvas, left + half, y, 90, 20, "Room", case.get("location") or patient.get("ward_location"), font, bold)
    _cell(canvas, left + half + 90, y, half - 90, 20, "Case / page", f"{_text(_record(snapshot.get('source')).get('case_id'))} | {page} of {pages}", font, bold)
    y -= 20
    _cell(canvas, left, y, half, 18, "Case Type", case.get("case_type") or patient.get("surgical_specialty"), font, bold)
    _cell(canvas, left + half, y, half, 18, "Case period", f"{_stamp(case.get('start_time'))} - {_stamp(case.get('discharge_time'))}", font, bold)
    return y - 4


def _payload_value(row: dict[str, Any], *keys: str) -> float | None:
    payload = _record(row.get("payload"))
    for key in keys:
        value = _number(payload.get(key))
        if value is not None:
            return value
    return None


def _sample(rows: list[dict[str, Any]], at: int, keys: tuple[str, ...]) -> float | None:
    eligible = [row for row in rows if int(row.get("ts_minute") or 0) <= at and at - int(row.get("ts_minute") or 0) <= 10 * 60_000]
    for row in reversed(eligible):
        value = _payload_value(row, *keys)
        if value is not None:
            return value
    return None


def _marker(canvas: Canvas, x: float, y: float, kind: str, color) -> None:
    canvas.setStrokeColor(color)
    canvas.setFillColor(color)
    canvas.setLineWidth(.7)
    if kind == "down":
        canvas.line(x - 2, y + 2, x, y - 2); canvas.line(x, y - 2, x + 2, y + 2); canvas.line(x + 2, y + 2, x - 2, y + 2)
    elif kind == "up":
        canvas.line(x - 2, y - 2, x, y + 2); canvas.line(x, y + 2, x + 2, y - 2); canvas.line(x + 2, y - 2, x - 2, y - 2)
    elif kind == "square":
        canvas.rect(x - 1.7, y - 1.7, 3.4, 3.4, fill=1, stroke=0)
    elif kind == "x":
        canvas.line(x - 2, y - 2, x + 2, y + 2); canvas.line(x - 2, y + 2, x + 2, y - 2)
    else:
        canvas.circle(x, y, 1.6, fill=1, stroke=0)


def _plot_rows(rows: list[dict[str, Any]], key: str, start: int, end: int) -> list[dict[str, Any]]:
    """Five-minute print cadence; retain actual timestamps, never interpolate.

    Cuff observations are discrete and must not be discarded for being off-grid.
    Continuous channels use the first available observation per five-minute bin.
    Full-resolution observations remain unchanged in the archive.
    """
    eligible = sorted((row for row in rows if start <= int(row.get("ts_minute") or 0) < end
                       and _payload_value(row, key) is not None), key=lambda row: row["ts_minute"])
    if key.startswith("nibp_"):
        return eligible
    bins = {}
    for row in eligible:
        bins.setdefault((int(row["ts_minute"]) - start) // 300_000, row)
    return list(bins.values())


def _chart_page(canvas: Canvas, snapshot: dict[str, Any], title: str, start: int, end: int, page: int, pages: int, font: str, bold: str, pacu: bool, run_offset: int = 0) -> None:
    top = _header(canvas, snapshot, title, page, pages, font, bold)
    timeline = _rows(snapshot.get("timeline"))
    plotted_keys = ("nibp_sys", "nibp_map", "nibp_dia", "hr", "art_sys", "art_map", "art_dia", "spo2")
    plotted_values = [value for row in timeline if start <= int(row.get("ts_minute") or 0) < end
                      for key in plotted_keys if (value := _payload_value(row, key)) is not None]
    scale_min = min(0, 20 * int(min(plotted_values, default=0) // 20))
    scale_max = max(200, 20 * ceil(max(plotted_values, default=200) / 20))
    left, width = MARGIN, PAGE_W - MARGIN * 2
    label_w, total_w = 82, 78
    plot_x, plot_w = left + label_w, width - label_w - total_w
    interval = 10 if pacu else 20
    columns = max(1, int(ceil((end - start) / (interval * 60_000))))
    column_w = plot_w / columns
    time_y = top - 22
    _box(canvas, left, time_y, width, 22, SHADE)
    _fit(canvas, _stamp(start, "%d-%b-%Y") + "\nTrends", left + 2, time_y + 8, label_w - 4, bold, 6, "center")
    for index in range(columns):
        x = plot_x + index * column_w
        _line(canvas, x, time_y, x, time_y + 22)
        _fit(canvas, _stamp(start + index * interval * 60_000, "%H:%M"), x, time_y + 8, column_w, bold, 6.5, "center")
    _fit(canvas, "Case Total", plot_x + plot_w, time_y + 8, total_w, bold, 6.5, "center")

    event_y = time_y - 20
    _box(canvas, left, event_y, width, 20, SHADE)
    _fit(canvas, "Events", left + 3, event_y + 7, label_w - 5, font, 6)
    visible_events = [
        event for event in _rows(snapshot.get("events"))
        if start <= int(event.get("event_ts") or 0) < end
    ]
    previous_event_x = -1_000.0
    event_lane = -1
    event_labels = {
        "anesthesia": "Anes",
        "in/out or": "OR in/out",
        "induction/reversal": "Ind/Rev",
        "intubation/extubation": "Intub/Extub",
        "positioning": "Position",
    }
    for event in visible_events:
        ts = int(event.get("event_ts") or 0)
        x = plot_x + (ts - start) / max(1, end - start) * plot_w
        event_lane = 0 if x - previous_event_x > 46 else (event_lane + 1) % 4
        previous_event_x = x
        label_y = event_y + 3 + event_lane * 4.2
        _line(canvas, x, event_y, x, event_y + 7, .7)
        title = _text(event.get("title"), "")
        short_title = event_labels.get(title.lower(), title)
        _fit(canvas, short_title, max(plot_x, min(x - 22, plot_x + plot_w - 44)), label_y, 44, font, 4.0, "center")

    chart_y, chart_h = event_y - 145, 145
    _box(canvas, left, chart_y, width, chart_h)
    _line(canvas, plot_x, chart_y, plot_x, chart_y + chart_h)
    _line(canvas, plot_x + plot_w, chart_y, plot_x + plot_w, chart_y + chart_h)
    for index in range(columns + 1):
        x = plot_x + index * column_w
        _line(canvas, x, chart_y, x, chart_y + chart_h, .25)
        for minor in range(5, interval, 5):
            mx = x + minor * column_w / interval
            if mx < plot_x + plot_w:
                _line(canvas, mx, chart_y, mx, chart_y + chart_h, .1)
    for step in range(6):
        y = chart_y + step * chart_h / 5
        _line(canvas, plot_x, y, plot_x + plot_w, y, .25)
        _fit(canvas, f"{scale_min + step * (scale_max - scale_min) / 5:g}", left + 55, y - 2, 22, font, 4.5, "right")
    legend = [("NBP S mmHg", "down", colors.red), ("NBP M mmHg", "square", colors.red), ("NBP D mmHg", "up", colors.red), ("HR bpm", "x", colors.green), ("ART S mmHg", "down", colors.darkred), ("ART M mmHg", "square", colors.darkred), ("ART D mmHg", "up", colors.darkred), ("SpO2 %", "circle", colors.black)]
    for index, (label, kind, color) in enumerate(legend):
        ly = chart_y + chart_h - 10 - index * 12
        _marker(canvas, left + 6, ly + 2, kind, color)
        _fit(canvas, label, left + 12, ly, 44, font, 5)
    series = [
        (("nibp_sys",), "down", colors.red), (("nibp_map",), "square", colors.red), (("nibp_dia",), "up", colors.red),
        (("hr",), "x", colors.green), (("art_sys",), "down", colors.darkred), (("art_map",), "square", colors.darkred), (("art_dia",), "up", colors.darkred), (("spo2",), "circle", colors.black),
    ]
    for keys, kind, color in series:
        for row in _plot_rows(timeline, keys[0], start, end):
            ts = int(row.get("ts_minute") or 0)
            x = plot_x + (ts - start) / max(1, end - start) * plot_w
            value = _payload_value(row, *keys)
            if value is None:
                continue
            y = chart_y + (value - scale_min) / (scale_max - scale_min) * chart_h
            _marker(canvas, x, y, kind, color)

    specs = [
        ("EtCO2", ("et_co2",), ""), ("SpO2", ("spo2",), "%"), ("Insp Agent", ("fi_agent",), "%"),
        ("FiO2", ("fio2",), ""), ("TV", ("tidal_volume_exp",), "mL"), ("RR", ("rr",), "/min"),
        ("Ppeak", ("airway_pressure_peak",), ""), ("PEEP", ("peep_total",), ""),
    ]
    table_top = chart_y
    row_h = 10
    for row_index, (label, keys, unit) in enumerate(specs):
        y = table_top - (row_index + 1) * row_h
        _box(canvas, left, y, width, row_h, LIGHT if row_index % 2 else None)
        _fit(canvas, label, left + 2, y + 2.5, label_w - 24, font, 5.3)
        _fit(canvas, unit, left + label_w - 22, y + 2.5, 20, font, 4.5, "right")
        for index in range(columns):
            x = plot_x + index * column_w
            _line(canvas, x, y, x, y + row_h, .25)
            at = start + int((index + .5) * interval * 60_000)
            value = _sample(timeline, at, keys)
            _fit(canvas, "-" if value is None else f"{value:g}", x, y + 2.5, column_w, font, 5.2, "center")
        _line(canvas, plot_x + plot_w, y, plot_x + plot_w, y + row_h)

    medication_top = table_top - len(specs) * row_h - 2
    runs = []
    for run in _rows(snapshot.get("io_runs")):
        run_start, run_end = int(run.get("started_at") or 0), int(run.get("stopped_at") or run.get("started_at") or 0)
        if run_end >= start and run_start < end:
            runs.append(run)
    # Continue additional administrations on another chart page instead of
    # silently discarding every item after the twelfth.
    runs = runs[run_offset:run_offset + 18]
    io_events = _rows(snapshot.get("io_events"))
    for row_index, run in enumerate(runs):
        y = medication_top - (row_index + 1) * 13
        _box(canvas, left, y, width, 13, LIGHT if row_index % 2 else None)
        _fit(canvas, run.get("item_name") or run.get("item_code"), left + 2, y + 6, label_w - 4, font, 5.2)
        _fit(canvas, run.get("route") or run.get("kind"), left + 2, y + 1, label_w - 4, font, 4.2)
        page_values = []
        case_values = []
        for event in io_events:
            if str(event.get("item_id")) != str(run.get("item_id")):
                continue
            ts = int(event.get("event_ts") or 0)
            value = event.get("dose_value") if event.get("dose_value") is not None else event.get("volume_ml")
            number = _number(value)
            if number is not None:
                case_values.append(number)
            if not (start <= ts < end):
                continue
            unit = event.get("dose_unit") or run.get("item_unit") or ""
            x = plot_x + (ts - start) / max(1, end - start) * plot_w
            canvas.setFillColor(colors.black); canvas.circle(x, y + 6.5, 1.3, fill=1, stroke=0)
            _fit(canvas, f"{_text(value)}", x - 9, y + 1, 18, font, 4.5, "center")
            if number is not None:
                page_values.append(number)
        for segment in run.get("segments") or []:
            seg_start, seg_end = int(segment.get("ts_from") or 0), int(segment.get("ts_to") or 0)
            if seg_end < start or seg_start >= end:
                continue
            x1 = plot_x + max(0, seg_start - start) / max(1, end - start) * plot_w
            x2 = plot_x + min(end - start, seg_end - start) / max(1, end - start) * plot_w
            _line(canvas, x1, y + 6, x2, y + 6, .8)
            rate = segment.get("dose_value") if segment.get("dose_value") is not None else segment.get("rate_value")
            _fit(canvas, _text(rate), x1 + 2, y + 7, max(12, x2 - x1 - 4), font, 4.3)
        total = f"{sum(case_values):g} {_text(run.get('item_unit'), '')}" if case_values else ("rate record" if run.get("segments") else "recorded")
        _fit(canvas, total, plot_x + plot_w + 2, y + 4, total_w - 4, bold, 5.2)

    footer_y = MARGIN + 6
    _fit(canvas, "Print cadence: continuous vitals 5 min; cuff readings at recorded times. Full-resolution data retained.", left, footer_y + 32, width, font, 5)
    _box(canvas, left, footer_y, width, 28)
    _line(canvas, left + width * .4, footer_y, left + width * .4, footer_y + 28)
    _line(canvas, left + width * .75, footer_y, left + width * .75, footer_y + 28)
    _fit(canvas, "Signature", left + 2, footer_y + 19, width * .4 - 4, font, 4.5)
    _fit(canvas, "Date", left + width * .4 + 2, footer_y + 19, width * .35 - 4, font, 4.5)
    _fit(canvas, f"Generated by Flora Canopy | Page {page} of {pages}", left + width * .75 + 2, footer_y + 9, width * .25 - 4, font, 5.2, "right")
    canvas.showPage()


def _field_value(field: dict[str, Any]) -> str:
    value = _record(field.get("value"))
    selected = value.get("selected") or []
    if selected:
        return "; ".join(_text(item.get("label") or item.get("value")) for item in selected if isinstance(item, dict))
    return _text(value.get("text") if value.get("text") is not None else value.get("number") if value.get("number") is not None else value.get("value") if value.get("value") is not None else field.get("raw_value"))


def _field_label(field: dict[str, Any]) -> str:
    position = _record(field.get("position"))
    header = _record(position.get("source_header"))
    source = field.get("title") or header.get("compTitle") or field.get("name") or header.get("compName") or ""
    label = str(source).strip()
    for prefix in ("Preop-", "Intraop-", "Postop-", "PreAnes-", "IntraAnes-", "PostAnes-", "Ck. list - ", "Ck. list-"):
        if label.lower().startswith(prefix.lower()):
            label = label[len(prefix):]
            break
    label = label.replace("_", " ").replace("-", " ").strip()
    return label or " "


def _form_page(canvas: Canvas, snapshot: dict[str, Any], form: dict[str, Any], source_page: int, fields: list[dict[str, Any]], page: int, pages: int, font: str, bold: str) -> None:
    top = _header(canvas, snapshot, _text(form.get("name"), "Clinical Form"), page, pages, font, bold)
    canvas.setFillColor(SHADE)
    canvas.rect(MARGIN, top - 15, PAGE_W - MARGIN * 2, 15, fill=1, stroke=0)
    _fit(canvas, f"{_text(form.get('name'))} | source page {source_page}", MARGIN, top - 11, PAGE_W - MARGIN * 2, bold, 7, "center")
    area_top, area_bottom = top - 18, MARGIN + 38
    positions = [_record(field.get("position")) for field in fields]
    max_row = max((int(position.get("row_end") or position.get("row_start") or 0) for position in positions), default=0) + 1
    max_col = max((int(position.get("column_end") if position.get("column_end") is not None else position.get("column_start") or 0) for position in positions), default=0) + 1
    row_h = (area_top - area_bottom) / max(1, max_row)
    col_w = (PAGE_W - MARGIN * 2) / max(1, max_col)
    for index, field in enumerate(fields):
        position = _record(field.get("position"))
        row_start = int(position.get("row_start") or index)
        row_end = max(row_start, int(position.get("row_end") if position.get("row_end") is not None else row_start))
        col_start = int(position.get("column_start") or 0)
        col_end = max(col_start, int(position.get("column_end") if position.get("column_end") is not None else col_start))
        x = MARGIN + col_start * col_w
        width = (col_end - col_start + 1) * col_w
        y = area_top - (row_end + 1) * row_h
        height = max(row_h, (row_end - row_start + 1) * row_h)
        component_type = int(field.get("component_type") or 0)
        title = _field_label(field)
        if component_type == 10:
            choice_labels = [_text(choice.get("label"), "") for choice in field.get("choices") or [] if isinstance(choice, dict) and choice.get("label")]
            if choice_labels:
                title = " / ".join(choice_labels)
            _box(canvas, x, y, width, height, SHADE)
            _fit(canvas, title, x + 2, y + max(2, height / 2 - 2), width - 4, bold, min(6.2, max(4.2, height * .35)), "center")
            continue
        _box(canvas, x, y, width, height)
        choices = field.get("choices") or []
        if len(choices) == 1 and isinstance(choices[0], dict) and choices[0].get("label"):
            choice_label = _text(choices[0].get("label"), "")
            if choice_label:
                title = choice_label
        _fit(canvas, title, x + 2, y + height - min(6, height / 2), width - 4, font, min(4.8, max(3.8, height * .24)))
        if choices:
            selected_items = [item for item in _record(field.get("value")).get("selected") or [] if isinstance(item, dict) and item.get("position") is not None and item.get("label")]
            answer = "  ".join(f"[x] {_text(item.get('label'))}" for item in selected_items) or "-"
        else:
            answer = _field_value(field)
        _fit(canvas, answer, x + 2, y + 2, width - 4, bold, min(6, max(4, height * .3)))
    _fit(canvas, f"Generated from preserved Innovian form fields | Page {page} of {pages}", MARGIN, 18, PAGE_W - MARGIN * 2, font, 5.2, "right")
    canvas.showPage()


def _summary_tables(snapshot: dict[str, Any], font: str, bold: str) -> list[Table]:
    """Wrap all staff/event text and paginate instead of clipping clinical notes."""
    width = PAGE_W - 2 * MARGIN
    style = ParagraphStyle("archive-summary", fontName=font, fontSize=7, leading=9)

    def table(headers, rows, widths):
        cells = [[Paragraph(escape(_text(value)).replace("\n", "<br/>"), style)
                  for value in row] for row in [headers, *rows]]
        result = Table(cells, colWidths=widths, repeatRows=1, hAlign="LEFT")
        result.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), .4, GRID),
            ("BACKGROUND", (0, 0), (-1, 0), SHADE),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        return result

    staff = [item for item in _rows(snapshot.get("staff")) if not item.get("source_deleted")]
    def staff_time(item, key):
        value = item.get(key)
        # Structured staff migration stores true UTC; report uses NIT wall time.
        if value and item.get("time_quality") in {"source_mapped", "partial_source"}:
            value = _ms(value) + 7 * 60 * 60_000
        return _stamp(value)
    staff_rows = [[item.get("display_name") or item.get("name"), item.get("role"),
                   staff_time(item, "entered_at"), staff_time(item, "exited_at")] for item in staff]
    output = [table(["Staff assignment timeline", "Role", "Time in", "Time out"],
                    staff_rows or [["Staff assignments unavailable in imported data", "-", "-", "-"]],
                    [width * .35, width * .25, width * .2, width * .2])]
    events = sorted(_rows(snapshot.get("events")), key=lambda item: int(item.get("event_ts") or 0))
    duration_rows = []
    for name, start_label, end_label in [("IN/Out OR", "in or", "out of or"),
                                        ("Anesthesia", "start ane", "end ane"),
                                        ("Induction/Reversal", "induction", "reversal"),
                                        ("Intubation/Extubation", "intubation", "extubation"),
                                        ("Surgery", "start surg", "end surg")]:
        starts = [item["event_ts"] for item in events if str(item.get("title") or "").lower() == start_label]
        ends = [item["event_ts"] for item in events if str(item.get("title") or "").lower() == end_label]
        # Do not guess paired intervals when multiple starts/ends are present.
        if len(starts) == 1 and len(ends) == 1 and ends[0] >= starts[0]:
            minutes = (ends[0] - starts[0]) // 60_000
            duration_rows.append([name, _stamp(starts[0]), _stamp(ends[0]), f"{minutes // 60} h {minutes % 60} min"])
    if duration_rows:
        output.append(table(["Duration events", "Start", "End", "Duration"], duration_rows,
                            [width * .35, width * .25, width * .25, width * .15]))
    event_rows = []
    seen = set()
    for event in events:
        title, memo = _text(event.get("title"), ""), _text(event.get("memo"), "")
        detail = title + ("\n" + memo if memo and memo != title else "")
        state = _text(event.get("source_state"), "")
        if state:
            detail += f"\nSource state: {state}"
        identity = (event.get("event_ts"), detail)
        if identity in seen:
            continue
        seen.add(identity)
        event_rows.append([_stamp(event.get("event_ts")), detail])
    output.append(table(["Recorded time", "Events and clinical notes"],
                        event_rows or [["-", "No events available in imported data"]],
                        [width * .2, width * .8]))
    return output


def _summary_pages(snapshot: dict[str, Any], font: str, bold: str) -> list[list[Table]]:
    # Same header height as chart/form pages. Leave footer and inter-table gaps.
    available = PAGE_H - MARGIN - 139 - 45
    pages, current, remaining = [], [], available
    pending = _summary_tables(snapshot, font, bold)
    while pending:
        item = pending.pop(0)
        _, height = item.wrap(PAGE_W - 2 * MARGIN, remaining)
        if height <= remaining:
            current.append(item)
            remaining -= height + 10
            continue
        parts = item.split(PAGE_W - 2 * MARGIN, remaining)
        if parts:
            current.append(parts[0])
            pending = parts[1:] + pending
        elif not current:
            raise ValueError("A report summary row is too large for a page")
        else:
            pending.insert(0, item)
        pages.append(current)
        current, remaining = [], available
    if current:
        pages.append(current)
    return pages


def build_innovian_report(snapshot: dict[str, Any], selected_sections: list[str]) -> bytes:
    font, bold = _fonts()
    selected_forms = {item.split(":", 1)[1] for item in selected_sections if item.startswith("form:")}
    charts = [item for item in selected_sections if item.startswith(("anes:", "pacu:"))]
    pages: list[tuple[str, Any]] = []
    timeline = _rows(snapshot.get("timeline"))
    case = _record(snapshot.get("case"))
    for chart in charts:
        pacu = chart.startswith("pacu:")
        interval = 10 if pacu else 20
        window = interval * 12 * 60_000
        start = int(case.get("start_time") or (timeline[0].get("ts_minute") if timeline else 0) or 0)
        end = int(case.get("discharge_time") or (timeline[-1].get("ts_minute") if timeline else start + window) or start + window)
        pacu_events = [
            int(item.get("event_ts") or 0)
            for item in _rows(snapshot.get("events"))
            if str(item.get("care_unit") or "").upper() == "PACU" and int(item.get("event_ts") or 0) > 0
        ]
        if pacu:
            if pacu_events:
                start = _floor_time(min(pacu_events), interval) - interval * 60_000
                end = _ceil_time(max(pacu_events), interval)
        elif pacu_events and min(pacu_events) > start:
            end = min(end, _ceil_time(min(pacu_events), interval))
        if end <= start:
            end = start + window
        for offset in range(start, end, window):
            window_end = min(end, offset + window)
            visible_runs = [run for run in _rows(snapshot.get("io_runs"))
                            if int(run.get("stopped_at") or run.get("started_at") or 0) >= offset
                            and int(run.get("started_at") or 0) < window_end]
            for run_offset in range(0, max(1, len(visible_runs)), 18):
                pages.append(("chart", (offset, window_end, pacu, run_offset)))
    for form in _rows(snapshot.get("forms")):
        if str(form.get("id")) not in selected_forms:
            continue
        by_page: dict[int, list[dict[str, Any]]] = {}
        for field in form.get("fields") or []:
            if not isinstance(field, dict):
                continue
            source_page = int(_record(field.get("position")).get("page") or 0)
            by_page.setdefault(source_page, []).append(field)
        if not by_page:
            by_page[0] = []
        for source_page, fields in sorted(by_page.items()):
            pages.append(("form", (form, source_page, fields)))
    if charts:
        pages.extend(("summary", items) for items in _summary_pages(snapshot, font, bold))
    if not pages:
        raise ValueError("No report sections selected")
    output = BytesIO()
    canvas = Canvas(output, pagesize=A4, pageCompression=1)
    canvas.setTitle(f"Innovian archive report - {_text(_record(snapshot.get('source')).get('case_id'))}")
    for page_number, (kind, payload) in enumerate(pages, start=1):
        if kind == "chart":
            start, end, pacu, run_offset = payload
            title = "Post Anesthetic Care Unit" if pacu else "Anesthesia Report"
            if run_offset:
                title += " - medications continued"
            _chart_page(canvas, snapshot, title, start, end, page_number, len(pages), font, bold, pacu, run_offset)
        elif kind == "form":
            form, source_page, fields = payload
            _form_page(canvas, snapshot, form, source_page, fields, page_number, len(pages), font, bold)
        else:
            y = _header(canvas, snapshot, "Staff Timeline and Events", page_number, len(pages), font, bold)
            for item in payload:
                _, height = item.wrap(PAGE_W - 2 * MARGIN, PAGE_H)
                item.drawOn(canvas, MARGIN, y - height)
                y -= height + 10
            _fit(canvas, f"Canopy PostgreSQL archive | Page {page_number} of {len(pages)}", MARGIN, 18,
                 PAGE_W - 2 * MARGIN, font, 5.2, "right")
            canvas.showPage()
    canvas.save()
    return output.getvalue()
