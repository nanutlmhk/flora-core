#!/usr/bin/env python3
"""Generate and validate Canopy Innovian-compatible reports from PostgreSQL.

The verifier deliberately calls the same snapshot and report builder used by
the API. It never reads an historical PDF while generating the report. A
temporary release-gate change is made inside a transaction and always rolled
back, so an importing year cannot accidentally become visible to users.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import uuid
from pathlib import Path

import psycopg
from psycopg.rows import dict_row


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "flora-api"))
os.environ.setdefault(
    "FLORA_DATABASE_URL",
    "postgresql://flora_admin:flora-admin-local-only@127.0.0.1:6892/flora",
)

from app.routes.legacy_archive import legacy_case_snapshot, legacy_report_options  # noqa: E402
from app.services.innovian_report import build_innovian_report  # noqa: E402


def normalized(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def validate_pdf(payload: bytes, expected: list[str], render_dir: Path, case_id: str, render: bool = True) -> dict:
    import pymupdf

    if not payload.startswith(b"%PDF-") or len(payload) < 8_000:
        raise AssertionError(f"{case_id}: invalid or suspiciously small PDF ({len(payload)} bytes)")
    document = pymupdf.open(stream=payload, filetype="pdf")
    if document.page_count < 1:
        raise AssertionError(f"{case_id}: generated PDF has no pages")
    text = "\n".join(page.get_text() for page in document)
    missing = [item for item in expected if normalized(item) and normalized(item).lower() not in normalized(text).lower()]
    if missing:
        raise AssertionError(f"{case_id}: generated report is missing expected text: {missing}")
    rendered = []
    for index in (sorted({0, min(2, document.page_count - 1)}) if render else []):
        page = document[index]
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False)
        samples = pixmap.samples
        dark = sum(1 for offset in range(0, len(samples), pixmap.n) if min(samples[offset:offset + 3]) < 220)
        ratio = dark / max(1, pixmap.width * pixmap.height)
        if ratio < 0.01:
            raise AssertionError(f"{case_id}: rendered page {index + 1} appears blank ({ratio:.4%} dark pixels)")
        destination = render_dir / f"{case_id}-page{index + 1}.png"
        pixmap.save(destination)
        rendered.append({"page": index + 1, "path": str(destination), "dark_pixel_ratio": round(ratio, 4)})
    return {"pages": document.page_count, "bytes": len(payload), "rendered": rendered}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("case_ids", nargs="*", help="Innovian source case IDs")
    parser.add_argument("--year", type=int, help="Validate every report in an archive year")
    parser.add_argument("--all-sections", action="store_true", help="Generate optional and default sections together")
    parser.add_argument("--summary-only", action="store_true", help="Do not save or render PDFs")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "tmp" / "pdfs" / "verification")
    arguments = parser.parse_args()
    arguments.output_dir.mkdir(parents=True, exist_ok=True)

    if not arguments.case_ids and arguments.year is None:
        parser.error("provide one or more case IDs or --year")
    results = []
    with psycopg.connect(os.environ["FLORA_DATABASE_URL"], row_factory=dict_row) as database:
        database.autocommit = False
        if arguments.year is not None:
            case_rows = database.execute(
                """SELECT a.id,a.source_case_id,a.started_at,c.patient_name,c.hn,c.diagnosis_name,c.procedure_name
                   FROM archive_case a
                   LEFT JOIN archive_case_context c ON c.archive_case_id=a.id
                   WHERE a.source_system='innovian' AND extract(year from a.started_at)::integer=%s
                   ORDER BY a.started_at,a.source_case_id""",
                (arguments.year,),
            ).fetchall()
        else:
            case_rows = []
        for source_case_id in arguments.case_ids:
            row = database.execute(
                """SELECT a.id,a.source_case_id,a.started_at,c.patient_name,c.hn,c.diagnosis_name,c.procedure_name
                   FROM archive_case a
                   LEFT JOIN archive_case_context c ON c.archive_case_id=a.id
                   WHERE a.source_system='innovian' AND a.source_case_id=%s
                   ORDER BY a.representation_version DESC LIMIT 1""",
                (source_case_id,),
            ).fetchone()
            if not row:
                raise AssertionError(f"{source_case_id}: archive case not found")
            case_rows.append(row)
        for row in case_rows:
            source_case_id = str(row["source_case_id"])
            try:
                database.execute(
                    """INSERT INTO archive_import_year_status(archive_year,status)
                       VALUES(extract(year from %s::timestamptz)::integer,'ready_for_verification')
                       ON CONFLICT(archive_year) DO UPDATE SET status='ready_for_verification'""",
                    (row["started_at"],),
                )
                archive_case_id = uuid.UUID(str(row["id"]))
                catalog = legacy_report_options(archive_case_id, database)
                selected = [
                    str(item["id"]) for item in catalog["sections"]
                    if arguments.all_sections or item.get("default")
                ]
                if not selected:
                    raise AssertionError(f"{source_case_id}: report catalog contains no default sections")
                if len(selected) > 24:
                    raise AssertionError(f"{source_case_id}: default report selection exceeds API limit ({len(selected)})")
                snapshot = legacy_case_snapshot(archive_case_id, database)["snapshot"]
                if any(item.startswith(("anes:", "pacu:")) for item in selected) and not snapshot.get("timeline", {}).get("rows"):
                    raise AssertionError(
                        f"{source_case_id}: chart verification failed: no imported clinical timeline observations; "
                        "a nonblank PDF header is not evidence of a complete report"
                    )
                payload = build_innovian_report(snapshot, selected)
                destination = arguments.output_dir / f"{source_case_id}-canopy-generated.pdf"
                if not arguments.summary_only:
                    destination.write_bytes(payload)
                expected = [source_case_id]
                if arguments.year is None:
                    expected.extend([catalog["patient"], row.get("hn"), row.get("diagnosis_name"), row.get("procedure_name")])
                if any(item.startswith("anes:") for item in selected):
                    expected.append("Anesthesia Report")
                if any(item.startswith("pacu:") for item in selected):
                    expected.append("Post Anesthetic Care Unit")
                result = validate_pdf(
                    payload,
                    [normalized(item) for item in expected if normalized(item)],
                    arguments.output_dir,
                    source_case_id,
                    render=not arguments.summary_only,
                )
                result.update({"case_id": source_case_id, "pdf": None if arguments.summary_only else str(destination), "sections": selected})
                results.append(result)
            finally:
                database.rollback()
    if arguments.summary_only:
        print(json.dumps({
            "status": "passed", "year": arguments.year, "report_count": len(results),
            "page_count": sum(item["pages"] for item in results),
            "pdf_bytes": sum(item["bytes"] for item in results),
        }, indent=2))
    else:
        print(json.dumps({"status": "passed", "reports": results}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
