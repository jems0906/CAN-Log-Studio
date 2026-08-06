from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from .can_parser import FrameRecord
from .can_utils import normalize_can_id


DEFAULT_MAPPING = {
    "messages": {
        "0x100": {
            "name": "Vehicle Speed",
            "signals": [
                {"name": "speed_kph", "start_byte": 0, "length": 2, "factor": 0.1, "offset": 0.0, "unit": "kph"},
            ],
        },
        "0x101": {
            "name": "Steering Angle",
            "signals": [
                {"name": "steering_deg", "start_byte": 0, "length": 2, "factor": 0.1, "offset": 0.0, "unit": "deg", "signed": True},
            ],
        },
        "0x102": {
            "name": "Brake Pressure",
            "signals": [
                {"name": "brake_pct", "start_byte": 0, "length": 1, "factor": 0.5, "offset": 0.0, "unit": "%"},
            ],
        },
        "0x103": {
            "name": "Throttle Position",
            "signals": [
                {"name": "throttle_pct", "start_byte": 0, "length": 1, "factor": 0.5, "offset": 0.0, "unit": "%"},
            ],
        },
    }
}


@dataclass(slots=True)
class DecodedSignal:
    name: str
    value: float
    unit: str


def load_mapping_text(mapping_text: str | None) -> dict[str, Any]:
    if not mapping_text or not mapping_text.strip():
        return DEFAULT_MAPPING

    payload = json.loads(mapping_text)
    if "messages" in payload:
        return payload

    if "frames" in payload:
        messages: dict[str, Any] = {}
        for key, value in payload["frames"].items():
            messages[normalize_can_id(key)] = value
        payload["messages"] = messages
        return payload

    return {"messages": payload}


def message_map(mapping: dict[str, Any]) -> dict[str, dict[str, Any]]:
    messages = mapping.get("messages", {})
    normalized: dict[str, dict[str, Any]] = {}
    for key, value in messages.items():
        normalized[normalize_can_id(key)] = value
    return normalized


def decode_frame(frame: FrameRecord, mapping: dict[str, Any]) -> dict[str, float | int | str]:
    decoded: dict[str, float | int | str] = {}
    message = message_map(mapping).get(frame.can_id)
    if not message:
        return decoded

    for signal in message.get("signals", []):
        value = _decode_signal(frame.data, signal)
        if value is None:
            continue
        decoded[signal.get("name", "signal")] = value
    return decoded


def _decode_signal(payload: bytes, signal: dict[str, Any]) -> float | None:
    start_byte = int(signal.get("start_byte", 0))
    length = int(signal.get("length", 1))
    if length <= 0 or start_byte < 0:
        return None

    segment = payload[start_byte : start_byte + length]
    if len(segment) < length:
        return None

    byte_order = str(signal.get("byte_order", "little")).lower()
    signed = bool(signal.get("signed", False))
    factor = float(signal.get("factor", 1.0))
    offset = float(signal.get("offset", 0.0))
    raw_value = int.from_bytes(segment, byteorder=byte_order, signed=signed)
    return raw_value * factor + offset
