#!/usr/bin/env python3
"""Import official CMS ICD-9-CM procedure titles into SQLite.

Usage:
  python backend/scripts/import_icd9cm_from_cms_zip.py --zip tmp_icd9_v32.zip --db C:/porjai/data/flora.db
"""

from __future__ import annotations

import argparse
import re
import sqlite3
import time
import zipfile
from pathlib import Path
from typing import Dict, Iterable, Optional, Tuple


LONG_ENTRY = "CMS32_DESC_LONG_SG.txt"
SHORT_ENTRY = "CMS32_DESC_SHORT_SG.txt"
LINE_RE = re.compile(r"^([0-9]{4})\s+(.+?)\s*$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import CMS ICD-9-CM procedure master data")
    parser.add_argument("--zip", required=True, type=Path, help="Path to CMS ICD-9-CM ZIP file")
    parser.add_argument("--db", required=True, type=Path, help="Path to flora.db")
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Replace the icd9cm_master table contents before import",
    )
    return parser.parse_args()


def normalize_text(value: str) -> str:
    return " ".join(str(value or "").strip().split())


def iter_titles(zf: zipfile.ZipFile, entry_name: str) -> Iterable[Tuple[str, str]]:
    with zf.open(entry_name) as stream:
        for raw_line in stream:
            line = raw_line.decode("utf-8", errors="ignore").strip()
            if not line:
                continue
            match = LINE_RE.match(line)
            if not match:
                continue
            code = match.group(1)
            title = normalize_text(match.group(2))
            if not code or not title:
                continue
            yield code, title


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS icd9cm_master (
          icd9cm         TEXT PRIMARY KEY,
          short_name_en  TEXT,
          name_en        TEXT,
          created_at     INTEGER NOT NULL,
          updated_at     INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_icd9cm_master_short_name_en
          ON icd9cm_master(short_name_en);

        CREATE INDEX IF NOT EXISTS idx_icd9cm_master_name_en
          ON icd9cm_master(name_en);
        """
    )


def load_titles(zip_path: Path) -> Dict[str, Dict[str, Optional[str]]]:
    if not zip_path.exists():
        raise FileNotFoundError(f"ZIP not found: {zip_path}")

    with zipfile.ZipFile(zip_path) as zf:
        names = set(zf.namelist())
        missing = [name for name in (LONG_ENTRY, SHORT_ENTRY) if name not in names]
        if missing:
            raise RuntimeError(f"ZIP missing required entries: {missing}")

        rows: Dict[str, Dict[str, Optional[str]]] = {}
        for code, title in iter_titles(zf, LONG_ENTRY):
            rows.setdefault(code, {})["name_en"] = title
        for code, title in iter_titles(zf, SHORT_ENTRY):
            rows.setdefault(code, {})["short_name_en"] = title

    return rows


def import_icd9cm(zip_path: Path, db_path: Path, replace: bool) -> Dict[str, int]:
    rows = load_titles(zip_path)
    if not db_path.exists():
        raise FileNotFoundError(f"DB not found: {db_path}")

    conn = sqlite3.connect(db_path)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        ensure_schema(conn)
        now = int(time.time() * 1000)

        inserted = 0
        updated = 0

        with conn:
            if replace:
                conn.execute("DELETE FROM icd9cm_master")

            for code, payload in rows.items():
                existing = conn.execute(
                    "SELECT icd9cm FROM icd9cm_master WHERE icd9cm = ?",
                    (code,),
                ).fetchone()
                if existing is None:
                    conn.execute(
                        """
                        INSERT INTO icd9cm_master
                          (icd9cm, short_name_en, name_en, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            code,
                            payload.get("short_name_en"),
                            payload.get("name_en"),
                            now,
                            now,
                        ),
                    )
                    inserted += 1
                else:
                    conn.execute(
                        """
                        UPDATE icd9cm_master
                           SET short_name_en = ?,
                               name_en = ?,
                               updated_at = ?
                         WHERE icd9cm = ?
                        """,
                        (
                            payload.get("short_name_en"),
                            payload.get("name_en"),
                            now,
                            code,
                        ),
                    )
                    updated += 1

        return {
            "rows": len(rows),
            "inserted": inserted,
            "updated": updated,
        }
    finally:
        conn.close()


def main() -> int:
    args = parse_args()
    summary = import_icd9cm(args.zip, args.db, args.replace)
    print(
        "Imported ICD-9-CM procedure master:",
        f"rows={summary['rows']}",
        f"inserted={summary['inserted']}",
        f"updated={summary['updated']}",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
