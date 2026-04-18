from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Integer, String, Text, text
from sqlalchemy import UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ImportBatch(Base):
    __tablename__ = "import_batches"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'running', 'completed', 'failed', 'partially_completed')",
            name="ck_integration_import_batches_status",
        ),
        CheckConstraint(
            "total_count >= 0",
            name="ck_integration_import_batches_total_count_non_negative",
        ),
        CheckConstraint(
            "success_count >= 0",
            name="ck_integration_import_batches_success_count_non_negative",
        ),
        CheckConstraint(
            "failed_count >= 0",
            name="ck_integration_import_batches_failed_count_non_negative",
        ),
        CheckConstraint(
            "success_count + failed_count <= total_count",
            name="ck_integration_import_batches_counts_not_greater_total",
        ),
        CheckConstraint(
            "finished_at IS NULL OR finished_at >= started_at",
            name="ck_integration_import_batches_finished_after_started",
        ),
        {"schema": "integration"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    source_id: Mapped[int] = mapped_column(
        ForeignKey("catalog.review_sources.id"),
        nullable=False,
    )
    started_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    finished_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    status: Mapped[str] = mapped_column(String(50), nullable=False)
    total_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    success_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    failed_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))


class ImportItem(Base):
    __tablename__ = "import_items"
    __table_args__ = (
        UniqueConstraint(
            "batch_id",
            "external_review_id",
            name="uq_integration_import_items_batch_external_review_id",
        ),
        CheckConstraint(
            "length(trim(external_review_id)) > 0",
            name="ck_integration_import_items_external_review_id_not_blank",
        ),
        CheckConstraint(
            "import_status IN ('pending', 'success', 'failed', 'skipped')",
            name="ck_integration_import_items_import_status",
        ),
        {"schema": "integration"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    batch_id: Mapped[int] = mapped_column(
        ForeignKey("integration.import_batches.id"),
        nullable=False,
    )
    external_review_id: Mapped[str] = mapped_column(String(255), nullable=False)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    import_status: Mapped[str] = mapped_column(String(50), nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
