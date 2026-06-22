"""SQLite engine/session/Base definitions and the DB dependency."""
from __future__ import annotations

import os
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

# DB file path (overridable via environment variable — used in tests and embedding)
DEFAULT_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "quillo.db")
DATABASE_URL = os.environ.get("QUILLO_DATABASE_URL", f"sqlite:///{DEFAULT_DB_PATH}")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: a per-request session. Can be overridden by the host app."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
