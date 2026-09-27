"""One-time/resumable PostgreSQL-to-PostgreSQL archive import for Canopy.

This script reads Anora's already-normalized Innovian archive as a migration
source.  The deployed Canopy application never calls Anora at run time.
"""

import argparse
from datetime import date
import os
import time

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb


TABLES = (
    ("archive_case", "id", (
        "id", "hospital_id", "source_system", "source_case_id", "representation_version",
        "patient_reference", "patient_snapshot", "procedure_snapshot", "started_at", "completed_at",
        "migration_status", "mapping_profile", "migration_run_id", "source_record_hash", "created_at",
    )),
    ("archive_case_context", "archive_case_id", (
        "archive_case_id", "source_poid", "hn", "encounter_number", "patient_name", "date_of_birth",
        "gender", "asa_status", "order_number", "procedure_code", "procedure_name", "diagnosis_code",
        "diagnosis_name", "case_type", "care_unit", "location", "created_at",
    )),
    ("archive_patient_demographics", "archive_case_id", (
        "archive_case_id", "source_record_id", "national_id", "blood_type", "admission_weight",
        "weight_unit", "height", "height_unit", "hospital_admitted_at", "date_of_birth", "gender",
        "asa_status", "nationality", "language", "religion",
    )),
    ("archive_allergy", "id", (
        "id", "archive_case_id", "source_record_id", "code", "label", "description", "reaction",
        "source_severity", "source_category", "recorded_at", "deleted_at", "source_deleted",
    )),
    ("archive_note", "id", (
        "id", "archive_case_id", "source_record_id", "note_type", "note_name", "code", "text",
        "procedure_status", "care_unit", "raw_timestamp", "occurred_at", "time_quality", "source_deleted",
    )),
    ("archive_observation", "id", (
        "id", "archive_case_id", "source_record_id", "parameter_code", "parameter_label", "value_number",
        "value_text", "unit", "raw_timestamp", "observed_at", "time_quality", "validated", "quality",
    )),
    ("archive_device_parameter", "id", (
        "id", "archive_case_id", "source_kind", "source_key", "parameter_label", "unit", "value_number",
        "value_text", "raw_timestamp", "observed_at", "time_quality", "source_parameter_id",
    )),
    ("archive_fluid_io", "id", (
        "id", "archive_case_id", "source_record_id", "source_paraminstance", "source_cid", "label", "unit",
        "value_number", "value_text", "state", "scheduled", "raw_timestamp", "occurred_at", "time_quality",
    )),
    ("archive_infusion", "id", (
        "id", "archive_case_id", "source_record_id", "source_paraminstance", "label", "source_type",
        "pump_state", "raw_pause_timestamp", "raw_discontinue_timestamp", "concentration_config",
    )),
    ("archive_infusion_component", "id", (
        "id", "archive_infusion_id", "source_cid", "component_index", "label", "unit", "source_type",
        "display_order", "configuration",
    )),
    ("archive_infusion_measurement", "id", (
        "id", "archive_infusion_component_id", "source_record_id", "value_number", "value_text", "state",
        "scheduled", "raw_timestamp", "observed_at", "time_quality",
    )),
    ("archive_vital_series_segment", "id", (
        "id", "archive_case_id", "source_record_id", "source_segment_key", "source_parameter_id",
        "parameter_code", "parameter_label", "unit", "graph_type", "vital_priority", "raw_first_timestamp",
        "raw_next_timestamp", "raw_interval_units", "sample_interval_ms", "sample_count", "encoded_samples",
        "raw_payload", "encoding", "exponent", "decimal_places", "observed_start_at", "observed_end_at",
        "time_quality", "valid_sample_count", "value_sum", "value_min", "value_max", "source_hash", "imported_at",
    )),
    ("archive_staff_assignment", "id", (
        "id", "archive_case_id", "source_record_id", "source_staff_id", "display_name", "role",
        "staff_group", "raw_time_in", "raw_time_out", "entered_at", "exited_at", "time_quality", "source_deleted",
    )),
    ("archive_event", "id", (
        "id", "archive_case_id", "event_definition_id", "source_record_id", "source_event_code",
        "source_event_name", "source_event_kind", "care_unit", "source_state", "memo", "raw_timestamp",
        "occurred_at", "time_quality",
    )),
    ("archive_form", "id", (
        "id", "archive_case_id", "source_form_id", "source_original_form_id", "source_poid", "name", "layout",
        "source_created_at", "source_updated_at", "imported_at",
    )),
    ("archive_form_field", "id", (
        "id", "archive_form_id", "source_grid_cell_id", "source_component_id", "component_type", "name",
        "title", "raw_value", "value", "choices", "position",
    )),
)


def import_table(source, target, table: str, conflict: str, columns: tuple[str, ...], batch_size: int) -> int:
    names = sql.SQL(",").join(map(sql.Identifier, columns))
    updates = sql.SQL(",").join(
        sql.SQL("{}=excluded.{}").format(sql.Identifier(name), sql.Identifier(name))
        for name in columns if name != conflict
    )
    stage = f"canopy_stage_{table}"
    merge = sql.SQL("INSERT INTO {} ({}) SELECT {} FROM {} ON CONFLICT ({}) DO UPDATE SET {}").format(
        sql.Identifier(table), names, names, sql.Identifier(stage), sql.Identifier(conflict), updates,
    )
    with target.cursor() as writer:
        writer.execute(sql.SQL("CREATE TEMP TABLE {} (LIKE {} INCLUDING DEFAULTS) ON COMMIT DELETE ROWS").format(
            sql.Identifier(stage), sql.Identifier(table)
        ))
    target.commit()
    copied = 0
    with source.cursor(name=f"canopy_{table}") as reader:
        reader.execute(sql.SQL("SELECT {} FROM {} ORDER BY {}").format(names, sql.Identifier(table), sql.Identifier(conflict)))
        while batch := reader.fetchmany(batch_size):
            batch = [tuple(Jsonb(value) if isinstance(value, (dict, list)) else value for value in row) for row in batch]
            with target.cursor() as writer:
                copy_sql = sql.SQL("COPY {} ({}) FROM STDIN").format(sql.Identifier(stage), names)
                with writer.copy(copy_sql) as copy:
                    for row in batch:
                        copy.write_row(row)
                writer.execute(merge)
            target.commit()
            copied += len(batch)
            print(f"{table}: {copied:,}", flush=True)
    return copied


def replace_archive(source, target) -> None:
    """Fast, exact replacement for a fresh Canopy installation."""
    table_names = sql.SQL(",").join(sql.Identifier(item[0]) for item in reversed(TABLES))
    with target.cursor() as writer:
        writer.execute(sql.SQL("TRUNCATE {} CASCADE").format(table_names))
    target.commit()
    for table, _, columns in TABLES:
        names = sql.SQL(",").join(map(sql.Identifier, columns))
        source_copy = sql.SQL("COPY (SELECT {} FROM {}) TO STDOUT").format(names, sql.Identifier(table))
        target_copy = sql.SQL("COPY {} ({}) FROM STDIN").format(sql.Identifier(table), names)
        transferred = 0
        next_report = 1024 * 1024 * 1024
        with source.cursor().copy(source_copy) as reader, target.cursor().copy(target_copy) as writer:
            for block in reader:
                writer.write(block)
                transferred += len(block)
                if transferred >= next_report:
                    print(f"{table}: {transferred / (1024 ** 3):.1f} GiB streamed", flush=True)
                    next_report += 1024 * 1024 * 1024
        target.commit()
        print(f"{table}: copied ({transferred / (1024 ** 2):.1f} MiB)", flush=True)


def _year_predicate(table: str, start: date, end: date) -> sql.Composed:
    bounds = sql.SQL("started_at >= {} AND started_at < {}").format(sql.Literal(start), sql.Literal(end))
    if table == "archive_case":
        return bounds
    if table == "archive_infusion_component":
        return sql.SQL("archive_infusion_id IN (SELECT i.id FROM archive_infusion i JOIN archive_case c ON c.id=i.archive_case_id WHERE {})").format(bounds)
    if table == "archive_infusion_measurement":
        return sql.SQL("archive_infusion_component_id IN (SELECT component.id FROM archive_infusion_component component JOIN archive_infusion i ON i.id=component.archive_infusion_id JOIN archive_case c ON c.id=i.archive_case_id WHERE {})").format(bounds)
    if table == "archive_form_field":
        return sql.SQL("archive_form_id IN (SELECT f.id FROM archive_form f JOIN archive_case c ON c.id=f.archive_case_id WHERE {})").format(bounds)
    return sql.SQL("archive_case_id IN (SELECT id FROM archive_case WHERE {})").format(bounds)


def replace_year(source, target, year: int) -> None:
    start, end = date(year, 1, 1), date(year + 1, 1, 1)
    with target.cursor() as writer:
        writer.execute(
            """INSERT INTO archive_import_year_status(archive_year,status,started_at,completed_at,verified_at,error)
               VALUES(%s,'importing',now(),NULL,NULL,NULL)
               ON CONFLICT(archive_year) DO UPDATE SET status='importing',started_at=now(),completed_at=NULL,verified_at=NULL,error=NULL""",
            (year,),
        )
        writer.execute("DELETE FROM archive_case WHERE started_at >= %s AND started_at < %s", (start, end))
    target.commit()
    print(f"{year}: cleared existing Canopy rows", flush=True)
    for table, _, columns in TABLES:
        names = sql.SQL(",").join(map(sql.Identifier, columns))
        predicate = _year_predicate(table, start, end)
        source_copy = sql.SQL("COPY (SELECT {} FROM {} WHERE {}) TO STDOUT").format(names, sql.Identifier(table), predicate)
        target_copy = sql.SQL("COPY {} ({}) FROM STDIN").format(sql.Identifier(table), names)
        transferred = 0
        with source.cursor().copy(source_copy) as reader, target.cursor().copy(target_copy) as writer:
            for block in reader:
                writer.write(block)
                transferred += len(block)
        target.commit()
        count = target.execute(
            sql.SQL("SELECT count(*) FROM {} WHERE {}").format(sql.Identifier(table), _year_predicate(table, start, end))
        ).fetchone()[0]
        print(f"{year} {table}: {count:,} rows ({transferred / (1024 ** 2):.1f} MiB)", flush=True)
    target.execute(
        "UPDATE archive_import_year_status SET status='ready_for_verification',completed_at=now() WHERE archive_year=%s",
        (year,),
    )
    target.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description="Import normalized Innovian archive rows into Canopy PostgreSQL")
    parser.add_argument("--source", default=os.getenv("ANORA_SOURCE_DATABASE_URL"), help="Source PostgreSQL URL")
    parser.add_argument("--target", default=os.getenv("FLORA_DATABASE_URL"), help="Canopy PostgreSQL URL (writer/admin role)")
    parser.add_argument("--batch-size", type=int, default=5_000)
    parser.add_argument("--replace", action="store_true", help="Replace Canopy archive tables using fast streaming COPY")
    parser.add_argument("--year", type=int, help="Replace one admission year and leave every other year untouched")
    args = parser.parse_args()
    if not args.source or not args.target:
        parser.error("provide --source and --target (or ANORA_SOURCE_DATABASE_URL and FLORA_DATABASE_URL)")
    started = time.monotonic()
    with psycopg.connect(args.source) as source, psycopg.connect(args.target) as target:
        if args.year:
            replace_year(source, target, args.year)
        elif args.replace:
            replace_archive(source, target)
        else:
            for table, conflict, columns in TABLES:
                import_table(source, target, table, conflict, columns, args.batch_size)
    print(f"Archive import complete in {time.monotonic() - started:.1f}s", flush=True)


if __name__ == "__main__":
    main()
