import hashlib
import hmac
import json
import os
import secrets
import time
from functools import wraps
from inspect import signature
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from psycopg import Connection
from pydantic import BaseModel

from ..database import connection


router = APIRouter(prefix="/api/auth", tags=["authentication"])
SESSION_TTL_MS = int(os.getenv("FLORA_AUTH_SESSION_TTL_MS", str(30 * 24 * 60 * 60 * 1000)))
DEFAULT_PASSWORD = os.getenv("FLORA_DEFAULT_STAFF_PASSWORD", "flora").strip() or "flora"
THEME_COLORS = {"monochromatic", "neon", "warm", "pastel", "jewel", "vibrant"}


def atomic(function):
    """Keep a mutation and its audit record in one PostgreSQL transaction."""
    parameters = signature(function)

    @wraps(function)
    def wrapped(*args, **kwargs):
        database = parameters.bind(*args, **kwargs).arguments["database"]
        with database.transaction():
            return function(*args, **kwargs)

    return wrapped


class LoginRequest(BaseModel):
    username: str
    password: str


class ThemeRequest(BaseModel):
    theme_mode: str
    theme_color: str


class ActiveRequest(BaseModel):
    is_active: bool


class PasswordResetRequest(BaseModel):
    password: str | None = None


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str


def now_ms() -> int:
    return int(time.time() * 1000)


def token_from(request: Request) -> str:
    explicit = request.headers.get("x-flora-session", "").strip()
    if explicit:
        return explicit
    authorization = request.headers.get("authorization", "").strip()
    return authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def password_hash(password: str, salt_hex: str) -> str:
    return hashlib.scrypt(
        password.encode("utf-8"), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1, dklen=64
    ).hex()


def verify_password(password: str, salt_hex: str, expected_hex: str) -> bool:
    try:
        return hmac.compare_digest(password_hash(password, salt_hex), expected_hex)
    except (TypeError, ValueError):
        return False


def new_password_record(password: str) -> tuple[str, str]:
    if not password:
        raise HTTPException(status_code=400, detail="password required")
    salt = secrets.token_hex(16)
    return salt, password_hash(password, salt)


def public_user(row: dict[str, Any]) -> dict[str, Any]:
    result = {"username": row["username"], "name": row.get("name") or row["username"]}
    if row.get("role"):
        result["role"] = row["role"]
    if row.get("theme_mode"):
        result["themeMode"] = row["theme_mode"]
    if row.get("theme_color"):
        result["themeColor"] = row["theme_color"]
    return result


def managed_user(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "username": row["username"],
        "hospitalId": row.get("hospital_id"),
        "authSource": row.get("auth_source"),
        "name": row.get("name") or row["username"],
        "role": row.get("role"),
        "themeMode": row.get("theme_mode"),
        "themeColor": row.get("theme_color"),
        "isActive": bool(row.get("is_active")),
        "createdAt": row.get("created_at") or 0,
        "updatedAt": row.get("updated_at") or 0,
        "lastLoginAt": row.get("last_login_at"),
    }


def audit(
    database: Connection,
    action: str,
    actor: dict[str, Any] | None,
    *,
    target: dict[str, Any] | None = None,
    status: str = "ok",
    detail: dict[str, Any] | None = None,
) -> None:
    database.execute(
        """
        INSERT INTO auth_audit (
          action, actor_user_id, actor_username, actor_role,
          target_user_id, target_username, status, detail_json, created_at
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            action,
            actor.get("id") if actor else None,
            actor.get("username") if actor else None,
            actor.get("role") if actor else None,
            target.get("id") if target else None,
            target.get("username") if target else None,
            status,
            json.dumps(detail, separators=(",", ":")) if detail else None,
            now_ms(),
        ),
    )


def current_user(request: Request, database: Connection = Depends(connection)) -> dict[str, Any]:
    token = token_from(request)
    current = now_ms()
    if not token:
        raise HTTPException(status_code=401, detail="sign in required")
    row = database.execute(
        """
        SELECT s.id AS session_id, s.expires_at, s.revoked_at,
               u.id, u.username, u.hospital_id, u.auth_source, u.name, u.role,
               u.theme_mode, u.theme_color, u.is_active,
               u.created_at, u.updated_at, u.last_login_at
        FROM auth_session s
        JOIN auth_user u ON u.id = s.user_id
        WHERE s.token_hash = %s
        LIMIT 1
        """,
        (token_hash(token),),
    ).fetchone()
    if row is None or row["revoked_at"] is not None or row["expires_at"] <= current or not row["is_active"]:
        raise HTTPException(status_code=401, detail="sign in required")
    database.execute(
        "UPDATE auth_session SET updated_at=%s, last_seen_at=%s, expires_at=%s WHERE id=%s",
        (current, current, current + SESSION_TTL_MS, row["session_id"]),
    )
    return row


def admin_user(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if str(user.get("role") or "").lower() != "admin":
        raise HTTPException(status_code=403, detail="admin access required")
    return user


@router.post("/login")
def login(payload: LoginRequest, request: Request, database: Connection = Depends(connection)) -> dict:
    username = payload.username.strip()
    if not username or not payload.password:
        raise HTTPException(status_code=400, detail="username and password are required")
    user = database.execute(
        "SELECT * FROM auth_user WHERE lower(username)=lower(%s) LIMIT 1", (username,)
    ).fetchone()
    if user is None or not user["is_active"] or not verify_password(
        payload.password, user["password_salt"], user["password_hash"]
    ):
        audit(database, "auth.login", None, target={"username": username}, status="denied", detail={"reason": "invalid_credentials"})
        raise HTTPException(status_code=401, detail="invalid username or password")
    token = secrets.token_urlsafe(32)
    current = now_ms()
    expires = current + SESSION_TTL_MS
    database.execute(
        """
        INSERT INTO auth_session (user_id, token_hash, client_label, created_at, updated_at, last_seen_at, expires_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (user["id"], token_hash(token), request.headers.get("x-flora-client") or request.headers.get("user-agent"), current, current, current, expires),
    )
    database.execute("UPDATE auth_user SET last_login_at=%s, updated_at=%s WHERE id=%s", (current, current, user["id"]))
    audit(database, "auth.login", user, target=user)
    return {"user": public_user(user), "session_token": token, "expires_at": expires}


@router.post("/logout")
@atomic
def logout(request: Request, user: dict = Depends(current_user), database: Connection = Depends(connection)) -> dict:
    current = now_ms()
    database.execute(
        "UPDATE auth_session SET revoked_at=%s, updated_at=%s WHERE token_hash=%s",
        (current, current, token_hash(token_from(request))),
    )
    audit(database, "auth.logout", user, target=user)
    return {"ok": True}


@router.get("/whoami")
def whoami(user: dict = Depends(current_user)) -> dict:
    return {"user": public_user(user)}


@router.get("/self")
def self_account(user: dict = Depends(current_user)) -> dict:
    return {"row": managed_user(user)}


@router.get("/users")
def users(
    q: str = "",
    include_inactive: bool = True,
    _: dict = Depends(admin_user),
    database: Connection = Depends(connection),
) -> dict:
    pattern = f"%{q.strip()}%"
    rows = database.execute(
        """
        SELECT * FROM auth_user
        WHERE (%s = '' OR username ILIKE %s OR name ILIKE %s OR coalesce(hospital_id, '') ILIKE %s)
          AND (%s OR is_active = 1)
        ORDER BY name, username
        """,
        (q.strip(), pattern, pattern, pattern, include_inactive),
    ).fetchall()
    return {"rows": [managed_user(row) for row in rows]}


@router.put("/self/preferences")
@atomic
def preferences(
    payload: ThemeRequest,
    user: dict = Depends(current_user),
    database: Connection = Depends(connection),
) -> dict:
    if payload.theme_mode != "dark" or payload.theme_color not in THEME_COLORS:
        raise HTTPException(status_code=400, detail="invalid theme preference")
    current = now_ms()
    row = database.execute(
        "UPDATE auth_user SET theme_mode=%s, theme_color=%s, updated_at=%s WHERE id=%s RETURNING *",
        (payload.theme_mode, payload.theme_color, current, user["id"]),
    ).fetchone()
    audit(database, "auth.self.set-preferences", user, target=row)
    return {"user": public_user(row), "row": managed_user(row)}


@router.put("/users/{user_id}/active")
@atomic
def set_active(
    user_id: int,
    payload: ActiveRequest,
    actor: dict = Depends(admin_user),
    database: Connection = Depends(connection),
) -> dict:
    row = database.execute(
        "UPDATE auth_user SET is_active=%s, updated_at=%s WHERE id=%s RETURNING *",
        (1 if payload.is_active else 0, now_ms(), user_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="user not found")
    if not payload.is_active:
        database.execute("UPDATE auth_session SET revoked_at=%s WHERE user_id=%s AND revoked_at IS NULL", (now_ms(), user_id))
    audit(database, "auth.user.set-active", actor, target=row, detail={"isActive": payload.is_active})
    return {"row": managed_user(row)}


@router.post("/users/{user_id}/reset-password")
@atomic
def reset_password(
    user_id: int,
    payload: PasswordResetRequest,
    actor: dict = Depends(admin_user),
    database: Connection = Depends(connection),
) -> dict:
    existing = database.execute("SELECT * FROM auth_user WHERE id=%s", (user_id,)).fetchone()
    if existing is None:
        raise HTTPException(status_code=404, detail="user not found")
    applied = (payload.password or "").strip() or (
        DEFAULT_PASSWORD if existing.get("auth_source") == "staff" else str(existing.get("hospital_id") or "").strip()
    )
    if not applied:
        raise HTTPException(status_code=400, detail="no default password available for this user")
    salt, hashed = new_password_record(applied)
    row = database.execute(
        "UPDATE auth_user SET password_salt=%s, password_hash=%s, updated_at=%s WHERE id=%s RETURNING *",
        (salt, hashed, now_ms(), user_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="user not found")
    database.execute("UPDATE auth_session SET revoked_at=%s WHERE user_id=%s AND revoked_at IS NULL", (now_ms(), user_id))
    audit(database, "auth.user.reset-password", actor, target=row)
    return {"row": managed_user(row), "applied_password": applied}


@router.post("/self/change-password")
@atomic
def change_password(
    payload: PasswordChangeRequest,
    user: dict = Depends(current_user),
    database: Connection = Depends(connection),
) -> dict:
    credential = database.execute("SELECT password_salt, password_hash FROM auth_user WHERE id=%s", (user["id"],)).fetchone()
    if credential is None or not verify_password(payload.current_password, credential["password_salt"], credential["password_hash"]):
        raise HTTPException(status_code=400, detail="current password is incorrect")
    new_password = payload.new_password.strip()
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="new password must be at least 6 characters")
    salt, hashed = new_password_record(new_password)
    row = database.execute(
        "UPDATE auth_user SET password_salt=%s, password_hash=%s, updated_at=%s WHERE id=%s RETURNING *",
        (salt, hashed, now_ms(), user["id"]),
    ).fetchone()
    audit(database, "auth.self.change-password", user, target=row)
    return {"row": managed_user(row)}
