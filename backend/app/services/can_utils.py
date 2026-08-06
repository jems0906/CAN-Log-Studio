from __future__ import annotations

from typing import Iterable


def normalize_can_id(value: str | int) -> str:
    if isinstance(value, int):
        return f"0x{value:X}"

    cleaned = value.strip().lower()
    if cleaned.startswith("0x"):
        cleaned = cleaned[2:]

    if not cleaned:
        return "0x0"

    try:
        parsed = int(cleaned, 16)
    except ValueError:
        parsed = int(cleaned)

    return f"0x{parsed:X}"


def bytes_to_hex(payload: bytes) -> str:
    return payload.hex().upper()


def payload_from_tokens(tokens: Iterable[str]) -> bytes:
    values = []
    for token in tokens:
        cleaned = token.strip()
        if not cleaned:
            continue
        values.append(int(cleaned, 16))
    return bytes(values)


def payload_from_text(text: str) -> bytes:
    compact = text.strip().replace(" ", "").replace(":", "")
    if not compact:
        return b""
    if len(compact) % 2:
        compact = "0" + compact
    return bytes.fromhex(compact)
