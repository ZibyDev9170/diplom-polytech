from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_roles
from app.db.session import get_db_session
from app.models.catalog import ReviewSource
from app.models.integration import ImportBatch, ImportItem
from app.schemas.auth import UserRead
from app.schemas.integration import ImportBatchRead, ImportItemRead
from app.schemas.reviews import ReviewSourceRead
from app.services.integration import (
    build_perekrestok_review_payload,
    build_perekrestok_review_payload_preview,
    build_mock_review_payload,
    build_mock_review_payload_preview,
    get_or_create_perekrestok_source,
    get_source_by_code_or_none,
    import_external_reviews,
)

router = APIRouter(prefix="/integration", tags=["integration"])


@router.post(
    "/reviews/import",
    response_model=ImportBatchRead,
    status_code=status.HTTP_201_CREATED,
)
async def import_reviews_from_external_source(
    payload: dict[str, Any] = Body(
        ...,
        examples=[
            {
                "source_code": "marketplace",
                "reviews": [
                    {
                        "external_id": "marketplace-10001",
                        "product_sku": "SKU-001",
                        "product_name": "Название товара",
                        "review_text": "Отличный товар, доставили быстро.",
                        "rating": 5,
                        "review_date": "2026-04-19",
                    },
                ],
            },
        ],
    ),
    current_user: UserRead = Depends(require_roles("admin", "manager")),
    session: AsyncSession = Depends(get_db_session),
) -> ImportBatchRead:
    source_code = get_required_source_code(payload)
    raw_reviews = get_required_reviews_list(payload)
    source = await get_source_by_code_or_none(session, source_code)

    if source is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Review source was not found by source_code",
        )

    try:
        result = await import_external_reviews(
            session=session,
            source=source,
            raw_reviews=raw_reviews,
            current_user=current_user,
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc

    await session.commit()

    return build_import_batch_read(result.batch, result.source, result.items)


@router.get("/mock/reviews/payload")
async def get_mock_reviews_payload(
    include_invalid: bool = False,
    include_duplicate: bool = False,
    _: UserRead = Depends(require_roles("admin", "manager")),
) -> dict[str, Any]:
    return build_mock_review_payload_preview(
        include_invalid=include_invalid,
        include_duplicate=include_duplicate,
    )


@router.post(
    "/mock/reviews/import",
    response_model=ImportBatchRead,
    status_code=status.HTTP_201_CREATED,
)
async def import_mock_reviews(
    include_invalid: bool = Query(default=False),
    include_duplicate: bool = Query(default=False),
    current_user: UserRead = Depends(require_roles("admin", "manager")),
    session: AsyncSession = Depends(get_db_session),
) -> ImportBatchRead:
    payload = await build_mock_review_payload(
        session=session,
        include_invalid=include_invalid,
        include_duplicate=include_duplicate,
    )
    source = await get_source_by_code_or_none(session, payload["source_code"])

    if source is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mock review source is not configured",
        )

    try:
        result = await import_external_reviews(
            session=session,
            source=source,
            raw_reviews=payload["reviews"],
            current_user=current_user,
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc

    await session.commit()

    return build_import_batch_read(result.batch, result.source, result.items)


@router.get("/perekrestok/reviews/payload")
async def get_perekrestok_reviews_payload(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    _: UserRead = Depends(require_roles("admin", "manager")),
) -> dict[str, Any]:
    try:
        return await build_perekrestok_review_payload_preview(
            offset=offset,
            limit=limit,
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc


@router.post(
    "/perekrestok/reviews/import",
    response_model=ImportBatchRead,
    status_code=status.HTTP_201_CREATED,
)
async def import_perekrestok_reviews(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    current_user: UserRead = Depends(require_roles("admin", "manager")),
    session: AsyncSession = Depends(get_db_session),
) -> ImportBatchRead:
    try:
        payload = await build_perekrestok_review_payload(
            session=session,
            offset=offset,
            limit=limit,
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    source = await get_or_create_perekrestok_source(session)

    try:
        result = await import_external_reviews(
            session=session,
            source=source,
            raw_reviews=payload["reviews"],
            current_user=current_user,
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc

    await session.commit()

    return build_import_batch_read(result.batch, result.source, result.items)


@router.get("/import-batches", response_model=list[ImportBatchRead])
async def list_import_batches(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _: UserRead = Depends(require_roles("admin", "manager")),
    session: AsyncSession = Depends(get_db_session),
) -> list[ImportBatchRead]:
    result = await session.execute(
        select(ImportBatch, ReviewSource)
        .join(ReviewSource, ReviewSource.id == ImportBatch.source_id)
        .order_by(ImportBatch.started_at.desc(), ImportBatch.id.desc())
        .limit(limit)
        .offset(offset),
    )

    batches = []
    for batch, source in result.all():
        items = await list_import_items(session, batch.id)
        batches.append(build_import_batch_read(batch, source, items))

    return batches


@router.get("/import-batches/{batch_id}", response_model=ImportBatchRead)
async def get_import_batch(
    batch_id: int,
    _: UserRead = Depends(require_roles("admin", "manager")),
    session: AsyncSession = Depends(get_db_session),
) -> ImportBatchRead:
    result = await session.execute(
        select(ImportBatch, ReviewSource)
        .join(ReviewSource, ReviewSource.id == ImportBatch.source_id)
        .where(ImportBatch.id == batch_id),
    )
    row = result.one_or_none()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Import batch was not found",
        )

    batch, source = row
    items = await list_import_items(session, batch.id)

    return build_import_batch_read(batch, source, items)


async def list_import_items(session: AsyncSession, batch_id: int) -> list[ImportItem]:
    result = await session.execute(
        select(ImportItem)
        .where(ImportItem.batch_id == batch_id)
        .order_by(ImportItem.id),
    )

    return list(result.scalars())


def get_required_source_code(payload: dict[str, Any]) -> str:
    source_code = payload.get("source_code")

    if not isinstance(source_code, str) or not source_code.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="source_code is required",
        )

    return source_code.strip().lower()


def get_required_reviews_list(payload: dict[str, Any]) -> list[Any]:
    reviews = payload.get("reviews")

    if not isinstance(reviews, list):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="reviews must be an array",
        )

    return reviews


def build_import_batch_read(
    batch: ImportBatch,
    source: ReviewSource,
    items: list[ImportItem],
) -> ImportBatchRead:
    return ImportBatchRead(
        id=batch.id,
        source=build_source_read(source),
        started_at=batch.started_at,
        finished_at=batch.finished_at,
        status=batch.status,
        total_count=batch.total_count,
        success_count=batch.success_count,
        failed_count=batch.failed_count,
        skipped_count=sum(1 for item in items if item.import_status == "skipped"),
        items=[build_import_item_read(item) for item in items],
    )


def build_import_item_read(item: ImportItem) -> ImportItemRead:
    return ImportItemRead(
        id=item.id,
        external_review_id=item.external_review_id,
        import_status=item.import_status,
        error_message=item.error_message,
        payload_json=item.payload_json,
        created_at=item.created_at,
    )


def build_source_read(source: ReviewSource) -> ReviewSourceRead:
    return ReviewSourceRead(id=source.id, code=source.code, name=source.name)
