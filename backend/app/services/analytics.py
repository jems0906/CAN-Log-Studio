from __future__ import annotations

from collections import defaultdict
from statistics import mean, pstdev
from typing import Any

from .can_parser import FrameRecord
from .dbc_mapper import decode_frame, message_map


def build_grouped_frames(frames: list[FrameRecord]) -> list[dict[str, Any]]:
    grouped: dict[str, list[FrameRecord]] = defaultdict(list)
    for frame in frames:
        grouped[frame.can_id].append(frame)

    ordered = []
    for can_id, bucket in grouped.items():
        last_frame = bucket[-1]
        ordered.append(
            {
                "can_id": can_id,
                "count": len(bucket),
                "first_seen": bucket[0].timestamp,
                "last_seen": last_frame.timestamp,
                "last_payload": last_frame.data.hex().upper(),
                "last_decoded": last_frame.data.hex().upper(),
                "error_count": sum(1 for frame in bucket if frame.is_error_frame),
            }
        )

    return sorted(ordered, key=lambda item: item["count"], reverse=True)


def build_signal_series(frames: list[FrameRecord], mapping: dict[str, Any]) -> dict[str, list[dict[str, float | str | int]]]:
    message_lookup = message_map(mapping)
    series: dict[str, list[dict[str, float | str | int]]] = defaultdict(list)

    for frame in frames:
        message = message_lookup.get(frame.can_id)
        if not message:
            continue

        decoded = decode_frame(frame, mapping)
        for signal_name, value in decoded.items():
            signal_def = _signal_definition(message, signal_name)
            unit = str(signal_def.get("unit", "")) if signal_def else ""
            series[signal_name].append(
                {
                    "timestamp": frame.timestamp,
                    "value": value,
                    "frame_index": frame.index,
                    "can_id": frame.can_id,
                    "unit": unit,
                }
            )

    return dict(series)


def find_anomalies(frames: list[FrameRecord], signal_series: dict[str, list[dict[str, float | str | int]]]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []

    for frame in frames:
        if frame.is_error_frame:
            findings.append(
                {
                    "kind": "error_frame",
                    "timestamp": frame.timestamp,
                    "can_id": frame.can_id,
                    "message": "Parser flagged the frame as an error frame.",
                    "severity": "high",
                }
            )

    for signal_name, points in signal_series.items():
        if len(points) < 3:
            continue

        values = [float(point["value"]) for point in points]
        baseline = mean(values)
        spread = pstdev(values) if len(values) > 1 else 0.0
        threshold = _signal_threshold(signal_name)

        for previous, current in zip(points, points[1:]):
            delta = float(current["value"]) - float(previous["value"])
            if abs(delta) < threshold and (spread <= 0 or abs(float(current["value"]) - baseline) <= 3 * spread):
                continue

            findings.append(
                {
                    "kind": "signal_spike",
                    "timestamp": current["timestamp"],
                    "can_id": current["can_id"],
                    "signal": signal_name,
                    "previous_value": previous["value"],
                    "current_value": current["value"],
                    "delta": delta,
                    "message": f"{signal_name} changed by {delta:.2f} beyond the expected range.",
                    "severity": "medium",
                }
            )

    return sorted(findings, key=lambda item: float(item["timestamp"]))


def search_frames(frames: list[FrameRecord], query: str) -> list[FrameRecord]:
    needle = query.strip().lower()
    if not needle:
        return frames

    matched = []
    for frame in frames:
        decoded_text = jsonish(frame.data)
        haystack = " ".join((frame.can_id, frame.raw_line, decoded_text)).lower()
        if needle in haystack:
            matched.append(frame)
    return matched


def _signal_definition(message: dict[str, Any], signal_name: str) -> dict[str, Any] | None:
    for signal in message.get("signals", []):
        if signal.get("name") == signal_name:
            return signal
    return None


def _signal_threshold(signal_name: str) -> float:
    lowered = signal_name.lower()
    if "speed" in lowered:
        return 12.0
    if "steer" in lowered:
        return 10.0
    if "brake" in lowered:
        return 20.0
    if "throttle" in lowered:
        return 18.0
    return 25.0


def jsonish(payload: bytes) -> str:
    return payload.hex().upper()
