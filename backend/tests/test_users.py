from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.security import verify_password
from app.models.auth import User

pytestmark = pytest.mark.asyncio


async def test_admin_can_create_user_and_password_is_hashed(
    api_client,
    auth_headers_for,
    create_user,
    db_session,
    role_ids,
):
    admin = await create_user(role_code="admin", email="root@example.ru")
    response = await api_client.post(
        "/api/v1/users",
        headers=auth_headers_for(admin, "admin"),
        json={
            "full_name": "Новый пользователь",
            "email": "new.user@example.ru",
            "password": "StrongPass123",
            "role_id": role_ids["support"],
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["full_name"] == "Новый пользователь"
    assert payload["email"] == "new.user@example.ru"
    assert payload["role"]["code"] == "support"

    created_user = await db_session.scalar(
        select(User).where(User.email == "new.user@example.ru"),
    )
    assert created_user is not None
    assert created_user.password_hash != "StrongPass123"
    assert verify_password("StrongPass123", created_user.password_hash)


async def test_manager_cannot_create_user(api_client, auth_headers_for, create_user, role_ids):
    manager = await create_user(role_code="manager", email="manager@example.ru")
    response = await api_client.post(
        "/api/v1/users",
        headers=auth_headers_for(manager, "manager"),
        json={
            "full_name": "Запрещенный пользователь",
            "email": "forbidden@example.ru",
            "password": "StrongPass123",
            "role_id": role_ids["support"],
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Insufficient role permissions"
