#!/usr/bin/env python3
"""Import ICD10 master rows from XLSX into SQLite.

Usage:
  python scripts/import_icd10_from_xlsx.py
  python scripts/import_icd10_from_xlsx.py --xlsx backend/ICD10.xlsx --db backend/flora.db
"""

from __future__ import annotations

import argparse
import re
import sqlite3
import time
import zipfile
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple
import xml.etree.ElementTree as ET


NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
}
MAIN_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RE_COL = re.compile(r"([A-Z]+)")
RE_INT = re.compile(r"^[+-]?\d+$")

HEADER_ALIASES = {
    "icd10": "icd10",
    "icd10who": "icd10who",
    "diagseq": "diagseq",
    "name": "name_en",
    "thainame": "name_th",
    "extcause": "extcause",
    "mcode": "mcode",
    "ca": "ca",
}


def canonical_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.strip().lower())


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


def normalize_code(value: Optional[str]) -> str:
    text = normalize_text(value).replace(" ", "")
    return text.upper()


def parse_int_like(value: Optional[str]) -> Optional[int]:
    text = normalize_text(value)
    if not text:
        return None

    if RE_INT.match(text):
        try:
            return int(text)
        except Exception:
            return None

    try:
        number = float(text)
        if not (number == number):  # NaN check
            return None
        rounded = int(round(number))
        if abs(number - rounded) < 1e-9:
            return rounded
    except Exception:
        return None

    return None


def load_shared_strings(zf: zipfile.ZipFile) -> List[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []

    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    shared: List[str] = []
    for si in root.findall("a:si", NS):
        text = "".join(t.text or "" for t in si.findall(".//a:t", NS))
        shared.append(text)
    return shared


def resolve_sheet_path(zf: zipfile.ZipFile, preferred_sheet_name: str) -> str:
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rel_map = {
        rel.attrib.get("Id"): rel.attrib.get("Target")
        for rel in rels.findall("pr:Relationship", NS)
    }

    sheet_rows: List[Tuple[str, str]] = []
    for sheet in workbook.findall("a:sheets/a:sheet", NS):
        name = sheet.attrib.get("name", "")
        rel_id = sheet.attrib.get(
            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id",
            "",
        )
        target = rel_map.get(rel_id, "")
        if not target:
            continue
        if target.startswith("/"):
            sheet_path = target.lstrip("/")
        elif target.startswith("xl/"):
            sheet_path = target
        else:
            sheet_path = f"xl/{target}"
        sheet_rows.append((name, sheet_path))

    if not sheet_rows:
        raise RuntimeError("No worksheets found in workbook")

    for name, sheet_path in sheet_rows:
        if name.strip().lower() == preferred_sheet_name.strip().lower():
            return sheet_path
    return sheet_rows[0][1]


def cell_value(cell: ET.Element, shared: List[str]) -> str:
    ctype = cell.attrib.get("t")
    v = cell.find(f"{MAIN_NS}v")
    if ctype == "s" and v is not None and v.text is not None:
        try:
            return shared[int(v.text)]
        except Exception:
            return ""
    if ctype == "inlineStr":
        return "".join(t.text or "" for t in cell.findall(f".//{MAIN_NS}t"))
    if v is not None and v.text is not None:
        return v.text
    return ""


def iter_sheet_rows(
    zf: zipfile.ZipFile, sheet_path: str, shared: List[str]
) -> Iterable[Tuple[int, Dict[int, str]]]:
    with zf.open(sheet_path) as stream:
        context = ET.iterparse(stream, events=("end",))
        for _, elem in context:
            if elem.tag != f"{MAIN_NS}row":
                continue

            row_num = int(elem.attrib.get("r", "0") or 0)
            values: Dict[int, str] = {}
            for cell in elem.findall(f"{MAIN_NS}c"):
                ref = cell.attrib.get("r", "")
                m = RE_COL.match(ref)
                if not m:
                    continue
                idx = col_to_index(m.group(1))
                value = normalize_text(cell_value(cell, shared))
                if value:
                    values[idx] = value

            if values:
                yield row_num, values
            elem.clear()


def map_header(cells: Dict[int, str]) -> Dict[str, int]:
    mapped: Dict[str, int] = {}
    for idx, raw in cells.items():
        key = canonical_header(raw)
        field = HEADER_ALIASES.get(key)
        if field:
            mapped[field] = idx
    return mapped


def to_record(cells: Dict[int, str], header_map: Dict[str, int]) -> Optional[Dict[str, object]]:
    def get(field: str) -> str:
        idx = header_map.get(field)
        if idx is None:
            return ""
        return normalize_text(cells.get(idx, ""))

    icd10 = normalize_code(get("icd10"))
    if not icd10:
        return None

    icd10who = normalize_code(get("icd10who")) or icd10
    name_en = get("name_en") or None
    name_th = get("name_th") or None

    record = {
        "icd10": icd10,
        "icd10who": icd10who,
        "diagseq": parse_int_like(get("diagseq")),
        "name_en": name_en,
        "name_th": name_th,
        "extcause": parse_int_like(get("extcause")),
        "mcode": parse_int_like(get("mcode")),
        "ca": parse_int_like(get("ca")),
    }
    return record


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS icd10_master (
          icd10         TEXT PRIMARY KEY,
          icd10who      TEXT NOT NULL,
          diagseq       INTEGER,
          name_en       TEXT,
          name_th       TEXT,
          extcause      INTEGER,
          mcode         INTEGER,
          ca            INTEGER,
          created_at    INTEGER NOT NULL,
          updated_at    INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_icd10_master_who
          ON icd10_master(icd10who);

        CREATE INDEX IF NOT EXISTS idx_icd10_master_name_en
          ON icd10_master(name_en);

        CREATE INDEX IF NOT EXISTS idx_icd10_master_name_th
          ON icd10_master(name_th);
        """
    )


def import_icd10(
    xlsx_path: Path,
    db_path: Path,
    sheet_name: str,
    replace: bool,
) -> Dict[str, int]:
    if not xlsx_path.exists():
        raise FileNotFoundError(f"XLSX not found: {xlsx_path}")
    if not db_path.exists():
        raise FileNotFoundError(f"DB not found: {db_path}")

    with zipfile.ZipFile(xlsx_path) as zf:
        shared = load_shared_strings(zf)
        sheet_path = resolve_sheet_path(zf, sheet_name)

        header_map: Dict[str, int] = {}
        records_by_code: Dict[str, Dict[str, object]] = {}
        total_rows = 0
        skipped_rows = 0
        duplicate_codes = 0

        for row_num, cells in iter_sheet_rows(zf, sheet_path, shared):
            total_rows += 1
            if not header_map:
                header_map = map_header(cells)
                required = {"icd10", "icd10who", "name_en"}
                missing = required - set(header_map.keys())
                if missing:
                    raise RuntimeError(
                        f"Missing required header columns: {sorted(missing)}"
                    )
                continue

            record = to_record(cells, header_map)
            if record is None:
                skipped_rows += 1
                continue

            code = str(record["icd10"])
            existing = records_by_code.get(code)
            if existing is None:
                records_by_code[code] = record
                continue

            duplicate_codes += 1
            for field in ("icd10who", "diagseq", "name_en", "name_th", "extcause", "mcode", "ca"):
                old_val = existing.get(field)
                new_val = record.get(field)
                if (old_val is None or old_val == "") and new_val not in (None, ""):
                    existing[field] = new_val

        records = list(records_by_code.values())

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        ensure_schema(conn)
        now = int(time.time() * 1000)

        with conn:
            if replace:
                conn.execute("DELETE FROM icd10_master")
                conn.executemany(
                    """
                    INSERT INTO icd10_master
                      (icd10, icd10who, diagseq, name_en, name_th, extcause, mcode, ca, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            rec["icd10"],
                            rec["icd10who"],
                            rec["diagseq"],
                            rec["name_en"],
                            rec["name_th"],
                            rec["extcause"],
                            rec["mcode"],
                            rec["ca"],
                            now,
                            now,
                        )
                        for rec in records
                    ],
                )
            else:
                conn.executemany(
                    """
                    INSERT INTO icd10_master
                      (icd10, icd10who, diagseq, name_en, name_th, extcause, mcode, ca, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(icd10)
                    DO UPDATE SET
                      icd10who = excluded.icd10who,
                      diagseq = excluded.diagseq,
                      name_en = excluded.name_en,
                      name_th = excluded.name_th,
                      extcause = excluded.extcause,
                      mcode = excluded.mcode,
                      ca = excluded.ca,
                      updated_at = excluded.updated_at
                    """,
                    [
                        (
                            rec["icd10"],
                            rec["icd10who"],
                            rec["diagseq"],
                            rec["name_en"],
                            rec["name_th"],
                            rec["extcause"],
                            rec["mcode"],
                            rec["ca"],
                            now,
                            now,
                        )
                        for rec in records
                    ],
                )

        total_in_db = conn.execute("SELECT COUNT(1) FROM icd10_master").fetchone()[0]
    finally:
        conn.close()

    return {
        "xlsx_rows_read": total_rows,
        "records_ready": len(records),
        "rows_skipped": skipped_rows,
        "duplicate_codes_collapsed": duplicate_codes,
        "rows_in_db": int(total_in_db),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Import ICD10 master data from XLSX")
    parser.add_argument(
        "--xlsx",
        type=Path,
        default=Path.cwd() / "ICD10.xlsx",
        help="Path to ICD10.xlsx",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=Path.cwd() / "flora.db",
        help="Path to flora.db",
    )
    parser.add_argument(
        "--sheet",
        default="ICD10",
        help="Worksheet name (default: ICD10)",
    )
    parser.add_argument(
        "--no-replace",
        action="store_true",
        help="Upsert only; do not delete existing rows before import",
    )
    args = parser.parse_args()

    result = import_icd10(
        xlsx_path=args.xlsx,
        db_path=args.db,
        sheet_name=args.sheet,
        replace=not args.no_replace,
    )

    print("[ICD10 IMPORT] done")
    print(f"  xlsx_rows_read: {result['xlsx_rows_read']}")
    print(f"  records_ready : {result['records_ready']}")
    print(f"  rows_skipped  : {result['rows_skipped']}")
    print(f"  duplicates    : {result['duplicate_codes_collapsed']}")
    print(f"  rows_in_db    : {result['rows_in_db']}")


if __name__ == "__main__":
    main()
