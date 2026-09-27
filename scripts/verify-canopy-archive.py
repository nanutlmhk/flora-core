"""Fail closed when a Canopy Innovian archive migration is incomplete."""

import argparse
import os

import psycopg


TABLES = (
    "archive_case", "archive_case_context", "archive_patient_demographics",
    "archive_allergy", "archive_note", "archive_observation",
    "archive_device_parameter", "archive_fluid_io", "archive_infusion",
    "archive_infusion_component", "archive_infusion_measurement",
    "archive_vital_series_segment", "archive_staff_assignment", "archive_event",
    "archive_form", "archive_form_field",
)


def count(connection: psycopg.Connection, table: str) -> int:
    return connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]


def year_count(connection: psycopg.Connection, table: str, year: int) -> int:
    start, end = f"{year}-01-01", f"{year + 1}-01-01"
    if table == "archive_case":
        query = "SELECT count(*) FROM archive_case WHERE started_at >= %s AND started_at < %s"
    elif table == "archive_infusion_component":
        query = "SELECT count(*) FROM archive_infusion_component component JOIN archive_infusion i ON i.id=component.archive_infusion_id JOIN archive_case c ON c.id=i.archive_case_id WHERE c.started_at >= %s AND c.started_at < %s"
    elif table == "archive_infusion_measurement":
        query = "SELECT count(*) FROM archive_infusion_measurement measurement JOIN archive_infusion_component component ON component.id=measurement.archive_infusion_component_id JOIN archive_infusion i ON i.id=component.archive_infusion_id JOIN archive_case c ON c.id=i.archive_case_id WHERE c.started_at >= %s AND c.started_at < %s"
    elif table == "archive_form_field":
        query = "SELECT count(*) FROM archive_form_field field JOIN archive_form f ON f.id=field.archive_form_id JOIN archive_case c ON c.id=f.archive_case_id WHERE c.started_at >= %s AND c.started_at < %s"
    else:
        query = f"SELECT count(*) FROM {table} item JOIN archive_case c ON c.id=item.archive_case_id WHERE c.started_at >= %s AND c.started_at < %s"
    return connection.execute(query, (start, end)).fetchone()[0]


def case_evidence(connection: psycopg.Connection, source_case_id: str) -> dict[str, int]:
    row = connection.execute(
        "SELECT id FROM archive_case WHERE source_system='innovian' AND source_case_id=%s LIMIT 1",
        (source_case_id,),
    ).fetchone()
    if not row:
        raise RuntimeError(f"canary case {source_case_id} is missing")
    case_id = row[0]
    checks = {
        "vital_segments": "archive_vital_series_segment",
        "device_parameters": "archive_device_parameter",
        "fluid_io": "archive_fluid_io",
        "infusions": "archive_infusion",
        "events": "archive_event",
        "forms": "archive_form",
        "staff": "archive_staff_assignment",
    }
    return {
        label: connection.execute(f"SELECT count(*) FROM {table} WHERE archive_case_id=%s", (case_id,)).fetchone()[0]
        for label, table in checks.items()
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=os.getenv("ANORA_SOURCE_DATABASE_URL"))
    parser.add_argument("--target", default=os.getenv("FLORA_DATABASE_URL"))
    parser.add_argument("--canary", default="25940")
    parser.add_argument("--year", type=int)
    args = parser.parse_args()
    if not args.source or not args.target:
        parser.error("provide --source and --target")
    failures: list[str] = []
    with psycopg.connect(args.source) as source, psycopg.connect(args.target) as target:
        for table in TABLES:
            counter = (lambda connection, name: year_count(connection, name, args.year)) if args.year else count
            source_count, target_count = counter(source, table), counter(target, table)
            print(f"{table}: source={source_count:,} target={target_count:,}")
            if source_count != target_count:
                failures.append(f"{table}: expected {source_count}, got {target_count}")
        source_evidence = case_evidence(source, args.canary)
        target_evidence = case_evidence(target, args.canary)
        print(f"canary {args.canary}: {target_evidence}")
        for label, expected in source_evidence.items():
            actual = target_evidence[label]
            if expected != actual or expected == 0:
                failures.append(f"canary {args.canary} {label}: expected non-zero {expected}, got {actual}")
    if failures:
        raise SystemExit("Archive verification failed:\n- " + "\n- ".join(failures))
    if args.year:
        with psycopg.connect(args.target) as target:
            target.execute(
                """INSERT INTO archive_import_year_status(archive_year,status,completed_at)
                   VALUES(%s,'ready_for_verification',now())
                   ON CONFLICT(archive_year) DO UPDATE SET status='ready_for_verification',completed_at=now(),error=NULL""",
                (args.year,),
            )
            target.commit()
    print("Archive verification passed.")


if __name__ == "__main__":
    main()
