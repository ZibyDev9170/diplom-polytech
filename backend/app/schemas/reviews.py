from datetime import date, datetime

from pydantic import BaseModel, EmailStr, Field

from app.schemas.auth import RoleRead


class ProductRead(BaseModel):
    id: int
    name: str
    sku: str
    is_active: bool


class ReviewSourceRead(BaseModel):
    id: int
    code: str
    name: str


class ReviewStatusRead(BaseModel):
    id: int
    code: str
    name: str
    sort_order: int
    is_terminal: bool


class ReviewUserRead(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    role: RoleRead | None = None


class ReviewCreateRequest(BaseModel):
    external_id: str | None = Field(default=None, max_length=255)
    product_id: int = Field(gt=0)
    source_id: int | None = Field(default=None, gt=0)
    review_text: str = Field(min_length=1)
    rating: int = Field(ge=1, le=5)
    review_date: date
    assigned_user_id: int | None = Field(default=None, gt=0)


class ReviewUpdateRequest(BaseModel):
    external_id: str | None = Field(default=None, max_length=255)
    product_id: int | None = Field(default=None, gt=0)
    source_id: int | None = Field(default=None, gt=0)
    review_text: str | None = Field(default=None, min_length=1)
    rating: int | None = Field(default=None, ge=1, le=5)
    review_date: date | None = None


class ReviewStatusChangeRequest(BaseModel):
    status_id: int = Field(gt=0)
    comment: str | None = None


class ReviewAssignmentRequest(BaseModel):
    assigned_user_id: int | None = Field(default=None, gt=0)


class ReviewResponseSaveRequest(BaseModel):
    response_text: str = Field(min_length=1)


class ReviewListItemRead(BaseModel):
    id: int
    external_id: str | None
    product: ProductRead
    source: ReviewSourceRead
    review_text: str
    rating: int
    review_date: date
    status: ReviewStatusRead
    assigned_user: ReviewUserRead | None
    created_at: datetime
    updated_at: datetime


class ReviewResponseRead(BaseModel):
    id: int
    review_id: int
    response_text: str
    created_by_user: ReviewUserRead
    updated_by_user: ReviewUserRead
    created_at: datetime
    updated_at: datetime


class ReviewStatusHistoryRead(BaseModel):
    id: int
    from_status: ReviewStatusRead | None
    to_status: ReviewStatusRead
    changed_by_user: ReviewUserRead
    changed_at: datetime
    comment: str | None


class ReviewAssignmentHistoryRead(BaseModel):
    id: int
    assigned_user: ReviewUserRead
    assigned_by_user: ReviewUserRead
    assigned_at: datetime
    unassigned_at: datetime | None


class ReviewDetailRead(ReviewListItemRead):
    created_by_user: ReviewUserRead | None
    updated_by_user: ReviewUserRead
    response: ReviewResponseRead | None
    status_history: list[ReviewStatusHistoryRead]
    assignment_history: list[ReviewAssignmentHistoryRead]


class ReviewListResponse(BaseModel):
    items: list[ReviewListItemRead]
    total: int
    limit: int
    offset: int


class ReviewReferenceDataRead(BaseModel):
    products: list[ProductRead]
    statuses: list[ReviewStatusRead]
    sources: list[ReviewSourceRead]
    users: list[ReviewUserRead]
