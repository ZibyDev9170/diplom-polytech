from __future__ import annotations

from urllib.parse import urlsplit
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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


class RemoteReviewFieldMapping(BaseModel):
    external_id: str = Field(min_length=1, max_length=255)
    product_id: str | None = Field(default=None, max_length=255)
    product_sku: str | None = Field(default=None, max_length=255)
    product_name: str | None = Field(default=None, max_length=255)
    review_text: str = Field(min_length=1, max_length=255)
    rating: str = Field(min_length=1, max_length=255)
    review_date: str = Field(min_length=1, max_length=255)


class RemoteReviewSourceRequest(BaseModel):
    source_code: str = Field(min_length=1, max_length=50)
    source_name: str | None = Field(default=None, max_length=100)
    endpoint_url: str = Field(min_length=1, max_length=2048)
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=20, ge=1, le=100)
    reviews_path: str | None = Field(default=None, max_length=255)
    mapping: RemoteReviewFieldMapping

    @field_validator("endpoint_url")
    @classmethod
    def validate_endpoint_url(cls, value: str) -> str:
        normalized_value = value.strip()
        parsed_url = urlsplit(normalized_value)

        if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
            raise ValueError("endpoint_url must start with http:// or https://")

        return normalized_value


class RemoteReviewPreviewRead(BaseModel):
    source_code: str
    source_name: str | None
    endpoint_url: str
    total_count: int
    valid_count: int
    invalid_count: int
    reviews: list[ExternalReviewItem]
    errors: list[str]


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
