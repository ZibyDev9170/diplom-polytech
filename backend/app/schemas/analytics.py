from datetime import date

from pydantic import BaseModel

from app.schemas.reviews import ProductRead


class AnalyticsSummaryRead(BaseModel):
    average_rating: float
    total_reviews: int
    negative_reviews_count: int
    negative_share_percent: float


class DynamicsProductBreakdownRead(BaseModel):
    product_id: int
    product_name: str
    reviews_count: int


class RatingDistributionItemRead(BaseModel):
    rating: int
    reviews_count: int


class ReviewDynamicsItemRead(BaseModel):
    review_day: date
    reviews_count: int
    average_rating: float
    products: list[DynamicsProductBreakdownRead]


class ProductRatingSummaryRead(BaseModel):
    product_id: int
    product_name: str
    reviews_count: int
    average_rating: float
    negative_reviews_count: int
    negative_share_percent: float
    rating_distribution: list[RatingDistributionItemRead]


class ProductAnalyticsRead(BaseModel):
    product: ProductRead
    summary: AnalyticsSummaryRead
    rating_distribution: list[RatingDistributionItemRead]


class PeriodAnalyticsRead(BaseModel):
    summary: AnalyticsSummaryRead
    dynamics: list[ReviewDynamicsItemRead]
