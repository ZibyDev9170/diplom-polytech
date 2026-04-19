from __future__ import annotations

import csv
from datetime import date
from decimal import Decimal
from io import StringIO
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import Numeric, and_, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db_session
from app.models.catalog import Product
from app.models.reviews import Review
from app.schemas.analytics import (
    AnalyticsSummaryRead,
    DynamicsProductBreakdownRead,
    PeriodAnalyticsRead,
    ProductAnalyticsRead,
    ProductRatingSummaryRead,
    RatingDistributionItemRead,
    ReviewDynamicsItemRead,
)
from app.schemas.auth import UserRead
from app.schemas.reviews import ProductRead
from app.services.audit import add_report_export_audit_log

router = APIRouter(prefix="/analytics", tags=["analytics"])

NEGATIVE_RATING_THRESHOLD = 2


def require_analytics_access(
    current_user: UserRead = Depends(get_current_user),
) -> UserRead:
    if current_user.role.code not in {"admin", "analyst"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient role permissions",
        )

    return current_user


@router.get("/summary", response_model=AnalyticsSummaryRead)
async def get_analytics_summary(
    product_id: int | None = Query(default=None, gt=0),
    date_from: date | None = None,
    date_to: date | None = None,
    _: UserRead = Depends(require_analytics_access),
    session: AsyncSession = Depends(get_db_session),
) -> AnalyticsSummaryRead:
    ensure_date_range_is_valid(date_from, date_to)
    return await calculate_summary(
        session=session,
        product_id=product_id,
        date_from=date_from,
        date_to=date_to,
    )


@router.get("/period", response_model=PeriodAnalyticsRead)
async def get_period_analytics(
    product_id: int | None = Query(default=None, gt=0),
    date_from: date | None = None,
    date_to: date | None = None,
    _: UserRead = Depends(require_analytics_access),
    session: AsyncSession = Depends(get_db_session),
) -> PeriodAnalyticsRead:
    ensure_date_range_is_valid(date_from, date_to)
    summary = await calculate_summary(
        session=session,
        product_id=product_id,
        date_from=date_from,
        date_to=date_to,
    )
    dynamics = await list_dynamics(
        session=session,
        product_id=product_id,
        date_from=date_from,
        date_to=date_to,
    )

    return PeriodAnalyticsRead(summary=summary, dynamics=dynamics)


@router.get("/dynamics", response_model=list[ReviewDynamicsItemRead])
async def get_reviews_dynamics(
    product_id: int | None = Query(default=None, gt=0),
    date_from: date | None = None,
    date_to: date | None = None,
    _: UserRead = Depends(require_analytics_access),
    session: AsyncSession = Depends(get_db_session),
) -> list[ReviewDynamicsItemRead]:
    ensure_date_range_is_valid(date_from, date_to)
    return await list_dynamics(
        session=session,
        product_id=product_id,
        date_from=date_from,
        date_to=date_to,
    )


@router.get("/products", response_model=list[ProductRatingSummaryRead])
async def get_products_analytics(
    product_id: int | None = Query(default=None, gt=0),
    date_from: date | None = None,
    date_to: date | None = None,
    _: UserRead = Depends(require_analytics_access),
    session: AsyncSession = Depends(get_db_session),
) -> list[ProductRatingSummaryRead]:
    ensure_date_range_is_valid(date_from, date_to)
    return await list_product_summaries(
        session=session,
        product_id=product_id,
        date_from=date_from,
        date_to=date_to,
    )


@router.get("/products/{product_id}", response_model=ProductAnalyticsRead)
async def get_product_analytics(
    product_id: int,
    date_from: date | None = None,
    date_to: date | None = None,
    _: UserRead = Depends(require_analytics_access),
    session: AsyncSession = Depends(get_db_session),
) -> ProductAnalyticsRead:
    ensure_date_range_is_valid(date_from, date_to)
    product = await get_product_or_404(session, product_id)
    summary = await calculate_summary(
        session=session,
        product_id=product.id,
        date_from=date_from,
        date_to=date_to,
    )
    rating_distribution = await list_rating_distribution(
        session=session,
        product_id=product.id,
        date_from=date_from,
        date_to=date_to,
    )

    return ProductAnalyticsRead(
        product=build_product_read(product),
        summary=summary,
        rating_distribution=rating_distribution,
    )


@router.get("/export.csv")
async def export_analytics_csv(
    product_id: int | None = Query(default=None, gt=0),
    date_from: date | None = None,
    date_to: date | None = None,
    current_user: UserRead = Depends(require_analytics_access),
    session: AsyncSession = Depends(get_db_session),
) -> Response:
    ensure_date_range_is_valid(date_from, date_to)
    product_summaries = await list_product_summaries(
        session=session,
        product_id=product_id,
        date_from=date_from,
        date_to=date_to,
    )

    add_report_export_audit_log(
        session=session,
        actor_id=current_user.id,
        report_code="analytics_product_summary",
        filters=build_filter_payload(
            product_id=product_id,
            date_from=date_from,
            date_to=date_to,
        ),
        rows_count=len(product_summaries),
    )
    await session.commit()

    output = StringIO()
    output.write("\ufeff")
    writer = csv.writer(output, delimiter=";")
    writer.writerow(
        [
            "Товар",
            "Количество отзывов",
            "Средняя оценка",
            "Количество негативных",
            "Доля негативных",
        ],
    )

    for item in product_summaries:
        writer.writerow(
            [
                item.product_name,
                item.reviews_count,
                format_float_for_csv(item.average_rating),
                item.negative_reviews_count,
                f"{format_float_for_csv(item.negative_share_percent)}%",
            ],
        )

    return Response(
        content=output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="analytics_product_summary.csv"',
        },
    )


async def calculate_summary(
    *,
    session: AsyncSession,
    product_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> AnalyticsSummaryRead:
    filters = build_review_filters(
        product_id=product_id,
        date_from=date_from,
        date_to=date_to,
    )
    result = await session.execute(
        select(
            func.count(Review.id).label("total_reviews"),
            func.coalesce(
                func.round(cast(func.avg(Review.rating), Numeric), 2),
                0,
            ).label("average_rating"),
            func.count(Review.id)
            .filter(Review.rating <= NEGATIVE_RATING_THRESHOLD)
            .label("negative_reviews_count"),
        )
        .join(Product, Product.id == Review.product_id)
        .where(*filters),
    )
    row = result.one()._mapping
    total_reviews = int(row["total_reviews"] or 0)
    negative_reviews_count = int(row["negative_reviews_count"] or 0)

    return AnalyticsSummaryRead(
        average_rating=decimal_to_float(row["average_rating"]),
        total_reviews=total_reviews,
        negative_reviews_count=negative_reviews_count,
        negative_share_percent=calculate_percent(negative_reviews_count, total_reviews),
    )


async def list_dynamics(
    *,
    session: AsyncSession,
    product_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[ReviewDynamicsItemRead]:
    filters = build_review_filters(
        product_id=product_id,
        date_from=date_from,
        date_to=date_to,
    )
    result = await session.execute(
        select(
            Review.review_date.label("review_day"),
            func.count(Review.id).label("reviews_count"),
            func.round(cast(func.avg(Review.rating), Numeric), 2).label(
                "average_rating",
            ),
        )
        .join(Product, Product.id == Review.product_id)
        .where(*filters)
        .group_by(Review.review_date)
        .order_by(Review.review_date),
    )
    product_breakdown = await list_dynamics_product_breakdown(
        session=session,
        product_id=product_id,
        date_from=date_from,
        date_to=date_to,
    )

    return [
        ReviewDynamicsItemRead(
            review_day=row.review_day,
            reviews_count=row.reviews_count,
            average_rating=decimal_to_float(row.average_rating),
            products=product_breakdown.get(row.review_day, []),
        )
        for row in result.all()
    ]


async def list_product_summaries(
    *,
    session: AsyncSession,
    product_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[ProductRatingSummaryRead]:
    join_conditions = [
        Review.product_id == Product.id,
        *build_review_period_filters(date_from=date_from, date_to=date_to),
    ]
    product_filters = []
    product_filters.append(Product.is_active.is_(True))

    if product_id is not None:
        product_filters.append(Product.id == product_id)

    result = await session.execute(
        select(
            Product.id.label("product_id"),
            Product.name.label("product_name"),
            func.count(Review.id).label("reviews_count"),
            func.coalesce(
                func.round(cast(func.avg(Review.rating), Numeric), 2),
                0,
            ).label("average_rating"),
            func.count(Review.id)
            .filter(Review.rating <= NEGATIVE_RATING_THRESHOLD)
            .label("negative_reviews_count"),
        )
        .outerjoin(Review, and_(*join_conditions))
        .where(*product_filters)
        .group_by(Product.id, Product.name)
        .order_by(func.count(Review.id).desc(), Product.id),
    )
    rating_distribution_by_product = await list_rating_distribution_by_product(
        session=session,
        product_id=product_id,
        date_from=date_from,
        date_to=date_to,
    )

    items: list[ProductRatingSummaryRead] = []
    for row in result.all():
        reviews_count = int(row.reviews_count or 0)
        negative_reviews_count = int(row.negative_reviews_count or 0)
        items.append(
            ProductRatingSummaryRead(
                product_id=row.product_id,
                product_name=row.product_name,
                reviews_count=reviews_count,
                average_rating=decimal_to_float(row.average_rating),
                negative_reviews_count=negative_reviews_count,
                negative_share_percent=calculate_percent(
                    negative_reviews_count,
                    reviews_count,
                ),
                rating_distribution=rating_distribution_by_product.get(
                    row.product_id,
                    build_empty_rating_distribution(),
                ),
            ),
        )

    return items


async def list_dynamics_product_breakdown(
    *,
    session: AsyncSession,
    product_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict[date, list[DynamicsProductBreakdownRead]]:
    filters = build_review_filters(
        product_id=product_id,
        date_from=date_from,
        date_to=date_to,
    )
    result = await session.execute(
        select(
            Review.review_date.label("review_day"),
            Product.id.label("product_id"),
            Product.name.label("product_name"),
            func.count(Review.id).label("reviews_count"),
        )
        .join(Product, Product.id == Review.product_id)
        .where(*filters)
        .group_by(Review.review_date, Product.id, Product.name)
        .order_by(Review.review_date, func.count(Review.id).desc(), Product.name),
    )
    breakdown: dict[date, list[DynamicsProductBreakdownRead]] = {}

    for row in result.all():
        breakdown.setdefault(row.review_day, []).append(
            DynamicsProductBreakdownRead(
                product_id=row.product_id,
                product_name=row.product_name,
                reviews_count=int(row.reviews_count or 0),
            ),
        )

    return breakdown


async def list_rating_distribution_by_product(
    *,
    session: AsyncSession,
    product_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict[int, list[RatingDistributionItemRead]]:
    filters = [Product.is_active.is_(True)]

    if product_id is not None:
        filters.append(Product.id == product_id)

    result = await session.execute(
        select(
            Product.id.label("product_id"),
            Review.rating.label("rating"),
            func.count(Review.id).label("reviews_count"),
        )
        .outerjoin(
            Review,
            and_(
                Review.product_id == Product.id,
                *build_review_period_filters(date_from=date_from, date_to=date_to),
            ),
        )
        .where(*filters)
        .group_by(Product.id, Review.rating),
    )
    counts_by_product: dict[int, dict[int, int]] = {}

    for row in result.all():
        counts_by_product.setdefault(row.product_id, {})

        if row.rating is not None:
            counts_by_product[row.product_id][row.rating] = int(row.reviews_count or 0)

    return {
        product_id: build_rating_distribution(counts_by_rating)
        for product_id, counts_by_rating in counts_by_product.items()
    }


async def list_rating_distribution(
    *,
    session: AsyncSession,
    product_id: int,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[RatingDistributionItemRead]:
    filters = build_review_filters(
        product_id=product_id,
        date_from=date_from,
        date_to=date_to,
    )
    result = await session.execute(
        select(
            Review.rating.label("rating"),
            func.count(Review.id).label("reviews_count"),
        )
        .join(Product, Product.id == Review.product_id)
        .where(*filters)
        .group_by(Review.rating),
    )
    counts_by_rating = {row.rating: row.reviews_count for row in result.all()}

    return build_rating_distribution(counts_by_rating)


def build_empty_rating_distribution() -> list[RatingDistributionItemRead]:
    return build_rating_distribution({})


def build_rating_distribution(
    counts_by_rating: dict[int, int],
) -> list[RatingDistributionItemRead]:
    return [
        RatingDistributionItemRead(
            rating=rating,
            reviews_count=int(counts_by_rating.get(rating, 0)),
        )
        for rating in range(1, 6)
    ]


def build_review_filters(
    *,
    product_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[Any]:
    filters = [
        Product.is_active.is_(True),
        *build_review_period_filters(date_from=date_from, date_to=date_to),
    ]

    if product_id is not None:
        filters.append(Review.product_id == product_id)

    return filters


def build_review_period_filters(
    *,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[Any]:
    filters: list[Any] = []

    if date_from is not None:
        filters.append(Review.review_date >= date_from)

    if date_to is not None:
        filters.append(Review.review_date <= date_to)

    return filters


async def get_product_or_404(session: AsyncSession, product_id: int) -> Product:
    product = await session.scalar(
        select(Product).where(Product.id == product_id, Product.is_active.is_(True)),
    )

    if product is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Active product not found",
        )

    return product


def build_product_read(product: Product) -> ProductRead:
    return ProductRead(
        id=product.id,
        name=product.name,
        sku=product.sku,
        is_active=product.is_active,
    )


def ensure_date_range_is_valid(date_from: date | None, date_to: date | None) -> None:
    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="date_from must be less than or equal to date_to",
        )


def calculate_percent(value: int, total: int) -> float:
    if total <= 0:
        return 0

    return round(value * 100 / total, 2)


def decimal_to_float(value: Decimal | int | float | None) -> float:
    if value is None:
        return 0

    return float(value)


def format_float_for_csv(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".")


def build_filter_payload(
    *,
    product_id: int | None,
    date_from: date | None,
    date_to: date | None,
) -> dict[str, str | int | None]:
    return {
        "product_id": product_id,
        "date_from": date_from.isoformat() if date_from is not None else None,
        "date_to": date_to.isoformat() if date_to is not None else None,
    }
