from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class UploadSession(Base):
    __tablename__ = "upload_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    source_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mapping_filename: Mapped[str] = mapped_column(String(255), nullable=True)
    frame_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    id_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    suspicious_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    duration_seconds: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    mapping_text: Mapped[str] = mapped_column(Text, nullable=False)

    frames: Mapped[list["CanFrame"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="CanFrame.position",
    )


class CanFrame(Base):
    __tablename__ = "can_frames"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("upload_sessions.id"), index=True, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    timestamp: Mapped[float] = mapped_column(Float, nullable=False)
    can_id: Mapped[str] = mapped_column(String(16), index=True, nullable=False)
    dlc: Mapped[int] = mapped_column(Integer, nullable=False)
    data_hex: Mapped[str] = mapped_column(String(64), nullable=False)
    raw_line: Mapped[str] = mapped_column(Text, nullable=False)
    is_error_frame: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    decoded_values: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    session: Mapped[UploadSession] = relationship(back_populates="frames")
