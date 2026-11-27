"""Single supervised ingest worker and the offline projection repair command."""

import argparse
import fcntl
import logging
import signal
import threading
import time

import psycopg

from .. import storage
from .config import UPLOADS, load
from .extract import Rejected
from .providers import Services, Temporary
from .store import Store

logger = logging.getLogger("trc.knowledge")


def run(store, config, stop):
    fingerprints = {}
    scan_at = 0.0
    detail = None
    while not stop.is_set():
        try:
            if store.set_worker("idle", detail):
                store.set_worker("paused", detail)
                stop.wait(3)
                continue
            if store.claim_repair():
                store.set_worker("repairing")
                try:
                    result = store.reconcile(repair=True)
                    logger.info("Vektorindex abgeglichen: %s", result)
                    detail = None
                except (psycopg.Error, Temporary, Rejected):
                    detail = "projection_repair_failed"
                continue
            roots = config.source_roots()
            if time.monotonic() >= scan_at:
                scan_at = time.monotonic() + config.rag_poll_seconds
                detail = None
                for prefix, root in roots.items():
                    try:
                        counts = store.scan(prefix, root, fingerprints)
                        if counts["read_errors"] or counts["skipped"]:
                            detail = "source_scan_incomplete"
                    except (OSError, Rejected):
                        detail = "source_root_unavailable"
            job = store.claim()
            if job is None:
                stop.wait(2)
                continue
            # The pause applies before the next claim; a claimed job finishes consistently.
            store.set_worker("processing", detail)
            result = store.process(roots, job)
            logger.info("Dokumentauftrag abgeschlossen: %s", result)
        except (psycopg.Error, OSError, Temporary, Rejected):
            logger.warning(
                "Worker kann einen Verarbeitungsschritt derzeit nicht ausführen."
            )
            stop.wait(8)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--reconcile", action="store_true", help="Qdrant aus PostgreSQL reparieren"
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())
    config = load()
    services = Services(config)
    store = Store(config, services)
    try:
        if args.reconcile:
            storage.migrate()
            store.init()
            logger.info("Vektorindex %s", store.reconcile(repair=True))
            return
        with (UPLOADS / ".worker.lock").open("a") as guard:
            fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
            while not stop.is_set():
                try:
                    storage.migrate()
                    store.init()
                    break
                except (psycopg.Error, RuntimeError, Rejected):
                    logger.warning(
                        "Worker wartet auf Datenbank oder kompatible Indexkonfiguration."
                    )
                    stop.wait(8)
            if not stop.is_set():
                run(store, config, stop)
    finally:
        services.close()


if __name__ == "__main__":
    main()
