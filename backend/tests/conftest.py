"""격리된 인메모리 SQLite로 Quillo API 테스트 클라이언트 구성."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from quillo import models  # noqa: F401  (ensure models are registered)
from quillo.database import Base, get_db
from quillo.main import app
from quillo.security import hash_password

ADMIN = {"email": "admin@quillo.local", "password": "change-me-quillo"}


@pytest.fixture()
def client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)

    db = TestingSession()
    db.add(
        models.User(
            email=ADMIN["email"],
            password_hash=hash_password(ADMIN["password"]),
            name="Quillo Admin",
            role="admin",
            status="active",
        )
    )
    db.commit()
    db.close()

    def override_get_db():
        session = TestingSession()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()
