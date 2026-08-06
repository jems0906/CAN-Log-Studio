from __future__ import annotations

import csv
import io
import json
import re
from dataclasses import dataclass
from typing import Iterable

from .can_utils import bytes_to_hex, normalize_can_id, payload_from_text, payload_from_tokens


@dataclass(slots=True)
class FrameRecord:
    index: int
    timestamp: float
    can_id: str
    dlc: int
    data: bytes
    raw_line: str
    is_error_frame: bool = False


_CANDUMP_HASH = re.compile(r"^(?P<can_id>[0-9A-Fa-f]+)#(?P<data>[0-9A-Fa-f]*)$")
_CANDUMP_SPACED = re.compile(
    r"^(?P<can_id>[0-9A-Fa-f]+)\s*\[(?P<dlc>\d+)\]\s*(?P<data>.*)$"
)
_CANDUMP_PIPE = re.compile(
    r"^(?P<timestamp>[0-9]+(?:\.[0-9]+)?)\s*[|,]\s*(?P<can_id>[0-9A-Fa-fx]+)\s*[|,]\s*(?P<data>.*)$"
)
_CANDUMP_IFACE_HASH = re.compile(
    r"^(?P<iface>\S+)\s+(?P<can_id>[0-9A-Fa-fx]+)#(?P<data>[0-9A-Fa-f]*)$"
)
_CANDUMP_IFACE_SPACED = re.compile(
    r"^(?P<iface>\S+)\s+(?P<can_id>[0-9A-Fa-fx]+)\s*\[(?P<dlc>\d+)\]\s*(?P<data>.*)$"
)


def parse_uploaded_log(log_text: str, filename: str) -> list[FrameRecord]:
    trimmed = log_text.lstrip()
    if filename.lower().endswith(".json") or trimmed.startswith("[") or trimmed.startswith("{"):
        return _parse_json_frames(log_text)

    if "," in log_text.splitlines()[0] if log_text.splitlines() else False:
        csv_frames = _parse_csv_frames(log_text)
        if csv_frames:
            return csv_frames

    return _parse_candump_frames(log_text)


def _parse_json_frames(log_text: str) -> list[FrameRecord]:
    payload = json.loads(log_text)
    items = payload.get("frames", payload) if isinstance(payload, dict) else payload
    frames: list[FrameRecord] = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        timestamp = float(item.get("timestamp", index * 0.05))
        can_id = normalize_can_id(str(item.get("can_id", item.get("id", "0x0"))))
        data = payload_from_text(str(item.get("data", item.get("payload", ""))))
        dlc = int(item.get("dlc", len(data)))
        frames.append(
            FrameRecord(
                index=index,
                timestamp=timestamp,
                can_id=can_id,
                dlc=dlc,
                data=data,
                raw_line=json.dumps(item, sort_keys=True),
                is_error_frame=bool(item.get("error", False)),
            )
        )
    return _finalize_frames(frames)


def _parse_csv_frames(log_text: str) -> list[FrameRecord]:
    frames: list[FrameRecord] = []
    reader = csv.DictReader(io.StringIO(log_text))
    for index, row in enumerate(reader):
        timestamp = _first_float(row, ("timestamp", "time", "ts", "seconds"), default=index * 0.05)
        can_id = normalize_can_id(_first_value(row, ("can_id", "id", "arb_id", "message_id"), default="0x0"))
        data_text = _first_value(row, ("data", "payload", "bytes", "frame"), default="")
        data = payload_from_text(data_text) if any(ch in data_text for ch in (" ", ":")) else payload_from_text(data_text)
        dlc = int(_first_value(row, ("dlc", "length"), default=str(len(data))))
        is_error = _first_value(row, ("error", "is_error"), default="false").lower() in {"1", "true", "yes"}
        frames.append(
            FrameRecord(
                index=index,
                timestamp=timestamp,
                can_id=can_id,
                dlc=dlc,
                data=data,
                raw_line=",".join(f"{key}={value}" for key, value in row.items()),
                is_error_frame=is_error,
            )
        )
    return _finalize_frames(frames)


def _parse_candump_frames(log_text: str) -> list[FrameRecord]:
    frames: list[FrameRecord] = []
    for index, raw_line in enumerate(line.strip() for line in log_text.splitlines() if line.strip()):
        if raw_line.upper().startswith(("ERROR", "ERR", "CAN ERROR")):
            frames.append(
                FrameRecord(
                    index=index,
                    timestamp=index * 0.05,
                    can_id="0x0",
                    dlc=0,
                    data=b"",
                    raw_line=raw_line,
                    is_error_frame=True,
                )
            )
            continue

        timestamp = index * 0.05
        candidate = raw_line
        match = re.match(r"^\((?P<timestamp>[0-9]+(?:\.[0-9]+)?)\)\s+(?P<rest>.+)$", raw_line)
        if match:
            timestamp = float(match.group("timestamp"))
            candidate = match.group("rest")

        pipe_match = _CANDUMP_PIPE.match(candidate)
        if pipe_match:
            timestamp = float(pipe_match.group("timestamp"))
            can_id = normalize_can_id(pipe_match.group("can_id"))
            data = payload_from_text(pipe_match.group("data"))
            frames.append(
                FrameRecord(
                    index=index,
                    timestamp=timestamp,
                    can_id=can_id,
                    dlc=len(data),
                    data=data,
                    raw_line=raw_line,
                )
            )
            continue

        iface_hash_match = _CANDUMP_IFACE_HASH.match(candidate)
        if iface_hash_match:
            can_id = normalize_can_id(iface_hash_match.group("can_id"))
            data = payload_from_text(iface_hash_match.group("data"))
            frames.append(
                FrameRecord(
                    index=index,
                    timestamp=timestamp,
                    can_id=can_id,
                    dlc=len(data),
                    data=data,
                    raw_line=raw_line,
                )
            )
            continue

        hash_match = _CANDUMP_HASH.match(candidate.replace(" ", ""))
        if hash_match:
            can_id = normalize_can_id(hash_match.group("can_id"))
            data = payload_from_text(hash_match.group("data"))
            frames.append(
                FrameRecord(
                    index=index,
                    timestamp=timestamp,
                    can_id=can_id,
                    dlc=len(data),
                    data=data,
                    raw_line=raw_line,
                )
            )
            continue

        spaced_match = _CANDUMP_SPACED.match(candidate)
        if spaced_match:
            can_id = normalize_can_id(spaced_match.group("can_id"))
            payload_tokens = spaced_match.group("data").split()
            data = payload_from_tokens(payload_tokens[: int(spaced_match.group("dlc"))])
            frames.append(
                FrameRecord(
                    index=index,
                    timestamp=timestamp,
                    can_id=can_id,
                    dlc=len(data),
                    data=data,
                    raw_line=raw_line,
                )
            )
            continue

        iface_spaced_match = _CANDUMP_IFACE_SPACED.match(candidate)
        if iface_spaced_match:
            can_id = normalize_can_id(iface_spaced_match.group("can_id"))
            payload_tokens = iface_spaced_match.group("data").split()
            data = payload_from_tokens(payload_tokens[: int(iface_spaced_match.group("dlc"))])
            frames.append(
                FrameRecord(
                    index=index,
                    timestamp=timestamp,
                    can_id=can_id,
                    dlc=len(data),
                    data=data,
                    raw_line=raw_line,
                )
            )
            continue

        parts = raw_line.split()
        if len(parts) >= 3:
            timestamp = _maybe_float(parts[0], default=timestamp)
            can_id = normalize_can_id(parts[1])
            payload_parts = parts[3:] if len(parts) > 3 and parts[2].startswith("[") else parts[2:]
            if payload_parts and payload_parts[0].startswith("[") and payload_parts[0].endswith("]"):
                payload_parts = payload_parts[1:]
            data = payload_from_tokens(payload_parts)
            frames.append(
                FrameRecord(
                    index=index,
                    timestamp=timestamp,
                    can_id=can_id,
                    dlc=len(data),
                    data=data,
                    raw_line=raw_line,
                )
            )
            continue

        frames.append(
            FrameRecord(
                index=index,
                timestamp=timestamp,
                can_id="0x0",
                dlc=0,
                data=b"",
                raw_line=raw_line,
                is_error_frame=True,
            )
        )
    return _finalize_frames(frames)


def _finalize_frames(frames: list[FrameRecord]) -> list[FrameRecord]:
    sorted_frames = sorted(frames, key=lambda item: (item.timestamp, item.index))
    for index, frame in enumerate(sorted_frames):
        frame.index = index
    return sorted_frames


def _first_value(row: dict[str, str], keys: Iterable[str], default: str) -> str:
    for key in keys:
        value = row.get(key)
        if value not in (None, ""):
            return value
    return default


def _first_float(row: dict[str, str], keys: Iterable[str], default: float) -> float:
    for key in keys:
        value = row.get(key)
        if value not in (None, ""):
            return _maybe_float(value, default)
    return default


def _maybe_float(value: str, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default
