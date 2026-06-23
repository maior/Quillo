"""Quillo standalone FastAPI app (:8675).

For running the paper workspace on its own. When embedding into a host, instead of
main, use `from quillo import paper_router, templates_router, get_current_user` and
swap out authentication/DB via app.dependency_overrides (see README).
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from . import models
from .auth_routes import router as auth_router
from .database import Base, SessionLocal, engine, get_db
from .papers_routes import PAPER_UPLOAD_DIR, _new_paper_key
from .papers_routes import router as papers_router
from .security import hash_password
from .templates_routes import router as templates_router

UPLOAD_DIR = os.path.dirname(PAPER_UPLOAD_DIR)  # backend/uploads


def _migrate(bind) -> None:
    """Lightweight schema migration — create_all does not add columns to existing tables."""
    with bind.begin() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(paper)"))]
        if cols and "key" not in cols:
            conn.execute(text('ALTER TABLE paper ADD COLUMN "key" VARCHAR(16) NOT NULL DEFAULT \'\''))
        if cols and "owner_id" not in cols:
            conn.execute(text("ALTER TABLE paper ADD COLUMN owner_id INTEGER NOT NULL DEFAULT 0"))
        # Self-registration adds a pending/active distinction; existing accounts default to active.
        ucols = [row[1] for row in conn.execute(text('PRAGMA table_info("user")'))]
        if ucols and "status" not in ucols:
            conn.execute(text("ALTER TABLE \"user\" ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active'"))


def _backfill_paper_keys(db: Session) -> None:
    changed = False
    for paper in db.scalars(select(models.Paper).where(models.Paper.key == "")):
        paper.key = _new_paper_key(db)
        changed = True
    if changed:
        db.commit()


def _seed_admin(db: Session) -> None:
    """Ensure one initial admin from env (QUILLO_ADMIN_EMAIL/PASSWORD)."""
    email = os.environ.get("QUILLO_ADMIN_EMAIL", "admin@quillo.local")
    password = os.environ.get("QUILLO_ADMIN_PASSWORD", "change-me-quillo")
    if db.scalar(select(models.User).where(models.User.email == email)):
        return
    db.add(
        models.User(
            email=email,
            password_hash=hash_password(password),
            name="Quillo Admin",
            role="admin",
            status="active",
        )
    )
    db.commit()


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _migrate(engine)
    db = SessionLocal()
    try:
        _backfill_paper_keys(db)
        _seed_admin(db)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Quillo API", version="1.0.0", lifespan=lifespan)
    origins = os.environ.get(
        "QUILLO_CORS_ORIGINS",
        "http://localhost:8678,http://127.0.0.1:8678",
    ).split(",")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in origins if o.strip()],
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["*"],
        allow_credentials=True,
    )
    app.include_router(auth_router)
    app.include_router(papers_router)
    app.include_router(templates_router)

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
