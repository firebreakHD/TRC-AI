"""PostgreSQL is authoritative; Qdrant is a rebuildable projection."""

import fcntl
import hashlib
import json
import os
import stat
import subprocess
import sys
import time
import uuid
from contextlib import contextmanager, nullcontext
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .. import storage
from .extract import MAX_BYTES, SUFFIXES, Rejected, chunks, markdown, words
from .providers import Temporary

LOCK = 8716495201
NAMESPACE = uuid.UUID("afb12bf5-53ae-4286-b915-6d4928075d14")
MAX_ATTEMPTS = 5
MAX_CHUNKS = 900
STOPWORDS = {
    "aber",
    "alle",
    "als",
    "and",
    "auch",
    "auf",
    "aus",
    "bei",
    "das",
    "dem",
    "den",
    "der",
    "die",
    "ein",
    "eine",
    "einer",
    "für",
    "hat",
    "ich",
    "im",
    "in",
    "ist",
    "jetzt",
    "mit",
    "oder",
    "sind",
    "the",
    "und",
    "von",
    "warum",
    "was",
    "welche",
    "welcher",
    "wie",
    "wird",
    "wo",
    "zum",
    "zur",
    "über",
}


@contextmanager
def upload_guard(root):
    with (root / ".upload.lock").open("a") as guard:
        fcntl.flock(guard, fcntl.LOCK_EX)
        yield


def relative(value):
    path = PurePosixPath(value)
    if (
        str(path) != value
        or not value
        or value == "."
        or path.is_absolute()
        or ".." in path.parts
        or len(value.encode()) > 1500
        or any(ord(char) < 32 or ord(char) == 127 for char in value)
        or "\\" in value
    ):
        raise Rejected("source_path")
    return value


def fingerprint(root, name, *, load=False):
    """Close every path component against symlink traversal, including concurrent replacement."""
    parts = PurePosixPath(relative(name)).parts
    flags = os.O_DIRECTORY | os.O_NOFOLLOW
    directory = os.open(root, flags)
    try:
        for part in parts[:-1]:
            child = os.open(part, flags, dir_fd=directory)
            os.close(directory)
            directory = child
        fd = os.open(parts[-1], os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        with os.fdopen(fd, "rb") as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_BYTES:
                raise Rejected("source_size_or_type")
            digest = hashlib.sha256()
            data = bytearray()
            size = 0
            while piece := stream.read(128 * 1024):
                size += len(piece)
                if size > MAX_BYTES:
                    raise Rejected("source_size_or_type")
                digest.update(piece)
                if load:
                    data.extend(piece)
            after = os.fstat(stream.fileno())
            if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                size,
                after.st_mtime_ns,
                after.st_ctime_ns,
            ):
                raise Temporary("source_changed")
            return digest.hexdigest(), bytes(data)
    finally:
        os.close(directory)


class LeaseLost(RuntimeError):
    """The processing attempt lost its right to publish."""


@dataclass
class Job:
    path: str
    digest: str
    token: uuid.UUID
    attempts: int


class Store:
    def __init__(self, config, services):
        self.config = config
        self.services = services

    @contextmanager
    def connection(self):
        with storage.connect(row_factory=dict_row) as conn:
            yield conn

    def init(self):
        with self.connection() as conn:
            self.lock(conn)
            key = (
                self.config.identity,
                self.config.rag_dimensions,
                self.config.collection,
            )
            conn.execute(
                "INSERT INTO rag_index (model,dimensions,collection) VALUES (%s,%s,%s) "
                "ON CONFLICT DO NOTHING",
                key,
            )
            self.check_index(conn)

    def check_index(self, conn):
        row = conn.execute(
            "SELECT model, dimensions, collection FROM rag_index"
        ).fetchone()
        if not row or tuple(row.values()) != (
            self.config.identity,
            self.config.rag_dimensions,
            self.config.collection,
        ):
            raise Rejected("index_configuration_mismatch")

    def lock(self, conn):
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (LOCK,))

    def scan(self, prefix, root, fingerprints):
        counts = {"files": 0, "queued": 0, "skipped": 0, "read_errors": 0}
        if not root.is_dir() or root.resolve() != root:
            raise Rejected("source_root_unavailable")

        def read_error(_):
            counts["read_errors"] += 1

        processed = set()
        try:
            for directory, dirs, files in os.walk(
                root, followlinks=False, onerror=read_error
            ):
                dirs[:] = sorted(name for name in dirs if not name.startswith("."))
                for filename in sorted(files):
                    path = Path(directory) / filename
                    if filename.startswith(".") or path.suffix.lower() not in SUFFIXES:
                        continue
                    name = path.relative_to(root).as_posix()
                    key = prefix + "/" + name
                    if counts["files"] >= 4000:
                        counts["skipped"] += 1
                        return counts
                    counts["files"] += 1
                    try:
                        before = path.lstat()
                        if not stat.S_ISREG(before.st_mode):
                            continue
                        stamp = (
                            before.st_dev,
                            before.st_ino,
                            before.st_size,
                            before.st_ctime_ns,
                        )
                        processed.add(key)
                        if fingerprints.get(key) == stamp:
                            continue
                        with (
                            upload_guard(root) if prefix == "upload" else nullcontext()
                        ):
                            digest, _ = fingerprint(root, name)
                            counts["queued"] += self.enqueue(key, digest)
                        fingerprints[key] = stamp
                    except Rejected:
                        counts["skipped"] += 1
                    except (OSError, Temporary):
                        counts["read_errors"] += 1
        finally:
            for key in tuple(fingerprints):
                if key.startswith(prefix + "/") and key not in processed:
                    del fingerprints[key]
        return counts

    def enqueue(self, name, digest):
        with self.connection() as conn:
            row = conn.execute(
                """
                INSERT INTO rag_jobs (path,digest,state)
                VALUES (%s,%s,'pending')
                ON CONFLICT (path) DO UPDATE SET digest=EXCLUDED.digest, state='pending',
                    attempts=0, available_at=now(), lease_token=NULL, lease_until=NULL, error_code=NULL
                WHERE rag_jobs.digest <> EXCLUDED.digest
                RETURNING path
            """,
                (relative(name), digest),
            ).fetchone()
            return row is not None

    def set_worker(self, phase, detail=None):
        with self.connection() as conn:
            row = conn.execute(
                """
                INSERT INTO rag_worker (phase, detail) VALUES (%s,%s)
                ON CONFLICT (singleton) DO UPDATE SET phase=EXCLUDED.phase, detail=EXCLUDED.detail, heartbeat=now()
                RETURNING paused
            """,
                (phase, detail),
            ).fetchone()
            return row["paused"]

    def pause(self, paused):
        with self.connection() as conn:
            conn.execute(
                """
                INSERT INTO rag_worker (phase, paused) VALUES ('starting',%s)
                ON CONFLICT (singleton) DO UPDATE SET paused=EXCLUDED.paused
            """,
                (paused,),
            )

    def request_repair(self):
        with self.connection() as conn:
            conn.execute("""
                INSERT INTO rag_worker(phase, repair_requested) VALUES ('starting', true)
                ON CONFLICT (singleton) DO UPDATE SET repair_requested=true
            """)

    def claim_repair(self):
        with self.connection() as conn:
            return bool(
                conn.execute("""
                UPDATE rag_worker SET repair_requested=false
                WHERE repair_requested=true RETURNING singleton
            """).fetchone()
            )

    def list_documents(self, after="", query=""):
        with self.connection() as conn:
            return conn.execute(
                """
                SELECT j.path, j.digest, j.state, j.attempts, j.error_code, d.indexed_at,
                       d.digest AS indexed_digest, (SELECT count(*) FROM rag_chunks c WHERE c.path=j.path) AS chunks
                FROM rag_jobs j LEFT JOIN rag_documents d USING (path)
                WHERE j.path > %s AND strpos(lower(j.path),lower(%s)) > 0 ORDER BY j.path LIMIT 101
            """,
                (after, query),
            ).fetchall()

    def claim(self):
        token = uuid.uuid4()
        with self.connection() as conn:
            conn.execute(
                """
                UPDATE rag_jobs SET state='failed', error_code='lease_expired',
                    lease_until=NULL, lease_token=NULL
                WHERE state='running' AND attempts >= %s AND lease_until <= now()
            """,
                (MAX_ATTEMPTS,),
            )
            row = conn.execute(
                """
                WITH candidate AS (
                    SELECT path FROM rag_jobs
                    WHERE (state='pending' AND available_at <= now()
                           OR state='running' AND lease_until <= now()) AND attempts < %s
                    ORDER BY available_at, path FOR UPDATE SKIP LOCKED LIMIT 1
                )
                UPDATE rag_jobs j SET state='running', attempts=j.attempts+1,
                    lease_token=%s, lease_until=now()+interval '5 minutes'
                FROM candidate WHERE j.path=candidate.path RETURNING j.path, j.digest, j.attempts
            """,
                (MAX_ATTEMPTS, token),
            ).fetchone()
        return Job(row["path"], row["digest"], token, row["attempts"]) if row else None

    def fail(self, job, code, retry):
        state = "pending" if retry and job.attempts < MAX_ATTEMPTS else "failed"
        delay = min(300, 5 * 2 ** (job.attempts - 1))
        with self.connection() as conn:
            conn.execute(
                """
                UPDATE rag_jobs SET state=%s, error_code=%s, lease_until=NULL, lease_token=NULL,
                    available_at=now()+%s*interval '1 second'
                WHERE path=%s AND lease_token=%s
            """,
                (state, code, delay, job.path, job.token),
            )
        return state

    def retry(self, name, *, reindex=False):
        with self.connection() as conn:
            return (
                conn.execute(
                    """
                UPDATE rag_jobs SET state='pending', attempts=0, available_at=now(), error_code=NULL
                WHERE path=%s AND (state='failed' OR (%s AND state='done'))
            """,
                    (relative(name), reindex),
                ).rowcount
                == 1
            )

    def status(self):
        with self.connection() as conn:
            result = conn.execute(
                "SELECT state, count(*) AS count FROM rag_jobs GROUP BY state"
            ).fetchall()
            errors = conn.execute("""
                SELECT error_code, count(*) AS count FROM rag_jobs WHERE error_code IS NOT NULL GROUP BY error_code
            """).fetchall()
            total = conn.execute(
                "SELECT count(*) AS count FROM rag_documents"
            ).fetchone()["count"]
            worker = conn.execute(
                "SELECT heartbeat, phase, detail, paused, repair_requested, "
                "heartbeat > now() - interval '240 seconds' AS alive FROM rag_worker"
            ).fetchone()
        return {
            "documents": total,
            "worker": worker,
            "jobs": {row["state"]: row["count"] for row in result},
            "errors": {row["error_code"]: row["count"] for row in errors},
        }

    def renew(self, job):
        with self.connection() as conn:
            result = conn.execute(
                """
                UPDATE rag_jobs SET lease_until=clock_timestamp()+interval '5 minutes'
                WHERE path=%s AND lease_token=%s AND lease_until > clock_timestamp()
            """,
                (job.path, job.token),
            )
            if result.rowcount != 1:
                raise LeaseLost

    def process(self, roots, job):
        renewed_at = time.monotonic()

        def heartbeat():
            nonlocal renewed_at
            if time.monotonic() - renewed_at >= 35:
                self.renew(job)
                self.set_worker("processing")
                renewed_at = time.monotonic()

        try:
            source, name = job.path.split("/", 1)
            root = roots.get(source)
            if root is None or root.resolve() != root:
                raise Rejected("source_root_unavailable")
            digest, data = fingerprint(root, name, load=True)
            if digest != job.digest:
                raise Rejected("source_changed_rescan")
            suffix = Path(name).suffix.lower()
            try:
                process = subprocess.run(
                    [
                        sys.executable,
                        "-m",
                        "trc.rag.parse_worker",
                        suffix,
                        self.config.rag_ocr_language,
                        "docling" if self.config.rag_docling else "native",
                    ],
                    input=data,
                    capture_output=True,
                    timeout=205,
                    check=True,
                )
                parsed = json.loads(process.stdout)
            except (subprocess.SubprocessError, ValueError):
                raise Rejected("parser_limits") from None
            if "error" in parsed:
                raise Rejected(parsed["error"])
            material = parsed["chunks"]
            if (
                self.services.profile_enabled("docling")
                and suffix == ".pdf"
                and material
                and all(row["kind"] != "ocr" for row in material)
            ):
                decoded = self.services.docling(Path(name).name, data)
                material = list(chunks(markdown(decoded)))
                if len(material) > MAX_CHUNKS:
                    raise Rejected("chunk_count")
            if not material:
                raise Rejected("empty_extraction")
            self.renew(job)
            renewed_at = time.monotonic()
            self.set_worker("embedding")
            embeddings = self.services.embeddings(
                [item["heading"] + "\n" + item["text"] for item in material],
                heartbeat=heartbeat,
            )
            records = [
                {
                    "id": uuid.uuid5(NAMESPACE, f"{job.path}\0{digest}\0{ordinal}"),
                    "path": job.path,
                    "ordinal": ordinal,
                    "body": item.pop("text"),
                    "meta": item,
                    "embedding": vector,
                }
                for ordinal, (item, vector) in enumerate(
                    zip(material, embeddings, strict=True)
                )
            ]
            self.services.initialize()
            return self.commit(job, records)
        except LeaseLost:
            return "lease_lost"
        except Rejected as error:
            return self.fail(job, str(error), False)
        except (OSError, Temporary, psycopg.Error) as error:
            code = (
                str(error)
                if isinstance(error, Temporary)
                else "source_io"
                if isinstance(error, OSError)
                else "database"
            )
            return self.fail(job, code, True)
        except Exception:  # noqa: BLE001 - parser/provider internals may contain private text.
            return self.fail(job, "extract_error", False)

    def commit(self, job, records):
        with self.connection() as conn:
            self.lock(conn)
            self.check_index(conn)
            current = conn.execute(
                """
                SELECT 1 FROM rag_jobs WHERE path=%s AND lease_token=%s AND lease_until > clock_timestamp() FOR UPDATE
            """,
                (job.path, job.token),
            ).fetchone()
            if not current:
                return "lease_lost"
            old = conn.execute(
                "SELECT id FROM rag_chunks WHERE path=%s", (job.path,)
            ).fetchall()
            self.services.put(records)
            conn.execute(
                """
                INSERT INTO rag_documents(path,digest) VALUES (%s,%s)
                ON CONFLICT (path) DO UPDATE SET digest=EXCLUDED.digest,indexed_at=now()
            """,
                (job.path, job.digest),
            )
            conn.execute("DELETE FROM rag_chunks WHERE path=%s", (job.path,))
            with conn.cursor() as cursor:
                cursor.executemany(
                    """
                    INSERT INTO rag_chunks(id,path,ordinal,body,meta,embedding)
                    VALUES (%(id)s,%(path)s,%(ordinal)s,%(body)s,%(meta)s,%(embedding)s)
                """,
                    [{**record, "meta": Jsonb(record["meta"])} for record in records],
                )
            conn.execute(
                """
                UPDATE rag_jobs SET state='done',lease_until=NULL,lease_token=NULL,error_code=NULL
                WHERE path=%s
            """,
                (job.path,),
            )
        self.prune([row["id"] for row in old])
        return "done"

    def prune(self, candidates):
        if candidates:
            try:
                with self.connection() as conn:
                    self.lock(conn)
                    active = conn.execute(
                        "SELECT id FROM rag_chunks WHERE id=ANY(%s)", (candidates,)
                    ).fetchall()
                    self.services.remove(
                        sorted(set(candidates) - {row["id"] for row in active})
                    )
            except (Temporary, psycopg.Error):
                pass  # Reconciliation handles stale points; PostgreSQL has already committed.

    def reconcile(self, repair=False):
        with self.connection() as conn:
            self.lock(conn)
            self.check_index(conn)
            if repair:
                self.services.initialize()
            active = {
                str(row["id"]) for row in conn.execute("SELECT id FROM rag_chunks")
            }
            vectors = set(self.services.point_ids())
            missing, stale = sorted(active - vectors), sorted(vectors - active)
            if repair:
                for start in range(0, len(missing), 64):
                    batch = [uuid.UUID(value) for value in missing[start : start + 64]]
                    records = conn.execute(
                        "SELECT id, path, embedding FROM rag_chunks WHERE id=ANY(%s)",
                        (batch,),
                    )
                    self.services.put(list(records))
                for start in range(0, len(stale), 64):
                    self.services.remove(stale[start : start + 64])
        return {
            "active": len(active),
            "missing": len(missing),
            "stale": len(stale),
            "repair_requested": repair,
        }

    def lookup(self, question, prefix, limit):
        terms = list(
            dict.fromkeys(
                word
                for word in words(question.casefold())
                if word.isalnum() and word not in STOPWORDS and len(word) >= 2
            )
        )[:32]
        dense = []
        dense_available = True
        try:
            (vector,) = self.services.embeddings([question])
            dense = self.services.search(vector, min(100, limit * 4), prefix)
        except Temporary:
            dense_available = False
        uuids = [uuid.UUID(point) for point in dense]
        with self.connection() as conn:
            self.check_index(conn)
            sparse = conn.execute(
                """
                WITH wanted AS (
                    SELECT to_tsquery('simple', string_agg(quote_literal(term), ' | ')) AS query
                    FROM unnest(%s::text[]) AS words(term)
                )
                SELECT c.id,c.path,c.body,c.meta FROM rag_chunks c CROSS JOIN wanted w
                WHERE c.terms @@ w.query AND (%s='' OR c.path=%s OR starts_with(c.path,%s||'/'))
                ORDER BY ts_rank_cd(c.terms,w.query) DESC, c.id LIMIT %s
            """,
                (terms, prefix, prefix, prefix, limit * 4),
            ).fetchall()
            fetched = conn.execute(
                """
                SELECT id,path,body,meta FROM rag_chunks
                WHERE id=ANY(%s::uuid[]) AND (%s='' OR path=%s OR starts_with(path,%s||'/'))
            """,
                (uuids, prefix, prefix, prefix),
            ).fetchall()
        indexed = {row["id"]: row for row in fetched}
        # Discard stale points before ranking; source visibility comes from SQL.
        ordered_dense = [indexed[uid] for uid in uuids if uid in indexed]
        return fuse(ordered_dense, sparse, limit), dense_available


def fuse(dense, sparse, limit):
    scores, records = {}, {}
    for route in (dense, sparse):
        for place, hit in enumerate(route, 1):
            uid = hit["id"]
            scores[uid] = scores.get(uid, 0.0) + 1 / (60 + place)
            records[uid] = hit
    available = sorted(scores, key=lambda uid: (-scores[uid], str(uid)))
    return [records[uid] for uid in available[:limit]]
