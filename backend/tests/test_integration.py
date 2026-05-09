from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.models.catalog import Product, ReviewSource
from app.models.reviews import Review

pytestmark = pytest.mark.asyncio


async def test_import_external_reviews_creates_batch_and_reviews(
    api_client,
    auth_headers_for,
    create_product,
    create_user,
    db_session,
):
    manager = await create_user(role_code="manager", email="manager@example.ru")
    product = await create_product(name="Кофемашина Mini", sku="COFFEE-MINI")

    response = await api_client.post(
        "/api/v1/integration/reviews/import",
        headers=auth_headers_for(manager, "manager"),
        json={
            "source_code": "marketplace",
            "reviews": [
                {
                    "external_id": "marketplace-10001",
                    "product_sku": product.sku,
                    "product_name": product.name,
                    "review_text": "Отлично варит кофе.",
                    "rating": 5,
                    "review_date": "2026-04-30",
                },
                {
                    "external_id": "marketplace-10001",
                    "product_sku": product.sku,
                    "product_name": product.name,
                    "review_text": "Повтор внутри пакета.",
                    "rating": 4,
                    "review_date": "2026-04-30",
                },
                {
                    "external_id": "marketplace-invalid",
                    "product_sku": product.sku,
                    "product_name": product.name,
                    "review_text": "",
                    "rating": 6,
                    "review_date": "2026-04-30",
                },
            ],
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["success_count"] == 1
    assert payload["failed_count"] == 1
    assert payload["skipped_count"] == 1
    assert payload["status"] == "partially_completed"

    reviews_count = await db_session.scalar(select(func.count(Review.id)))
    assert reviews_count == 1


async def test_repeat_import_skips_existing_review(api_client, auth_headers_for, create_product, create_user):
    manager = await create_user(role_code="manager", email="manager@example.ru")
    product = await create_product(name="Лампа Lumi", sku="LUMI-001")
    payload = {
        "source_code": "marketplace",
        "reviews": [
            {
                "external_id": "repeat-001",
                "product_sku": product.sku,
                "product_name": product.name,
                "review_text": "Первый импорт.",
                "rating": 5,
                "review_date": "2026-04-30",
            },
        ],
    }

    first_response = await api_client.post(
        "/api/v1/integration/reviews/import",
        headers=auth_headers_for(manager, "manager"),
        json=payload,
    )
    second_response = await api_client.post(
        "/api/v1/integration/reviews/import",
        headers=auth_headers_for(manager, "manager"),
        json=payload,
    )

    assert first_response.status_code == 201
    assert second_response.status_code == 201
    second_payload = second_response.json()
    assert second_payload["success_count"] == 0
    assert second_payload["failed_count"] == 0
    assert second_payload["skipped_count"] == 1


async def test_import_endpoint_rejects_invalid_json_shape(api_client, auth_headers_for, create_user):
    manager = await create_user(role_code="manager", email="manager@example.ru")

    response = await api_client.post(
        "/api/v1/integration/reviews/import",
        headers=auth_headers_for(manager, "manager"),
        json={"source_code": "marketplace", "reviews": "not-an-array"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "reviews must be an array"


async def test_import_external_reviews_auto_creates_source_and_product(
    api_client,
    auth_headers_for,
    create_user,
    db_session,
):
    manager = await create_user(role_code="manager", email="manager@example.ru")

    response = await api_client.post(
        "/api/v1/integration/reviews/import",
        headers=auth_headers_for(manager, "manager"),
        json={
            "source_code": "ozon",
            "source_name": "Ozon Reviews",
            "reviews": [
                {
                    "external_id": "ozon-10001",
                    "product_sku": "OZON-SKU-001",
                    "product_name": "Универсальный товар",
                    "review_text": "Импорт без предварительной подготовки каталога.",
                    "rating": 5,
                    "review_date": "2026-05-09",
                },
            ],
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["success_count"] == 1
    assert payload["source"]["code"] == "ozon"
    assert payload["source"]["name"] == "Ozon Reviews"

    source = await db_session.scalar(
        select(ReviewSource).where(ReviewSource.code == "ozon"),
    )
    product = await db_session.scalar(
        select(Product).where(Product.sku == "OZON-SKU-001"),
    )
    reviews_count = await db_session.scalar(select(func.count(Review.id)))

    assert source is not None
    assert product is not None
    assert product.name == "Универсальный товар"
    assert reviews_count == 1


async def test_preview_remote_source_reviews_with_mapping(
    api_client,
    auth_headers_for,
    create_user,
    monkeypatch,
):
    manager = await create_user(role_code="manager", email="manager@example.ru")

    async def fake_fetch_json_payload_from_url(_: str):
        return {
            "data": {
                "reviews": [
                    {
                        "id": "remote-10001",
                        "text": "Приехало быстро и без повреждений.",
                        "rating": 5,
                        "created_at": "2026-05-09T11:20:00Z",
                        "product": {
                            "sku": "REMOTE-SKU-001",
                            "name": "Удаленный товар",
                        },
                    }
                ],
            },
        }

    monkeypatch.setattr(
        "app.services.integration.fetch_json_payload_from_url",
        fake_fetch_json_payload_from_url,
    )

    response = await api_client.post(
        "/api/v1/integration/external-source/reviews/preview",
        headers=auth_headers_for(manager, "manager"),
        json={
            "source_code": "remote_api",
            "source_name": "Remote API",
            "endpoint_url": "https://example.com/api/reviews",
            "reviews_path": "data.reviews",
            "mapping": {
                "external_id": "id",
                "product_sku": "product.sku",
                "product_name": "product.name",
                "review_text": "text",
                "rating": "rating",
                "review_date": "created_at",
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total_count"] == 1
    assert payload["valid_count"] == 1
    assert payload["invalid_count"] == 0
    assert payload["reviews"][0]["external_id"] == "remote-10001"
    assert payload["reviews"][0]["product_sku"] == "REMOTE-SKU-001"
    assert payload["reviews"][0]["review_date"] == "2026-05-09"


async def test_import_remote_source_reviews_creates_review_from_mapping(
    api_client,
    auth_headers_for,
    create_user,
    db_session,
    monkeypatch,
):
    manager = await create_user(role_code="manager", email="manager@example.ru")

    async def fake_fetch_json_payload_from_url(_: str):
        return {
            "payload": {
                "items": [
                    {
                        "review_id": "remote-import-001",
                        "comment": "Очень удобный интерфейс устройства.",
                        "score": "4",
                        "published_at": "2026-05-08T08:00:00Z",
                        "product": {
                            "sku": "REMOTE-IMPORT-001",
                            "title": "Станция очистки воздуха",
                        },
                    }
                ],
            },
        }

    monkeypatch.setattr(
        "app.services.integration.fetch_json_payload_from_url",
        fake_fetch_json_payload_from_url,
    )

    response = await api_client.post(
        "/api/v1/integration/external-source/reviews/import",
        headers=auth_headers_for(manager, "manager"),
        json={
            "source_code": "remote_import",
            "source_name": "Remote Import",
            "endpoint_url": "https://example.com/api/reviews",
            "reviews_path": "payload.items",
            "mapping": {
                "external_id": "review_id",
                "product_sku": "product.sku",
                "product_name": "product.title",
                "review_text": "comment",
                "rating": "score",
                "review_date": "published_at",
            },
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["success_count"] == 1
    assert payload["source"]["code"] == "remote_import"

    source = await db_session.scalar(
        select(ReviewSource).where(ReviewSource.code == "remote_import"),
    )
    product = await db_session.scalar(
        select(Product).where(Product.sku == "REMOTE-IMPORT-001"),
    )
    reviews_count = await db_session.scalar(select(func.count(Review.id)))

    assert source is not None
    assert product is not None
    assert product.name == "Станция очистки воздуха"
    assert reviews_count == 1
