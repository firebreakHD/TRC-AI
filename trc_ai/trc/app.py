from asyncio import Semaphore, gather
import sqlite3
from contextlib import asynccontextmanager
from datetime import timezone
from enum import StrEnum
import hmac
import json
import logging
import os
from pathlib import Path
import shutil
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener
from typing import Annotated
from uuid import UUID

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, JsonValue, ValidationError, field_validator
import psycopg
from starlette.concurrency import run_in_threadpool

from . import network, settings, storage
from .rag import config as knowledge_config
from .rag import http as knowledge_http
from .intelligence import api as intelligence_http, store as intelligence_store

VERSION = "0.3.0"
MAX_BODY = 512 * 1024
STATIC = Path(__file__).parent / "static"
logger = logging.getLogger(__name__)
bearer = HTTPBearer(auto_error=False)
local_http = build_opener(ProxyHandler({}))


class Area(StrEnum):
    EMAILS = "emails"
    CALENDAR = "calendar"
    TASKS = "tasks"
    MESSENGER = "messenger"
    MARKET_PRICES = "market-prices"
    NEWS = "news"
    RESEARCH = "research"
    REPORTS = "reports"
    NOTIFICATIONS = "notifications"


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid")

    external_id: str = Field(min_length=1, max_length=256, pattern=r"^[^\x00-\x1f]+$")
    observed_at: AwareDatetime
    payload: dict[str, JsonValue]

    @field_validator("observed_at", mode="before")
    @classmethod
    def require_datetime_string(cls, value):
        if not isinstance(value, str) or "T" not in value:
            raise ValueError("ISO-8601-Zeitstempel mit Zeitzone erforderlich.")
        return value

    @field_validator("observed_at")
    @classmethod
    def normalize_datetime(cls, value):
        return value.astimezone(timezone.utc)


class Batch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9._-]*$")
    records: list[Record] = Field(min_length=1, max_length=100)

    @field_validator("records")
    @classmethod
    def unique_records(cls, records):
        if len({record.external_id for record in records}) != len(records):
            raise ValueError("Externe IDs müssen innerhalb eines Imports eindeutig sein.")
        return records


class ApiError(Exception):
    def __init__(self, status, code, message):
        self.status = status
        self.code = code
        self.message = message


@asynccontextmanager
async def lifespan(app):
    app.state.tokens = settings.load_tokens()
    app.state.network_startup = network.load_startup()
    app.state.schema_ready = False
    app.state.knowledge_config = knowledge_config.load()
    app.state.upload_limit = Semaphore(1)
    app.state.query_limit = Semaphore(1)
    app.state.chat_tasks = {}
    app.state.chat_partials = {}
    try:
        intelligence_store.initialize()
        app.state.chat_ready = True
    except (OSError, sqlite3.Error, RuntimeError):
        logger.error("Chat-Speicher konnte nicht gestartet werden.")
        app.state.chat_ready = False
    yield
    tasks = list(app.state.chat_tasks.values())
    for task in tasks:
        task.cancel()
    await gather(*tasks, return_exceptions=True)


app = FastAPI(version=VERSION, lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None, redirect_slashes=False)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self'; "
        "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
    )
    return response


@app.exception_handler(ApiError)
async def api_error(request, exc):
    headers = {"WWW-Authenticate": "Bearer"} if exc.status == 401 else {}
    if exc.status == 503:
        headers["Retry-After"] = "5"
    return JSONResponse(
        {"error": {"code": exc.code, "message": exc.message}},
        status_code=exc.status, headers=headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    return await api_error(request, ApiError(422, "invalid_request", "Ungültige Anfrage."))


async def authorize(request, *roles):
    credentials: HTTPAuthorizationCredentials | None = await bearer(request)
    if credentials and settings.TOKEN_PATTERN.fullmatch(credentials.credentials):
        for role, secret in zip(("admin", "workflow", "chat"), request.app.state.tokens, strict=True):
            if role in roles and secret and hmac.compare_digest(credentials.credentials, secret):
                return role
    raise ApiError(401, "unauthorized", "Ein gültiges Zugriffstoken ist erforderlich.")


async def read_model(request, model):
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
        raise ApiError(415, "unsupported_media_type", "Content-Type application/json ist erforderlich.")
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_BODY:
            raise ApiError(413, "payload_too_large", "Die Anfrage überschreitet 512 KiB.")
        body.extend(chunk)
    try:
        return model.model_validate_json(bytes(body))
    except (ValidationError, RecursionError, OverflowError, ValueError) as exc:
        raise ApiError(422, "invalid_request", "Der Anfrageinhalt ist ungültig.") from exc


def require_database():
    try:
        if not app.state.schema_ready:
            storage.migrate()
            app.state.schema_ready = True
        return storage.database_status()
    except (psycopg.Error, RuntimeError) as exc:
        raise ApiError(503, "database_unavailable", "PostgreSQL ist zurzeit nicht verfügbar.") from exc


@app.get("/")
def control_center():
    return FileResponse(STATIC / "index.html")


@app.get("/ui/app.js")
def script():
    return FileResponse(STATIC / "app.js", media_type="text/javascript")


@app.get("/ui/intelligence.js")
def intelligence_script():
    return FileResponse(STATIC / "intelligence.js", media_type="text/javascript")


@app.get("/ui/style.css")
def stylesheet():
    return FileResponse(STATIC / "style.css", media_type="text/css")


@app.get("/healthz")
def health():
    require_database()
    return {"status": "ok"}


@app.get("/api/v1/system/status")
async def status(request: Request):
    await authorize(request, "admin", "workflow")
    return await run_in_threadpool(system_status)


def system_status():
    version, database_bytes = require_database()
    disk = shutil.disk_usage("/data")
    meminfo = Path("/proc/meminfo").read_text().splitlines()
    memory = {line.split(":")[0]: int(line.split()[1]) * 1024
              for line in meminfo if line.startswith(("MemTotal:", "MemAvailable:"))}
    return {
        "status": "ok", "version": VERSION,
        "postgresql": {"version": version, "database_bytes": database_bytes},
        "qdrant": qdrant_status(),
        "resources": {
            "visible_cpu_count": len(os.sched_getaffinity(0)),
            "system_load_1m": os.getloadavg()[0],
            "system_memory_total_bytes": memory["MemTotal"],
            "system_memory_available_bytes": memory["MemAvailable"],
            "data_disk_total_bytes": disk.total,
            "data_disk_free_bytes": disk.free,
        },
    }


def qdrant_status():
    try:
        with local_http.open("http://127.0.0.1:6333/", timeout=0.5) as response:
            version = json.load(response)["version"]
        with local_http.open("http://127.0.0.1:6333/collections", timeout=0.5) as response:
            collections = len(json.load(response)["result"]["collections"])
    except (URLError, TimeoutError, KeyError, ValueError):
        return {"available": False}
    return {"available": True, "version": version, "collections": collections}


@app.get("/api/v1/admin/preferences")
async def preferences(request: Request):
    await authorize(request, "admin")
    try:
        values = await run_in_threadpool(settings.load_preferences)
    except (OSError, ValidationError):
        logger.warning("Control-Center-Einstellungen konnten nicht geladen werden.")
        values = settings.Preferences()
    return {"values": values.model_dump(), "schema": settings.Preferences.model_json_schema()}


@app.put("/api/v1/admin/preferences")
async def update_preferences(request: Request):
    await authorize(request, "admin")
    body = await read_model(request, settings.Preferences)
    try:
        await run_in_threadpool(settings.save_preferences, body)
    except OSError as exc:
        raise ApiError(503, "settings_unavailable", "Die Einstellungen konnten nicht gespeichert werden.") from exc
    return body


@app.post("/api/v1/workflow/records/{area}")
async def workflow_records(request: Request, area: Area):
    await authorize(request, "workflow")
    try:
        key = UUID(request.headers.get("idempotency-key", ""))
    except ValueError as exc:
        raise ApiError(422, "invalid_idempotency_key", "Idempotency-Key muss eine UUID sein.") from exc
    batch = await read_model(request, Batch)
    await run_in_threadpool(require_database)
    try:
        return await run_in_threadpool(storage.ingest, area.value, key, batch)
    except storage.IdempotencyConflict as exc:
        raise ApiError(409, "idempotency_conflict", "Der Schlüssel wurde bereits für andere Daten verwendet.") from exc
    except (ValueError, RecursionError, psycopg.DataError) as exc:
        raise ApiError(422, "invalid_request", "Der Anfrageinhalt ist ungültig.") from exc
    except psycopg.Error as exc:
        raise ApiError(503, "database_unavailable", "Der Import ist vorübergehend nicht verfügbar.") from exc

@app.get("/api/v1/admin/network")
async def network_dashboard(request: Request):
    await authorize(request, "admin")
    context = {"scheme": request.scope["scheme"], "trusted_proxy": request.scope.get("trc_trusted_proxy", False),
               "forwarded_host": request.scope.get("trc_forwarded_host")}
    try:
        return await run_in_threadpool(network.dashboard, app.state.network_startup, context)
    except (OSError, ValueError) as exc:
        raise ApiError(503, "network_settings_unavailable", "Netzwerkeinstellungen konnten nicht geladen werden.") from exc


@app.put("/api/v1/admin/network/services/{service}")
async def network_update(request: Request, service: str):
    await authorize(request, "admin")
    command = await read_model(request, network.IntegrationUpdate)
    try:
        return await run_in_threadpool(network.update, service, command, app.state.network_startup)
    except ValueError as exc:
        raise ApiError(422, "invalid_network_settings", str(exc)[:240]) from exc
    except OSError as exc:
        raise ApiError(503, "network_settings_unavailable", "Netzwerkeinstellungen konnten nicht gespeichert werden.") from exc


@app.post("/api/v1/admin/network/services/{service}/test")
async def network_test(request: Request, service: str):
    await authorize(request, "admin")
    try:
        return await run_in_threadpool(network.probe, service, app.state.network_startup)
    except ValueError as exc:
        raise ApiError(422, "invalid_network_settings", str(exc)[:240]) from exc
    except OSError as exc:
        raise ApiError(503, "network_settings_unavailable", "Prüfung konnte nicht gespeichert werden.") from exc



@app.get("/api/v1/workflow/records/{area}")
async def workflow_read(
    request: Request,
    area: Area,
    source: Annotated[str | None, Query(pattern=r"^[a-z0-9][a-z0-9._-]{0,63}$")] = None,
    cursor: Annotated[str, Query(max_length=2200)] = "",
    limit: Annotated[int, Query(ge=1, le=50)] = 25,
):
    await authorize(request, "admin")
    await run_in_threadpool(require_database)
    try:
        return await run_in_threadpool(storage.list_records, area, source, cursor, limit)
    except ValueError as error:
        raise ApiError(422, "invalid_cursor", "Ungültiger Lesecursor.") from error
    except psycopg.Error as error:
        raise ApiError(503, "database_unavailable", "PostgreSQL ist zurzeit nicht verfügbar.") from error


knowledge_http.install(app, authorize, read_model, require_database, ApiError)

intelligence_http.install(app, authorize, read_model, require_database, ApiError)
