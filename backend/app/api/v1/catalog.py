from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.api.deps import get_current_user
from app.db.session import get_db_session
from app.models.catalog import (
    AllowedStatusTransition,
    Product,
    ReviewSource,
    ReviewStatus,
)
from app.schemas.auth import UserRead
from app.schemas.catalog import (
    ProductCatalogRead,
    ProductCreateRequest,
    ProductUpdateRequest,
    ReviewSourceCatalogRead,
    ReviewSourceCreateRequest,
    ReviewSourceUpdateRequest,
    ReviewStatusCatalogRead,
    ReviewStatusCreateRequest,
    ReviewStatusUpdateRequest,
    StatusTransitionCreateRequest,
    StatusTransitionRead,
)
from app.services.audit import AuditEntity, AuditEvent, add_audit_log

router = APIRouter(prefix="/catalog", tags=["catalog"])


def require_catalog_access(
    current_user: UserRead = Depends(get_current_user),
) -> UserRead:
    if current_user.role.code == "support":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient role permissions",
        )

    return current_user


@router.get("/products", response_model=list[ProductCatalogRead])
async def list_products(
    include_inactive: bool = True,
    _: UserRead = Depends(require_catalog_access),
    session: AsyncSession = Depends(get_db_session),
) -> list[ProductCatalogRead]:
    statement = select(Product).order_by(Product.id)
    if not include_inactive:
        statement = statement.where(Product.is_active.is_(True))

    result = await session.execute(statement)
    return [build_product_read(product) for product in result.scalars()]


@router.post(
    "/products",
    response_model=ProductCatalogRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_product(
    payload: ProductCreateRequest,
    current_user: UserRead = Depends(require_catalog_access),
    session: AsyncSession = Depends(get_db_session),
) -> ProductCatalogRead:
    name = normalize_required_text(payload.name, "Product name is required")
    sku = normalize_required_text(payload.sku, "Product SKU is required")
    await ensure_product_sku_is_available(session, sku)

    product = Product(name=name, sku=sku, is_active=payload.is_active)
    session.add(product)
    await session.flush()
    await session.refresh(product)

    add_audit_log(
        session=session,
        actor_id=current_user.id,
        entity_type=AuditEntity.PRODUCT,
        entity_id=product.id,
        action=AuditEvent.PRODUCT_CREATE,
        new_values=serialize_product(product),
    )
    await session.commit()

    return build_product_read(product)


@router.patch("/products/{product_id}", response_model=ProductCatalogRead)
async def update_product(
    product_id: int,
    payload: ProductUpdateRequest,
    current_user: UserRead = Depends(require_catalog_access),
    session: AsyncSession = Depends(get_db_session),
) -> ProductCatalogRead:
    ensure_payload_has_fields(payload.model_fields_set)
    product = await get_product_or_404(session, product_id)
    old_values = serialize_product(product)

    if "name" in payload.model_fields_set:
        if payload.name is None:
            raise_required_field_error("Product name is required")
        product.name = normalize_required_text(payload.name, "Product name is required")

    if "sku" in payload.model_fields_set:
        if payload.sku is None:
            raise_required_field_error("Product SKU is required")
        sku = normalize_required_text(payload.sku, "Product SKU is required")
        await ensure_product_sku_is_available(session, sku, exclude_product_id=product.id)
        product.sku = sku

    if "is_active" in payload.model_fields_set:
        if payload.is_active is None:
            raise_required_field_error("Product active flag is required")
        product.is_active = payload.is_active

    await session.flush()
    add_audit_log(
        session=session,
        actor_id=current_user.id,
        entity_type=AuditEntity.PRODUCT,
        entity_id=product.id,
        action=AuditEvent.PRODUCT_UPDATE,
        old_values=old_values,
        new_values=serialize_product(product),
    )
    await session.commit()

    return build_product_read(product)


@router.patch("/products/{product_id}/activate", response_model=ProductCatalogRead)
async def activate_product(
    product_id: int,
    current_user: UserRead = Depends(require_catalog_access),
    session: AsyncSession = Depends(get_db_session),
) -> ProductCatalogRead:
    return await set_product_active_state(
        product_id=product_id,
        is_active=True,
        action=AuditEvent.PRODUCT_ACTIVATE,
        current_user=current_user,
        session=session,
    )


@router.patch("/products/{product_id}/deactivate", response_model=ProductCatalogRead)
async def deactivate_product(
    product_id: int,
    current_user: UserRead = Depends(require_catalog_access),
    session: AsyncSession = Depends(get_db_session),
) -> ProductCatalogRead:
    return await set_product_active_state(
        product_id=product_id,
        is_active=False,
        action=AuditEvent.PRODUCT_DEACTIVATE,
        current_user=current_user,
        session=session,
    )


@router.get("/review-sources", response_model=list[ReviewSourceCatalogRead])
async def list_review_sources(
    _: UserRead = Depends(require_catalog_access),
    session: AsyncSession = Depends(get_db_session),
) -> list[ReviewSourceCatalogRead]:
    result = await session.execute(select(ReviewSource).order_by(ReviewSource.id))
    return [build_source_read(source) for source in result.scalars()]


@router.post(
    "/review-sources",
    response_model=ReviewSourceCatalogRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_review_source(
    payload: ReviewSourceCreateRequest,
    current_user: UserRead = Depends(require_catalog_access),
    session: AsyncSession = Depends(get_db_session),
) -> ReviewSourceCatalogRead:
    code = normalize_code(payload.code, "Source code is required")
    name = normalize_required_text(payload.name, "Source name is required")
    await ensure_source_code_is_available(session, code)

    source = ReviewSource(code=code, name=name)
    session.add(source)
    await session.flush()
    await session.refresh(source)

    add_audit_log(
        session=session,
        actor_id=current_user.id,
        entity_type=AuditEntity.REVIEW_SOURCE,
        entity_id=source.id,
        action=AuditEvent.REVIEW_SOURCE_CREATE,
        new_values=serialize_source(source),
    )
    await session.commit()

    return build_source_read(source)


@router.patch("/review-sources/{source_id}", response_model=ReviewSourceCatalogRead)
async def update_review_source(
    source_id: int,
    payload: ReviewSourceUpdateRequest,
    current_user: UserRead = Depends(require_catalog_access),
    session: AsyncSession = Depends(get_db_session),
) -> ReviewSourceCatalogRead:
    ensure_payload_has_fields(payload.model_fields_set)
    source = await get_source_or_404(session, source_id)
    old_values = serialize_source(source)

    if "code" in payload.model_fields_set:
        if payload.code is None:
            raise_required_field_error("Source code is required")
        code = normalize_code(payload.code, "Source code is required")
        ensure_system_code_is_not_changed(source.code, code, "manual")
        await ensure_source_code_is_available(session, code, exclude_source_id=source.id)
        source.code = code

    if "name" in payload.model_fields_set:
        if payload.name is None:
            raise_required_field_error("Source name is required")
        source.name = normalize_required_text(payload.name, "Source name is required")

    await session.flush()
    add_audit_log(
        session=session,
        actor_id=current_user.id,
        entity_type=AuditEntity.REVIEW_SOURCE,
        entity_id=source.id,
        action=AuditEvent.REVIEW_SOURCE_UPDATE,
        old_values=old_values,
        new_values=serialize_source(source),
    )
    await session.commit()

    return build_source_read(source)


@router.get("/review-statuses", response_model=list[ReviewStatusCatalogRead])
async def list_review_statuses(
    _: UserRead = Depends(require_catalog_access),
    session: AsyncSession = Depends(get_db_session),
) -> list[ReviewStatusCatalogRead]:
    result = await session.execute(
        select(ReviewStatus).order_by(ReviewStatus.sort_order, ReviewStatus.id),
    )
    return [build_status_read(status_item) for status_item in result.scalars()]


@router.post(
    "/review-statuses",
    response_model=ReviewStatusCatalogRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_review_status(
    payload: ReviewStatusCreateRequest,
    current_user: UserRead = Depends(require_catalog_access),
    session: AsyncSession = Depends(get_db_session),
) -> ReviewStatusCatalogRead:
    code = normalize_code(payload.code, "Status code is required")
    name = normalize_required_text(payload.name, "Status name is required")
    await ensure_status_code_is_available(session, code)

    status_item = ReviewStatus(
        code=code,
        name=name,
        sort_order=payload.sort_order,
        is_terminal=payload.is_terminal,
    )
    session.add(status_item)
    await session.flush()
    await session.refresh(status_item)

    add_audit_log(
        session=session,
        actor_id=current_user.id,
        entity_type=AuditEntity.REVIEW_STATUS,
        entity_id=status_item.id,
        action=AuditEvent.REVIEW_STATUS_CREATE,
        new_values=serialize_status(status_item),
    )
    await session.commit()

    return build_status_read(status_item)


@router.patch("/review-statuses/{status_id}", response_model=ReviewStatusCatalogRead)
async def update_review_status(
    status_id: int,
    payload: ReviewStatusUpdateRequest,
    current_user: UserRead = Depends(require_catalog_access),
    session: AsyncSession = Depends(get_db_session),
) -> ReviewStatusCatalogRead:
    ensure_payload_has_fields(payload.model_fields_set)
    status_item = await get_status_or_404(session, status_id)
    old_values = serialize_status(status_item)

    if "code" in payload.model_fields_set:
        if payload.code is None:
            raise_required_field_error("Status code is required")
        code = normalize_code(payload.code, "Status code is required")
        ensure_system_code_is_not_changed(status_item.code, code, "new")
        await ensure_status_code_is_available(session, code, exclude_status_id=status_item.id)
        status_item.code = code

    if "name" in payload.model_fields_set:
        if payload.name is None:
            raise_required_field_error("Status name is required")
        status_item.name = normalize_required_text(payload.name, "Status name is required")

    if "sort_order" in payload.model_fields_set:
        if payload.sort_order is None:
            raise_required_field_error("Status sort order is required")
        status_item.sort_order = payload.sort_order

    if "is_terminal" in payload.model_fields_set:
        if payload.is_terminal is None:
            raise_required_field_error("Status terminal flag is required")
        status_item.is_terminal = payload.is_terminal

    await session.flush()
    add_audit_log(
        session=session,
        actor_id=current_user.id,
        entity_type=AuditEntity.REVIEW_STATUS,
        entity_id=status_item.id,
        action=AuditEvent.REVIEW_STATUS_UPDATE,
        old_values=old_values,
        new_values=serialize_status(status_item),
    )
    await session.commit()

    return build_status_read(status_item)


@router.get("/status-transitions", response_model=list[StatusTransitionRead])
async def list_status_transitions(
    _: UserRead = Depends(require_catalog_access),
    session: AsyncSession = Depends(get_db_session),
) -> list[StatusTransitionRead]:
    from_status = aliased(ReviewStatus)
    to_status = aliased(ReviewStatus)
    result = await session.execute(
        select(AllowedStatusTransition, from_status, to_status)
        .join(from_status, from_status.id == AllowedStatusTransition.from_status_id)
        .join(to_status, to_status.id == AllowedStatusTransition.to_status_id)
        .order_by(from_status.sort_order, to_status.sort_order, AllowedStatusTransition.id),
    )

    return [
        build_transition_read(transition, old_status, new_status)
        for transition, old_status, new_status in result.all()
    ]


@router.post(
    "/status-transitions",
    response_model=StatusTransitionRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_status_transition(
    payload: StatusTransitionCreateRequest,
    current_user: UserRead = Depends(require_catalog_access),
    session: AsyncSession = Depends(get_db_session),
) -> StatusTransitionRead:
    if payload.from_status_id == payload.to_status_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Transition statuses must be different",
        )

    from_status = await get_status_or_404(session, payload.from_status_id)
    to_status = await get_status_or_404(session, payload.to_status_id)
    await ensure_transition_is_available(session, from_status.id, to_status.id)

    transition = AllowedStatusTransition(
        from_status_id=from_status.id,
        to_status_id=to_status.id,
    )
    session.add(transition)
    await session.flush()
    await session.refresh(transition)

    add_audit_log(
        session=session,
        actor_id=current_user.id,
        entity_type=AuditEntity.STATUS_TRANSITION,
        entity_id=transition.id,
        action=AuditEvent.STATUS_TRANSITION_CREATE,
        new_values=serialize_transition(transition),
    )
    await session.commit()

    return build_transition_read(transition, from_status, to_status)


@router.delete(
    "/status-transitions/{transition_id}",
    response_model=None,
    response_class=Response,
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_status_transition(
    transition_id: int,
    current_user: UserRead = Depends(require_catalog_access),
    session: AsyncSession = Depends(get_db_session),
) -> None:
    transition = await get_transition_or_404(session, transition_id)
    old_values = serialize_transition(transition)

    await session.delete(transition)
    add_audit_log(
        session=session,
        actor_id=current_user.id,
        entity_type=AuditEntity.STATUS_TRANSITION,
        entity_id=transition_id,
        action=AuditEvent.STATUS_TRANSITION_DELETE,
        old_values=old_values,
    )
    await session.commit()


async def set_product_active_state(
    product_id: int,
    is_active: bool,
    action: AuditEvent,
    current_user: UserRead,
    session: AsyncSession,
) -> ProductCatalogRead:
    product = await get_product_or_404(session, product_id)
    old_values = serialize_product(product)
    product.is_active = is_active

    await session.flush()
    add_audit_log(
        session=session,
        actor_id=current_user.id,
        entity_type=AuditEntity.PRODUCT,
        entity_id=product.id,
        action=action,
        old_values=old_values,
        new_values=serialize_product(product),
    )
    await session.commit()

    return build_product_read(product)


async def get_product_or_404(session: AsyncSession, product_id: int) -> Product:
    product = await session.get(Product, product_id)
    if product is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found",
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


async def get_status_or_404(session: AsyncSession, status_id: int) -> ReviewStatus:
    status_item = await session.get(ReviewStatus, status_id)
    if status_item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Review status not found",
        )

    return status_item


async def get_transition_or_404(
    session: AsyncSession,
    transition_id: int,
) -> AllowedStatusTransition:
    transition = await session.get(AllowedStatusTransition, transition_id)
    if transition is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Status transition not found",
        )

    return transition


async def ensure_product_sku_is_available(
    session: AsyncSession,
    sku: str,
    exclude_product_id: int | None = None,
) -> None:
    statement = select(Product.id).where(func.lower(Product.sku) == sku.lower())
    if exclude_product_id is not None:
        statement = statement.where(Product.id != exclude_product_id)

    existing_id = await session.scalar(statement)
    if existing_id is not None:
        raise_conflict("Product with this SKU already exists")


async def ensure_source_code_is_available(
    session: AsyncSession,
    code: str,
    exclude_source_id: int | None = None,
) -> None:
    statement = select(ReviewSource.id).where(func.lower(ReviewSource.code) == code.lower())
    if exclude_source_id is not None:
        statement = statement.where(ReviewSource.id != exclude_source_id)

    existing_id = await session.scalar(statement)
    if existing_id is not None:
        raise_conflict("Review source with this code already exists")


async def ensure_status_code_is_available(
    session: AsyncSession,
    code: str,
    exclude_status_id: int | None = None,
) -> None:
    statement = select(ReviewStatus.id).where(func.lower(ReviewStatus.code) == code.lower())
    if exclude_status_id is not None:
        statement = statement.where(ReviewStatus.id != exclude_status_id)

    existing_id = await session.scalar(statement)
    if existing_id is not None:
        raise_conflict("Review status with this code already exists")


async def ensure_transition_is_available(
    session: AsyncSession,
    from_status_id: int,
    to_status_id: int,
) -> None:
    existing_id = await session.scalar(
        select(AllowedStatusTransition.id).where(
            AllowedStatusTransition.from_status_id == from_status_id,
            AllowedStatusTransition.to_status_id == to_status_id,
        ),
    )
    if existing_id is not None:
        raise_conflict("Status transition already exists")


def build_product_read(product: Product) -> ProductCatalogRead:
    return ProductCatalogRead(
        id=product.id,
        name=product.name,
        sku=product.sku,
        is_active=product.is_active,
        created_at=product.created_at,
    )


def build_source_read(source: ReviewSource) -> ReviewSourceCatalogRead:
    return ReviewSourceCatalogRead(id=source.id, code=source.code, name=source.name)


def build_status_read(status_item: ReviewStatus) -> ReviewStatusCatalogRead:
    return ReviewStatusCatalogRead(
        id=status_item.id,
        code=status_item.code,
        name=status_item.name,
        sort_order=status_item.sort_order,
        is_terminal=status_item.is_terminal,
    )


def build_transition_read(
    transition: AllowedStatusTransition,
    from_status: ReviewStatus,
    to_status: ReviewStatus,
) -> StatusTransitionRead:
    return StatusTransitionRead(
        id=transition.id,
        from_status=build_status_read(from_status),
        to_status=build_status_read(to_status),
    )


def serialize_product(product: Product) -> dict[str, Any]:
    return {
        "id": product.id,
        "name": product.name,
        "sku": product.sku,
        "is_active": product.is_active,
        "created_at": product.created_at.isoformat() if product.created_at else None,
    }


def serialize_source(source: ReviewSource) -> dict[str, Any]:
    return {"id": source.id, "code": source.code, "name": source.name}


def serialize_status(status_item: ReviewStatus) -> dict[str, Any]:
    return {
        "id": status_item.id,
        "code": status_item.code,
        "name": status_item.name,
        "sort_order": status_item.sort_order,
        "is_terminal": status_item.is_terminal,
    }


def serialize_transition(transition: AllowedStatusTransition) -> dict[str, Any]:
    return {
        "id": transition.id,
        "from_status_id": transition.from_status_id,
        "to_status_id": transition.to_status_id,
    }


def ensure_payload_has_fields(fields: set[str]) -> None:
    if not fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields provided",
        )


def normalize_required_text(value: str, error_message: str) -> str:
    normalized_value = value.strip()
    if not normalized_value:
        raise_required_field_error(error_message)

    return normalized_value


def normalize_code(value: str, error_message: str) -> str:
    return normalize_required_text(value, error_message).lower()


def ensure_system_code_is_not_changed(
    current_code: str,
    next_code: str,
    protected_code: str,
) -> None:
    if current_code == protected_code and next_code != protected_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"System code cannot be changed: {protected_code}",
        )


def raise_required_field_error(message: str) -> None:
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


def raise_conflict(message: str) -> None:
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)
