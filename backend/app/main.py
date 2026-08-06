from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import desc
from sqlalchemy.orm import selectinload

from .database import Base, SessionLocal, engine
from .models import CanFrame, UploadSession
from .schemas import FrameOut, SessionDetail, SessionSummary
from .services.analytics import build_grouped_frames, build_signal_series, find_anomalies
from .services.can_parser import FrameRecord, parse_uploaded_log
from .services.dbc_mapper import DEFAULT_MAPPING, decode_frame, load_mapping_text


def _find_frontend_dir() -> Path | None:
    candidates = [
        Path(__file__).resolve().parent / "static",
        Path(__file__).resolve().parents[2] / "frontend" / "dist",
    ]
    for candidate in candidates:
        if (candidate / "index.html").exists():
            return candidate
    return None


FRONTEND_DIR = _find_frontend_dir()

app = FastAPI(title="CAN Log Studio API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/sessions", response_model=list[SessionSummary])
def list_sessions() -> list[UploadSession]:
    with SessionLocal() as db:
        return (
            db.query(UploadSession)
            .order_by(desc(UploadSession.created_at))
            .limit(20)
            .all()
        )


@app.get("/api/sessions/{session_id}", response_model=SessionDetail)
def get_session(session_id: int) -> SessionDetail:
    with SessionLocal() as db:
        session = (
            db.query(UploadSession)
            .options(selectinload(UploadSession.frames))
            .filter(UploadSession.id == session_id)
            .one_or_none()
        )
        if session is None:
            raise HTTPException(status_code=404, detail="Session not found")
        return _serialize_session(session)


@app.post("/api/sessions/upload", response_model=SessionDetail)
async def upload_session(
    log_file: UploadFile = File(...),
    mapping_file: UploadFile | None = File(None),
    mapping_text: str = Form(""),
    notes: str = Form(""),
) -> SessionDetail:
    try:
        log_bytes = await log_file.read()
        log_text = log_bytes.decode("utf-8", errors="replace")
        uploaded_mapping_text = mapping_text.strip() if mapping_text.strip() else None

        if mapping_file and mapping_file.filename:
            uploaded_mapping_text = (await mapping_file.read()).decode("utf-8", errors="replace")

        mapping = load_mapping_text(uploaded_mapping_text or json_dump(DEFAULT_MAPPING))
        frames = parse_uploaded_log(log_text, log_file.filename or "can-log.txt")
        if not frames:
            raise HTTPException(status_code=400, detail="The uploaded log did not contain any frames")

        decoded_frames = [decode_frame(frame, mapping) for frame in frames]
        grouped = build_grouped_frames(frames)
        signal_series = build_signal_series(frames, mapping)
        anomalies = find_anomalies(frames, signal_series)
        session_id = _persist_session(
            log_filename=log_file.filename or "can-log.txt",
            mapping_filename=mapping_file.filename if mapping_file else None,
            mapping_text=uploaded_mapping_text or json_dump(DEFAULT_MAPPING),
            notes=notes,
            frames=frames,
            decoded_frames=decoded_frames,
            grouped=grouped,
            anomalies=anomalies,
        )
        return get_session(session_id)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Upload processing failed: {error}") from error


def _persist_session(
    *,
    log_filename: str,
    mapping_filename: str | None,
    mapping_text: str,
    notes: str,
    frames: list[FrameRecord],
    decoded_frames: list[dict[str, Any]],
    grouped: list[dict[str, Any]],
    anomalies: list[dict[str, Any]],
) -> UploadSession:
    with SessionLocal() as db:
        session = UploadSession(
            created_at=datetime.utcnow(),
            source_filename=log_filename,
            mapping_filename=mapping_filename,
            frame_count=len(frames),
            id_count=len({frame.can_id for frame in frames}),
            error_count=sum(1 for frame in frames if frame.is_error_frame),
            suspicious_count=len(anomalies),
            duration_seconds=max(frames[-1].timestamp - frames[0].timestamp, 0.0),
            notes=notes,
            mapping_text=mapping_text,
        )
        db.add(session)
        db.flush()

        for frame, decoded in zip(frames, decoded_frames):
            db.add(
                CanFrame(
                    session_id=session.id,
                    position=frame.index,
                    timestamp=frame.timestamp,
                    can_id=frame.can_id,
                    dlc=frame.dlc,
                    data_hex=frame.data.hex().upper(),
                    raw_line=frame.raw_line,
                    is_error_frame=frame.is_error_frame,
                    decoded_values=decoded,
                )
            )

        db.commit()
        db.refresh(session)
        return session.id


def _serialize_session(session: UploadSession) -> SessionDetail:
    frames = [
        FrameOut(
            position=frame.position,
            timestamp=frame.timestamp,
            can_id=frame.can_id,
            dlc=frame.dlc,
            data_hex=frame.data_hex,
            raw_line=frame.raw_line,
            is_error_frame=frame.is_error_frame,
            decoded_values=frame.decoded_values,
        )
        for frame in session.frames
    ]
    grouped = build_grouped_frames(
        [
            FrameRecord(
                index=frame.position,
                timestamp=frame.timestamp,
                can_id=frame.can_id,
                dlc=frame.dlc,
                data=bytes.fromhex(frame.data_hex),
                raw_line=frame.raw_line,
                is_error_frame=frame.is_error_frame,
            )
            for frame in session.frames
        ]
    )
    mapping = load_mapping_text(session.mapping_text)
    signal_series = build_signal_series(
        [
            FrameRecord(
                index=frame.position,
                timestamp=frame.timestamp,
                can_id=frame.can_id,
                dlc=frame.dlc,
                data=bytes.fromhex(frame.data_hex),
                raw_line=frame.raw_line,
                is_error_frame=frame.is_error_frame,
            )
            for frame in session.frames
        ],
        mapping,
    )
    anomalies = find_anomalies(
        [
            FrameRecord(
                index=frame.position,
                timestamp=frame.timestamp,
                can_id=frame.can_id,
                dlc=frame.dlc,
                data=bytes.fromhex(frame.data_hex),
                raw_line=frame.raw_line,
                is_error_frame=frame.is_error_frame,
            )
            for frame in session.frames
        ],
        signal_series,
    )
    return SessionDetail(
        id=session.id,
        created_at=session.created_at,
        source_filename=session.source_filename,
        mapping_filename=session.mapping_filename,
        frame_count=session.frame_count,
        id_count=session.id_count,
        error_count=session.error_count,
        suspicious_count=session.suspicious_count,
        duration_seconds=session.duration_seconds,
        notes=session.notes,
        grouped_frames=grouped,
        signal_series=signal_series,
        anomalies=anomalies,
        frames=frames,
    )


def json_dump(payload: dict[str, Any]) -> str:
    import json

    return json.dumps(payload, indent=2, sort_keys=True)


@app.get("/", include_in_schema=False)
def serve_frontend_root() -> FileResponse:
    if FRONTEND_DIR is None:
        raise HTTPException(status_code=404, detail="Frontend assets not found")
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/{full_path:path}", include_in_schema=False)
def serve_frontend_asset_or_spa(full_path: str) -> FileResponse:
    if full_path == "api" or full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")
    if FRONTEND_DIR is None:
        raise HTTPException(status_code=404, detail="Frontend assets not found")

    base = FRONTEND_DIR.resolve()
    requested = (base / full_path).resolve()

    try:
        requested.relative_to(base)
    except ValueError as error:
        raise HTTPException(status_code=404, detail="Not found") from error

    if requested.is_file():
        return FileResponse(requested)

    if "." in full_path:
        raise HTTPException(status_code=404, detail="Not found")

    return FileResponse(base / "index.html")
