from contextlib import asynccontextmanager
import os

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from psycopg import Connection

from .database import close_pool, connection, open_pool
from .routes.cases_read import router as cases_read_router
from .routes.auth_canopy import router as canopy_auth_router
from .routes.fleet_read import router as fleet_read_router
from .routes.sync_ingest import router as sync_ingest_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    open_pool()
    yield
    close_pool()


app = FastAPI(title="Flora API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
API_MODE = os.getenv("FLORA_API_MODE", "leaf").strip().lower()
if API_MODE in {"leaf", "canopy"}:
    app.include_router(cases_read_router)
if API_MODE == "canopy":
    app.include_router(canopy_auth_router)
    app.include_router(fleet_read_router)
if API_MODE == "sync":
    app.include_router(sync_ingest_router)


@app.middleware("http")
async def enforce_canopy_read_only(request: Request, call_next):
    if API_MODE == "canopy" and request.method not in {"GET", "HEAD", "OPTIONS"}:
        if request.url.path not in {"/api/auth/login", "/api/auth/logout"}:
            return JSONResponse(
                status_code=403,
                content={"error": "Flora Canopy is read-only"},
            )
    return await call_next(request)


@app.exception_handler(HTTPException)
async def legacy_http_error(_: Request, error: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=error.status_code, content={"error": error.detail})


@app.get("/health")
def health(database: Connection = Depends(connection)) -> dict:
    database.execute("SELECT 1").fetchone()
    return {"status": "OK", "data_ready": True, "data_mode": "server", "api_mode": API_MODE}
