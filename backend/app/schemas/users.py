from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.schemas.auth import RoleRead


class UserManagementRead(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    role: RoleRead
    is_active: bool
    blocked_until: datetime | None
    created_at: datetime
    updated_at: datetime


class UserCreateRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(min_length=8)
    role_id: int = Field(gt=0)


class UserUpdateRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    role_id: int = Field(gt=0)


class UserRoleUpdateRequest(BaseModel):
    role_id: int = Field(gt=0)
