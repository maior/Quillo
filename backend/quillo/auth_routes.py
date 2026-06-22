"""Standalone 인증 라우트 — 세션 로그인 + 외부 도구용 Bearer API 토큰.

호스트(mspl 등)에 임베드할 때는 이 라우터를 마운트하지 않고, 호스트의 인증을 쓴다.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models
from .database import get_db
from .security import (
    SESSION_COOKIE,
    SESSION_TTL,
    create_session,
    destroy_session,
    get_current_user,
    hash_api_token,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    role: str
    status: str = "active"


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)) -> models.User:
    user = db.scalar(select(models.User).where(models.User.email == body.email))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if user.status == "pending":
        raise HTTPException(status_code=403, detail="관리자 승인 후 로그인할 수 있습니다.")
    token = create_session(db, user.id)
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(SESSION_TTL.total_seconds()),
        httponly=True,
        samesite="lax",
    )
    return user


@router.post("/logout")
def logout(
    response: Response,
    db: Session = Depends(get_db),
    quillo_session: str | None = Cookie(default=None),
) -> dict[str, str]:
    if quillo_session:
        destroy_session(db, quillo_session)
    response.delete_cookie(SESSION_COOKIE)
    return {"status": "ok"}


@router.get("/me", response_model=UserOut)
def me(user: models.User = Depends(get_current_user)) -> models.User:
    return user


@router.get("/users")
def list_active_users(
    db: Session = Depends(get_db), user: models.User = Depends(get_current_user)
) -> list[dict]:
    """초대 대상 선택용 활성 사용자 목록 — id·이름·이메일만."""
    rows = db.scalars(
        select(models.User).where(models.User.status == "active").order_by(models.User.name)
    )
    return [{"id": u.id, "name": u.name, "email": u.email} for u in rows]


@router.post("/token")
def issue_api_token(
    db: Session = Depends(get_db), user: models.User = Depends(get_current_user)
) -> dict:
    """개인 API 토큰 발급 — 기존 토큰은 폐기되고 원문은 이번 응답에서만 노출된다."""
    token = "quillo_" + secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc).isoformat()
    rec = db.scalar(select(models.ApiToken).where(models.ApiToken.user_id == user.id))
    if rec:
        rec.token_hash = hash_api_token(token)
        rec.prefix = token[:10]
        rec.created_at = now
    else:
        db.add(
            models.ApiToken(
                user_id=user.id,
                token_hash=hash_api_token(token),
                prefix=token[:10],
                created_at=now,
            )
        )
    db.commit()
    return {"token": token, "prefix": token[:10]}


@router.get("/token")
def api_token_status(
    db: Session = Depends(get_db), user: models.User = Depends(get_current_user)
) -> dict:
    rec = db.scalar(select(models.ApiToken).where(models.ApiToken.user_id == user.id))
    if rec is None:
        return {"has_token": False}
    return {"has_token": True, "prefix": rec.prefix, "created_at": rec.created_at}


@router.delete("/token")
def revoke_api_token(
    db: Session = Depends(get_db), user: models.User = Depends(get_current_user)
) -> dict:
    rec = db.scalar(select(models.ApiToken).where(models.ApiToken.user_id == user.id))
    if rec:
        db.delete(rec)
        db.commit()
    return {"revoked": rec is not None}
