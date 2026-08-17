r"""Stage and publish Innovian PDFs by converted Patient ID.

Innovian exports files with temporary names such as ``ANEtmp...pdf`` and
``FRMtmp...pdf``. This tool reads the Patient ID printed in each report and
converts a value such as ``4886/68`` to hospital filename format
``680004886``.

Production workflow:

    Step 1 - merge
      Z:/*.pdf -> Z:/ready/readyYYYY/<PatientID>.pdf
               -> Z:/merged/mergedYYYY/<original source PDFs>

    Step 2 - publish
      Z:/ready/readyYYYY/<PatientID>.pdf -> Z:/anes/<PatientID>/<PatientID>.pdf
                                          -> Z:/uploaded/uploadedYYYY/<PatientID>.pdf

Default behavior is preview-only. Add ``--execute`` after reviewing the plan.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import re
import shutil
import sys
from typing import Iterable

from pypdf import PdfReader, PdfWriter


PATIENT_ID_LABEL = (
    r"(?:Patient\s*ID|PatientID|H\s*\.?\s*N\s*\.?|Hospital\s*(?:No|Number)|"
    r"\u0e40\u0e25\u0e02\u0e17\u0e35\u0e48\u0e1c\u0e39\u0e49\u0e1b\u0e48\u0e27\u0e22|"
    r"\u0e40\u0e25\u0e02\u0e1b\u0e23\u0e30\u0e08\u0e33\u0e15\u0e31\u0e27\u0e1c\u0e39\u0e49\u0e1b\u0e48\u0e27\u0e22|"
    r"\u0e23\u0e2b\u0e31\u0e2a\u0e1c\u0e39\u0e49\u0e1b\u0e48\u0e27\u0e22)"
)
PRINTED_PATIENT_ID_VALUE = r"(?P<number>\d{1,7})\s*[/\\]+\s*(?P<year>\d{2})"
FORMATTED_PATIENT_ID_VALUE = r"(?P<patient_id>\d{9})"
LABELED_PRINTED_PATIENT_ID_PATTERNS = (
    re.compile(rf"{PRINTED_PATIENT_ID_VALUE}\s*.{{0,45}}?{PATIENT_ID_LABEL}", re.IGNORECASE | re.DOTALL),
    re.compile(rf"{PATIENT_ID_LABEL}.{{0,45}}?{PRINTED_PATIENT_ID_VALUE}", re.IGNORECASE | re.DOTALL),
)
LABELED_FORMATTED_PATIENT_ID_PATTERNS = (
    re.compile(rf"{PATIENT_ID_LABEL}\s*[:\-]?\s*{FORMATTED_PATIENT_ID_VALUE}", re.IGNORECASE),
    re.compile(rf"{FORMATTED_PATIENT_ID_VALUE}\s*.{{0,25}}?{PATIENT_ID_LABEL}", re.IGNORECASE | re.DOTALL),
)
EXPORT_STAMP_PATTERN = re.compile(r"(?P<stamp>20\d{10})(?=\.pdf$)", re.IGNORECASE)
REPORT_TYPE_PATTERN = re.compile(r"_(?P<kind>ANE|FRM)tmp", re.IGNORECASE)
YEAR_DIR_PATTERN = re.compile(r"^ready(?P<year>20\d{2})$", re.IGNORECASE)


@dataclass(frozen=True)
class Report:
    path: Path
    patient_id: str
    printed_patient_id: str
    kind: str
    timestamp: str
    pages: int

    @property
    def sort_key(self) -> tuple[str, int, str]:
        kind_order = {"ANE": 0, "FRM": 1}
        return (self.timestamp, kind_order.get(self.kind, 9), self.path.name.casefold())


@dataclass(frozen=True)
class PreparedPdf:
    path: Path
    patient_id: str
    year: str
    pages: int

    @property
    def sort_key(self) -> tuple[str, str, str]:
        return (self.patient_id, self.year, self.path.name.casefold())


def log(message: str = "") -> None:
    print(message, flush=True)


def parse_year(value: str) -> str:
    if not re.fullmatch(r"20\d{2}", value):
        raise argparse.ArgumentTypeError("year must be four digits in the form YYYY, for example 2025")
    return value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Stage or publish temporary Innovian PDFs grouped by converted Patient ID.",
    )
    parser.add_argument(
        "--inspect",
        type=Path,
        default=None,
        help="Inspect one PDF and print extracted text near Patient ID fields without processing files.",
    )
    parser.add_argument(
        "--step",
        choices=("merge", "publish"),
        default="merge",
        help="Workflow step to preview or execute (default: merge).",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path("."),
        help=r"Working root containing incoming PDFs and archive folders, for example Z:/ or \\server\share.",
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=None,
        help="Override incoming PDF folder for the merge step (default: <root>).",
    )
    parser.add_argument(
        "--anes-root",
        type=Path,
        default=None,
        help=r"Override live destination root (default: <root>\anes).",
    )
    parser.add_argument(
        "--ready-root",
        type=Path,
        default=None,
        help=r"Override staged merged-PDF root (default: <root>\ready).",
    )
    parser.add_argument(
        "--merged-root",
        "--archive",
        dest="merged_root",
        type=Path,
        default=None,
        help=r"Override original-source archive root (default: <root>\merged).",
    )
    parser.add_argument(
        "--uploaded-root",
        type=Path,
        default=None,
        help=r"Override delivered-PDF archive root (default: <root>\uploaded).",
    )
    parser.add_argument(
        "--all-pdfs",
        action="store_true",
        help="During merge, include non-ANEtmp/FRMtmp PDFs from the incoming folder.",
    )
    parser.add_argument(
        "--year",
        action="append",
        type=parse_year,
        metavar="YYYY",
        help="Process only this year; repeat to include multiple years. Required with --execute unless --all-years is used.",
    )
    parser.add_argument(
        "--all-years",
        action="store_true",
        help="Explicitly allow execution across all years instead of supplying --year.",
    )
    parser.add_argument(
        "--summary-only",
        action="store_true",
        help="Show one line per Patient ID without listing each source PDF.",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Perform file operations. Without this flag, only preview the plan.",
    )
    existing_group = parser.add_mutually_exclusive_group()
    existing_group.add_argument(
        "--append-existing",
        action="store_true",
        help="Append new content to an existing staged/live Patient ID PDF after backup.",
    )
    existing_group.add_argument(
        "--replace-existing",
        action="store_true",
        help="Replace an existing staged/live Patient ID PDF after backup.",
    )
    return parser.parse_args()


def try_extract_page_text(reader: PdfReader, page_index: int) -> tuple[str, str | None]:
    try:
        return reader.pages[page_index].extract_text() or "", None
    except Exception as exc:
        return "", f"page {page_index + 1}: {type(exc).__name__}: {exc}"


def extract_page_text(reader: PdfReader) -> tuple[str, list[str]]:
    texts: list[str] = []
    page_errors: list[str] = []
    for page_index in range(len(reader.pages)):
        text, error = try_extract_page_text(reader, page_index)
        if text:
            texts.append(text)
        if error:
            page_errors.append(error)
    return "\n".join(texts), page_errors


def hospital_patient_id(number: str, year: str) -> str:
    return f"{year}{int(number):07d}"


def extract_patient_id(text: str) -> str | None:
    searchable = re.sub(r"[\t ]+", " ", text)
    for pattern in LABELED_PRINTED_PATIENT_ID_PATTERNS:
        match = pattern.search(searchable)
        if match:
            return hospital_patient_id(match.group("number"), match.group("year"))
    for pattern in LABELED_FORMATTED_PATIENT_ID_PATTERNS:
        match = pattern.search(searchable)
        if match:
            return match.group("patient_id")
    # Some report templates place the value too far from its field label for
    # PDF text extraction to preserve the association. A single Patient ID
    # shaped value in the report remains unambiguous.
    candidates = {
        hospital_patient_id(match.group("number"), match.group("year"))
        for match in re.finditer(PRINTED_PATIENT_ID_VALUE, searchable)
    }
    if len(candidates) == 1:
        return candidates.pop()
    # Extraction sometimes separates label and value unusually. Keep a final
    # small-window search for already formatted Patient IDs.
    lines = [line.strip() for line in searchable.splitlines() if line.strip()]
    for index, line in enumerate(lines):
        if not re.search(PATIENT_ID_LABEL, line, re.IGNORECASE):
            continue
        window = " ".join(lines[max(0, index - 3) : min(len(lines), index + 4)])
        numeric_candidates = re.findall(r"(?<!\d)(\d{9})(?!\d)", window)
        if numeric_candidates:
            return numeric_candidates[0]
    return None


def extract_printed_patient_id(text: str) -> str:
    searchable = re.sub(r"[\t ]+", " ", text)
    for pattern in LABELED_PRINTED_PATIENT_ID_PATTERNS:
        match = pattern.search(searchable)
        if match:
            return f"{match.group('number')}/{match.group('year')}"
    for pattern in LABELED_FORMATTED_PATIENT_ID_PATTERNS:
        match = pattern.search(searchable)
        if match:
            return match.group("patient_id")
    candidates = {
        f"{match.group('number')}/{match.group('year')}"
        for match in re.finditer(PRINTED_PATIENT_ID_VALUE, searchable)
    }
    if len(candidates) == 1:
        return candidates.pop()
    return "unparsed Patient ID"


def diagnostic_field_lines(text: str) -> list[str]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    matched_indexes = [
        index
        for index, line in enumerate(lines)
        if re.search(PATIENT_ID_LABEL, line, re.IGNORECASE)
    ]
    selected: list[str] = []
    seen: set[int] = set()
    for index in matched_indexes:
        for nearby in range(max(0, index - 2), min(len(lines), index + 3)):
            if nearby not in seen:
                selected.append(f"{nearby + 1:04d}: {lines[nearby]}")
                seen.add(nearby)
    return selected


def inspect_pdf(path: Path) -> int:
    resolved = path.expanduser().resolve()
    log(f"Inspecting PDF: {resolved}")
    if not resolved.is_file():
        print(f"PDF does not exist: {resolved}", file=sys.stderr, flush=True)
        return 2
    try:
        reader = PdfReader(str(resolved))
    except Exception as exc:
        print(f"PDF cannot be opened: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        return 1
    text, page_errors = extract_page_text(reader)
    log(f"Pages: {len(reader.pages)}")
    for error in page_errors:
        log(f"Page extraction error: {error}")
    detected = extract_patient_id(text)
    log(f"Converted Patient ID: {detected or 'PARSER FAILED'}")
    log("Extracted lines around possible Patient ID fields:")
    lines = diagnostic_field_lines(text)
    if lines:
        for line in lines:
            log(f"  {line}")
    else:
        log("  Patient ID was not recognized in extracted text.")
        log("  The PDF may be image-only, use a different template, or need OCR.")
    return 0 if detected else 1


def report_metadata(path: Path) -> Report:
    try:
        reader = PdfReader(str(path))
    except Exception as exc:
        raise ValueError(f"PDF cannot be opened: {type(exc).__name__}: {exc}") from exc
    first_page_text, first_page_error = try_extract_page_text(reader, 0) if reader.pages else ("", None)
    patient_id_text = first_page_text
    patient_id = extract_patient_id(first_page_text)
    if not patient_id:
        all_text, page_errors = extract_page_text(reader)
        patient_id_text = all_text
        patient_id = extract_patient_id(all_text)
        if not patient_id and (page_errors or first_page_error):
            errors = page_errors or [first_page_error]
            detail = "; ".join(error for error in errors if error)
            raise ValueError(f"Patient ID parser blocked by PDF text extraction error ({detail})")
    if not patient_id:
        diagnostic = diagnostic_field_lines(all_text if "all_text" in locals() else first_page_text)
        detail = " | ".join(line.split(": ", 1)[-1] for line in diagnostic[:12])
        if detail:
            raise ValueError(f"Patient ID parser failed; extracted nearby text: {detail}")
        raise ValueError("Patient ID parser failed; no recognizable Patient ID text was extracted")
    kind_match = REPORT_TYPE_PATTERN.search(path.name)
    stamp_match = EXPORT_STAMP_PATTERN.search(path.name)
    return Report(
        path=path,
        patient_id=patient_id,
        printed_patient_id=extract_printed_patient_id(patient_id_text),
        kind=kind_match.group("kind").upper() if kind_match else "PDF",
        timestamp=stamp_match.group("stamp") if stamp_match else "999999999999",
        pages=len(reader.pages),
    )


def report_year(report: Report) -> str:
    match = re.match(r"^(20\d{2})", report.timestamp)
    return match.group(1) if match else datetime.now().strftime("%Y")


def group_year(reports: list[Report]) -> str:
    return max(report_year(report) for report in reports)


def is_innovian_export(path: Path) -> bool:
    return REPORT_TYPE_PATTERN.search(path.name) is not None


def filename_export_year(path: Path) -> str | None:
    match = EXPORT_STAMP_PATTERN.search(path.name)
    return match.group("stamp")[:4] if match else None


def unique_path(directory: Path, filename: str) -> Path:
    candidate = directory / filename
    if not candidate.exists():
        return candidate
    source = Path(filename)
    index = 2
    while True:
        candidate = directory / f"{source.stem}_{index:03d}{source.suffix}"
        if not candidate.exists():
            return candidate
        index += 1


def archived_source_path(report: Report, merged_root: Path) -> Path:
    return merged_root / f"merged{report_year(report)}" / report.path.name


def split_archived_reports(
    reports: list[Report],
    merged_root: Path,
) -> tuple[list[Report], list[Report]]:
    fresh: list[Report] = []
    repeated: list[Report] = []
    for report in reports:
        if archived_source_path(report, merged_root).exists():
            repeated.append(report)
        else:
            fresh.append(report)
    return fresh, repeated


def order_reports(reports: list[Report]) -> list[Report]:
    ordered = sorted(reports, key=lambda report: report.sort_key)
    if len(ordered) == 2 and {report.kind for report in ordered} == {"ANE", "FRM"}:
        return sorted(ordered, key=lambda report: (0 if report.kind == "ANE" else 1, report.timestamp))
    index = 0
    while index + 1 < len(ordered):
        first = ordered[index]
        second = ordered[index + 1]
        if first.kind == "FRM" and second.kind == "ANE":
            try:
                first_time = datetime.strptime(first.timestamp, "%Y%m%d%H%M")
                second_time = datetime.strptime(second.timestamp, "%Y%m%d%H%M")
                seconds_apart = abs((second_time - first_time).total_seconds())
            except ValueError:
                seconds_apart = None
            if seconds_apart is not None and seconds_apart <= 60:
                ordered[index], ordered[index + 1] = second, first
                index += 2
                continue
        index += 1
    return ordered


def discover_reports(
    source: Path,
    include_all_pdfs: bool,
    years: set[str] | None,
) -> tuple[dict[str, list[Report]], list[tuple[Path, str]], list[Path], list[Path]]:
    groups: dict[str, list[Report]] = {}
    failures: list[tuple[Path, str]] = []
    ignored: list[Path] = []
    out_of_year: list[Path] = []
    candidates = sorted(source.glob("*.pdf"), key=lambda item: item.name.casefold())
    log(f"Scanning incoming folder: {source}")
    log(f"Found {len(candidates)} top-level PDF file(s).")
    for index, path in enumerate(candidates, start=1):
        log(f"[SCAN {index}/{len(candidates)}] {path.name}")
        if not include_all_pdfs and not is_innovian_export(path):
            ignored.append(path)
            log("  -> ignored: not an ANEtmp/FRMtmp Innovian export")
            continue
        if years and filename_export_year(path) not in years:
            out_of_year.append(path)
            log(f"  -> ignored: export year {filename_export_year(path) or 'unknown'} not selected")
            continue
        try:
            report = report_metadata(path)
        except Exception as exc:
            failures.append((path, str(exc)))
            log(f"  -> ERROR: {exc}")
            continue
        groups.setdefault(report.patient_id, []).append(report)
        log(
            f"  -> Patient ID {report.printed_patient_id} -> {report.patient_id} | "
            f"{report.kind} | {report.pages} page(s) | year {report_year(report)}"
        )
    for patient_id, reports in groups.items():
        groups[patient_id] = order_reports(reports)
    return groups, failures, ignored, out_of_year


def discover_prepared_pdfs(ready_root: Path, years: set[str] | None) -> list[PreparedPdf]:
    prepared: list[PreparedPdf] = []
    if not ready_root.is_dir():
        log(f"Ready folder does not exist yet: {ready_root}")
        return prepared
    log(f"Scanning staged PDFs: {ready_root}")
    for directory in sorted(ready_root.iterdir(), key=lambda path: path.name.casefold()):
        year_match = YEAR_DIR_PATTERN.match(directory.name) if directory.is_dir() else None
        if not year_match:
            continue
        year = year_match.group("year")
        if years and year not in years:
            log(f"[READY] skip folder {directory.name}: year not selected")
            continue
        files = sorted(directory.glob("*.pdf"), key=lambda path: path.name.casefold())
        log(f"[READY] {directory.name}: {len(files)} staged PDF file(s)")
        for path in files:
            if not re.fullmatch(r"\d{9}", path.stem):
                log(f"  -> ignored unexpected staged filename: {path.name}")
                continue
            try:
                pages = len(PdfReader(str(path)).pages)
            except Exception as exc:
                log(f"  -> ERROR reading staged PDF {path.name}: {exc}")
                continue
            prepared.append(PreparedPdf(path=path, patient_id=path.stem, year=year, pages=pages))
            log(f"  -> Patient ID {path.stem} | {pages} page(s)")
    return sorted(prepared, key=lambda item: item.sort_key)


def extra_patient_pdfs(patient_dir: Path, final_output: Path) -> list[Path]:
    if not patient_dir.is_dir():
        return []
    final_name = final_output.name.casefold()
    return sorted(
        [
            path
            for path in patient_dir.glob("*.pdf")
            if path.name.casefold() != final_name and not path.name.startswith(".")
        ],
        key=lambda path: path.name.casefold(),
    )


def write_pdf(inputs: Iterable[Path], output: Path) -> None:
    writer = PdfWriter()
    try:
        for input_path in inputs:
            writer.append(str(input_path))
        with output.open("wb") as handle:
            writer.write(handle)
    finally:
        writer.close()


def validate_pdf(path: Path) -> None:
    PdfReader(str(path))


def print_merge_plan(
    groups: dict[str, list[Report]],
    failures: list[tuple[Path, str]],
    ignored: list[Path],
    out_of_year: list[Path],
    ready_root: Path,
    merged_root: Path,
    append_existing: bool,
    replace_existing: bool,
    summary_only: bool,
) -> None:
    total_reports = sum(len(reports) for reports in groups.values())
    total_pages = sum(report.pages for reports in groups.values() for report in reports)
    log(f"MERGE STEP: {total_reports} readable report(s) for {len(groups)} Patient ID(s), {total_pages} page(s).")
    log(f"Ready root : {ready_root}")
    log(f"Merged root: {merged_root}")
    log()
    for patient_id in sorted(groups):
        reports = groups[patient_id]
        fresh, repeated = split_archived_reports(reports, merged_root)
        year = group_year(fresh or reports)
        staged = ready_root / f"ready{year}" / f"{patient_id}.pdf"
        status = ""
        if staged.exists() and append_existing:
            status = " [append to staged PDF with backup]"
        elif staged.exists() and replace_existing:
            status = " [replace staged PDF with backup]"
        elif staged.exists():
            status = " [SKIP: staged PDF already exists]"
        elif not fresh:
            status = " [SKIP: all source files already archived]"
        log(f"{patient_id}: merge {len(fresh)} new file(s), {sum(item.pages for item in fresh)} page(s) -> {staged}{status}")
        if not summary_only:
            for report in fresh:
                log(f"  {report.kind:3} {report.path.name} -> merged{report_year(report)}")
            for report in repeated:
                log(f"  DUP {report.path.name} [already archived; move to duplicates on execute]")
    if failures:
        log("\nPDF(s) requiring Patient ID parser review:")
        for path, reason in failures:
            log(f"  {path.name}: {reason}")
    if ignored:
        log(f"\nIgnored {len(ignored)} non-Innovian PDF(s) in incoming root (use --all-pdfs to include them).")
    if out_of_year:
        log(f"\nIgnored {len(out_of_year)} Innovian PDF(s) outside selected year filter.")


def execute_merge(
    groups: dict[str, list[Report]],
    ready_root: Path,
    merged_root: Path,
    append_existing: bool,
    replace_existing: bool,
) -> tuple[int, int]:
    completed = 0
    skipped = 0
    for patient_id in sorted(groups):
        reports = groups[patient_id]
        log(f"\n[MERGE PATIENT ID {patient_id}] Starting {len(reports)} discovered source file(s)")
        fresh, repeated = split_archived_reports(reports, merged_root)
        for duplicate_report in repeated:
            duplicates_dir = merged_root / f"merged{report_year(duplicate_report)}" / "duplicates"
            duplicates_dir.mkdir(parents=True, exist_ok=True)
            duplicate_path = unique_path(duplicates_dir, duplicate_report.path.name)
            shutil.move(str(duplicate_report.path), str(duplicate_path))
            log(f"  [DUPLICATE] {duplicate_report.path.name} -> {duplicate_path}")
        if not fresh:
            log(f"  [SKIP] no new source reports to merge for Patient ID {patient_id}")
            continue

        year = group_year(fresh)
        staged_dir = ready_root / f"ready{year}"
        staged = staged_dir / f"{patient_id}.pdf"
        had_staged = staged.exists()
        if staged.exists() and not append_existing and not replace_existing:
            log(f"  [SKIP] staged PDF already exists: {staged}")
            skipped += 1
            continue

        staged_dir.mkdir(parents=True, exist_ok=True)
        temporary = staged_dir / f".{patient_id}.merging.pdf"
        if temporary.exists():
            temporary.unlink()
        try:
            inputs: list[Path] = []
            if staged.exists() and append_existing:
                inputs.append(staged)
                log(f"  [APPEND BASE] {staged}")
            inputs.extend(report.path for report in fresh)
            for report in fresh:
                log(f"  [ADD {report.kind}] {report.path.name} ({report.pages} page(s))")
            log(f"  [WRITE TEMP] {temporary}")
            write_pdf(inputs, temporary)
            validate_pdf(temporary)
            log(f"  [VALIDATED] {temporary}")
            if staged.exists():
                backup_dir = staged_dir / "previous-prepared"
                backup_dir.mkdir(parents=True, exist_ok=True)
                stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                backup = unique_path(backup_dir, f"{patient_id}_{stamp}.pdf")
                shutil.copy2(str(staged), str(backup))
                log(f"  [BACKUP STAGED] {backup}")
            temporary.replace(staged)
            log(f"  [READY PDF] {staged}")
            for report in fresh:
                merged_dir = merged_root / f"merged{report_year(report)}"
                merged_dir.mkdir(parents=True, exist_ok=True)
                archived = unique_path(merged_dir, report.path.name)
                shutil.move(str(report.path), str(archived))
                log(f"  [ARCHIVE RAW] {report.path.name} -> {archived}")
            action = "appended" if append_existing and had_staged else "merged"
            log(f"[READY {patient_id}] {action} {len(fresh)} new report(s) -> {staged}")
            completed += 1
        except Exception as exc:
            if temporary.exists():
                temporary.unlink()
            print(f"[ERROR {patient_id}] {exc}", file=sys.stderr, flush=True)
            skipped += 1
    return completed, skipped


def print_publish_plan(
    prepared: list[PreparedPdf],
    anes_root: Path,
    uploaded_root: Path,
    append_existing: bool,
    replace_existing: bool,
) -> None:
    log(f"PUBLISH STEP: {len(prepared)} staged Patient ID PDF(s), {sum(item.pages for item in prepared)} page(s).")
    log(f"Live root    : {anes_root}")
    log(f"Uploaded root: {uploaded_root}")
    log()
    for item in prepared:
        live = anes_root / item.patient_id / f"{item.patient_id}.pdf"
        extras = extra_patient_pdfs(live.parent, live)
        status = ""
        if extras:
            status = " [BLOCKED: extra PDF(s) found in patient folder]"
        elif live.exists() and append_existing:
            status = " [append to live PDF with backup]"
        elif live.exists() and replace_existing:
            status = " [replace live PDF with backup]"
        elif live.exists():
            status = " [SKIP: live PDF already exists; use --append-existing for later reports]"
        log(f"{item.patient_id}: publish {item.pages} page(s) -> {live}{status}")
        log(f"  delivered copy -> {uploaded_root / f'uploaded{item.year}' / f'{item.patient_id}.pdf'}")
        for extra in extras:
            log(f"  BLOCKING PDF {extra.name}")


def execute_publish(
    prepared: list[PreparedPdf],
    anes_root: Path,
    uploaded_root: Path,
    append_existing: bool,
    replace_existing: bool,
) -> tuple[int, int]:
    completed = 0
    skipped = 0
    for item in prepared:
        log(f"\n[PUBLISH PATIENT ID {item.patient_id}] Starting staged PDF: {item.path.name} ({item.pages} page(s))")
        patient_dir = anes_root / item.patient_id
        live = patient_dir / f"{item.patient_id}.pdf"
        had_live = live.exists()
        extras = extra_patient_pdfs(patient_dir, live)
        if extras:
            log(f"  [SKIP] extra PDF(s) found in patient folder: {', '.join(path.name for path in extras)}")
            skipped += 1
            continue
        if live.exists() and not append_existing and not replace_existing:
            log(f"  [SKIP] live PDF already exists: {live}")
            skipped += 1
            continue

        patient_dir.mkdir(parents=True, exist_ok=True)
        temporary = patient_dir / f".{item.patient_id}.uploading.pdf"
        if temporary.exists():
            temporary.unlink()
        try:
            inputs = [item.path]
            if live.exists() and append_existing:
                inputs = [live, item.path]
                log(f"  [APPEND BASE] {live}")
            log(f"  [ADD STAGED] {item.path}")
            log(f"  [WRITE TEMP] {temporary}")
            write_pdf(inputs, temporary)
            validate_pdf(temporary)
            log(f"  [VALIDATED] {temporary}")
            if live.exists():
                backup_dir = uploaded_root / f"uploaded{item.year}" / "previous-final"
                backup_dir.mkdir(parents=True, exist_ok=True)
                stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                backup = unique_path(backup_dir, f"{item.patient_id}_{stamp}.pdf")
                shutil.copy2(str(live), str(backup))
                log(f"  [BACKUP LIVE] {backup}")
            temporary.replace(live)
            log(f"  [LIVE PDF] {live}")
            uploaded_dir = uploaded_root / f"uploaded{item.year}"
            uploaded_dir.mkdir(parents=True, exist_ok=True)
            uploaded = unique_path(uploaded_dir, f"{item.patient_id}.pdf")
            shutil.copy2(str(live), str(uploaded))
            log(f"  [UPLOADED COPY] {uploaded}")
            item.path.unlink()
            log(f"  [REMOVE STAGED] {item.path}")
            action = "appended" if append_existing and had_live else "published"
            log(f"[UPLOADED {item.patient_id}] {action} -> {live}; copy -> {uploaded}")
            completed += 1
        except Exception as exc:
            if temporary.exists():
                temporary.unlink()
            print(f"[ERROR {item.patient_id}] {exc}", file=sys.stderr, flush=True)
            skipped += 1
    return completed, skipped


def main() -> int:
    args = parse_args()
    if args.inspect is not None:
        return inspect_pdf(args.inspect)
    root = args.root.expanduser().resolve()
    source = args.source.expanduser().resolve() if args.source is not None else root
    anes_root = args.anes_root.expanduser().resolve() if args.anes_root is not None else root / "anes"
    ready_root = args.ready_root.expanduser().resolve() if args.ready_root is not None else root / "ready"
    merged_root = args.merged_root.expanduser().resolve() if args.merged_root is not None else root / "merged"
    uploaded_root = args.uploaded_root.expanduser().resolve() if args.uploaded_root is not None else root / "uploaded"
    years = set(args.year) if args.year else None

    if args.execute and not years and not args.all_years:
        print(
            "Refusing to execute without a year filter. Add --year YYYY, or use --all-years intentionally.",
            file=sys.stderr,
        )
        return 2
    if years and args.all_years:
        print("Use either --year YYYY or --all-years, not both.", file=sys.stderr)
        return 2

    if args.step == "merge":
        if not source.is_dir():
            print(f"Incoming folder does not exist: {source}", file=sys.stderr)
            return 2
        groups, failures, ignored, out_of_year = discover_reports(source, args.all_pdfs, years)
        print_merge_plan(
            groups,
            failures,
            ignored,
            out_of_year,
            ready_root,
            merged_root,
            args.append_existing,
            args.replace_existing,
            args.summary_only,
        )
        if not groups:
            return 1 if failures else 0
        if not args.execute:
            print("\nPreview only. Re-run with --step merge --execute to stage merged PDFs.")
            return 0
        completed, skipped = execute_merge(
            groups, ready_root, merged_root, args.append_existing, args.replace_existing,
        )
        print(f"\nMerge completed for {completed} Patient ID(s); skipped/failed {skipped} Patient ID(s).")
        if failures:
            print(
                f"Unresolved source PDF(s) left in incoming folder for manual review: {len(failures)}.",
                file=sys.stderr,
            )
        return 0 if skipped == 0 and not failures else 1

    prepared = discover_prepared_pdfs(ready_root, years)
    print_publish_plan(prepared, anes_root, uploaded_root, args.append_existing, args.replace_existing)
    if not prepared:
        return 0
    if not args.execute:
        print("\nPreview only. Re-run with --step publish --execute to copy staged PDFs into anes.")
        return 0
    completed, skipped = execute_publish(
        prepared, anes_root, uploaded_root, args.append_existing, args.replace_existing,
    )
    print(f"\nPublish completed for {completed} Patient ID(s); skipped/failed {skipped} Patient ID(s).")
    return 0 if skipped == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
