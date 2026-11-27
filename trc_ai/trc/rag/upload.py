"""Bounded, atomic replacement in the private document inbox."""

import os
import stat
from pathlib import Path

from .config import UPLOADS
from .extract import SUFFIXES, Rejected
from .store import relative, upload_guard


class QuotaReached(Exception):
    pass


def filename(value):
    if (
        relative(value) != value
        or "/" in value
        or value.startswith(".")
        or len(value.encode()) > 220
        or Path(value).suffix.lower() not in SUFFIXES
    ):
        raise Rejected("upload_filename")
    return value


def publish(store, staging, name, digest, size, quota):
    target = UPLOADS / name
    with upload_guard(UPLOADS):
        total, count = 0, 0
        for path in UPLOADS.iterdir():
            if path.name.startswith(".") or path == target:
                continue
            file = path.lstat()
            if stat.S_ISREG(file.st_mode):
                total += file.st_size
                count += 1
        if total + size > quota or count >= 4000:
            raise QuotaReached
        os.replace(staging, target)
        fd = os.open(UPLOADS, os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        # A crash before enqueue is recovered by the upload directory watcher.
        queued = store.enqueue("upload/" + name, digest)
    return {"path": "upload/" + name, "sha256": digest, "queued": queued}
