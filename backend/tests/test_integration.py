from __future__ import annotations

import pytest
from sqlalchemy import func, select

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
