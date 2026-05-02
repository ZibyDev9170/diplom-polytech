from __future__ import annotations

from datetime import date

import pytest

pytestmark = pytest.mark.asyncio


async def test_analytics_returns_expected_summary_and_product_distribution(
    api_client,
    auth_headers_for,
    create_product,
    create_review_record,
    create_user,
):
    analyst = await create_user(role_code="analyst", email="analyst@example.ru")
    author = await create_user(role_code="manager", email="manager@example.ru")
    product_one = await create_product(name="Наушники Pulse", sku="PULSE-001")
    product_two = await create_product(name="Термокружка Travel", sku="TRAVEL-001")

    await create_review_record(
        product=product_one,
        created_by=author,
        review_text="Отличный звук.",
        rating=5,
        review_date=date(2026, 4, 20),
    )
    await create_review_record(
        product=product_one,
        created_by=author,
        review_text="Через неделю появился шум.",
        rating=1,
        review_date=date(2026, 4, 21),
    )
    await create_review_record(
        product=product_two,
        created_by=author,
        review_text="Температуру держит стабильно.",
        rating=4,
        review_date=date(2026, 4, 21),
    )

    summary_response = await api_client.get(
        "/api/v1/analytics/summary",
        headers=auth_headers_for(analyst, "analyst"),
    )
    assert summary_response.status_code == 200
    summary_payload = summary_response.json()
    assert summary_payload["total_reviews"] == 3
    assert summary_payload["average_rating"] == pytest.approx(3.33, abs=0.01)
    assert summary_payload["negative_reviews_count"] == 1
    assert summary_payload["negative_share_percent"] == pytest.approx(33.33, abs=0.01)

    products_response = await api_client.get(
        "/api/v1/analytics/products",
        headers=auth_headers_for(analyst, "analyst"),
    )
    assert products_response.status_code == 200
    products_payload = products_response.json()
    pulse_summary = next(
        item for item in products_payload if item["product_id"] == product_one.id
    )
    assert pulse_summary["reviews_count"] == 2
    assert pulse_summary["negative_reviews_count"] == 1
    assert pulse_summary["rating_distribution"][0]["reviews_count"] == 1
    assert pulse_summary["rating_distribution"][4]["reviews_count"] == 1

    detail_response = await api_client.get(
        f"/api/v1/analytics/products/{product_one.id}",
        headers=auth_headers_for(analyst, "analyst"),
    )
    assert detail_response.status_code == 200
    detail_payload = detail_response.json()
    assert detail_payload["product"]["name"] == "Наушники Pulse"
    assert detail_payload["summary"]["total_reviews"] == 2
    assert detail_payload["summary"]["average_rating"] == pytest.approx(3.0, abs=0.01)

    dynamics_response = await api_client.get(
        "/api/v1/analytics/dynamics",
        headers=auth_headers_for(analyst, "analyst"),
        params={"date_from": "2026-04-20", "date_to": "2026-04-21"},
    )
    assert dynamics_response.status_code == 200
    dynamics_payload = dynamics_response.json()
    assert len(dynamics_payload) == 2
    assert dynamics_payload[1]["products"][0]["reviews_count"] >= 1
