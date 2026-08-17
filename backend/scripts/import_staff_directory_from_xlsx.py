#!/usr/bin/env python3
"""Import anesthesia staff directory rows from XLSX into SQLite.

Usage:
  python scripts/import_staff_directory_from_xlsx.py
  python scripts/import_staff_directory_from_xlsx.py --xlsx backend/Anesthesia Residents.xlsx --db backend/flora.db
"""

from __future__ import annotations

import argparse
import decimal
import re
import sqlite3
import time
import zipfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import xml.etree.ElementTree as ET


NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
RE_COL = re.compile(r"([A-Z]+)")
RE_SCI = re.compile(r"^[+-]?(?:\d+\.?\d*|\d*\.?\d+)[eE][+-]?\d+$")
RE_TRAIL_DOT_ZERO = re.compile(r"^-?\d+\.0$")
RE_TRAILING_YEAR = re.compile(r"(\d{2,4})\s*$")

ROLE_MAP = {
    "anes cu staff": ("anesthetist", "Anesthetist"),
    "anes cu staffs": ("anesthetist", "Anesthetist"),
    "anesthetist": ("anesthetist", "Anesthetist"),
    "assistant": ("assistant", "Assistant"),
    "circulating nurse": ("circulatingNurse", "Circulating nurse"),
    "fellow anesthetist": ("fellowAnesthetist", "Fellow Anesthetist"),
    "instrument nurse": ("instrumentNurse", "Instrument nurse"),
    "medical student": ("medicalStudent", "Medical Student"),
    "nurse anesthetist": ("nurseAnesthetist", "Nurse anesthetist"),
    "rotate resident": ("rotateResident", "Rotate resident"),
    "scrub nurse": ("scrubNurse", "Scrub nurse"),
    "surgeon": ("surgeon", "Surgeon"),
    "surgery resident": ("surgeryResident", "Surgery resident"),
    "anesthetist resident": ("anesthetistResident", "Anesthetist Resident"),
}


def col_to_index(col: str) -> int:
    n = 0
    for ch in col:
        if "A" <= ch <= "Z":
            n = n * 26 + (ord(ch) - 64)
    return n - 1


def normalize_text(value: Optional[str]) -> str:
    if value is None:
        return ""
    return str(value).strip()


def normalize_id(value: Optional[str]) -> str:
    s = normalize_text(value)
    if not s:
        return ""
    if RE_TRAIL_DOT_ZERO.match(s):
        return s[:-2]
    if RE_SCI.match(s):
        try:
            with decimal.localcontext() as ctx:
                ctx.prec = 50
                d = decimal.Decimal(s)
                return str(int(d))
        except Exception:
            return s
    return s


def normalize_email(value: Optional[str]) -> str:
    s = normalize_text(value).lower()
    if not s or "@" not in s:
        return ""
    return s


def normalize_entry_year(value: Optional[str]) -> Optional[int]:
    s = normalize_text(value)
    if not s:
        return None
    try:
        n = int(float(s))
    except Exception:
        return None
    if 2500 <= n <= 2700:
        return n
    if 1900 <= n <= 2200:
        return n
    if 50 <= n <= 99:
        return 2500 + n
    if 0 <= n <= 49:
        return 2000 + n
    return None


def normalize_role(role_text: str) -> Optional[Tuple[str, str, Optional[int]]]:
    raw = normalize_text(role_text)
    compact = re.sub(r"\s+", " ", raw).strip()
    low = compact.lower()

    if low.startswith("anes resident"):
        year = None
        m = RE_TRAILING_YEAR.search(compact)
        if m:
            year = normalize_entry_year(m.group(1))
        return ("anesthetistResident", "Anesthetist Resident", year)

    if low in ROLE_MAP:
        role_id, role_name = ROLE_MAP[low]
        return (role_id, role_name, None)

    # Default fallback to anesthetist resident for unknown resident variants.
    if "resident" in low:
        return ("anesthetistResident", "Anesthetist Resident", None)

    return None


def canonical_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.strip().lower())


def open_xlsx_rows(xlsx_path: Path) -> Dict[str, List[List[str]]]:
    rows_by_sheet: Dict[str, List[List[str]]] = {}
    with zipfile.ZipFile(xlsx_path) as zf:
        shared: List[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            sst = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in sst.findall("a:si", NS):
                text = "".join(t.text or "" for t in si.findall(".//a:t", NS))
                shared.append(text)

        wb = ET.fromstring(zf.read("xl/workbook.xml"))
        rel = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        rel_map = {
            r.attrib.get("Id"): r.attrib.get("Target")
            for r in rel.findall(
                "{http://schemas.openxmlformats.org/package/2006/relationships}Relationship"
            )
        }

        sheets: List[Tuple[str, str]] = []
        for sheet in wb.findall("a:sheets/a:sheet", NS):
            name = sheet.attrib.get("name", "")
            rel_id = sheet.attrib.get(
                "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id",
                "",
            )
            target = rel_map.get(rel_id, "")
            if target.startswith("worksheets/"):
                sheets.append((name, f"xl/{target}"))

        for sheet_name, sheet_file in sheets:
            root = ET.fromstring(zf.read(sheet_file))
            out_rows: List[List[str]] = []
            for row in root.findall(".//a:sheetData/a:row", NS):
                values: Dict[int, str] = {}
                for cell in row.findall("a:c", NS):
                    ref = cell.attrib.get("r", "")
                    m = RE_COL.match(ref)
                    if not m:
                        continue
                    idx = col_to_index(m.group(1))
                    ctype = cell.attrib.get("t")
                    v = cell.find("a:v", NS)
                    is_el = cell.find("a:is", NS)
                    val = ""
                    if ctype == "s" and v is not None and v.text is not None:
                        try:
                            val = shared[int(v.text)]
                        except Exception:
                            val = ""
                    elif ctype == "inlineStr" and is_el is not None:
                        val = "".join(t.text or "" for t in is_el.findall(".//a:t", NS))
                    elif v is not None and v.text is not None:
                        val = v.text

                    val = val.strip()
                    if val:
                        values[idx] = val

                if values:
                    max_idx = max(values.keys())
                    arr = [values.get(i, "") for i in range(max_idx + 1)]
                    out_rows.append(arr)
            rows_by_sheet[sheet_name] = out_rows

    return rows_by_sheet


def get_cell(row: List[str], idx: int) -> str:
    if idx < 0 or idx >= len(row):
        return ""
    return normalize_text(row[idx])


def detect_header_map(header_row: List[str]) -> Dict[str, int]:
    mapping: Dict[str, int] = {}
    for idx, raw in enumerate(header_row):
        key = canonical_header(raw)
        if key in {"thfirstname", "ชื่อไทย"}:
            mapping["th_first_name"] = idx
        elif key in {"thlastname", "นามสกุลไทย"}:
            mapping["th_last_name"] = idx
        elif key in {"enfirstname", "ชื่ออังกฤษ"}:
            mapping["en_first_name"] = idx
        elif key in {"enlastname", "นามสกุลอังกฤษ"}:
            mapping["en_last_name"] = idx
        elif key in {"personalid", "รหัสประจำตัว"}:
            mapping["personal_id"] = idx
        elif key in {"staffrole"}:
            mapping["staff_role"] = idx
        elif key in {"email"}:
            mapping["email"] = idx
        elif key in {"staffid", "เลขที่ว", "เลขที่", "hospitalid", "hospitalstaffno"}:
            mapping["hospital_id"] = idx
        elif key in {"innovianid"}:
            mapping["innovian_id"] = idx

    # New CU staff workbook layout:
    # [ลำดับ, ชื่อไทย, นามสกุลไทย, ชื่ออังกฤษ, นามสกุลอังกฤษ, รหัสประจำตัว รพ., Personal Role, Email, Confirm data, Innovian ID]
    personal_role = normalize_text(header_row[6] if len(header_row) > 6 else "").lower()
    email_header = normalize_text(header_row[7] if len(header_row) > 7 else "").lower()
    innovian_header = normalize_text(header_row[9] if len(header_row) > 9 else "").lower()
    if (
        not {"en_first_name", "en_last_name", "staff_role"}.issubset(mapping.keys())
        and personal_role == "personal role"
        and email_header == "email"
        and innovian_header == "innovian id"
    ):
        mapping.update(
            {
                "th_first_name": 1,
                "th_last_name": 2,
                "en_first_name": 3,
                "en_last_name": 4,
                "hospital_id": 5,
                "staff_role": 6,
                "email": 7,
                "innovian_id": 9,
            }
        )
    return mapping


def make_staff_name(en_first: str, en_last: str, th_first: str, th_last: str) -> str:
    en = " ".join(x for x in [en_first, en_last] if x).strip()
    if en:
        return en
    return " ".join(x for x in [th_first, th_last] if x).strip()


def is_header_like_row(staff_role: str, staff_name: str, en_first: str, en_last: str) -> bool:
    role_key = canonical_header(staff_role)
    name_key = canonical_header(staff_name)
    en_first_key = canonical_header(en_first)
    en_last_key = canonical_header(en_last)
    if role_key == "staffrole":
        return True
    if en_first_key == "enfirstname" or en_last_key == "enlastname":
        return True
    if name_key in {"enfirstnameenlastname", "ชื่ออังกฤษนามสกุลอังกฤษ"}:
        return True
    return False


def collect_records(rows_by_sheet: Dict[str, List[List[str]]]) -> List[Dict[str, str]]:
    records: List[Dict[str, str]] = []

    # Primary source with the most complete columns.
    main_rows = rows_by_sheet.get("Anesth Residents", [])
    for row in main_rows:
        if len(row) < 9:
            continue
        staff_role_raw = get_cell(row, 6)
        if not staff_role_raw:
            continue

        th_first = get_cell(row, 1)
        th_last = get_cell(row, 2)
        en_first = get_cell(row, 3)
        en_last = get_cell(row, 4)
        personal_id = normalize_id(get_cell(row, 5))
        email = normalize_email(get_cell(row, 7))
        hospital_id = normalize_id(get_cell(row, 8))
        innovian_id = normalize_id(get_cell(row, 9))

        # Skip sample/example row.
        if "..." in email or hospital_id == "12345":
            continue

        staff_name = make_staff_name(en_first, en_last, th_first, th_last)
        if not staff_name:
            continue
        if is_header_like_row(staff_role_raw, staff_name, en_first, en_last):
            continue
        normalized_role = normalize_role(staff_role_raw)
        if not normalized_role:
            continue
        role_id, staff_role, entry_year = normalized_role

        records.append(
            {
                "hospital_id": hospital_id,
                "personal_id": personal_id,
                "email": email,
                "th_first_name": th_first,
                "th_last_name": th_last,
                "en_first_name": en_first,
                "en_last_name": en_last,
                "innovian_id": innovian_id,
                "staff_name": staff_name,
                "staff_role_id": role_id,
                "staff_role": staff_role,
                "entry_year": entry_year,
                "source": "Anesth Residents",
            }
        )

    # Secondary sources; parsed only when they expose recognizable headers.
    for sheet_name, rows in rows_by_sheet.items():
        if sheet_name == "Anesth Residents":
            continue
        if not rows:
            continue

        header_idx = -1
        header_map: Dict[str, int] = {}
        for idx, row in enumerate(rows[:10]):
            mapping = detect_header_map(row)
            if {"en_first_name", "en_last_name", "staff_role"}.issubset(mapping.keys()):
                header_idx = idx
                header_map = mapping
                break
        if header_idx < 0:
            continue

        for row in rows[header_idx + 1 :]:
            staff_role_raw = get_cell(row, header_map.get("staff_role", -1))
            if not staff_role_raw:
                continue

            th_first = get_cell(row, header_map.get("th_first_name", -1))
            th_last = get_cell(row, header_map.get("th_last_name", -1))
            en_first = get_cell(row, header_map.get("en_first_name", -1))
            en_last = get_cell(row, header_map.get("en_last_name", -1))
            personal_id = normalize_id(get_cell(row, header_map.get("personal_id", -1)))
            email = normalize_email(get_cell(row, header_map.get("email", -1)))
            hospital_id = normalize_id(get_cell(row, header_map.get("hospital_id", -1)))
            innovian_id = normalize_id(get_cell(row, header_map.get("innovian_id", -1)))

            if "..." in email or hospital_id == "12345":
                continue

            staff_name = make_staff_name(en_first, en_last, th_first, th_last)
            if not staff_name:
                continue
            if is_header_like_row(staff_role_raw, staff_name, en_first, en_last):
                continue
            normalized_role = normalize_role(staff_role_raw)
            if not normalized_role:
                continue
            role_id, staff_role, entry_year = normalized_role

            records.append(
                {
                    "hospital_id": hospital_id,
                    "personal_id": personal_id,
                    "email": email,
                    "th_first_name": th_first,
                    "th_last_name": th_last,
                    "en_first_name": en_first,
                    "en_last_name": en_last,
                    "innovian_id": innovian_id,
                    "staff_name": staff_name,
                    "staff_role_id": role_id,
                    "staff_role": staff_role,
                    "entry_year": entry_year,
                    "source": sheet_name,
                }
            )

    # Deduplicate with priority for primary sheet values.
    dedup: Dict[str, Dict[str, str]] = {}
    priority = {"Anesth Residents": 3, "Sheet2": 2, "ensheet": 1}
    fields = [
        "hospital_id",
        "personal_id",
        "email",
        "th_first_name",
        "th_last_name",
        "en_first_name",
        "en_last_name",
        "innovian_id",
        "staff_role_id",
        "staff_name",
        "staff_role",
        "entry_year",
    ]

    for rec in records:
        key = (
            rec["hospital_id"].lower()
            or rec["email"].lower()
            or f'{rec["staff_name"].lower()}::{rec["staff_role_id"].lower()}'
        )
        existing = dedup.get(key)
        if existing is None:
            dedup[key] = dict(rec)
            continue

        old_p = priority.get(existing.get("source", ""), 0)
        new_p = priority.get(rec.get("source", ""), 0)
        for field in fields:
            old_val = existing.get(field, "")
            new_val = rec.get(field, "")
            if new_val and (not old_val or new_p >= old_p):
                existing[field] = new_val
        if new_p >= old_p:
            existing["source"] = rec.get("source", existing.get("source", ""))

    return list(dedup.values())


def ensure_columns(conn: sqlite3.Connection) -> None:
    cols = {
        row[1]
        for row in conn.execute("PRAGMA table_info(staff_directory)").fetchall()
    }
    required = {
        "hospital_id": "TEXT",
        "personal_id": "TEXT",
        "email": "TEXT",
        "th_first_name": "TEXT",
        "th_last_name": "TEXT",
        "en_first_name": "TEXT",
        "en_last_name": "TEXT",
        "innovian_id": "TEXT",
        "staff_role_id": "TEXT",
        "entry_year": "INTEGER",
        "is_active": "INTEGER NOT NULL DEFAULT 1",
    }
    for col, col_type in required.items():
        if col not in cols:
            conn.execute(f"ALTER TABLE staff_directory ADD COLUMN {col} {col_type}")


def merge_value(current: Optional[str], incoming: str) -> str:
    if incoming:
        return incoming
    return normalize_text(current)


def upsert_records(conn: sqlite3.Connection, records: List[Dict[str, str]]) -> Tuple[int, int]:
    inserted = 0
    updated = 0
    now = int(time.time() * 1000)

    for rec in records:
        shared_id = rec.get("hospital_id", "") or rec.get("personal_id", "")
        hospital_id = shared_id
        personal_id = rec.get("personal_id", "") or shared_id
        email = rec.get("email", "")
        staff_name = rec.get("staff_name", "")
        staff_role = rec.get("staff_role", "")
        staff_role_id = rec.get("staff_role_id", "")
        if not staff_name or not staff_role:
            continue

        row = None
        if hospital_id:
            row = conn.execute(
                "SELECT * FROM staff_directory WHERE hospital_id = ? LIMIT 1",
                (hospital_id,),
            ).fetchone()
        if row is None and email:
            row = conn.execute(
                "SELECT * FROM staff_directory WHERE lower(email) = lower(?) LIMIT 1",
                (email,),
            ).fetchone()
        if row is None:
            row = conn.execute(
                "SELECT * FROM staff_directory WHERE staff_name = ? AND staff_role_id = ? LIMIT 1",
                (staff_name, staff_role_id),
            ).fetchone()

        if row is None:
            conn.execute(
                """
                INSERT INTO staff_directory (
                  hospital_id, personal_id, email, th_first_name, th_last_name,
                  en_first_name, en_last_name, innovian_id,
                  staff_role_id, entry_year, staff_name, staff_role,
                  is_active, used_count, last_used_at, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)
                """,
                (
                    hospital_id or None,
                    personal_id or None,
                    rec.get("email", "") or None,
                    rec.get("th_first_name", "") or None,
                    rec.get("th_last_name", "") or None,
                    rec.get("en_first_name", "") or None,
                    rec.get("en_last_name", "") or None,
                    rec.get("innovian_id", "") or None,
                    rec.get("staff_role_id", "") or None,
                    rec.get("entry_year"),
                    staff_name,
                    staff_role,
                    now,
                    now,
                    now,
                ),
            )
            inserted += 1
            continue

        cursor = conn.execute("SELECT * FROM staff_directory WHERE id = ? LIMIT 1", (row[0],))
        fetched = cursor.fetchone()
        columns = [d[0] for d in cursor.description]
        existing = dict(zip(columns, fetched))

        conn.execute(
            """
            UPDATE staff_directory
            SET hospital_id = ?,
                personal_id = ?,
                email = ?,
                th_first_name = ?,
                th_last_name = ?,
                en_first_name = ?,
                en_last_name = ?,
                innovian_id = ?,
                staff_role_id = ?,
                entry_year = ?,
                staff_name = ?,
                staff_role = ?,
                is_active = 1,
                updated_at = ?
            WHERE id = ?
            """,
            (
                merge_value(existing.get("hospital_id"), hospital_id) or None,
                merge_value(existing.get("personal_id"), personal_id) or None,
                merge_value(existing.get("email"), rec.get("email", "")) or None,
                merge_value(existing.get("th_first_name"), rec.get("th_first_name", "")) or None,
                merge_value(existing.get("th_last_name"), rec.get("th_last_name", "")) or None,
                merge_value(existing.get("en_first_name"), rec.get("en_first_name", "")) or None,
                merge_value(existing.get("en_last_name"), rec.get("en_last_name", "")) or None,
                merge_value(existing.get("innovian_id"), rec.get("innovian_id", "")) or None,
                merge_value(existing.get("staff_role_id"), rec.get("staff_role_id", "")) or None,
                rec.get("entry_year") or existing.get("entry_year"),
                merge_value(existing.get("staff_name"), rec.get("staff_name", "")),
                merge_value(existing.get("staff_role"), rec.get("staff_role", "")),
                now,
                existing["id"],
            ),
        )
        updated += 1

    return inserted, updated


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--xlsx",
        default="backend/Anesthesia Residents.xlsx",
        help="Path to xlsx source file",
    )
    parser.add_argument(
        "--db",
        default="backend/flora.db",
        help="Path to sqlite db",
    )
    args = parser.parse_args()

    xlsx_path = Path(args.xlsx)
    db_path = Path(args.db)
    if not xlsx_path.exists():
        raise SystemExit(f"XLSX file not found: {xlsx_path}")
    if not db_path.exists():
        raise SystemExit(f"DB file not found: {db_path}")

    rows_by_sheet = open_xlsx_rows(xlsx_path)
    records = collect_records(rows_by_sheet)
    if not records:
        raise SystemExit("No valid staff rows detected in workbook.")

    conn = sqlite3.connect(str(db_path))
    try:
        ensure_columns(conn)
        conn.execute(
            """
            DELETE FROM staff_directory
            WHERE lower(replace(trim(staff_role), ' ', '')) = 'staffrole'
            """
        )
        conn.execute(
            """
            DELETE FROM staff_directory
            WHERE lower(replace(trim(staff_name), ' ', '')) IN (
                'enfirstnameenlastname'
            )
               OR staff_name LIKE '%นามสกุล(อังกฤษ)%'
               OR hospital_id = 'เลขที่ ว.....'
               OR personal_id = 'รหัสประจำตัว'
            """
        )
        inserted, updated = upsert_records(conn, records)
        conn.commit()
    finally:
        conn.close()

    print(
        f"Imported staff directory from {xlsx_path} -> {db_path}\n"
        f"Parsed rows: {len(records)}\n"
        f"Inserted: {inserted}\n"
        f"Updated: {updated}"
    )


if __name__ == "__main__":
    main()
