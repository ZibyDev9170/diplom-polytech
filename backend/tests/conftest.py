from __future__ import annotations

import asyncio
import os
import re
from collections.abc import AsyncIterator, Callable
from datetime import date, datetime, timezone
from pathlib import Path
from uuid import uuid4

import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = PROJECT_ROOT / "backend"
DATABASE_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
MUTABLE_TABLES = [
    "audit.audit_logs",
    "auth.login_attempts",
    "reviews.review_responses",
    "reviews.review_status_history",
    "reviews.review_assignments",
    "reviews.reviews",
    "integration.import_items",
    "integration.import_batches",
    "auth.users",
    "catalog.products",
]


def render_url_with_password(url: URL) -> str:
    return url.render_as_string(hide_password=False)


def build_default_test_database_url() -> str:
    base_url = make_url(
        os.getenv(
            "DATABASE_URL",
            "postgresql+asyncpg://reviews:reviews@localhost:5433/review_management",
        ),
    )
    database_name = base_url.database or "review_management"

    if not database_name.endswith("_test"):
        database_name = f"{database_name}_test"

    return render_url_with_password(base_url.set(database=database_name))


TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", build_default_test_database_url())
TEST_ADMIN_DATABASE_URL = os.getenv(
    "TEST_DATABASE_ADMIN_URL",
    render_url_with_password(make_url(TEST_DATABASE_URL).set(database="postgres")),
)


def configure_test_environment() -> None:
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key")
    os.environ.setdefault(
        "TRUSTED_HOSTS",
        '["testserver","localhost","127.0.0.1","backend"]',
    )
    os.environ.setdefault("CORS_ORIGINS", '["http://testserver"]')
    os.environ.setdefault("FORCE_HTTPS", "false")


configure_test_environment()

from app.api.deps import get_db_session  # noqa: E402
from app.core.security import create_access_token, hash_password  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models.auth import Role, User  # noqa: E402
from app.models.catalog import Product, ReviewSource, ReviewStatus  # noqa: E402
from app.models.reviews import Review, ReviewAssignment, ReviewStatusHistory  # noqa: E402


def ensure_valid_database_name(database_url: str) -> str:
    database_name = make_url(database_url).database or ""
    if not DATABASE_NAME_PATTERN.match(database_name):
        raise RuntimeError(
            "TEST_DATABASE_URL must contain a simple database name "
            "with letters, numbers and underscores only",
        )

    return database_name


async def create_test_database_if_needed() -> None:
    database_name = ensure_valid_database_name(TEST_DATABASE_URL)
    admin_engine = create_async_engine(
        TEST_ADMIN_DATABASE_URL,
        isolation_level="AUTOCOMMIT",
        poolclass=NullPool,
    )

    try:
        async with admin_engine.connect() as connection:
            exists = await connection.scalar(
                text("SELECT 1 FROM pg_database WHERE datname = :database_name"),
                {"database_name": database_name},
            )
            if not exists:
                await connection.execute(text(f'CREATE DATABASE "{database_name}"'))
    finally:
        await admin_engine.dispose()


def run_migrations() -> None:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    config.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    command.upgrade(config, "head")


@pytest.fixture(scope="session", autouse=True)
def prepared_test_database() -> None:
    asyncio.run(create_test_database_if_needed())
    run_migrations()


@pytest.fixture(scope="session")
def test_engine(prepared_test_database):
    engine = create_async_engine(
        TEST_DATABASE_URL,
        pool_pre_ping=True,
        poolclass=NullPool,
    )
    yield engine
    asyncio.run(engine.dispose())


@pytest.fixture(scope="session")
def session_maker(test_engine):
    return async_sessionmaker(
        bind=test_engine,
        autoflush=False,
        expire_on_commit=False,
    )


@pytest.fixture(scope="session")
def app(session_maker):
    application = create_app()

    async def override_get_db_session() -> AsyncIterator[AsyncSession]:
        async with session_maker() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise

    application.dependency_overrides[get_db_session] = override_get_db_session
    yield application
    application.dependency_overrides.clear()


@pytest_asyncio.fixture(autouse=True)
async def reset_database(test_engine) -> AsyncIterator[None]:
    async with test_engine.begin() as connection:
        await connection.execute(
            text(
                f'TRUNCATE TABLE {", ".join(MUTABLE_TABLES)} '
                "RESTART IDENTITY CASCADE",
            ),
        )

    yield


@pytest_asyncio.fixture
async def db_session(session_maker) -> AsyncIterator[AsyncSession]:
    async with session_maker() as session:
        yield session


@pytest_asyncio.fixture
async def api_client(app) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        yield client


async def get_role(session: AsyncSession, code: str) -> Role:
    role = await session.scalar(select(Role).where(Role.code == code))
    if role is None:
        raise RuntimeError(f"Role '{code}' was not found in seed data")

    return role


async def get_source(session: AsyncSession, code: str) -> ReviewSource:
    source = await session.scalar(select(ReviewSource).where(ReviewSource.code == code))
    if source is None:
        raise RuntimeError(f"Source '{code}' was not found in seed data")

    return source


async def get_status(session: AsyncSession, code: str) -> ReviewStatus:
    status_item = await session.scalar(select(ReviewStatus).where(ReviewStatus.code == code))
    if status_item is None:
        raise RuntimeError(f"Status '{code}' was not found in seed data")

    return status_item


@pytest_asyncio.fixture
async def role_ids(db_session: AsyncSession) -> dict[str, int]:
    result = await db_session.execute(select(Role))
    return {role.code: role.id for role in result.scalars()}


@pytest_asyncio.fixture
async def source_ids(db_session: AsyncSession) -> dict[str, int]:
    result = await db_session.execute(select(ReviewSource))
    return {source.code: source.id for source in result.scalars()}


@pytest_asyncio.fixture
async def status_ids(db_session: AsyncSession) -> dict[str, int]:
    result = await db_session.execute(select(ReviewStatus))
    return {status_item.code: status_item.id for status_item in result.scalars()}


@pytest_asyncio.fixture
async def create_user(
    db_session: AsyncSession,
) -> Callable[..., AsyncIterator[User] | asyncio.Future[User]]:
    async def factory(
        *,
        full_name: str = "Тестовый пользователь",
        email: str | None = None,
        password: str = "Passw0rd!",
        role_code: str = "admin",
        is_active: bool = True,
    ) -> User:
        role = await get_role(db_session, role_code)
        user = User(
            full_name=full_name,
            email=(email or f"{role_code}-{uuid4().hex[:8]}@example.com").lower(),
            password_hash=hash_password(password),
            role_id=role.id,
            is_active=is_active,
            failed_login_attempts=0,
            blocked_until=None,
            updated_at=datetime.now(timezone.utc),
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)
        return user

    return factory


@pytest_asyncio.fixture
async def create_product(
    db_session: AsyncSession,
) -> Callable[..., AsyncIterator[Product] | asyncio.Future[Product]]:
    async def factory(
        *,
        name: str | None = None,
        sku: str | None = None,
        is_active: bool = True,
    ) -> Product:
        token = uuid4().hex[:8].upper()
        product = Product(
            name=name or f"Тестовый товар {token}",
            sku=sku or f"SKU-{token}",
            is_active=is_active,
        )
        db_session.add(product)
        await db_session.commit()
        await db_session.refresh(product)
        return product

    return factory


@pytest_asyncio.fixture
async def create_review_record(
    db_session: AsyncSession,
    create_product,
    create_user,
) -> Callable[..., AsyncIterator[Review] | asyncio.Future[Review]]:
    async def factory(
        *,
        product: Product | None = None,
        source_code: str = "manual",
        status_code: str = "new",
        review_text: str = "Тестовый отзыв",
        rating: int = 5,
        review_date: date = date(2026, 4, 30),
        assigned_user: User | None = None,
        created_by: User | None = None,
        updated_by: User | None = None,
        external_id: str | None = None,
    ) -> Review:
        product = product or await create_product()
        source = await get_source(db_session, source_code)
        status_item = await get_status(db_session, status_code)
        author = created_by or await create_user(role_code="manager")
        editor = updated_by or author
        review = Review(
            external_id=external_id,
            product_id=product.id,
            source_id=source.id,
            review_text=review_text,
            rating=rating,
            review_date=review_date,
            status_id=status_item.id,
            assigned_user_id=assigned_user.id if assigned_user is not None else None,
            created_by_user_id=author.id,
            updated_by_user_id=editor.id,
            updated_at=datetime.now(timezone.utc),
        )
        db_session.add(review)
        await db_session.flush()
        await db_session.refresh(review)
        db_session.add(
            ReviewStatusHistory(
                review_id=review.id,
                from_status_id=None,
                to_status_id=status_item.id,
                changed_by_user_id=editor.id,
                comment="Seeded for test",
            ),
        )
        if assigned_user is not None:
            db_session.add(
                ReviewAssignment(
                    review_id=review.id,
                    assigned_user_id=assigned_user.id,
                    assigned_by_user_id=author.id,
                ),
            )
        await db_session.commit()
        await db_session.refresh(review)
        return review

    return factory


@pytest.fixture
def auth_headers_for() -> Callable[[User, str], dict[str, str]]:
    def factory(user: User, role_code: str) -> dict[str, str]:
        token = create_access_token(
            subject=str(user.id),
            additional_claims={"role": role_code, "email": user.email},
        )
        return {"Authorization": f"Bearer {token}"}

    return factory
