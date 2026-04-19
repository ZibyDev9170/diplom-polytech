from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.api.deps import require_roles
from app.db.session import get_db_session
from app.models.auth import Role, User
from app.models.catalog import (
    AllowedStatusTransition,
    Product,
    ReviewSource,
    ReviewStatus,
)
from app.models.reviews import (
    Review,
    ReviewAssignment,
    ReviewResponse,
    ReviewStatusHistory,
)
from app.schemas.auth import RoleRead, UserRead
from app.schemas.reviews import (
    ProductRead,
    ReviewAssignmentHistoryRead,
    ReviewAssignmentRequest,
    ReviewCreateRequest,
    ReviewDetailRead,
    ReviewListItemRead,
    ReviewListResponse,
    ReviewReferenceDataRead,
    ReviewResponseRead,
    ReviewResponseSaveRequest,
    ReviewSourceRead,
    ReviewStatusChangeRequest,
    ReviewStatusHistoryRead,
    ReviewStatusRead,
    ReviewUpdateRequest,
    ReviewUserRead,
)
from app.services.audit import AuditEntity, AuditEvent, add_audit_log

router = APIRouter(prefix="/reviews", tags=["reviews"])

review_access = require_roles("admin", "manager", "support")


@router.get("/reference-data", response_model=ReviewReferenceDataRead)
async def list_review_reference_data(
    _: UserRead = Depends(review_access),
    session: AsyncSession = Depends(get_db_session),
) -> ReviewReferenceDataRead:
    products_result = await session.execute(
        select(Product)
        .where(Product.is_active.is_(True))
        .order_by(Product.name, Product.id),
    )
    statuses_result = await session.execute(
        select(ReviewStatus).order_by(ReviewStatus.sort_order, ReviewStatus.id),
    )
    sources_result = await session.execute(select(ReviewSource).order_by(ReviewSource.name))
    users_result = await session.execute(
        select(User, Role)
        .join(Role, Role.id == User.role_id)
        .where(User.is_active.is_(True))
        .order_by(User.full_name, User.id),
    )

    return ReviewReferenceDataRead(
        products=[build_product_read(product) for product in products_result.scalars()],
        statuses=[build_status_read(status_item) for status_item in statuses_result.scalars()],
        sources=[build_source_read(source) for source in sources_result.scalars()],
        users=[build_review_user_read(user, role) for user, role in users_result.all()],
    )


@router.get("", response_model=ReviewListResponse)
async def list_reviews(
    product_id: int | None = Query(default=None, gt=0),
    status_id: int | None = Query(default=None, gt=0),
    source_id: int | None = Query(default=None, gt=0),
    date_from: date | None = None,
    date_to: date | None = None,
    rating: int | None = Query(default=None, ge=1, le=5),
    assigned_user_id: int | None = Query(default=None, gt=0),
    q: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _: UserRead = Depends(review_access),
    session: AsyncSession = Depends(get_db_session),
) -> ReviewListResponse:
    ensure_date_range_is_valid(date_from, date_to)

    assigned_user = aliased(User)
    filters = build_review_filters(
        assigned_user=assigned_user,
        product_id=product_id,
        status_id=status_id,
        source_id=source_id,
        date_from=date_from,
        date_to=date_to,
        rating=rating,
        assigned_user_id=assigned_user_id,
        q=q,
    )

    base_statement = (
        select(Review, Product, ReviewSource, ReviewStatus, assigned_user)
        .join(Product, Product.id == Review.product_id)
        .join(ReviewSource, ReviewSource.id == Review.source_id)
        .join(ReviewStatus, ReviewStatus.id == Review.status_id)
        .outerjoin(assigned_user, assigned_user.id == Review.assigned_user_id)
        .where(*filters)
    )

    total_statement = (
        select(func.count(Review.id))
        .join(Product, Product.id == Review.product_id)
        .join(ReviewSource, ReviewSource.id == Review.source_id)
        .join(ReviewStatus, ReviewStatus.id == Review.status_id)
        .outerjoin(assigned_user, assigned_user.id == Review.assigned_user_id)
        .where(*filters)
    )

    total = await session.scalar(total_statement)
    result = await session.execute(
        base_statement.order_by(Review.review_date.desc(), Review.id.desc())
        .limit(limit)
        .offset(offset),
    )

    return ReviewListResponse(
        items=[
            build_review_list_item(review, product, source, status_item, assigned)
            for review, product, source, status_item, assigned in result.all()
        ],
        total=total or 0,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=ReviewDetailRead, status_code=status.HTTP_201_CREATED)
async def create_review(
    payload: ReviewCreateRequest,
    current_user: UserRead = Depends(review_access),
    session: AsyncSession = Depends(get_db_session),
) -> ReviewDetailRead:
    product = await get_product_or_404(session, payload.product_id)
    source = await get_source_or_default(session, payload.source_id)
    new_status = await get_required_status_by_code(session, "new")
    assigned_user = None

    if payload.assigned_user_id is not None:
        assigned_user = await get_user_or_404(session, payload.assigned_user_id)

    external_id = normalize_optional_text(payload.external_id)
    await ensure_external_id_is_available(session, source.id, external_id)

    now = datetime.now(timezone.utc)
    review = Review(
        external_id=external_id,
        product_id=product.id,
        source_id=source.id,
        review_text=normalize_required_text(payload.review_text, "Review text is required"),
        rating=payload.rating,
        review_date=payload.review_date,
        status_id=new_status.id,
        assigned_user_id=assigned_user.id if assigned_user is not None else None,
        created_by_user_id=current_user.id,
        updated_by_user_id=current_user.id,
        updated_at=now,
    )
    session.add(review)
    await session.flush()
    await session.refresh(review)

    session.add(
        ReviewStatusHistory(
            review_id=review.id,
            from_status_id=None,
            to_status_id=new_status.id,
            changed_by_user_id=current_user.id,
        ),
    )

    if assigned_user is not None:
        session.add(
            ReviewAssignment(
                review_id=review.id,
                assigned_user_id=assigned_user.id,
                assigned_by_user_id=current_user.id,
            ),
        )

    add_audit_log(
        session=session,
        actor_id=current_user.id,
        entity_type=AuditEntity.REVIEW,
        entity_id=review.id,
        action=AuditEvent.REVIEW_CREATE,
        new_values=serialize_review(review),
    )

    if assigned_user is not None:
        add_audit_log(
            session=session,
            actor_id=current_user.id,
            entity_type=AuditEntity.REVIEW,
            entity_id=review.id,
            action=AuditEvent.REVIEW_ASSIGN,
            old_values={"assigned_user_id": None},
            new_values={
                "review_id": review.id,
                "assigned_user_id": assigned_user.id,
                "assigned_by_user_id": current_user.id,
            },
        )

    await session.commit()

    return await get_review_detail_or_404(session, review.id)


@router.get("/{review_id}", response_model=ReviewDetailRead)
async def get_review(
    review_id: int,
    _: UserRead = Depends(review_access),
    session: AsyncSession = Depends(get_db_session),
) -> ReviewDetailRead:
    return await get_review_detail_or_404(session, review_id)


@router.patch("/{review_id}", response_model=ReviewDetailRead)
async def update_review(
    review_id: int,
    payload: ReviewUpdateRequest,
    current_user: UserRead = Depends(review_access),
    session: AsyncSession = Depends(get_db_session),
) -> ReviewDetailRead:
    if not payload.model_fields_set:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No review fields provided",
        )

    review = await get_review_entity_or_404(session, review_id, for_update=True)
    old_values = serialize_review(review)
    fields = payload.model_fields_set

    if "product_id" in fields:
        if payload.product_id is None:
            raise_required_field_error("Product is required")
        product = await get_product_or_404(session, payload.product_id)
        review.product_id = product.id

    if "source_id" in fields:
        if payload.source_id is None:
            raise_required_field_error("Source is required")
        source = await get_source_or_404(session, payload.source_id)
        review.source_id = source.id

    if "review_text" in fields:
        if payload.review_text is None:
            raise_required_field_error("Review text is required")
        review.review_text = normalize_required_text(
            payload.review_text,
            "Review text is required",
        )

    if "rating" in fields:
        if payload.rating is None:
            raise_required_field_error("Rating is required")
        review.rating = payload.rating

    if "review_date" in fields:
        if payload.review_date is None:
            raise_required_field_error("Review date is required")
        review.review_date = payload.review_date

    if "external_id" in fields:
        review.external_id = normalize_optional_text(payload.external_id)

    await ensure_external_id_is_available(
        session=session,
        source_id=review.source_id,
        external_id=review.external_id,
        exclude_review_id=review.id,
    )

    review.updated_by_user_id = current_user.id
    review.updated_at = datetime.now(timezone.utc)

    await session.flush()
    add_audit_log(
        session=session,
        actor_id=current_user.id,
        entity_type=AuditEntity.REVIEW,
        entity_id=review.id,
        action=AuditEvent.REVIEW_UPDATE,
        old_values=old_values,
        new_values=serialize_review(review),
    )
    await session.commit()

    return await get_review_detail_or_404(session, review.id)


@router.patch("/{review_id}/status", response_model=ReviewDetailRead)
async def change_review_status(
    review_id: int,
    payload: ReviewStatusChangeRequest,
    current_user: UserRead = Depends(review_access),
    session: AsyncSession = Depends(get_db_session),
) -> ReviewDetailRead:
    review = await get_review_entity_or_404(session, review_id, for_update=True)
    next_status = await get_status_or_404(session, payload.status_id)

    if review.status_id == next_status.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Review already has this status",
        )

    transition_id = await session.scalar(
        select(AllowedStatusTransition.id).where(
            AllowedStatusTransition.from_status_id == review.status_id,
            AllowedStatusTransition.to_status_id == next_status.id,
        ),
    )
    if transition_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Status transition is not allowed",
        )

    old_values = serialize_review(review)
    previous_status_id = review.status_id
    review.status_id = next_status.id
    review.updated_by_user_id = current_user.id
    review.updated_at = datetime.now(timezone.utc)

    session.add(
        ReviewStatusHistory(
            review_id=review.id,
            from_status_id=previous_status_id,
            to_status_id=next_status.id,
            changed_by_user_id=current_user.id,
            comment=normalize_optional_text(payload.comment),
        ),
    )

    await session.flush()
    add_audit_log(
        session=session,
        actor_id=current_user.id,
        entity_type=AuditEntity.REVIEW,
        entity_id=review.id,
        action=AuditEvent.REVIEW_CHANGE_STATUS,
        old_values=old_values,
        new_values=serialize_review(review),
    )
    await session.commit()

    return await get_review_detail_or_404(session, review.id)


@router.patch("/{review_id}/assignment", response_model=ReviewDetailRead)
async def assign_review_user(
    review_id: int,
    payload: ReviewAssignmentRequest,
    current_user: UserRead = Depends(review_access),
    session: AsyncSession = Depends(get_db_session),
) -> ReviewDetailRead:
    review = await get_review_entity_or_404(session, review_id, for_update=True)
    assigned_user = None

    if payload.assigned_user_id is not None:
        assigned_user = await get_user_or_404(session, payload.assigned_user_id)

    if review.assigned_user_id == payload.assigned_user_id:
        return await get_review_detail_or_404(session, review.id)

    old_values = serialize_review(review)
    now = datetime.now(timezone.utc)
    active_assignments = await session.execute(
        select(ReviewAssignment)
        .where(
            ReviewAssignment.review_id == review.id,
            ReviewAssignment.unassigned_at.is_(None),
        )
        .with_for_update(),
    )

    for assignment in active_assignments.scalars():
        assignment.unassigned_at = now

    review.assigned_user_id = assigned_user.id if assigned_user is not None else None
    review.updated_by_user_id = current_user.id
    review.updated_at = now

    if assigned_user is not None:
        session.add(
            ReviewAssignment(
                review_id=review.id,
                assigned_user_id=assigned_user.id,
                assigned_by_user_id=current_user.id,
                assigned_at=now,
            ),
        )

    await session.flush()
    add_audit_log(
        session=session,
        actor_id=current_user.id,
        entity_type=AuditEntity.REVIEW,
        entity_id=review.id,
        action=(
            AuditEvent.REVIEW_ASSIGN
            if assigned_user is not None
            else AuditEvent.REVIEW_UNASSIGN
        ),
        old_values=old_values,
        new_values=serialize_review(review),
    )
    await session.commit()

    return await get_review_detail_or_404(session, review.id)


@router.put("/{review_id}/response", response_model=ReviewDetailRead)
async def save_review_response(
    review_id: int,
    payload: ReviewResponseSaveRequest,
    current_user: UserRead = Depends(review_access),
    session: AsyncSession = Depends(get_db_session),
) -> ReviewDetailRead:
    review = await get_review_entity_or_404(session, review_id, for_update=True)
    response_text = normalize_required_text(payload.response_text, "Response text is required")
    now = datetime.now(timezone.utc)
    response = await session.scalar(
        select(ReviewResponse)
        .where(ReviewResponse.review_id == review.id)
        .with_for_update(),
    )

    old_values = serialize_response(response) if response is not None else None
    if response is None:
        response = ReviewResponse(
            review_id=review.id,
            response_text=response_text,
            created_by_user_id=current_user.id,
            updated_by_user_id=current_user.id,
            updated_at=now,
        )
        session.add(response)
    else:
        response.response_text = response_text
        response.updated_by_user_id = current_user.id
        response.updated_at = now

    review.updated_by_user_id = current_user.id
    review.updated_at = now

    await session.flush()
    await session.refresh(response)
    add_audit_log(
        session=session,
        actor_id=current_user.id,
        entity_type=AuditEntity.REVIEW_RESPONSE,
        entity_id=response.id,
        action=AuditEvent.REVIEW_SAVE_RESPONSE,
        old_values=old_values,
        new_values=serialize_response(response),
    )
    await session.commit()

    return await get_review_detail_or_404(session, review.id)


def build_review_filters(
    assigned_user: Any,
    product_id: int | None,
    status_id: int | None,
    source_id: int | None,
    date_from: date | None,
    date_to: date | None,
    rating: int | None,
    assigned_user_id: int | None,
    q: str | None,
) -> list[Any]:
    filters: list[Any] = [Product.is_active.is_(True)]

    if product_id is not None:
        filters.append(Review.product_id == product_id)
    if status_id is not None:
        filters.append(Review.status_id == status_id)
    if source_id is not None:
        filters.append(Review.source_id == source_id)
    if date_from is not None:
        filters.append(Review.review_date >= date_from)
    if date_to is not None:
        filters.append(Review.review_date <= date_to)
    if rating is not None:
        filters.append(Review.rating == rating)
    if assigned_user_id is not None:
        filters.append(Review.assigned_user_id == assigned_user_id)

    search_term = normalize_optional_text(q)
    if search_term is not None:
        lowered_pattern = f"%{search_term.lower()}%"
        raw_pattern = f"%{search_term}%"
        filters.append(
            or_(
                func.lower(Review.review_text).like(lowered_pattern),
                func.lower(func.coalesce(Review.external_id, "")).like(lowered_pattern),
                func.lower(Product.name).like(lowered_pattern),
                func.lower(Product.sku).like(lowered_pattern),
                func.lower(ReviewSource.name).like(lowered_pattern),
                func.lower(ReviewSource.code).like(lowered_pattern),
                func.lower(ReviewStatus.name).like(lowered_pattern),
                func.lower(ReviewStatus.code).like(lowered_pattern),
                func.lower(func.coalesce(assigned_user.full_name, "")).like(
                    lowered_pattern,
                ),
                func.lower(func.coalesce(assigned_user.email, "")).like(lowered_pattern),
                cast(Review.id, String).like(raw_pattern),
                cast(Review.rating, String).like(raw_pattern),
            ),
        )

    return filters


async def get_review_detail_or_404(
    session: AsyncSession,
    review_id: int,
) -> ReviewDetailRead:
    assigned_user = aliased(User)
    created_by_user = aliased(User)
    updated_by_user = aliased(User)

    result = await session.execute(
        select(
            Review,
            Product,
            ReviewSource,
            ReviewStatus,
            assigned_user,
            created_by_user,
            updated_by_user,
        )
        .join(Product, Product.id == Review.product_id)
        .join(ReviewSource, ReviewSource.id == Review.source_id)
        .join(ReviewStatus, ReviewStatus.id == Review.status_id)
        .outerjoin(assigned_user, assigned_user.id == Review.assigned_user_id)
        .outerjoin(created_by_user, created_by_user.id == Review.created_by_user_id)
        .join(updated_by_user, updated_by_user.id == Review.updated_by_user_id)
        .where(Review.id == review_id, Product.is_active.is_(True)),
    )
    row = result.one_or_none()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Review not found",
        )

    (
        review,
        product,
        source,
        status_item,
        assigned,
        created_by,
        updated_by,
    ) = row

    response = await get_review_response_read(session, review.id)

    return ReviewDetailRead(
        **build_review_list_item(
            review,
            product,
            source,
            status_item,
            assigned,
        ).model_dump(),
        created_by_user=build_review_user_read(created_by) if created_by is not None else None,
        updated_by_user=build_review_user_read(updated_by),
        response=response,
        status_history=await list_status_history(session, review.id),
        assignment_history=await list_assignment_history(session, review.id),
    )


async def get_review_response_read(
    session: AsyncSession,
    review_id: int,
) -> ReviewResponseRead | None:
    created_by_user = aliased(User)
    updated_by_user = aliased(User)
    result = await session.execute(
        select(ReviewResponse, created_by_user, updated_by_user)
        .join(created_by_user, created_by_user.id == ReviewResponse.created_by_user_id)
        .join(updated_by_user, updated_by_user.id == ReviewResponse.updated_by_user_id)
        .where(ReviewResponse.review_id == review_id),
    )
    row = result.one_or_none()

    if row is None:
        return None

    response, created_by, updated_by = row
    return ReviewResponseRead(
        id=response.id,
        review_id=response.review_id,
        response_text=response.response_text,
        created_by_user=build_review_user_read(created_by),
        updated_by_user=build_review_user_read(updated_by),
        created_at=response.created_at,
        updated_at=response.updated_at,
    )


async def list_status_history(
    session: AsyncSession,
    review_id: int,
) -> list[ReviewStatusHistoryRead]:
    from_status = aliased(ReviewStatus)
    to_status = aliased(ReviewStatus)
    changed_by_user = aliased(User)
    result = await session.execute(
        select(ReviewStatusHistory, from_status, to_status, changed_by_user)
        .outerjoin(from_status, from_status.id == ReviewStatusHistory.from_status_id)
        .join(to_status, to_status.id == ReviewStatusHistory.to_status_id)
        .join(changed_by_user, changed_by_user.id == ReviewStatusHistory.changed_by_user_id)
        .where(ReviewStatusHistory.review_id == review_id)
        .order_by(ReviewStatusHistory.changed_at, ReviewStatusHistory.id),
    )

    return [
        ReviewStatusHistoryRead(
            id=history.id,
            from_status=build_status_read(old_status) if old_status is not None else None,
            to_status=build_status_read(new_status),
            changed_by_user=build_review_user_read(changed_by),
            changed_at=history.changed_at,
            comment=history.comment,
        )
        for history, old_status, new_status, changed_by in result.all()
    ]


async def list_assignment_history(
    session: AsyncSession,
    review_id: int,
) -> list[ReviewAssignmentHistoryRead]:
    assigned_user = aliased(User)
    assigned_by_user = aliased(User)
    result = await session.execute(
        select(ReviewAssignment, assigned_user, assigned_by_user)
        .join(assigned_user, assigned_user.id == ReviewAssignment.assigned_user_id)
        .join(assigned_by_user, assigned_by_user.id == ReviewAssignment.assigned_by_user_id)
        .where(ReviewAssignment.review_id == review_id)
        .order_by(ReviewAssignment.assigned_at, ReviewAssignment.id),
    )

    return [
        ReviewAssignmentHistoryRead(
            id=assignment.id,
            assigned_user=build_review_user_read(assigned),
            assigned_by_user=build_review_user_read(assigned_by),
            assigned_at=assignment.assigned_at,
            unassigned_at=assignment.unassigned_at,
        )
        for assignment, assigned, assigned_by in result.all()
    ]


async def get_review_entity_or_404(
    session: AsyncSession,
    review_id: int,
    for_update: bool = False,
) -> Review:
    statement = (
        select(Review)
        .join(Product, Product.id == Review.product_id)
        .where(Review.id == review_id, Product.is_active.is_(True))
    )
    if for_update:
        statement = statement.with_for_update()

    review = await session.scalar(statement)

    if review is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Review not found",
        )

    return review


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


async def get_source_or_404(session: AsyncSession, source_id: int) -> ReviewSource:
    source = await session.get(ReviewSource, source_id)

    if source is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Review source not found",
        )

    return source


async def get_source_or_default(
    session: AsyncSession,
    source_id: int | None,
) -> ReviewSource:
    if source_id is not None:
        return await get_source_or_404(session, source_id)

    source = await session.scalar(
        select(ReviewSource).where(ReviewSource.code == "manual"),
    )

    if source is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Manual review source is not configured",
        )

    return source


async def get_status_or_404(session: AsyncSession, status_id: int) -> ReviewStatus:
    status_item = await session.get(ReviewStatus, status_id)

    if status_item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Review status not found",
        )

    return status_item


async def get_required_status_by_code(
    session: AsyncSession,
    code: str,
) -> ReviewStatus:
    status_item = await session.scalar(
        select(ReviewStatus).where(ReviewStatus.code == code),
    )

    if status_item is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Required review status is not configured: {code}",
        )

    return status_item


async def get_user_or_404(session: AsyncSession, user_id: int) -> User:
    user = await session.get(User, user_id)

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return user


async def ensure_external_id_is_available(
    session: AsyncSession,
    source_id: int,
    external_id: str | None,
    exclude_review_id: int | None = None,
) -> None:
    if external_id is None:
        return

    statement = select(Review.id).where(
        Review.source_id == source_id,
        Review.external_id == external_id,
    )
    if exclude_review_id is not None:
        statement = statement.where(Review.id != exclude_review_id)

    existing_review_id = await session.scalar(statement)
    if existing_review_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Review with this external id already exists for the source",
        )


def build_review_list_item(
    review: Review,
    product: Product,
    source: ReviewSource,
    status_item: ReviewStatus,
    assigned_user: User | None,
) -> ReviewListItemRead:
    return ReviewListItemRead(
        id=review.id,
        external_id=review.external_id,
        product=build_product_read(product),
        source=build_source_read(source),
        review_text=review.review_text,
        rating=review.rating,
        review_date=review.review_date,
        status=build_status_read(status_item),
        assigned_user=(
            build_review_user_read(assigned_user) if assigned_user is not None else None
        ),
        created_at=review.created_at,
        updated_at=review.updated_at,
    )


def build_product_read(product: Product) -> ProductRead:
    return ProductRead(
        id=product.id,
        name=product.name,
        sku=product.sku,
        is_active=product.is_active,
    )


def build_source_read(source: ReviewSource) -> ReviewSourceRead:
    return ReviewSourceRead(id=source.id, code=source.code, name=source.name)


def build_status_read(status_item: ReviewStatus) -> ReviewStatusRead:
    return ReviewStatusRead(
        id=status_item.id,
        code=status_item.code,
        name=status_item.name,
        sort_order=status_item.sort_order,
        is_terminal=status_item.is_terminal,
    )


def build_review_user_read(user: User, role: Role | None = None) -> ReviewUserRead:
    return ReviewUserRead(
        id=user.id,
        full_name=user.full_name,
        email=user.email,
        role=(
            RoleRead(id=role.id, code=role.code, name=role.name)
            if role is not None
            else None
        ),
    )


def serialize_review(review: Review) -> dict[str, Any]:
    return {
        "id": review.id,
        "external_id": review.external_id,
        "product_id": review.product_id,
        "source_id": review.source_id,
        "review_text": review.review_text,
        "rating": review.rating,
        "review_date": serialize_date(review.review_date),
        "status_id": review.status_id,
        "assigned_user_id": review.assigned_user_id,
        "created_by_user_id": review.created_by_user_id,
        "updated_by_user_id": review.updated_by_user_id,
        "created_at": serialize_datetime(review.created_at),
        "updated_at": serialize_datetime(review.updated_at),
    }


def serialize_response(response: ReviewResponse | None) -> dict[str, Any] | None:
    if response is None:
        return None

    return {
        "id": response.id,
        "review_id": response.review_id,
        "response_text": response.response_text,
        "created_by_user_id": response.created_by_user_id,
        "updated_by_user_id": response.updated_by_user_id,
        "created_at": serialize_datetime(response.created_at),
        "updated_at": serialize_datetime(response.updated_at),
    }


def ensure_date_range_is_valid(date_from: date | None, date_to: date | None) -> None:
    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="date_from must be less than or equal to date_to",
        )


def normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None

    normalized_value = value.strip()
    return normalized_value or None


def normalize_required_text(value: str, error_message: str) -> str:
    normalized_value = value.strip()

    if not normalized_value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_message,
        )

    return normalized_value


def raise_required_field_error(message: str) -> None:
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


def serialize_date(value: date | None) -> str | None:
    if value is None:
        return None

    return value.isoformat()


def serialize_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None

    return value.isoformat()
