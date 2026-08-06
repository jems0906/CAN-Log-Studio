from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class SessionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    source_filename: str
    mapping_filename: str | None
    frame_count: int
    id_count: int
    error_count: int
    suspicious_count: int
    duration_seconds: float
    notes: str


class FrameOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    position: int
    timestamp: float
    can_id: str
    dlc: int
    data_hex: str
    raw_line: str
    is_error_frame: bool
    decoded_values: dict[str, Any]


class SessionDetail(SessionSummary):
    grouped_frames: list[dict[str, Any]]
    signal_series: dict[str, list[dict[str, Any]]]
    anomalies: list[dict[str, Any]]
    frames: list[FrameOut]
