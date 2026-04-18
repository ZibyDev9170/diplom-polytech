from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import BigInteger, CheckConstraint, Date, ForeignKey, Index, SmallInteger
from sqlalchemy import String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (
        UniqueConstraint(
            "source_id",
            "external_id",
            name="uq_reviews_reviews_source_external_id",
        ),
        CheckConstraint("rating BETWEEN 1 AND 5", name="ck_reviews_reviews_rating_range"),
        CheckConstraint(
            "length(trim(review_text)) > 0",
            name="ck_reviews_reviews_review_text_not_blank",
        ),
        Index("ix_reviews_reviews_product_id", "product_id"),
        Index("ix_reviews_reviews_status_id", "status_id"),
        Index("ix_reviews_reviews_review_date", "review_date"),
        Index("ix_reviews_reviews_rating", "rating"),
        Index("ix_reviews_reviews_assigned_user_id", "assigned_user_id"),
        {"schema": "reviews"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    external_id: Mapped[str | None] = mapped_column(String(255))
    product_id: Mapped[int] = mapped_column(ForeignKey("catalog.products.id"), nullable=False)
    source_id: Mapped[int] = mapped_column(
        ForeignKey("catalog.review_sources.id"),
        nullable=False,
    )
    review_text: Mapped[str] = mapped_column(Text, nullable=False)
    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    review_date: Mapped[date] = mapped_column(Date, nullable=False)
    status_id: Mapped[int] = mapped_column(
        ForeignKey("catalog.review_statuses.id"),
        nullable=False,
    )
    assigned_user_id: Mapped[int | None] = mapped_column(ForeignKey("auth.users.id"))
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("auth.users.id"))
    updated_by_user_id: Mapped[int] = mapped_column(ForeignKey("auth.users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )


class ReviewAssignment(Base):
    __tablename__ = "review_assignments"
    __table_args__ = (
        CheckConstraint(
            "unassigned_at IS NULL OR unassigned_at >= assigned_at",
            name="ck_reviews_review_assignments_unassigned_after_assigned",
        ),
        {"schema": "reviews"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    review_id: Mapped[int] = mapped_column(ForeignKey("reviews.reviews.id"), nullable=False)
    assigned_user_id: Mapped[int] = mapped_column(ForeignKey("auth.users.id"), nullable=False)
    assigned_by_user_id: Mapped[int] = mapped_column(ForeignKey("auth.users.id"), nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    unassigned_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))


class ReviewStatusHistory(Base):
    __tablename__ = "review_status_history"
    __table_args__ = (
        CheckConstraint(
            "from_status_id IS NULL OR from_status_id <> to_status_id",
            name="ck_reviews_review_status_history_status_changed",
        ),
        {"schema": "reviews"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    review_id: Mapped[int] = mapped_column(ForeignKey("reviews.reviews.id"), nullable=False)
    from_status_id: Mapped[int | None] = mapped_column(
        ForeignKey("catalog.review_statuses.id"),
    )
    to_status_id: Mapped[int] = mapped_column(
        ForeignKey("catalog.review_statuses.id"),
        nullable=False,
    )
    changed_by_user_id: Mapped[int] = mapped_column(ForeignKey("auth.users.id"), nullable=False)
    changed_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    comment: Mapped[str | None] = mapped_column(Text)


class ReviewResponse(Base):
    __tablename__ = "review_responses"
    __table_args__ = (
        CheckConstraint(
            "length(trim(response_text)) > 0",
            name="ck_reviews_review_responses_response_text_not_blank",
        ),
        {"schema": "reviews"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    review_id: Mapped[int] = mapped_column(
        ForeignKey("reviews.reviews.id"),
        unique=True,
        nullable=False,
    )
    response_text: Mapped[str] = mapped_column(Text, nullable=False)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("auth.users.id"), nullable=False)
    updated_by_user_id: Mapped[int] = mapped_column(ForeignKey("auth.users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
