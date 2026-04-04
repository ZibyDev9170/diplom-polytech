from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class RoleRead(BaseModel):
    id: int
    code: str
    name: str


class UserRead(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    role: RoleRead
    is_active: bool


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserRead
