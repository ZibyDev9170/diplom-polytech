from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_roles
from app.core.config import get_settings
from app.core.security import create_access_token, verify_password
from app.db.session import get_db_session
from app.models.auth import LoginAttempt, Role, User
from app.schemas.auth import LoginRequest, LoginResponse, RoleRead, UserRead

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    session: AsyncSession = Depends(get_db_session),
) -> LoginResponse:
    settings = get_settings()
    client_ip = request.client.host if request.client else "0.0.0.0"
    normalized_email = payload.email.lower()

    result = await session.execute(
        select(User, Role)
        .join(Role, Role.id == User.role_id)
        .where(func.lower(User.email) == normalized_email)
        .with_for_update(of=User),
    )
    row = result.one_or_none()

    if row is None:
        logger.warning("Failed login for unknown email: %s", normalized_email)
        raise invalid_credentials_exception()

    user, role = row

    if not user.is_active:
        await log_login_attempt(session, user.id, False, client_ip)
        await session.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is inactive",
        )

    now = datetime.now(timezone.utc)
    if user.blocked_until and to_aware_utc(user.blocked_until) > now:
        await log_login_attempt(session, user.id, False, client_ip)
        await session.commit()
        raise HTTPException(
            status_code=423,
            detail="Too many failed login attempts. Try again later",
        )

    if not verify_password(payload.password, user.password_hash):
        user.failed_login_attempts += 1
        user.updated_at = now

        if user.failed_login_attempts >= settings.max_failed_login_attempts:
            user.blocked_until = now + timedelta(minutes=settings.login_block_minutes)

        await log_login_attempt(session, user.id, False, client_ip)
        await session.commit()
        raise invalid_credentials_exception()

    user.failed_login_attempts = 0
    user.blocked_until = None
    user.updated_at = now

    await log_login_attempt(session, user.id, True, client_ip)
    await session.commit()

    user_read = build_user_read(user, role)
    access_token = create_access_token(
        subject=str(user.id),
        additional_claims={"role": role.code, "email": user.email},
    )

    return LoginResponse(
        access_token=access_token,
        expires_in=settings.access_token_expire_minutes * 60,
        user=user_read,
    )


@router.get("/me", response_model=UserRead)
async def read_me(current_user: UserRead = Depends(get_current_user)) -> UserRead:
    return current_user


@router.get("/admin-check", response_model=UserRead)
async def admin_check(current_user: UserRead = Depends(require_roles("admin"))) -> UserRead:
    return current_user


async def log_login_attempt(
    session: AsyncSession,
    user_id: int,
    is_success: bool,
    ip_address: str,
) -> None:
    session.add(
        LoginAttempt(
            user_id=user_id,
            is_success=is_success,
            ip_address=ip_address,
        ),
    )


def build_user_read(user: User, role: Role) -> UserRead:
    return UserRead(
        id=user.id,
        full_name=user.full_name,
        email=user.email,
        is_active=user.is_active,
        role=RoleRead(id=role.id, code=role.code, name=role.name),
    )


def invalid_credentials_exception() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid email or password",
    )


def to_aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)

    return value.astimezone(timezone.utc)
