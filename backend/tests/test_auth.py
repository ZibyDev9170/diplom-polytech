from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.models.auth import LoginAttempt, User

pytestmark = pytest.mark.asyncio


async def test_login_returns_jwt_and_current_user(api_client, create_user, db_session):
    password = "AdmIn123!"
    user = await create_user(
        full_name="Администратор",
        email="admin@example.ru",
        password=password,
        role_code="admin",
    )

    response = await api_client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": password},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["token_type"] == "bearer"
    assert payload["access_token"]
    assert payload["user"]["email"] == user.email
    assert payload["user"]["role"]["code"] == "admin"

    stored_user = await db_session.scalar(select(User).where(User.id == user.id))
    assert stored_user is not None
    assert stored_user.failed_login_attempts == 0
    assert stored_user.blocked_until is None


async def test_user_is_blocked_after_five_failed_attempts(
    api_client,
    create_user,
    db_session,
):
    user = await create_user(
        email="locked@example.ru",
        password="AdmIn123!",
        role_code="manager",
    )

    for _ in range(5):
        response = await api_client.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": "wrong-password"},
        )
        assert response.status_code == 401

    await db_session.refresh(user)
    assert user.failed_login_attempts == 5
    assert user.blocked_until is not None

    blocked_response = await api_client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": "AdmIn123!"},
    )
    assert blocked_response.status_code == 423

    attempts_count = await db_session.scalar(
        select(func.count(LoginAttempt.id)).where(LoginAttempt.user_id == user.id),
    )
    assert attempts_count == 6


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/v1/users"),
        ("get", "/api/v1/reviews"),
        ("get", "/api/v1/analytics/summary"),
    ],
)
async def test_protected_endpoints_require_token(api_client, method: str, path: str):
    response = await getattr(api_client, method)(path)
    assert response.status_code == 401
