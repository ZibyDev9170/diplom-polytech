from __future__ import annotations

import asyncio
import json
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import Product, ReviewSource, ReviewStatus
from app.models.integration import ImportBatch, ImportItem
from app.models.reviews import Review, ReviewStatusHistory
from app.schemas.integration import ExternalReviewItem
from app.schemas.auth import UserRead
from app.services.audit import AuditEntity, AuditEvent, add_audit_log

MOCK_SOURCE_CODE = "marketplace"
PEREKRESTOK_SOURCE_CODE = "perekrestok"
PEREKRESTOK_SOURCE_NAME = "Перекресток"
PEREKRESTOK_DATASET = "lapki/perekrestok-reviews"
PEREKRESTOK_DATASET_CONFIG = "default"
PEREKRESTOK_DATASET_SPLIT = "train"
HUGGING_FACE_ROWS_URL = "https://datasets-server.huggingface.co/rows"
HUGGING_FACE_TIMEOUT_SECONDS = 30

MOCK_PRODUCT_SEEDS = [
    ("DEMO-HEADPHONES", "Беспроводные наушники Pulse"),
    ("DEMO-COFFEE-MACHINE", "Кофемашина Barista Mini"),
    ("DEMO-BACKPACK", "Городской рюкзак Nord"),
    ("DEMO-LAMP", "Настольная лампа Lumi"),
    ("DEMO-THERMOS", "Термокружка Travel 500"),
]

MOCK_REVIEW_TEXTS = [
    ("Очень понравилось качество сборки, пользуюсь каждый день.", 5),
    ("Доставка быстрая, упаковка целая, товар соответствует описанию.", 5),
    ("В целом нормально, но ожидал чуть более плотные материалы.", 4),
    ("Хороший вариант за свои деньги, без лишних сюрпризов.", 4),
    ("После недели использования заметил небольшой люфт.", 3),
    ("Функции работают, но инструкция могла быть понятнее.", 3),
    ("Цвет отличается от фотографии, это расстроило.", 2),
    ("Пришлось оформлять возврат, товар пришел с дефектом.", 1),
    ("Покупкой доволен, буду заказывать еще.", 5),
    ("Есть мелкие недочеты, но пользоваться можно.", 3),
    ("Качество выше ожиданий, особенно за такую цену.", 5),
    ("Не понравился запах пластика после распаковки.", 2),
    ("Товар удобный, но доставка заняла больше недели.", 4),
    ("Комплектация полная, все работает стабильно.", 5),
    ("Через пару дней перестала работать одна функция.", 1),
]


@dataclass
class ReviewImportResult:
    batch: ImportBatch
    source: ReviewSource
    items: list[ImportItem]


async def import_external_reviews(
    *,
    session: AsyncSession,
    source: ReviewSource,
    raw_reviews: list[Any],
    current_user: UserRead,
) -> ReviewImportResult:
    now = datetime.now(timezone.utc)
    new_status = await get_required_status_by_code(session, "new")
    batch = ImportBatch(
        source_id=source.id,
        status="running",
        total_count=len(raw_reviews),
        success_count=0,
        failed_count=0,
    )
    session.add(batch)
    await session.flush()
    await session.refresh(batch)

    items: list[ImportItem] = []
    seen_external_ids: set[str] = set()
    used_import_item_external_ids: set[str] = set()
    skipped_count = 0

    for index, raw_item in enumerate(raw_reviews, start=1):
        payload_json = normalize_payload_for_jsonb(raw_item)
        fallback_external_id = f"invalid-{index}"

        try:
            external_review = ExternalReviewItem.model_validate(raw_item)
        except ValidationError as exc:
            batch.failed_count += 1
            item_external_id = get_unique_import_item_external_id(
                get_external_id_from_raw_item(raw_item, fallback_external_id),
                used_import_item_external_ids,
            )
            import_item = build_import_item(
                batch_id=batch.id,
                external_review_id=item_external_id,
                payload_json=payload_json,
                import_status="failed",
                error_message=build_validation_error_message(exc),
            )
            session.add(import_item)
            items.append(import_item)
            continue
        except ValueError as exc:
            batch.failed_count += 1
            item_external_id = get_unique_import_item_external_id(
                get_external_id_from_raw_item(raw_item, fallback_external_id),
                used_import_item_external_ids,
            )
            import_item = build_import_item(
                batch_id=batch.id,
                external_review_id=item_external_id,
                payload_json=payload_json,
                import_status="failed",
                error_message=str(exc),
            )
            session.add(import_item)
            items.append(import_item)
            continue

        external_id = external_review.external_id.strip()
        if external_id in seen_external_ids:
            skipped_count += 1
            item_external_id = get_unique_import_item_external_id(
                external_id,
                used_import_item_external_ids,
            )
            import_item = build_import_item(
                batch_id=batch.id,
                external_review_id=item_external_id,
                payload_json=payload_json,
                import_status="skipped",
                error_message="Duplicate external_id inside the current import batch",
            )
            session.add(import_item)
            items.append(import_item)
            continue

        seen_external_ids.add(external_id)

        existing_review_id = await get_existing_review_id(
            session=session,
            source_id=source.id,
            external_id=external_id,
        )
        if existing_review_id is not None:
            skipped_count += 1
            item_external_id = get_unique_import_item_external_id(
                external_id,
                used_import_item_external_ids,
            )
            import_item = build_import_item(
                batch_id=batch.id,
                external_review_id=item_external_id,
                payload_json=payload_json,
                import_status="skipped",
                error_message=f"Review already exists: {existing_review_id}",
            )
            session.add(import_item)
            items.append(import_item)
            continue

        product = await find_product_for_external_review(session, external_review)
        if product is None:
            batch.failed_count += 1
            item_external_id = get_unique_import_item_external_id(
                external_id,
                used_import_item_external_ids,
            )
            import_item = build_import_item(
                batch_id=batch.id,
                external_review_id=item_external_id,
                payload_json=payload_json,
                import_status="failed",
                error_message="Product was not found by product_id or product_sku",
            )
            session.add(import_item)
            items.append(import_item)
            continue

        review = Review(
            external_id=external_id,
            product_id=product.id,
            source_id=source.id,
            review_text=external_review.review_text.strip(),
            rating=external_review.rating,
            review_date=external_review.review_date,
            status_id=new_status.id,
            assigned_user_id=None,
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
                comment="Imported from external source",
            ),
        )

        item_external_id = get_unique_import_item_external_id(
            external_id,
            used_import_item_external_ids,
        )
        import_item = build_import_item(
            batch_id=batch.id,
            external_review_id=item_external_id,
            payload_json=payload_json,
            import_status="success",
            error_message=None,
        )
        session.add(import_item)
        items.append(import_item)
        batch.success_count += 1

    batch.finished_at = datetime.now(timezone.utc)
    batch.status = get_batch_status(
        total_count=batch.total_count,
        success_count=batch.success_count,
        failed_count=batch.failed_count,
        skipped_count=skipped_count,
    )

    add_audit_log(
        session=session,
        actor_id=current_user.id,
        entity_type=AuditEntity.IMPORT_BATCH,
        entity_id=batch.id,
        action=AuditEvent.REVIEW_IMPORT,
        new_values={
            "source_id": source.id,
            "source_code": source.code,
            "total_count": batch.total_count,
            "success_count": batch.success_count,
            "failed_count": batch.failed_count,
            "skipped_count": skipped_count,
            "status": batch.status,
        },
    )
    await session.flush()

    for item in items:
        await session.refresh(item)

    return ReviewImportResult(batch=batch, source=source, items=items)


async def build_mock_review_payload(
    *,
    session: AsyncSession,
    include_invalid: bool = False,
    include_duplicate: bool = False,
) -> dict[str, Any]:
    products = await get_or_create_mock_products(session)
    today = date.today()
    reviews: list[dict[str, Any]] = []

    for index, (review_text, rating) in enumerate(MOCK_REVIEW_TEXTS, start=1):
        product = products[(index - 1) % len(products)]
        reviews.append(
            {
                "external_id": f"mock-{today.isoformat()}-{index:02d}",
                "product_sku": product.sku,
                "product_name": product.name,
                "review_text": review_text,
                "rating": rating,
                "review_date": today.isoformat(),
            },
        )

    if include_duplicate and reviews:
        reviews.append({**reviews[0]})

    if include_invalid:
        reviews.append(
            {
                "external_id": f"mock-invalid-{today.isoformat()}",
                "product_sku": products[0].sku,
                "rating": 6,
                "review_date": today.isoformat(),
            },
        )

    return {"source_code": MOCK_SOURCE_CODE, "reviews": reviews}


async def build_perekrestok_review_payload(
    *,
    session: AsyncSession,
    offset: int,
    limit: int,
) -> dict[str, Any]:
    rows = await fetch_perekrestok_rows(offset=offset, limit=limit)
    reviews = [map_perekrestok_row_to_external_review(row) for row in rows]
    await get_or_create_perekrestok_products(session, reviews)

    return {"source_code": PEREKRESTOK_SOURCE_CODE, "reviews": reviews}


async def build_perekrestok_review_payload_preview(
    *,
    offset: int,
    limit: int,
) -> dict[str, Any]:
    rows = await fetch_perekrestok_rows(offset=offset, limit=limit)

    return {
        "source_code": PEREKRESTOK_SOURCE_CODE,
        "reviews": [map_perekrestok_row_to_external_review(row) for row in rows],
    }


async def fetch_perekrestok_rows(*, offset: int, limit: int) -> list[dict[str, Any]]:
    return await asyncio.to_thread(fetch_perekrestok_rows_sync, offset, limit)


def fetch_perekrestok_rows_sync(offset: int, limit: int) -> list[dict[str, Any]]:
    query = urllib.parse.urlencode(
        {
            "dataset": PEREKRESTOK_DATASET,
            "config": PEREKRESTOK_DATASET_CONFIG,
            "split": PEREKRESTOK_DATASET_SPLIT,
            "offset": offset,
            "length": limit,
        },
    )
    request = urllib.request.Request(
        f"{HUGGING_FACE_ROWS_URL}?{query}",
        headers={"Accept": "application/json", "User-Agent": "review-management-system"},
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=HUGGING_FACE_TIMEOUT_SECONDS,
        ) as response:
            response_body = response.read().decode("utf-8")
    except OSError as exc:
        raise RuntimeError("Could not fetch Perekrestok reviews from Hugging Face") from exc

    try:
        payload = json.loads(response_body)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Hugging Face returned invalid JSON") from exc

    rows = payload.get("rows")
    if not isinstance(rows, list):
        raise RuntimeError("Hugging Face response does not contain rows")

    parsed_rows: list[dict[str, Any]] = []
    for item in rows:
        if isinstance(item, dict) and isinstance(item.get("row"), dict):
            parsed_rows.append(item["row"])

    return parsed_rows


def map_perekrestok_row_to_external_review(row: dict[str, Any]) -> dict[str, Any]:
    product_id = normalize_external_text(row.get("product_id")) or "unknown-product"
    review_id = normalize_external_text(row.get("review_id")) or "unknown-review"
    product_name = normalize_external_text(row.get("product_name")) or "Товар Перекресток"
    review_text = normalize_external_text(row.get("review_text")) or ""
    rating = normalize_rating(row.get("rating"))

    return {
        "external_id": f"perekrestok-{review_id}",
        "product_sku": build_perekrestok_product_sku(product_id),
        "product_name": product_name,
        "review_text": review_text,
        "rating": rating,
        "review_date": date.today().isoformat(),
        "source_payload": {
            "product_id": row.get("product_id"),
            "product_category": row.get("product_category"),
            "product_price": row.get("product_price"),
            "review_author": row.get("review_author"),
        },
    }


async def get_or_create_perekrestok_source(session: AsyncSession) -> ReviewSource:
    source = await get_source_by_code_or_none(session, PEREKRESTOK_SOURCE_CODE)

    if source is not None:
        return source

    source = ReviewSource(code=PEREKRESTOK_SOURCE_CODE, name=PEREKRESTOK_SOURCE_NAME)
    session.add(source)
    await session.flush()
    await session.refresh(source)

    return source


async def get_or_create_perekrestok_products(
    session: AsyncSession,
    reviews: list[dict[str, Any]],
) -> list[Product]:
    product_by_sku: dict[str, str] = {}
    for review in reviews:
        product_sku = normalize_external_text(review.get("product_sku"))
        product_name = normalize_external_text(review.get("product_name"))

        if product_sku:
            product_by_sku[product_sku] = product_name or product_sku

    if not product_by_sku:
        return []

    result = await session.execute(
        select(Product).where(Product.sku.in_(product_by_sku.keys())),
    )
    existing_products = {product.sku: product for product in result.scalars()}
    created_products = []

    for product_sku, product_name in product_by_sku.items():
        if product_sku in existing_products:
            continue

        product = Product(sku=product_sku, name=product_name, is_active=True)
        session.add(product)
        created_products.append(product)

    if created_products:
        await session.flush()

        for product in created_products:
            await session.refresh(product)

    return [*existing_products.values(), *created_products]


def build_mock_review_payload_preview(
    *,
    include_invalid: bool = False,
    include_duplicate: bool = False,
) -> dict[str, Any]:
    today = date.today()
    reviews: list[dict[str, Any]] = []

    for index, (review_text, rating) in enumerate(MOCK_REVIEW_TEXTS, start=1):
        sku, name = MOCK_PRODUCT_SEEDS[(index - 1) % len(MOCK_PRODUCT_SEEDS)]
        reviews.append(
            {
                "external_id": f"mock-{today.isoformat()}-{index:02d}",
                "product_sku": sku,
                "product_name": name,
                "review_text": review_text,
                "rating": rating,
                "review_date": today.isoformat(),
            },
        )

    if include_duplicate and reviews:
        reviews.append({**reviews[0]})

    if include_invalid:
        reviews.append(
            {
                "external_id": f"mock-invalid-{today.isoformat()}",
                "product_sku": MOCK_PRODUCT_SEEDS[0][0],
                "rating": 6,
                "review_date": today.isoformat(),
            },
        )

    return {"source_code": MOCK_SOURCE_CODE, "reviews": reviews}


async def get_or_create_mock_products(session: AsyncSession) -> list[Product]:
    result = await session.execute(
        select(Product).where(Product.is_active.is_(True)).order_by(Product.id).limit(5),
    )
    products = list(result.scalars())
    if products:
        return products

    products = [Product(sku=sku, name=name, is_active=True) for sku, name in MOCK_PRODUCT_SEEDS]
    session.add_all(products)
    await session.flush()

    for product in products:
        await session.refresh(product)

    return products


async def get_source_by_code_or_none(
    session: AsyncSession,
    source_code: str,
) -> ReviewSource | None:
    normalized_code = source_code.strip().lower()

    if not normalized_code:
        return None

    return await session.scalar(
        select(ReviewSource).where(func.lower(ReviewSource.code) == normalized_code),
    )


async def get_required_status_by_code(session: AsyncSession, code: str) -> ReviewStatus:
    status = await session.scalar(
        select(ReviewStatus).where(ReviewStatus.code == code),
    )

    if status is None:
        raise RuntimeError(f"Required review status is not configured: {code}")

    return status


async def get_existing_review_id(
    *,
    session: AsyncSession,
    source_id: int,
    external_id: str,
) -> int | None:
    return await session.scalar(
        select(Review.id).where(
            Review.source_id == source_id,
            Review.external_id == external_id,
        ),
    )


async def find_product_for_external_review(
    session: AsyncSession,
    external_review: ExternalReviewItem,
) -> Product | None:
    if external_review.product_id is not None:
        product = await session.scalar(
            select(Product).where(
                Product.id == external_review.product_id,
                Product.is_active.is_(True),
            ),
        )
        if product is not None:
            return product

    if external_review.product_sku is not None:
        return await session.scalar(
            select(Product).where(
                func.lower(Product.sku) == external_review.product_sku.strip().lower(),
                Product.is_active.is_(True),
            ),
        )

    return None


def build_import_item(
    *,
    batch_id: int,
    external_review_id: str,
    payload_json: dict[str, Any],
    import_status: str,
    error_message: str | None,
) -> ImportItem:
    return ImportItem(
        batch_id=batch_id,
        external_review_id=external_review_id[:255],
        payload_json=payload_json,
        import_status=import_status,
        error_message=error_message,
    )


def get_external_id_from_raw_item(raw_item: Any, fallback: str) -> str:
    if isinstance(raw_item, dict):
        value = raw_item.get("external_id")
        if isinstance(value, str) and value.strip():
            return value.strip()

    return fallback


def normalize_external_text(value: Any) -> str | None:
    if value is None:
        return None

    normalized_value = str(value).strip()
    return normalized_value or None


def normalize_rating(value: Any) -> int:
    try:
        rating = round(float(value))
    except (TypeError, ValueError):
        return 0

    return rating


def build_perekrestok_product_sku(product_id: str) -> str:
    normalized_product_id = product_id.strip() or "unknown-product"
    return f"PEREKRESTOK-{normalized_product_id}"[:100]


def get_unique_import_item_external_id(
    external_id: str,
    used_external_ids: set[str],
) -> str:
    normalized_external_id = external_id.strip()[:255] or "unknown"
    if normalized_external_id not in used_external_ids:
        used_external_ids.add(normalized_external_id)
        return normalized_external_id

    for suffix_index in range(2, 10_000):
        suffix = f"#{suffix_index}"
        candidate = f"{normalized_external_id[: 255 - len(suffix)]}{suffix}"
        if candidate not in used_external_ids:
            used_external_ids.add(candidate)
            return candidate

    fallback = f"duplicate-{len(used_external_ids) + 1}"
    used_external_ids.add(fallback)
    return fallback


def normalize_payload_for_jsonb(raw_item: Any) -> dict[str, Any]:
    if isinstance(raw_item, dict):
        return raw_item

    return {"raw": raw_item}


def build_validation_error_message(exc: ValidationError) -> str:
    messages = []

    for error in exc.errors():
        location = ".".join(str(part) for part in error["loc"])
        messages.append(f"{location}: {error['msg']}")

    return "; ".join(messages)


def get_batch_status(
    *,
    total_count: int,
    success_count: int,
    failed_count: int,
    skipped_count: int,
) -> str:
    if total_count == 0:
        return "completed"

    if success_count == total_count:
        return "completed"

    if failed_count == total_count:
        return "failed"

    if success_count > 0 or failed_count > 0 or skipped_count > 0:
        return "partially_completed"

    return "failed"
