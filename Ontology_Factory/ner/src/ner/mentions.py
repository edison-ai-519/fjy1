from __future__ import annotations

from pydantic import BaseModel


class RawEntityMention(BaseModel):
    text: str
    label: str
    start: int
    end: int
    confidence: float | None = None
