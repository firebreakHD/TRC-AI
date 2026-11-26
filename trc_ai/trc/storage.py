import hashlib
import json
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"


class IdempotencyConflict(Exception):
    pass


def connect():
    return psycopg.connect(
        host="/run/postgresql",
        dbname="trc",
        user="trc",
        connect_timeout=2,
        options="-c statement_timeout=4000 -c lock_timeout=2000",
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
