from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.reviews import ReviewSourceRead


class ExternalReviewItem(BaseModel):
    external_id: str = Field(min_length=1, max_length=255)
    product_id: int | None = Field(default=None, gt=0)
    product_sku: str | None = Field(default=None, min_length=1, max_length=100)
    product_name: str | None = Field(default=None, max_length=255)
    review_text: str = Field(min_length=1)
    rating: int = Field(ge=1, le=5)
    review_date: date

    model_config = ConfigDict(extra="allow")

    @model_validator(mode="after")
    def validate_product_reference(self) -> ExternalReviewItem:
        if self.product_id is None and self.product_sku is None:
            raise ValueError("product_id or product_sku is required")

        return self


class ExternalReviewImportRequest(BaseModel):
    source_code: str = Field(min_length=1, max_length=50)
    reviews: list[ExternalReviewItem]


class ImportItemRead(BaseModel):
    id: int
    external_review_id: str
    import_status: str
    error_message: str | None
    payload_json: dict[str, Any]
    created_at: datetime


class ImportBatchRead(BaseModel):
    id: int
    source: ReviewSourceRead
    started_at: datetime
    finished_at: datetime | None
    status: str
    total_count: int
    success_count: int
    failed_count: int
    skipped_count: int
    items: list[ImportItemRead] = []
