"""Quillo — 협업 LaTeX 논문 워크스페이스 (추출 가능한 패키지).

호스트 앱(mspl 등)에 임베드하는 법:

    from quillo import paper_router, templates_router, get_current_user, get_db, Base
    from quillo.papers_routes import PAPER_UPLOAD_DIR

    app.include_router(paper_router)
    app.include_router(templates_router)
    # 호스트 사용자/세션으로 교체 — CurrentUser 는 (id, name, email, role) 속성만 있으면 된다
    app.dependency_overrides[get_current_user] = host_get_current_user
    app.dependency_overrides[get_db] = host_get_db
    Base.metadata.create_all(bind=host_engine)  # paper_* 테이블을 호스트 DB 에 생성

standalone 구동: `uvicorn quillo.main:app --port 8675`
"""
from __future__ import annotations

from . import models
from .database import Base, get_db
from .papers_routes import router as paper_router
from .security import get_current_user, require_admin
from .templates_routes import router as templates_router

__all__ = [
    "models",
    "Base",
    "get_db",
    "get_current_user",
    "require_admin",
    "paper_router",
    "templates_router",
]
