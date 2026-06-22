"""인증 유틸 — 표준 라이브러리만 사용 (PBKDF2 해시 + 불투명 세션 토큰).

get_current_user / get_db 는 호스트 앱이 app.dependency_overrides 로 교체할 수 있다.
이것이 Quillo 를 mspl 같은 호스트에 임베드하는 결합 지점이다.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Cookie, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models
from .database import get_db

SESSION_COOKIE = "quillo_session"
SESSION_TTL = timedelta(days=14)
_PBKDF2_ITERATIONS = 200_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt.encode(), _PBKDF2_ITERATIONS
    ).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, digest = stored.split("$", 1)
    except ValueError:
        return False
    candidate = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt.encode(), _PBKDF2_ITERATIONS
    ).hex()
    return secrets.compare_digest(candidate, digest)


def create_session(db: Session, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + SESSION_TTL).isoformat()
    db.add(models.AuthSession(token=token, user_id=user_id, expires_at=expires))
    db.commit()
    return token


def destroy_session(db: Session, token: str) -> None:
    sess = db.scalar(select(models.AuthSession).where(models.AuthSession.token == token))
    if sess:
        db.delete(sess)
        db.commit()


def hash_api_token(token: str) -> str:
    """API 토큰은 sha256 해시만 저장한다 (원문은 발급 시 1회 노출)."""
    return hashlib.sha256(token.encode()).hexdigest()


def get_current_user(
    db: Session = Depends(get_db),
    quillo_session: str | None = Cookie(default=None),
    authorization: str | None = Header(default=None),
) -> models.User:
    # 외부 도구용 Bearer API 토큰 — 쿠키와 동일한 사용자 권한으로 동작
    if authorization and authorization.startswith("Bearer "):
        candidate = authorization[len("Bearer ") :].strip()
        rec = db.scalar(
            select(models.ApiToken).where(
                models.ApiToken.token_hash == hash_api_token(candidate)
            )
        )
        if rec is not None:
            user = db.get(models.User, rec.user_id)
            if user is not None:
                return user
        raise HTTPException(status_code=401, detail="Invalid API token")
    if not quillo_session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    sess = db.scalar(
        select(models.AuthSession).where(models.AuthSession.token == quillo_session)
    )
    if sess is None or datetime.fromisoformat(sess.expires_at) < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")
    user = db.get(models.User, sess.user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_admin(user: models.User = Depends(get_current_user)) -> models.User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user
