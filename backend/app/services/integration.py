from __future__ import annotations

import asyncio
import json
import re
import urllib.error
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
from app.schemas.integration import ExternalReviewItem, RemoteReviewFieldMapping
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


@dataclass
class RemoteReviewPreviewResult:
    source_code: str
    source_name: str | None
    endpoint_url: str
    total_count: int
    valid_reviews: list[ExternalReviewItem]
    errors: list[str]


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

        product = await find_or_create_product_for_external_review(session, external_review)
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


async def build_remote_review_payload_preview(
    *,
    endpoint_url: str,
    source_code: str,
    source_name: str | None,
    offset: int,
    limit: int,
    reviews_path: str | None,
    mapping: RemoteReviewFieldMapping,
) -> RemoteReviewPreviewResult:
    payload = await fetch_json_payload_from_url(endpoint_url, offset=offset, limit=limit)
    raw_reviews = extract_reviews_from_remote_payload(payload, reviews_path, offset=offset, limit=limit)
    valid_reviews: list[ExternalReviewItem] = []
    errors: list[str] = []

    for index, raw_item in enumerate(raw_reviews, start=1):
        try:
            mapped_item = map_remote_item_to_external_review(raw_item, mapping)
            valid_reviews.append(ExternalReviewItem.model_validate(mapped_item))
        except (RuntimeError, ValueError, ValidationError) as exc:
            errors.append(f"Запись {index}: {format_remote_mapping_error(exc)}")

    return RemoteReviewPreviewResult(
        source_code=source_code.strip().lower(),
        source_name=normalize_external_text(source_name),
        endpoint_url=endpoint_url,
        total_count=len(raw_reviews),
        valid_reviews=valid_reviews,
        errors=errors,
    )


async def build_remote_review_payload(
    *,
    endpoint_url: str,
    source_code: str,
    source_name: str | None,
    offset: int,
    limit: int,
    reviews_path: str | None,
    mapping: RemoteReviewFieldMapping,
) -> dict[str, Any]:
    preview = await build_remote_review_payload_preview(
        endpoint_url=endpoint_url,
        source_code=source_code,
        source_name=source_name,
        offset=offset,
        limit=limit,
        reviews_path=reviews_path,
        mapping=mapping,
    )

    if preview.errors:
        raise RuntimeError(
            "Remote source payload contains invalid reviews: " + "; ".join(preview.errors[:10]),
        )

    return {
        "source_code": preview.source_code,
        "source_name": preview.source_name,
        "reviews": [review.model_dump(mode="json") for review in preview.valid_reviews],
    }


async def fetch_json_payload_from_url(endpoint_url: str, *, offset: int, limit: int) -> Any:
    return await asyncio.to_thread(fetch_json_payload_from_url_sync, endpoint_url, offset, limit)


def fetch_json_payload_from_url_sync(endpoint_url: str, offset: int, limit: int) -> Any:
    resolved_endpoint_url = format_remote_endpoint_url(
        endpoint_url,
        offset=offset,
        limit=limit,
    )
    request = urllib.request.Request(
        resolved_endpoint_url,
        headers={"Accept": "application/json", "User-Agent": "review-management-system"},
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=HUGGING_FACE_TIMEOUT_SECONDS,
        ) as response:
            response_body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        error_payload = ""

        try:
            error_payload = exc.read().decode("utf-8").strip()
        except OSError:
            error_payload = ""

        error_suffix = f": {error_payload}" if error_payload else ""
        raise RuntimeError(
            f"Could not fetch reviews from the remote source ({resolved_endpoint_url}): "
            f"HTTP {exc.code}{error_suffix}"
        ) from exc
    except OSError as exc:
        raise RuntimeError(
            f"Could not fetch reviews from the remote source ({resolved_endpoint_url}): {exc}"
        ) from exc

    try:
        return json.loads(response_body)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Remote source returned invalid JSON") from exc


def format_remote_endpoint_url(endpoint_url: str, *, offset: int, limit: int) -> str:
    normalized_endpoint_url = (
        endpoint_url.replace("%7B", "{")
        .replace("%7D", "}")
        .replace("%7b", "{")
        .replace("%7d", "}")
    )

    resolved_endpoint_url = (
        normalized_endpoint_url.replace("{offset}", str(offset))
        .replace("{limit}", str(limit))
        .replace("{length}", str(limit))
    )

    parsed_url = urllib.parse.urlsplit(resolved_endpoint_url)
    query_params = urllib.parse.parse_qsl(parsed_url.query, keep_blank_values=True)
    normalized_query_params: list[tuple[str, str]] = []
    has_length = any(key == "length" for key, _ in query_params)

    for key, value in query_params:
        normalized_value = value

        if key in {"offset", "limit", "length"}:
            normalized_value = re.sub(r"^\{(\d+)\}$", r"\1", normalized_value)

        if (
            parsed_url.netloc == "datasets-server.huggingface.co"
            and parsed_url.path == "/rows"
            and key == "limit"
            and not has_length
        ):
            normalized_query_params.append(("length", normalized_value))
            continue

        normalized_query_params.append((key, normalized_value))

    if normalized_query_params != query_params:
        return urllib.parse.urlunsplit(
            (
                parsed_url.scheme,
                parsed_url.netloc,
                parsed_url.path,
                urllib.parse.urlencode(normalized_query_params),
                parsed_url.fragment,
            )
        )

    return resolved_endpoint_url


def extract_reviews_from_remote_payload(
    payload: Any,
    reviews_path: str | None,
    *,
    offset: int,
    limit: int,
) -> list[Any]:
    extracted_value = resolve_json_path(payload, reviews_path)

    if not isinstance(extracted_value, list):
        raise RuntimeError("Reviews path does not point to an array")

    return extracted_value[offset : offset + limit]


def resolve_json_path(payload: Any, path: str | None) -> Any:
    if path is None:
        return payload

    normalized_path = path.strip()
    if not normalized_path or normalized_path == "$":
        return payload

    if normalized_path.startswith("$."):
        normalized_path = normalized_path[2:]

    current: Any = payload
    for segment in normalized_path.split("."):
        current = resolve_json_path_segment(current, segment)

    return current


def resolve_json_path_segment(value: Any, segment: str) -> Any:
    normalized_segment = segment.strip()
    if not normalized_segment:
        return value

    if isinstance(value, dict):
        if normalized_segment not in value:
            raise RuntimeError(f"Path segment was not found: {normalized_segment}")
        return value[normalized_segment]

    if isinstance(value, list) and normalized_segment.isdigit():
        index = int(normalized_segment)
        if index < 0 or index >= len(value):
            raise RuntimeError(f"Array index is out of range: {normalized_segment}")
        return value[index]

    raise RuntimeError(f"Could not resolve path segment: {normalized_segment}")


def map_remote_item_to_external_review(
    raw_item: Any,
    mapping: RemoteReviewFieldMapping,
) -> dict[str, Any]:
    if not isinstance(raw_item, dict):
        raise ValueError("review item must be an object")

    mapped_item: dict[str, Any] = {
        "external_id": get_required_mapped_value(raw_item, mapping.external_id),
        "review_text": get_required_mapped_value(raw_item, mapping.review_text),
        "rating": get_mapped_rating(raw_item, mapping.rating),
        "review_date": get_mapped_review_date(raw_item, mapping.review_date),
        "source_payload": raw_item,
    }

    if mapping.product_id:
        product_id = get_optional_mapped_value(raw_item, mapping.product_id)
        if product_id is not None:
            mapped_item["product_id"] = product_id

    if mapping.product_sku:
        product_sku = get_optional_mapped_value(raw_item, mapping.product_sku)
        if product_sku is not None:
            mapped_item["product_sku"] = product_sku
    elif mapped_item.get("product_id") is not None:
        mapped_item["product_sku"] = str(mapped_item["product_id"])

    if mapping.product_name:
        product_name = get_optional_mapped_value(raw_item, mapping.product_name)
        if product_name is not None:
            mapped_item["product_name"] = product_name

    return mapped_item


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
    return await get_or_create_review_source(
        session,
        PEREKRESTOK_SOURCE_CODE,
        PEREKRESTOK_SOURCE_NAME,
    )


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


async def get_or_create_review_source(
    session: AsyncSession,
    source_code: str,
    source_name: str | None = None,
) -> ReviewSource:
    normalized_code = source_code.strip().lower()
    source = await get_source_by_code_or_none(session, normalized_code)

    if source is not None:
        return source

    normalized_name = normalize_external_text(source_name)
    source = ReviewSource(
        code=normalized_code,
        name=(normalized_name or build_default_source_name(normalized_code))[:100],
    )
    session.add(source)
    await session.flush()
    await session.refresh(source)

    return source


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


async def find_or_create_product_for_external_review(
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
        normalized_sku = external_review.product_sku.strip().lower()
        product_by_sku = await session.scalar(
            select(Product).where(
                func.lower(Product.sku) == normalized_sku,
            ),
        )

        if product_by_sku is not None:
            return product_by_sku if product_by_sku.is_active else None

        product_name = normalize_external_text(external_review.product_name)
        if product_name:
            product = Product(
                sku=external_review.product_sku.strip()[:100],
                name=product_name[:255],
                is_active=True,
            )
            session.add(product)
            await session.flush()
            await session.refresh(product)
            return product

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


def get_required_mapped_value(raw_item: dict[str, Any], path: str) -> str:
    value = get_optional_mapped_value(raw_item, path)
    if value is None:
        raise ValueError(f"required field was not found by path: {path}")

    return value


def get_optional_mapped_value(raw_item: dict[str, Any], path: str | None) -> str | None:
    if path is None:
        return None

    if path.startswith("="):
        return normalize_external_text(resolve_mapping_constant(path))

    try:
        value = resolve_json_path(raw_item, path)
    except RuntimeError:
        return None

    return normalize_external_text(value)


def get_mapped_rating(raw_item: dict[str, Any], path: str) -> Any:
    if path.startswith("="):
        value = resolve_mapping_constant(path)
    else:
        value = resolve_json_path(raw_item, path)
    rating = normalize_rating(value)
    return rating if 1 <= rating <= 5 else value


def get_mapped_review_date(raw_item: dict[str, Any], path: str) -> Any:
    if path.startswith("="):
        value = resolve_mapping_constant(path)
    else:
        value = resolve_json_path(raw_item, path)
    normalized_value = normalize_external_review_date(value)
    return normalized_value if normalized_value is not None else value


def resolve_mapping_constant(path: str) -> Any:
    constant_value = path[1:].strip()

    if not constant_value:
        return None

    if constant_value.lower() == "today":
        return date.today().isoformat()

    return constant_value


def normalize_external_review_date(value: Any) -> str | None:
    if value is None:
        return None

    if isinstance(value, date):
        return value.isoformat()

    if isinstance(value, datetime):
        return value.date().isoformat()

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc).date().isoformat()
        except (OverflowError, OSError, ValueError):
            return None

    if isinstance(value, str):
        normalized_value = value.strip()
        if not normalized_value:
            return None

        if "T" in normalized_value:
            normalized_value = normalized_value.split("T", 1)[0]

        try:
            return date.fromisoformat(normalized_value).isoformat()
        except ValueError:
            return None

    return None


def normalize_rating(value: Any) -> int:
    try:
        rating = round(float(value))
    except (TypeError, ValueError):
        return 0

    return rating


def format_remote_mapping_error(exc: ValidationError | ValueError) -> str:
    if isinstance(exc, ValidationError):
        return build_validation_error_message(exc)

    return str(exc)


def build_default_source_name(source_code: str) -> str:
    words = source_code.replace("-", " ").replace("_", " ").split()
    if not words:
        return source_code

    return " ".join(word.capitalize() for word in words)


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
