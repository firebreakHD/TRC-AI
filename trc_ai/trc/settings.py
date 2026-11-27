import json
import os
from pathlib import Path
import re
import tempfile

from pydantic import BaseModel, ConfigDict, Field

TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{32,128}", re.ASCII)
OPTIONS = Path("/run/trc/options.json")
PREFERENCES = Path("/data/config/control-center.json")


class Preferences(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    schema_version: int = Field(default=1, ge=1, le=1)
    refresh_seconds: int = Field(default=15, ge=5, le=120, title="Aktualisierungsintervall",
                                 description="Abstand zwischen Statusabfragen in Sekunden.")


def load_tokens():
    options = json.loads(OPTIONS.read_text())
    admin = options.get("admin_token", "")
    workflow = options.get("workflow_token", "")
    chat = options.get("chat_token", "")
    return (
        admin if isinstance(admin, str) and TOKEN_PATTERN.fullmatch(admin) else None,
        workflow if isinstance(workflow, str) and workflow != admin
        and TOKEN_PATTERN.fullmatch(workflow) else None,
        chat if isinstance(chat, str) and chat not in (admin, workflow) and TOKEN_PATTERN.fullmatch(chat) else None,
    )


def load_preferences():
    try:
        return Preferences.model_validate_json(PREFERENCES.read_bytes())
    except FileNotFoundError:
        return Preferences()


def save_preferences(preferences):
    fd, name = tempfile.mkstemp(dir=PREFERENCES.parent, prefix=".control-center.")
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(preferences.model_dump_json())
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, PREFERENCES)
        directory = os.open(PREFERENCES.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(name).unlink(missing_ok=True)
