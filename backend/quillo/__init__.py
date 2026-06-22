"""Quillo — collaborative LaTeX paper workspace (extractable package).

How to embed into a host app (such as mspl):

    from quillo import paper_router, templates_router, get_current_user, get_db, Base
    from quillo.papers_routes import PAPER_UPLOAD_DIR

    app.include_router(paper_router)
    app.include_router(templates_router)
    # Swap in the host user/session — CurrentUser only needs the (id, name, email, role) attributes
    app.dependency_overrides[get_current_user] = host_get_current_user
    app.dependency_overrides[get_db] = host_get_db
    Base.metadata.create_all(bind=host_engine)  # create the paper_* tables in the host DB

standalone run: `uvicorn quillo.main:app --port 8675`
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
