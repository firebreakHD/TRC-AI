import hashlib
import json
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"


class IdempotencyConflict(Exception):
    pass


def connect(**kwargs):
    return psycopg.connect(
        host="/run/postgresql",
        dbname="trc",
        user="trc",
        connect_timeout=2,
        options="-c statement_timeout=4000 -c lock_timeout=2000",
        **kwargs,
    )


def migrate():
    with connect() as connection:
        connection.execute("SELECT pg_advisory_xact_lock(254875001)")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                name text PRIMARY KEY,
                sha256 text NOT NULL
            )
            """
        )
        applied = dict(connection.execute("SELECT name, sha256 FROM schema_migrations"))
        files = sorted(MIGRATIONS.glob("*.sql"))
        local = {file.name for file in files}
        if applied.keys() - local:
            raise RuntimeError("Datenbankschema benötigt eine neuere TRC-Version.")
        for file in files:
            sql = file.read_bytes()
            digest = hashlib.sha256(sql).hexdigest()
            if file.name in applied:
                if applied[file.name] != digest:
                    raise RuntimeError("Eine bereits ausgeführte Migration wurde verändert.")
                continue
            connection.execute(sql.decode())
            connection.execute("INSERT INTO schema_migrations VALUES (%s, %s)", (file.name, digest))


def database_status():
    with connect() as connection:
        return connection.execute(
            """SELECT current_setting('server_version'), pg_database_size(current_database())"""
        ).fetchone()


def ingest(area, key, batch):
    canonical = json.dumps(
        [area, batch.model_dump(mode="json")], sort_keys=True, ensure_ascii=True,
        separators=(",", ":"), allow_nan=False,
    )
    fingerprint = hashlib.sha256(canonical.encode()).hexdigest()
    with connect() as connection:
        claim = connection.execute(
            """
            INSERT INTO workflow_requests (idempotency_key, fingerprint)
            VALUES (%s, %s) ON CONFLICT DO NOTHING RETURNING idempotency_key
            """,
            (key, fingerprint),
        ).fetchone()
        if not claim:
            previous, result = connection.execute(
                "SELECT fingerprint, result FROM workflow_requests WHERE idempotency_key = %s",
                (key,),
            ).fetchone()
            if previous != fingerprint:
                raise IdempotencyConflict
            return result

        applied = 0
        for record in sorted(batch.records, key=lambda record: record.external_id):
            cursor = connection.execute(
                """
                INSERT INTO workflow_records (area, source, external_id, observed_at, payload)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (area, source, external_id) DO UPDATE SET
                    observed_at = EXCLUDED.observed_at, payload = EXCLUDED.payload
                WHERE EXCLUDED.observed_at > workflow_records.observed_at
                """,
                (area, batch.source, record.external_id, record.observed_at, Jsonb(record.payload)),
            )
            applied += cursor.rowcount
        result = {"applied": applied, "unchanged": len(batch.records) - applied}
        connection.execute(
            "UPDATE workflow_requests SET result = %s WHERE idempotency_key = %s",
            (Jsonb(result), key),
        )
        return result


def list_records(area, source, cursor, limit):
    import base64
    from datetime import datetime

    try:
        boundary = None
        if cursor:
            parts = json.loads(base64.b64decode(cursor, altchars=b"-_", validate=True))
            if not isinstance(parts, list) or len(parts) != 3 or not all(isinstance(item, str) for item in parts):
                raise ValueError
            boundary = (datetime.fromisoformat(parts[0]), parts[1], parts[2])
            if boundary[0].utcoffset() is None or not 1 <= len(parts[1]) <= 64 or not 1 <= len(parts[2]) <= 256:
                raise ValueError
    except (ValueError, TypeError, OverflowError) as error:
        raise ValueError("invalid_cursor") from error

    filters = ["area=%s"]
    params = [area]
    if source:
        filters.append("source=%s")
        params.append(source)
    if boundary:
        filters.append("(observed_at,source,external_id) < (%s,%s,%s)")
        params.extend(boundary)

    # Stream large stored payloads and keep each page under approximately 1 MiB.
    rows = []
    encoded_bytes = 0
    next_cursor = None
    with connect() as conn, conn.cursor(name="trc_read_records") as result:
        result.itersize = 4
        result.execute(
            "SELECT source,external_id,observed_at,payload FROM workflow_records WHERE "
            + " AND ".join(filters) + " ORDER BY observed_at DESC,source DESC,external_id DESC LIMIT %s",
            [*params, limit + 1],
        )
        for row in result:
            source_id, external_id, observed, payload = row
            record = {"source": source_id, "external_id": external_id,
                      "observed_at": observed.isoformat(), "payload": payload}
            size = len(json.dumps(record, ensure_ascii=False).encode())
            if len(rows) >= limit or rows and encoded_bytes + size > 1024**2:
                last = rows[-1]
                value = [last["observed_at"], last["source"], last["external_id"]]
                next_cursor = base64.urlsafe_b64encode(json.dumps(value).encode()).decode()
                break
            rows.append(record)
            encoded_bytes += size
    return {"records": rows, "next": next_cursor}
