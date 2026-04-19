from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Review Management System API"
    api_v1_prefix: str = "/api/v1"
    database_url: str = (
        "postgresql+asyncpg://reviews:reviews@localhost:5432/review_management"
    )
    cors_origins: list[str] = ["http://localhost:5173"]
    cors_allow_credentials: bool = True
    trusted_hosts: list[str] = ["localhost", "127.0.0.1", "backend"]
    force_https: bool = False
    jwt_secret_key: str = "dev-secret-change-before-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    max_failed_login_attempts: int = 5
    login_block_minutes: int = 10

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: str | list[str]) -> str | list[str]:
        if isinstance(value, str):
            if value and value.startswith("["):
                return value

            return [origin.strip() for origin in value.split(",") if origin.strip()]

        return [origin.rstrip("/") for origin in value]

    @field_validator("cors_origins")
    @classmethod
    def validate_cors_origins(cls, value: list[str]) -> list[str]:
        value = [origin.rstrip("/") for origin in value]

        if "*" in value:
            raise ValueError("CORS_ORIGINS must contain explicit origins, not '*'")

        return value

    @field_validator("trusted_hosts", mode="before")
    @classmethod
    def parse_trusted_hosts(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str) and value and not value.startswith("["):
            return [host.strip() for host in value.split(",") if host.strip()]

        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
