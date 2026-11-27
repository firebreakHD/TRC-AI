"""Administrative document, knowledge and worker routes."""

import hashlib
import os
import tempfile
from asyncio import timeout
from contextlib import contextmanager
from pathlib import Path
from typing import Annotated, Literal

import psycopg
from fastapi import Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool

from .config import UPLOADS
from .extract import Rejected
from .providers import Services, Temporary
from .store import Store, relative
from .upload import QuotaReached, filename, publish

PROFILES = {
    "general": "Du beantwortest Fragen zur Wissensdatenbank.",
    "jarvis": "Du bist JARVIS, sachlich und präzise.",
    "friday": "Du bist FRIDAY, direkt und freundlich.",
}


class Command(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Search(Command):
    question: str = Field(min_length=3, max_length=1500)
    prefix: str = Field(default="", max_length=400)
    limit: int = Field(default=5, ge=1, le=10)
    answer: bool = False
    profile: Literal["general", "jarvis", "friday"] = "general"

    @field_validator("question")
    @classmethod
    def question_has_text(cls, value):
        if len(value.strip()) < 3:
            raise ValueError("question")
        return value.strip()


class Retry(Command):
    path: str = Field(min_length=1, max_length=1500)
    reindex: bool = False


class Pause(Command):
    paused: bool


def install(app, authorize, read_model, require_database, ApiError):
    @contextmanager
    def store():
        require_database()
        config = app.state.knowledge_config
        services = Services(config)
        try:
            yield Store(config, services)
        except psycopg.Error as error:
            raise ApiError(
                503, "database_unavailable", "PostgreSQL ist zurzeit nicht verfügbar."
            ) from error
        except Rejected as error:
            raise ApiError(
                422, "knowledge_request", "Pfad oder Indexkonfiguration prüfen."
            ) from error
        except Temporary as error:
            raise ApiError(
                503, "index_unavailable", "Der Vektorindex ist derzeit nicht verfügbar."
            ) from error
        except OSError as error:
            raise ApiError(
                503, "knowledge_io", "Die Dokumentablage ist zurzeit nicht verfügbar."
            ) from error
        finally:
            services.close()

    def status_data():
        with store() as repo:
            status = repo.status()
        config = app.state.knowledge_config
        status["configuration"] = config.model_dump()
        status["restart_required_for_options"] = True
        return status

    @app.get("/api/v1/knowledge/status")
    async def status(request: Request):
        await authorize(request, "admin")
        return await run_in_threadpool(status_data)

    def listing(after):
        with store() as repo:
            rows = repo.list_documents(relative(after) if after else "")
            return {
                "documents": rows[:100],
                "next": rows[99]["path"] if len(rows) > 100 else None,
            }

    @app.get("/api/v1/knowledge/documents")
    async def documents(
        request: Request, after: Annotated[str, Query(max_length=1500)] = ""
    ):
        await authorize(request, "admin")
        return await run_in_threadpool(listing, after)

    def accept(staging, name, digest, size, quota):
        with store() as repo:
            return publish(repo, staging, name, digest, size, quota)

    @app.put("/api/v1/knowledge/documents/{name}", status_code=202)
    async def upload(request: Request, name: str):
        await authorize(request, "admin")
        try:
            filename(name)
        except Rejected as error:
            raise ApiError(
                422,
                "upload_filename",
                "Einen Dateinamen mit unterstütztem Format angeben.",
            ) from error
        if (
            request.headers.get("content-type", "").split(";")[0].strip().lower()
            != "application/octet-stream"
        ):
            raise ApiError(
                415, "upload_content_type", "application/octet-stream ist erforderlich."
            )
        config = app.state.knowledge_config
        maximum = config.rag_upload_mib * 1024**2
        quota = config.rag_upload_quota_mib * 1024**2
        length = request.headers.get("content-length")
        if length and (
            len(length) > 10
            or not length.isascii()
            or not length.isdecimal()
            or int(length) > maximum
        ):
            raise ApiError(
                413, "upload_size", "Die Datei überschreitet das Uploadlimit."
            )
        if app.state.upload_limit.locked():
            raise ApiError(429, "upload_busy", "Ein anderer Upload läuft gerade.")
        async with app.state.upload_limit:
            staging = None
            try:
                with tempfile.NamedTemporaryFile(
                    dir=UPLOADS, prefix=".incoming-", delete=False
                ) as stream:
                    staging = Path(stream.name)
                    digest, size = hashlib.sha256(), 0
                    async with timeout(90):
                        async for fragment in request.stream():
                            size += len(fragment)
                            if size > maximum:
                                raise ApiError(
                                    413,
                                    "upload_size",
                                    "Die Datei überschreitet das Uploadlimit.",
                                )
                            stream.write(fragment)
                            digest.update(fragment)
                    if not size:
                        raise ApiError(422, "upload_empty", "Die Datei ist leer.")
                    stream.flush()
                    os.fsync(stream.fileno())
                return await run_in_threadpool(
                    accept, staging, name, digest.hexdigest(), size, quota
                )
            except TimeoutError as error:
                raise ApiError(
                    408, "upload_timeout", "Der Upload hat zu lange gedauert."
                ) from error
            except QuotaReached as error:
                raise ApiError(
                    413,
                    "upload_quota",
                    "Für die private Dokumentablage ist das Speicherlimit erreicht.",
                ) from error
            except OSError as error:
                raise ApiError(
                    503, "upload_io", "Die Dokumentablage ist zurzeit nicht verfügbar."
                ) from error
            finally:
                if staging is not None:
                    staging.unlink(missing_ok=True)

    def queue_again(command):
        with store() as repo:
            return {"queued": repo.retry(command.path, reindex=command.reindex)}

    @app.post("/api/v1/knowledge/retry")
    async def retry(request: Request):
        await authorize(request, "admin")
        command = await read_model(request, Retry)
        return await run_in_threadpool(queue_again, command)

    def set_pause(command):
        with store() as repo:
            repo.pause(command.paused)
            return {"paused": command.paused}

    @app.put("/api/v1/knowledge/worker")
    async def worker(request: Request):
        await authorize(request, "admin")
        command = await read_model(request, Pause)
        return await run_in_threadpool(set_pause, command)

    def repair_job():
        with store() as repo:
            repo.request_repair()
        return {"queued": True}

    @app.post("/api/v1/knowledge/index/repair", status_code=202)
    async def repair(request: Request):
        await authorize(request, "admin")
        return await run_in_threadpool(repair_job)

    def retrieve(command):
        with store() as repo:
            prefix = relative(command.prefix) if command.prefix else ""
            matches, dense = repo.lookup(
                command.question, prefix, repo.config.rag_rerank_candidates
            )
            ranked, method = repo.services.rerank(command.question, matches)
            hits = ranked[: command.limit]
            answer = None
            answer_status = "not_requested"
            if command.answer:
                answer_status = "no_evidence"
                if hits:
                    answer, answer_status = repo.services.answer(
                        command.question, hits, PROFILES[command.profile]
                    )
            sources = [
                {
                    "id": f"S{number}",
                    "chunk_id": str(hit["id"]),
                    "path": hit["path"],
                    "excerpt": hit["body"][:1600],
                    **hit["meta"],
                }
                for number, hit in enumerate(hits, 1)
            ]
            return {
                "answer": answer,
                "answer_status": answer_status,
                "sources": sources,
                "retrieval": "hybrid" if dense else "lexical",
                "reranking": method,
            }

    @app.post("/api/v1/knowledge/query")
    async def search(request: Request):
        await authorize(request, "admin")
        command = await read_model(request, Search)
        if app.state.query_limit.locked():
            raise ApiError(
                429, "query_busy", "Eine andere Wissensabfrage läuft gerade."
            )
        async with app.state.query_limit:
            return await run_in_threadpool(retrieve, command)
