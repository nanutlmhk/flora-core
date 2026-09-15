import os
from collections.abc import Iterator

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool


DATABASE_URL = os.environ["FLORA_DATABASE_URL"]

pool = ConnectionPool(
    conninfo=DATABASE_URL,
    min_size=1,
    max_size=10,
    kwargs={"autocommit": True, "row_factory": dict_row},
    open=False,
)


def open_pool() -> None:
    pool.open(wait=True, timeout=10)


def close_pool() -> None:
    pool.close()


def connection() -> Iterator[Connection]:
    with pool.connection() as database:
        yield database
