"""Isolated, bounded document parser. The worker owns files and publication."""

import fcntl
import json
import os
import resource
import sys

from .extract import MAX_BYTES, Rejected, chunks, extract

MAX_CHUNKS = 900


def main():
    resource.setrlimit(resource.RLIMIT_AS, (1024**3, 1024**3))
    resource.setrlimit(resource.RLIMIT_CPU, (180, 185))
    os.environ["OMP_THREAD_LIMIT"] = "1"
    data = sys.stdin.buffer.read(MAX_BYTES + 1)
    try:
        if len(data) > MAX_BYTES:
            raise Rejected("file_size")
        rows = []
        for row in chunks(
            extract(data, sys.argv[1], sys.argv[2], docling=sys.argv[3] == "docling")
        ):
            if len(rows) >= MAX_CHUNKS:
                raise Rejected("chunk_count")
            rows.append(row)
        return {"chunks": rows}
    except Rejected as exc:
        return {"error": str(exc)}
    except Exception:  # noqa: BLE001 - malformed documents can contain private text.
        return {"error": "invalid_document"}


if __name__ == "__main__":
    with open("/data/config/.document-parser.lock", "a", encoding="utf-8") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        print(json.dumps(main(), ensure_ascii=False))
