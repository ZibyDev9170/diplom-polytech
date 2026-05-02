from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import func, select

from app.models.audit import AuditLog
from app.models.reviews import ReviewStatusHistory
from app.services.audit import AuditEvent

pytestmark = pytest.mark.asyncio


async def test_support_can_create_review_with_new_status(
    api_client,
    auth_headers_for,
    create_product,
    create_user,
    source_ids,
):
    support_user = await create_user(role_code="support", email="support@example.ru")
    product = await create_product(name="Тестовый чай", sku="TEA-001")

    response = await api_client.post(
        "/api/v1/reviews",
        headers=auth_headers_for(support_user, "support"),
        json={
            "product_id": product.id,
            "source_id": source_ids["manual"],
            "review_text": "Очень вкусный чай.",
            "rating": 5,
            "review_date": "2026-04-30",
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["product"]["id"] == product.id
    assert payload["status"]["code"] == "new"
    assert payload["status_history"][0]["to_status"]["code"] == "new"


async def test_reviews_filter_by_product_status_rating_search_and_assignee(
    api_client,
    auth_headers_for,
    create_product,
    create_review_record,
    create_user,
    status_ids,
):
    manager = await create_user(role_code="manager", email="manager@example.ru")
    assignee = await create_user(role_code="support", email="assignee@example.ru")
    tea = await create_product(name="Чай Эрл Грей", sku="TEA-100")
    coffee = await create_product(name="Кофе Бразилия", sku="COFFEE-100")

    await create_review_record(
        product=tea,
        created_by=manager,
        assigned_user=assignee,
        review_text="Очень понравился вкус бергамота.",
        rating=5,
        review_date=date(2026, 4, 28),
    )
    await create_review_record(
        product=coffee,
        created_by=manager,
        review_text="Упаковка была повреждена.",
        rating=2,
        review_date=date(2026, 4, 29),
    )

    response = await api_client.get(
        "/api/v1/reviews",
        headers=auth_headers_for(manager, "manager"),
        params={
            "product_id": tea.id,
            "status_id": status_ids["new"],
            "rating": 5,
            "assigned_user_id": assignee.id,
            "q": "бергамота",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["product"]["name"] == "Чай Эрл Грей"


async def test_allowed_status_transition_creates_history_and_audit_log(
    api_client,
    auth_headers_for,
    create_product,
    create_user,
    db_session,
    source_ids,
    status_ids,
):
    manager = await create_user(role_code="manager", email="manager@example.ru")
    product = await create_product(name="Термокружка", sku="THERMO-001")
    create_response = await api_client.post(
        "/api/v1/reviews",
        headers=auth_headers_for(manager, "manager"),
        json={
            "product_id": product.id,
            "source_id": source_ids["manual"],
            "review_text": "Держит температуру отлично.",
            "rating": 5,
            "review_date": "2026-04-30",
        },
    )
    review_id = create_response.json()["id"]

    response = await api_client.patch(
        f"/api/v1/reviews/{review_id}/status",
        headers=auth_headers_for(manager, "manager"),
        json={"status_id": status_ids["in_progress"], "comment": "Взяли в работу"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"]["code"] == "in_progress"
    assert payload["status_history"][-1]["from_status"]["code"] == "new"
    assert payload["status_history"][-1]["to_status"]["code"] == "in_progress"

    history_count = await db_session.scalar(
        select(func.count(ReviewStatusHistory.id)).where(
            ReviewStatusHistory.review_id == review_id,
        ),
    )
    assert history_count == 2

    audit_log = await db_session.scalar(
        select(AuditLog).where(
            AuditLog.entity_id == review_id,
            AuditLog.action == AuditEvent.REVIEW_CHANGE_STATUS.value,
        ),
    )
    assert audit_log is not None


async def test_forbidden_status_transition_is_rejected(
    api_client,
    auth_headers_for,
    create_product,
    create_user,
    db_session,
    source_ids,
    status_ids,
):
    manager = await create_user(role_code="manager", email="manager@example.ru")
    product = await create_product(name="Настольная лампа", sku="LAMP-001")
    create_response = await api_client.post(
        "/api/v1/reviews",
        headers=auth_headers_for(manager, "manager"),
        json={
            "product_id": product.id,
            "source_id": source_ids["manual"],
            "review_text": "Свет приятный, но хотелось бы длиннее кабель.",
            "rating": 4,
            "review_date": "2026-04-30",
        },
    )
    review_id = create_response.json()["id"]

    response = await api_client.patch(
        f"/api/v1/reviews/{review_id}/status",
        headers=auth_headers_for(manager, "manager"),
        json={"status_id": status_ids["answered"]},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Status transition is not allowed"

    history_count = await db_session.scalar(
        select(func.count(ReviewStatusHistory.id)).where(
            ReviewStatusHistory.review_id == review_id,
        ),
    )
    assert history_count == 1


async def test_review_assignment_updates_assignee_and_history(
    api_client,
    auth_headers_for,
    create_product,
    create_user,
    source_ids,
):
    manager = await create_user(role_code="manager", email="manager@example.ru")
    support_user = await create_user(role_code="support", email="support@example.ru")
    product = await create_product(name="Рюкзак", sku="BAG-001")
    create_response = await api_client.post(
        "/api/v1/reviews",
        headers=auth_headers_for(manager, "manager"),
        json={
            "product_id": product.id,
            "source_id": source_ids["manual"],
            "review_text": "Удобные лямки, но молния иногда заедает.",
            "rating": 4,
            "review_date": "2026-04-30",
        },
    )
    review_id = create_response.json()["id"]

    response = await api_client.patch(
        f"/api/v1/reviews/{review_id}/assignment",
        headers=auth_headers_for(manager, "manager"),
        json={"assigned_user_id": support_user.id},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["assigned_user"]["id"] == support_user.id
    assert len(payload["assignment_history"]) == 1
    assert payload["assignment_history"][0]["assigned_user"]["id"] == support_user.id


async def test_analyst_cannot_create_review(
    api_client,
    auth_headers_for,
    create_product,
    create_user,
    source_ids,
):
    analyst = await create_user(role_code="analyst", email="analyst@example.ru")
    product = await create_product(name="Колонка", sku="SPEAKER-001")

    response = await api_client.post(
        "/api/v1/reviews",
        headers=auth_headers_for(analyst, "analyst"),
        json={
            "product_id": product.id,
            "source_id": source_ids["manual"],
            "review_text": "Не должно создаваться у аналитика.",
            "rating": 3,
            "review_date": "2026-04-30",
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Insufficient role permissions"
