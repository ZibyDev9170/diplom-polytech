from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, ForeignKey, SmallInteger
from sqlalchemy import String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint(
            "length(trim(name)) > 0",
            name="ck_catalog_products_name_not_blank",
        ),
        CheckConstraint("length(trim(sku)) > 0", name="ck_catalog_products_sku_not_blank"),
        {"schema": "catalog"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sku: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )


class ReviewSource(Base):
    __tablename__ = "review_sources"
    __table_args__ = (
        CheckConstraint(
            "length(trim(code)) > 0",
            name="ck_catalog_review_sources_code_not_blank",
        ),
        CheckConstraint(
            "length(trim(name)) > 0",
            name="ck_catalog_review_sources_name_not_blank",
        ),
        {"schema": "catalog"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)


class ReviewStatus(Base):
    __tablename__ = "review_statuses"
    __table_args__ = (
        CheckConstraint(
            "length(trim(code)) > 0",
            name="ck_catalog_review_statuses_code_not_blank",
        ),
        CheckConstraint(
            "length(trim(name)) > 0",
            name="ck_catalog_review_statuses_name_not_blank",
        ),
        CheckConstraint(
            "sort_order >= 0",
            name="ck_catalog_review_statuses_sort_order_non_negative",
        ),
        {"schema": "catalog"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    sort_order: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    is_terminal: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )


class AllowedStatusTransition(Base):
    __tablename__ = "allowed_status_transitions"
    __table_args__ = (
        UniqueConstraint(
            "from_status_id",
            "to_status_id",
            name="uq_catalog_allowed_status_transitions_from_to",
        ),
        CheckConstraint(
            "from_status_id <> to_status_id",
            name="ck_catalog_allowed_status_transitions_not_same_status",
        ),
        {"schema": "catalog"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    from_status_id: Mapped[int] = mapped_column(
        ForeignKey("catalog.review_statuses.id"),
        nullable=False,
    )
    to_status_id: Mapped[int] = mapped_column(
        ForeignKey("catalog.review_statuses.id"),
        nullable=False,
    )
