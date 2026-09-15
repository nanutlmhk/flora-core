import os
import sqlite3
import sys

import psycopg
from psycopg import sql


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


sqlite_path = os.environ["FLORA_SQLITE_PATH"]
database_url = os.environ["FLORA_DATABASE_URL"]
app_role = os.getenv("FLORA_APP_ROLE", "flora_app")
view_role = os.getenv("FLORA_VIEW_ROLE", "flora_view")
sync_role = os.getenv("FLORA_SYNC_ROLE", "flora_sync")
expected_checks = int(os.getenv("FLORA_EXPECTED_CHECKS", "24"))
sync_tables = {"sync_leaf_node", "sync_message", "sync_case_index"}

sqlite_db = sqlite3.connect(f"file:{sqlite_path}?mode=ro&immutable=1", uri=True)
sqlite_tables = [
    row[0]
    for row in sqlite_db.execute(
        """
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
        """
    )
]

with psycopg.connect(database_url) as postgres:
    with postgres.cursor() as cursor:
        cursor.execute(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name
            """
        )
        postgres_tables = [row[0] for row in cursor.fetchall()]

        postgres_clinical_tables = sorted(set(postgres_tables) - sync_tables)
        if sqlite_tables != postgres_clinical_tables:
            missing = sorted(set(sqlite_tables) - set(postgres_clinical_tables))
            extra = sorted(set(postgres_clinical_tables) - set(sqlite_tables))
            fail(f"table mismatch; missing={missing}, extra={extra}")

        sqlite_total = 0
        postgres_total = 0
        mismatches = []
        for table in sqlite_tables:
            sqlite_count = sqlite_db.execute(
                f'SELECT COUNT(*) FROM "{table}"'
            ).fetchone()[0]
            cursor.execute(
                sql.SQL("SELECT COUNT(*) FROM {}").format(sql.Identifier(table))
            )
            postgres_count = cursor.fetchone()[0]
            sqlite_total += sqlite_count
            postgres_total += postgres_count
            if sqlite_count != postgres_count:
                mismatches.append(f"{table}: sqlite={sqlite_count}, postgres={postgres_count}")

        if mismatches:
            fail("row-count mismatch: " + "; ".join(mismatches))

        cursor.execute(
            """
            SELECT
              count(*) FILTER (WHERE contype = 'p'),
              count(*) FILTER (WHERE contype = 'f'),
              count(*) FILTER (WHERE contype = 'c'),
              bool_and(convalidated)
            FROM pg_constraint
            JOIN pg_class relation ON relation.oid = conrelid
            WHERE connamespace = 'public'::regnamespace
              AND relation.relname = ANY(%s)
            """,
            (sqlite_tables,),
        )
        primary_keys, foreign_keys, checks, all_validated = cursor.fetchone()
        if primary_keys != len(sqlite_tables):
            fail(f"expected {len(sqlite_tables)} primary keys, found {primary_keys}")
        if foreign_keys != 24:
            fail(f"expected 24 foreign keys, found {foreign_keys}")
        if checks != expected_checks:
            fail(f"expected {expected_checks} CHECK constraints, found {checks}")
        if not all_validated:
            fail("one or more PostgreSQL constraints are not validated")

        missing_privileges = []
        for table in sqlite_tables:
            cursor.execute(
                "SELECT has_table_privilege(%s, %s, %s)",
                (app_role, f'public."{table}"', "SELECT,INSERT,UPDATE,DELETE"),
            )
            if not cursor.fetchone()[0]:
                missing_privileges.append(table)
        if missing_privileges:
            fail(f"{app_role} lacks table privileges on {missing_privileges}")

        cursor.execute(
            """
            SELECT sequencename
            FROM pg_sequences
            WHERE schemaname = 'public'
            ORDER BY sequencename
            """,
        )
        sequence_names = [row[0] for row in cursor.fetchall() if not row[0].startswith("sync_")]
        missing_sequence_privileges = []
        for sequence_name in sequence_names:
            cursor.execute(
                "SELECT has_sequence_privilege(%s, %s, %s)",
                (app_role, f'public."{sequence_name}"', "USAGE,SELECT,UPDATE"),
            )
            if not cursor.fetchone()[0]:
                missing_sequence_privileges.append(sequence_name)
        if missing_sequence_privileges:
            fail(
                f"{app_role} lacks privileges on sequences "
                f"{missing_sequence_privileges}"
            )

        missing_view_select = []
        unsafe_view_tables = []
        for table in postgres_tables:
            relation = f'public."{table}"'
            cursor.execute(
                "SELECT has_table_privilege(%s, %s, 'SELECT')",
                (view_role, relation),
            )
            if not cursor.fetchone()[0]:
                missing_view_select.append(table)
            cursor.execute(
                "SELECT has_table_privilege(%s, %s, 'INSERT,UPDATE,DELETE')",
                (view_role, relation),
            )
            if cursor.fetchone()[0]:
                unsafe_view_tables.append(table)
        if missing_view_select:
            fail(f"{view_role} lacks SELECT on {missing_view_select}")
        if unsafe_view_tables:
            fail(f"{view_role} has unsafe write privileges on {unsafe_view_tables}")

        for table in sorted(sync_tables):
            relation = f'public."{table}"'
            cursor.execute(
                "SELECT has_table_privilege(%s, %s, 'SELECT,INSERT,UPDATE')",
                (sync_role, relation),
            )
            if not cursor.fetchone()[0]:
                fail(f"{sync_role} lacks synchronization privileges on {table}")
            cursor.execute(
                "SELECT has_table_privilege(%s, %s, 'DELETE')",
                (sync_role, relation),
            )
            if cursor.fetchone()[0]:
                fail(f"{sync_role} has unsafe DELETE privilege on {table}")

        cursor.execute(
            """
            SELECT
              table_name,
              column_name,
              pg_get_serial_sequence(
                format('%I.%I', table_schema, table_name),
                column_name
              )
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND column_default LIKE 'nextval(%'
            ORDER BY table_name, column_name
            """
        )
        sequences = cursor.fetchall()
        for table, column, sequence in sequences:
            cursor.execute(
                sql.SQL("SELECT max({}) FROM {}").format(
                    sql.Identifier(column), sql.Identifier(table)
                )
            )
            maximum = cursor.fetchone()[0]
            cursor.execute(
                sql.SQL("SELECT last_value, is_called FROM {}").format(
                    sql.Identifier(*sequence.split("."))
                )
            )
            last_value, is_called = cursor.fetchone()
            next_value = last_value + 1 if is_called else last_value
            if maximum is not None and next_value <= maximum:
                fail(
                    f"sequence {sequence} would generate {next_value}, "
                    f"but {table}.{column} already reaches {maximum}"
                )

print(
    "PASS: "
    f"tables={len(sqlite_tables)} rows={sqlite_total} "
    f"primary_keys={primary_keys} foreign_keys={foreign_keys} checks={checks} "
    f"sequences={len(sequences)} "
    f"app_role={app_role} view_role={view_role} sync_role={sync_role} "
    f"sync_tables={len(sync_tables)}"
)
