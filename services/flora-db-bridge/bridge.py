import os
import sqlite3
import time
from collections import defaultdict, deque

import psycopg
from psycopg import sql


SQLITE_PATH = os.getenv("FLORA_SQLITE_PATH", "/source/flora.db")
DATABASE_URL = os.environ["FLORA_DATABASE_URL"]
INTERVAL_SECONDS = max(2, int(os.getenv("FLORA_BRIDGE_INTERVAL_SECONDS", "10")))


def source_tables(source: sqlite3.Connection) -> list[str]:
    return [
        row[0]
        for row in source.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]


def dependency_order(source: sqlite3.Connection, tables: list[str]) -> list[str]:
    table_set = set(tables)
    parents: dict[str, set[str]] = {table: set() for table in tables}
    children: dict[str, set[str]] = defaultdict(set)
    for table in tables:
        for foreign_key in source.execute(f'PRAGMA foreign_key_list("{table}")'):
            parent = foreign_key[2]
            if parent in table_set and parent != table:
                parents[table].add(parent)
                children[parent].add(table)
    queue = deque(sorted(table for table, deps in parents.items() if not deps))
    ordered: list[str] = []
    while queue:
        table = queue.popleft()
        ordered.append(table)
        for child in sorted(children[table]):
            parents[child].discard(table)
            if not parents[child] and child not in ordered and child not in queue:
                queue.append(child)
    # Self-references or unexpected cycles are handled after their reachable parents.
    return ordered + sorted(set(tables) - set(ordered))


def synchronize_once() -> tuple[int, int]:
    source = sqlite3.connect(f"file:{SQLITE_PATH}?mode=ro", uri=True, timeout=30)
    source.row_factory = sqlite3.Row
    source.execute("PRAGMA query_only=ON")
    tables = source_tables(source)
    written = 0
    with psycopg.connect(DATABASE_URL) as target:
        with target.cursor() as cursor:
            cursor.execute(
                "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY ordinal_position"
            )
            target_columns: dict[str, list[str]] = defaultdict(list)
            for table, column in cursor.fetchall():
                target_columns[table].append(column)

            for table in dependency_order(source, tables):
                source_columns = [row[1] for row in source.execute(f'PRAGMA table_info("{table}")')]
                columns = [column for column in source_columns if column in target_columns[table]]
                primary_keys = [
                    row[1]
                    for row in sorted(source.execute(f'PRAGMA table_info("{table}")'), key=lambda item: item[5])
                    if row[5]
                ]
                if not columns or not primary_keys:
                    raise RuntimeError(f"cannot bridge {table}: missing columns or primary key")
                rows = source.execute(
                    f'SELECT {", ".join(f"\"{column}\"" for column in columns)} FROM "{table}"'
                ).fetchall()
                if not rows:
                    continue
                assignments = [column for column in columns if column not in primary_keys]
                statement = sql.SQL("INSERT INTO {} ({}) VALUES ({}) ON CONFLICT ({}) ").format(
                    sql.Identifier(table),
                    sql.SQL(", ").join(map(sql.Identifier, columns)),
                    sql.SQL(", ").join(sql.Placeholder() for _ in columns),
                    sql.SQL(", ").join(map(sql.Identifier, primary_keys)),
                )
                if assignments:
                    statement += sql.SQL("DO UPDATE SET ") + sql.SQL(", ").join(
                        sql.SQL("{} = EXCLUDED.{}").format(sql.Identifier(column), sql.Identifier(column))
                        for column in assignments
                    )
                else:
                    statement += sql.SQL("DO NOTHING")
                cursor.executemany(statement, [tuple(row[column] for column in columns) for row in rows])
                written += len(rows)

            for table in tables:
                primary_key = next(
                    (row[1] for row in source.execute(f'PRAGMA table_info("{table}")') if row[5] == 1),
                    None,
                )
                if not primary_key:
                    continue
                cursor.execute("SELECT pg_get_serial_sequence(%s, %s)", (f"public.{table}", primary_key))
                sequence = cursor.fetchone()[0]
                if not sequence:
                    continue
                cursor.execute(
                    sql.SQL("SELECT max({}) FROM {}").format(sql.Identifier(primary_key), sql.Identifier(table))
                )
                maximum = cursor.fetchone()[0]
                if maximum is not None:
                    cursor.execute("SELECT setval(%s, %s, true)", (sequence, maximum))

            mismatches = []
            for table in tables:
                source_count = source.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
                cursor.execute(sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(table)))
                target_count = cursor.fetchone()[0]
                if source_count != target_count:
                    mismatches.append(f"{table}:{source_count}!={target_count}")
            if mismatches:
                raise RuntimeError("row parity failed " + ", ".join(mismatches))
        target.commit()
    source.close()
    return len(tables), written


while True:
    started = time.monotonic()
    try:
        table_count, row_count = synchronize_once()
        print(f"bridge ok tables={table_count} rows={row_count} elapsed={time.monotonic() - started:.2f}s", flush=True)
    except Exception as error:
        print(f"bridge failed: {type(error).__name__}: {error}", flush=True)
    time.sleep(INTERVAL_SECONDS)
