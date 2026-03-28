from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db_session

router = APIRouter(tags=["health"])


@router.get("/health", summary="Service health check")
async def health_check(session: AsyncSession = Depends(get_db_session)) -> dict[str, str]:
    settings = get_settings()

    try:
        await session.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"status": "degraded", "database": "unavailable"},
        ) from exc

    return {
        "status": "ok",
        "service": settings.app_name,
        "database": "ok",
    }
