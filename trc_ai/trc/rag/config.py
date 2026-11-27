"""Validated start options and document source roots."""

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from ..settings import OPTIONS

UPLOADS = Path("/data/documents")
SHARE = Path("/share")
MAX_BYTES = 32 * 1024**2


class Config(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    rag_pg_buffers_mib: int = Field(default=256, ge=64, le=512)
    rag_embed_model: str = Field(
        default="bge-m3", pattern=r"^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$"
    )
    rag_dimensions: int = Field(default=1024, ge=64, le=4096)
    rag_embed_batch: int = Field(default=4, ge=1, le=16)
    rag_chat_provider: Literal["ollama", "openai_compatible"] = "ollama"
    rag_chat_model: str = Field(
        default="", max_length=120, pattern=r"^[a-zA-Z0-9._:/-]*$"
    )
    rag_context: int = Field(default=4096, ge=1024, le=16384)
    rag_answer_tokens: int = Field(default=350, ge=64, le=1200)
    rag_ocr_language: Literal["deu+eng", "deu", "eng"] = "deu+eng"
    rag_docling: bool = True
    rag_rerank_candidates: int = Field(default=12, ge=3, le=30)
    rag_shared_dir: str = Field(default="", max_length=160)
    rag_poll_seconds: int = Field(default=45, ge=10, le=3600)
    rag_upload_mib: int = Field(default=20, ge=1, le=32)
    rag_upload_quota_mib: int = Field(default=1024, ge=32, le=8192)

    @field_validator("rag_shared_dir")
    @classmethod
    def validate_share(cls, value):
        if value and (
            value.startswith("/")
            or "\\" in value
            or any(
                not part or part in {".", ".."} or part.startswith(".")
                for part in value.split("/")
            )
            or any(ord(c) < 32 or ord(c) == 127 for c in value)
        ):
            raise ValueError("Relativen Unterordner von /share angeben")
        return value

    @property
    def identity(self):
        return f"ollama:{self.rag_embed_model}"

    @property
    def collection(self):
        return "trc_knowledge_v1"

    def source_roots(self):
        roots = {"upload": UPLOADS}
        if self.rag_shared_dir:
            roots["local"] = SHARE / self.rag_shared_dir
        return roots


def load():
    try:
        return Config.model_validate_json(OPTIONS.read_bytes())
    except FileNotFoundError:
        return Config()
    except ValidationError:
        raise ValueError(
            "Add-on-Optionen für die Wissensdatenbank sind ungültig."
        ) from None
