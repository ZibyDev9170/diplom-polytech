from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog


class AuditEntity(StrEnum):
    AUTH_LOGIN = "auth.login"
    USER = "auth.users"
    PRODUCT = "catalog.products"
    REVIEW_SOURCE = "catalog.review_sources"
    REVIEW_STATUS = "catalog.review_statuses"
    STATUS_TRANSITION = "catalog.allowed_status_transitions"
    REVIEW = "reviews.reviews"
    REVIEW_RESPONSE = "reviews.review_responses"
    IMPORT_BATCH = "integration.import_batches"
    REPORT_EXPORT = "analytics.report_exports"


class AuditEvent(StrEnum):
    LOGIN_SUCCESS = "login_success"
    LOGIN_FAILED = "login_failed"
    USER_CREATE = "user_create"
    USER_UPDATE = "user_update"
    USER_CHANGE_ROLE = "user_change_role"
    USER_BLOCK = "user_block"
    USER_UNBLOCK = "user_unblock"
    PRODUCT_CREATE = "product_create"
    PRODUCT_UPDATE = "product_update"
    PRODUCT_ACTIVATE = "product_activate"
    PRODUCT_DEACTIVATE = "product_deactivate"
    REVIEW_SOURCE_CREATE = "review_source_create"
    REVIEW_SOURCE_UPDATE = "review_source_update"
    REVIEW_STATUS_CREATE = "review_status_create"
    REVIEW_STATUS_UPDATE = "review_status_update"
    STATUS_TRANSITION_CREATE = "status_transition_create"
    STATUS_TRANSITION_DELETE = "status_transition_delete"
    REVIEW_CREATE = "review_create"
    REVIEW_UPDATE = "review_update"
    REVIEW_CHANGE_STATUS = "review_change_status"
    REVIEW_ASSIGN = "review_assign"
    REVIEW_UNASSIGN = "review_unassign"
    REVIEW_SAVE_RESPONSE = "review_save_response"
    REVIEW_IMPORT = "review_import"
    REPORT_EXPORT = "report_export"


AUDIT_EVENT_DESCRIPTIONS: dict[AuditEvent, str] = {
    AuditEvent.LOGIN_SUCCESS: "Успешный вход в систему",
    AuditEvent.LOGIN_FAILED: "Неудачная попытка входа",
    AuditEvent.USER_CREATE: "Создание пользователя",
    AuditEvent.USER_UPDATE: "Редактирование пользователя",
    AuditEvent.USER_CHANGE_ROLE: "Смена роли пользователя",
    AuditEvent.USER_BLOCK: "Блокировка пользователя",
    AuditEvent.USER_UNBLOCK: "Разблокировка пользователя",
    AuditEvent.PRODUCT_CREATE: "Создание товара",
    AuditEvent.PRODUCT_UPDATE: "Редактирование товара",
    AuditEvent.PRODUCT_ACTIVATE: "Активация товара",
    AuditEvent.PRODUCT_DEACTIVATE: "Отключение товара",
    AuditEvent.REVIEW_SOURCE_CREATE: "Создание источника отзывов",
    AuditEvent.REVIEW_SOURCE_UPDATE: "Редактирование источника отзывов",
    AuditEvent.REVIEW_STATUS_CREATE: "Создание статуса отзывов",
    AuditEvent.REVIEW_STATUS_UPDATE: "Редактирование статуса отзывов",
    AuditEvent.STATUS_TRANSITION_CREATE: "Создание перехода статусов",
    AuditEvent.STATUS_TRANSITION_DELETE: "Удаление перехода статусов",
    AuditEvent.REVIEW_CREATE: "Создание отзыва",
    AuditEvent.REVIEW_UPDATE: "Редактирование отзыва",
    AuditEvent.REVIEW_CHANGE_STATUS: "Смена статуса отзыва",
    AuditEvent.REVIEW_ASSIGN: "Назначение ответственного за отзыв",
    AuditEvent.REVIEW_UNASSIGN: "Снятие ответственного с отзыва",
    AuditEvent.REVIEW_SAVE_RESPONSE: "Сохранение ответа на отзыв",
    AuditEvent.REVIEW_IMPORT: "Импорт отзывов из внешнего источника",
    AuditEvent.REPORT_EXPORT: "Экспорт отчета",
}


def add_audit_log(
    *,
    session: AsyncSession,
    actor_id: int,
    entity_type: AuditEntity | str,
    entity_id: int,
    action: AuditEvent | str,
    old_values: dict[str, Any] | None = None,
    new_values: dict[str, Any] | None = None,
) -> None:
    session.add(
        AuditLog(
            user_id=actor_id,
            entity_type=get_enum_value(entity_type),
            entity_id=entity_id,
            action=get_enum_value(action),
            old_values_json=normalize_audit_payload(old_values),
            new_values_json=normalize_audit_payload(new_values),
        ),
    )


def add_login_audit_log(
    *,
    session: AsyncSession,
    user_id: int,
    email: str,
    ip_address: str,
    is_success: bool,
    reason: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    payload: dict[str, Any] = {
        "email": email,
        "ip_address": ip_address,
        "is_success": is_success,
    }

    if reason is not None:
        payload["reason"] = reason

    if metadata:
        payload.update(metadata)

    add_audit_log(
        session=session,
        actor_id=user_id,
        entity_type=AuditEntity.AUTH_LOGIN,
        entity_id=user_id,
        action=AuditEvent.LOGIN_SUCCESS if is_success else AuditEvent.LOGIN_FAILED,
        new_values=payload,
    )


def add_report_export_audit_log(
    *,
    session: AsyncSession,
    actor_id: int,
    report_code: str,
    filters: dict[str, Any] | None = None,
    rows_count: int | None = None,
) -> None:
    payload: dict[str, Any] = {
        "report_code": report_code,
        "filters": filters or {},
    }

    if rows_count is not None:
        payload["rows_count"] = rows_count

    add_audit_log(
        session=session,
        actor_id=actor_id,
        entity_type=AuditEntity.REPORT_EXPORT,
        entity_id=actor_id,
        action=AuditEvent.REPORT_EXPORT,
        new_values=payload,
    )


def get_enum_value(value: StrEnum | str) -> str:
    if isinstance(value, StrEnum):
        return value.value

    return value


def normalize_audit_payload(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if payload is None:
        return None

    normalized_payload = to_json_compatible_value(payload)
    if isinstance(normalized_payload, dict):
        return normalized_payload

    return {"value": normalized_payload}


def to_json_compatible_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()

    if isinstance(value, date):
        return value.isoformat()

    if isinstance(value, StrEnum):
        return value.value

    if isinstance(value, dict):
        return {str(key): to_json_compatible_value(item) for key, item in value.items()}

    if isinstance(value, list):
        return [to_json_compatible_value(item) for item in value]

    if isinstance(value, tuple):
        return [to_json_compatible_value(item) for item in value]

    return value
