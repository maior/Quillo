"""Standalone authentication routes — session login + Bearer API tokens for external tools.

When embedding into a host (such as mspl), do not mount this router; use the host's authentication instead.
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
        raise HTTPException(status_code=403, detail="You can log in after an administrator approves your account.")
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
    """List of active users for selecting invitees — id, name, and email only."""
    rows = db.scalars(
        select(models.User).where(models.User.status == "active").order_by(models.User.name)
    )
    return [{"id": u.id, "name": u.name, "email": u.email} for u in rows]


@router.post("/token")
def issue_api_token(
    db: Session = Depends(get_db), user: models.User = Depends(get_current_user)
) -> dict:
    """Issue a personal API token — any existing token is revoked, and the plaintext is exposed only in this response."""
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
