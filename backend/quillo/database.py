"""SQLite 엔진/세션/Base 정의 및 DB 의존성."""
from __future__ import annotations

import os
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

# DB 파일 경로 (환경변수로 오버라이드 가능 — 테스트·임베드에서 사용)
DEFAULT_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "quillo.db")
DATABASE_URL = os.environ.get("QUILLO_DATABASE_URL", f"sqlite:///{DEFAULT_DB_PATH}")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    """FastAPI 의존성: 요청 단위 세션. 호스트 앱이 override 할 수 있다."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
