from datetime import datetime

from pydantic import BaseModel, Field


class ProductCatalogRead(BaseModel):
    id: int
    name: str
    sku: str
    is_active: bool
    created_at: datetime


class ProductCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    sku: str = Field(min_length=1, max_length=100)
    is_active: bool = True


class ProductUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    sku: str | None = Field(default=None, min_length=1, max_length=100)
    is_active: bool | None = None


class ReviewSourceCatalogRead(BaseModel):
    id: int
    code: str
    name: str


class ReviewSourceCreateRequest(BaseModel):
    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=100)


class ReviewSourceUpdateRequest(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=50)
    name: str | None = Field(default=None, min_length=1, max_length=100)


class ReviewStatusCatalogRead(BaseModel):
    id: int
    code: str
    name: str
    sort_order: int
    is_terminal: bool


class ReviewStatusCreateRequest(BaseModel):
    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=100)
    sort_order: int = Field(ge=0, le=32767)
    is_terminal: bool = False


class ReviewStatusUpdateRequest(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=50)
    name: str | None = Field(default=None, min_length=1, max_length=100)
    sort_order: int | None = Field(default=None, ge=0, le=32767)
    is_terminal: bool | None = None


class StatusTransitionCreateRequest(BaseModel):
    from_status_id: int = Field(gt=0)
    to_status_id: int = Field(gt=0)


class StatusTransitionRead(BaseModel):
    id: int
    from_status: ReviewStatusCatalogRead
    to_status: ReviewStatusCatalogRead
