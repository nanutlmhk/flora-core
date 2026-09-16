"""Shared PostgreSQL mutations. Table and column names come from server code only."""
import json
import math
from fastapi import HTTPException
from psycopg import sql
from .routes.auth_leaf import now_ms


def text(value):
    return str(value).strip() or None if value is not None else None


def number(value, field="value", minimum=None):
    if value is None or value == "":
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise HTTPException(400, f"invalid {field}") from None
    if not math.isfinite(result) or (minimum is not None and result < minimum):
        raise HTTPException(400, f"invalid {field}")
    return result


def timestamp(value, field="timestamp", default=None):
    result = number(value, field, 1)
    return int(result)//60000*60000 if result is not None else default


def flag(value, default=True):
    if value is None or value == "":
        return int(default)
    if isinstance(value, str):
        return int(value.strip().lower() in {"1", "true", "yes"})
    return int(bool(value))


def insert(db, table, values):
    return db.execute(sql.SQL("INSERT INTO {} ({}) VALUES ({}) RETURNING *").format(
        sql.Identifier(table), sql.SQL(",").join(map(sql.Identifier, values)),
        sql.SQL(",").join(sql.Placeholder() for _ in values)), tuple(values.values())).fetchone()


def update(db, table, row_id, values):
    return db.execute(sql.SQL("UPDATE {} SET {} WHERE id=%s RETURNING *").format(
        sql.Identifier(table), sql.SQL(",").join(sql.SQL("{}=%s").format(sql.Identifier(k)) for k in values)),
        (*values.values(),row_id)).fetchone()


def io_audit(db, case_id, entity, before, after, actor, reason=None):
    row = after or before
    insert(db,"case_io_audit",dict(case_id=case_id,entity_type=entity,entity_id=row["id"],
        action="delete" if after is None else "update" if before else "insert",
        before_json=json.dumps(before) if before else None,after_json=json.dumps(after) if after else None,
        actor_username=actor["username"],actor_name=actor.get("name"),actor_role=actor.get("role"),
        reason=text(reason),created_at=now_ms()))


def case_audit(db, case_id, action, before, after, actor):
    # A dedicated audit stream for patient, diagnosis, procedure, staff and form changes.
    insert(db,"case_clinical_audit",dict(case_id=case_id,action=action,
        before_json=json.dumps(before) if before is not None else None,
        after_json=json.dumps(after) if after is not None else None,
        actor_username=actor["username"],actor_role=actor.get("role"),created_at=now_ms()))
