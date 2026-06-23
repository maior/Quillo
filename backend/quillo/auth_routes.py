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
    hash_password,
    require_admin,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str


class RegisterIn(BaseModel):
    name: str
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


@router.post("/register", status_code=201)
def register(body: RegisterIn, db: Session = Depends(get_db)) -> dict:
    """Public self-registration. The account is created as `pending` and can log in
    only after an administrator approves it."""
    name = body.name.strip()
    email = body.email.strip().lower()
    if not name:
        raise HTTPException(status_code=422, detail="Please enter your name")
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=422, detail="Please enter a valid email address")
    if len(body.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    if db.scalar(select(models.User).where(models.User.email == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    db.add(
        models.User(
            email=email,
            password_hash=hash_password(body.password),
            name=name,
            role="member",
            status="pending",
        )
    )
    db.commit()
    return {"status": "pending", "message": "Your account is awaiting administrator approval."}


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


# ── Admin: user management (approve registrations, remove accounts) ──────────
@router.get("/admin/users", response_model=list[UserOut])
def admin_list_users(
    db: Session = Depends(get_db), admin: models.User = Depends(require_admin)
) -> list[models.User]:
    """Every user, pending accounts first — for the admin approval screen."""
    users = list(db.scalars(select(models.User)))
    users.sort(key=lambda u: (u.status != "pending", u.name.lower(), u.email))
    return users


@router.post("/admin/users/{user_id}/approve", response_model=UserOut)
def admin_approve_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
) -> models.User:
    user = db.get(models.User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="No such user")
    user.status = "active"
    db.commit()
    db.refresh(user)
    return user


@router.delete("/admin/users/{user_id}")
def admin_remove_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
) -> dict:
    """Reject a pending registration or remove an existing member. Admins cannot be
    removed and an admin cannot remove themselves."""
    user = db.get(models.User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="No such user")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot remove your own account")
    if user.role == "admin":
        raise HTTPException(status_code=400, detail="Admin accounts cannot be removed here")
    db.delete(user)
    db.commit()
    return {"removed": True}
