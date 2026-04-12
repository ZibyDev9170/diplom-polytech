from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import EmailStr
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_roles
from app.core.security import hash_password
from app.db.session import get_db_session
from app.models.auth import Role, User
from app.schemas.auth import RoleRead, UserRead
from app.schemas.users import (
    UserCreateRequest,
    UserManagementRead,
    UserRoleUpdateRequest,
    UserUpdateRequest,
)
from app.services.audit import AuditEntity, AuditEvent, add_audit_log

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/roles", response_model=list[RoleRead])
async def list_roles(
    _: UserRead = Depends(require_roles("admin")),
    session: AsyncSession = Depends(get_db_session),
) -> list[RoleRead]:
    result = await session.execute(select(Role).order_by(Role.id))
    return [build_role_read(role) for role in result.scalars()]


@router.get("", response_model=list[UserManagementRead])
async def list_users(
    _: UserRead = Depends(require_roles("admin")),
    session: AsyncSession = Depends(get_db_session),
) -> list[UserManagementRead]:
    result = await session.execute(
        select(User, Role).join(Role, Role.id == User.role_id).order_by(User.id),
    )

    return [build_user_management_read(user, role) for user, role in result.all()]


@router.post("", response_model=UserManagementRead, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreateRequest,
    current_user: UserRead = Depends(require_roles("admin")),
    session: AsyncSession = Depends(get_db_session),
) -> UserManagementRead:
    normalized_email = normalize_email(payload.email)
    await ensure_email_is_available(session, normalized_email)
    role = await get_role_or_404(session, payload.role_id)
    full_name = normalize_required_text(payload.full_name, "Full name is required")

    now = datetime.now(timezone.utc)
    user = User(
        full_name=full_name,
        email=normalized_email,
        password_hash=hash_password(payload.password),
        role_id=role.id,
        is_active=True,
        failed_login_attempts=0,
        blocked_until=None,
        updated_at=now,
    )
    session.add(user)
    await session.flush()
    await session.refresh(user)

    add_audit_log(
        session=session,
        actor_id=current_user.id,
        entity_type=AuditEntity.USER,
        entity_id=user.id,
        action=AuditEvent.USER_CREATE,
        new_values=serialize_user(user, role),
    )
    await session.commit()

    return build_user_management_read(user, role)


@router.patch("/{user_id}", response_model=UserManagementRead)
async def update_user(
    user_id: int,
    payload: UserUpdateRequest,
    current_user: UserRead = Depends(require_roles("admin")),
    session: AsyncSession = Depends(get_db_session),
) -> UserManagementRead:
    user, current_role = await get_user_with_role_or_404(session, user_id)
    normalized_email = normalize_email(payload.email)
    await ensure_email_is_available(session, normalized_email, exclude_user_id=user.id)
    next_role = await get_role_or_404(session, payload.role_id)
    full_name = normalize_required_text(payload.full_name, "Full name is required")

    old_values = serialize_user(user, current_role)
    user.full_name = full_name
    user.email = normalized_email
    user.role_id = next_role.id
    user.updated_at = datetime.now(timezone.utc)

    await session.flush()
    add_audit_log(
        session=session,
        actor_id=current_user.id,
        entity_type=AuditEntity.USER,
        entity_id=user.id,
        action=AuditEvent.USER_UPDATE,
        old_values=old_values,
        new_values=serialize_user(user, next_role),
    )
    await session.commit()

    return build_user_management_read(user, next_role)


@router.patch("/{user_id}/role", response_model=UserManagementRead)
async def change_user_role(
    user_id: int,
    payload: UserRoleUpdateRequest,
    current_user: UserRead = Depends(require_roles("admin")),
    session: AsyncSession = Depends(get_db_session),
) -> UserManagementRead:
    user, current_role = await get_user_with_role_or_404(session, user_id)
    next_role = await get_role_or_404(session, payload.role_id)

    old_values = serialize_user(user, current_role)
    user.role_id = next_role.id
    user.updated_at = datetime.now(timezone.utc)

    await session.flush()
    add_audit_log(
        session=session,
        actor_id=current_user.id,
        entity_type=AuditEntity.USER,
        entity_id=user.id,
        action=AuditEvent.USER_CHANGE_ROLE,
        old_values=old_values,
        new_values=serialize_user(user, next_role),
    )
    await session.commit()

    return build_user_management_read(user, next_role)


@router.patch("/{user_id}/block", response_model=UserManagementRead)
async def block_user(
    user_id: int,
    current_user: UserRead = Depends(require_roles("admin")),
    session: AsyncSession = Depends(get_db_session),
) -> UserManagementRead:
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot block your own user",
        )

    user, role = await get_user_with_role_or_404(session, user_id)
    old_values = serialize_user(user, role)
    user.is_active = False
    user.updated_at = datetime.now(timezone.utc)

    await session.flush()
    add_audit_log(
        session=session,
        actor_id=current_user.id,
        entity_type=AuditEntity.USER,
        entity_id=user.id,
        action=AuditEvent.USER_BLOCK,
        old_values=old_values,
        new_values=serialize_user(user, role),
    )
    await session.commit()

    return build_user_management_read(user, role)


@router.patch("/{user_id}/unblock", response_model=UserManagementRead)
async def unblock_user(
    user_id: int,
    current_user: UserRead = Depends(require_roles("admin")),
    session: AsyncSession = Depends(get_db_session),
) -> UserManagementRead:
    user, role = await get_user_with_role_or_404(session, user_id)
    old_values = serialize_user(user, role)
    user.is_active = True
    user.failed_login_attempts = 0
    user.blocked_until = None
    user.updated_at = datetime.now(timezone.utc)

    await session.flush()
    add_audit_log(
        session=session,
        actor_id=current_user.id,
        entity_type=AuditEntity.USER,
        entity_id=user.id,
        action=AuditEvent.USER_UNBLOCK,
        old_values=old_values,
        new_values=serialize_user(user, role),
    )
    await session.commit()

    return build_user_management_read(user, role)


async def get_role_or_404(session: AsyncSession, role_id: int) -> Role:
    role = await session.get(Role, role_id)

    if role is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found",
        )

    return role


async def get_user_with_role_or_404(
    session: AsyncSession,
    user_id: int,
) -> tuple[User, Role]:
    result = await session.execute(
        select(User, Role).join(Role, Role.id == User.role_id).where(User.id == user_id),
    )
    row = result.one_or_none()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return row


async def ensure_email_is_available(
    session: AsyncSession,
    email: str,
    exclude_user_id: int | None = None,
) -> None:
    statement = select(User.id).where(func.lower(User.email) == email)

    if exclude_user_id is not None:
        statement = statement.where(User.id != exclude_user_id)

    existing_user_id = await session.scalar(statement)

    if existing_user_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User with this email already exists",
        )


def build_role_read(role: Role) -> RoleRead:
    return RoleRead(id=role.id, code=role.code, name=role.name)


def build_user_management_read(user: User, role: Role) -> UserManagementRead:
    return UserManagementRead(
        id=user.id,
        full_name=user.full_name,
        email=user.email,
        role=build_role_read(role),
        is_active=user.is_active,
        blocked_until=user.blocked_until,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


def serialize_user(user: User, role: Role) -> dict[str, Any]:
    return {
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "role_id": role.id,
        "role_code": role.code,
        "is_active": user.is_active,
        "blocked_until": serialize_datetime(user.blocked_until),
    }


def serialize_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None

    return value.isoformat()


def normalize_email(email: EmailStr | str) -> str:
    return str(email).strip().lower()


def normalize_text(value: str) -> str:
    return value.strip()


def normalize_required_text(value: str, error_message: str) -> str:
    normalized_value = normalize_text(value)

    if not normalized_value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_message,
        )

    return normalized_value
