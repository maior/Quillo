"""SQLAlchemy ORM models — dedicated to the paper workspace (Quillo).

Extracted from mspl. User/AuthSession/ApiToken are minimal models for standalone
authentication; when embedding into a host app, override get_current_user/get_db to
use the host's user system.
"""
from __future__ import annotations

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


# ── Authentication (minimal standalone setup) ───────────────────────────────
class User(Base):
    __tablename__ = "user"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))  # "salt$pbkdf2hex"
    name: Mapped[str] = mapped_column(String(128), default="")
    role: Mapped[str] = mapped_column(String(16), default="member")  # admin | member
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | pending


class AuthSession(Base):
    __tablename__ = "auth_session"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    expires_at: Mapped[str] = mapped_column(String(32))  # ISO8601 UTC


class ApiToken(Base):
    """Personal API token for external tools (Claude Code, etc.) — one per user, hash only."""

    __tablename__ = "api_token"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), index=True)  # sha256 hex
    prefix: Mapped[str] = mapped_column(String(16))  # first 10 chars for identification
    created_at: Mapped[str] = mapped_column(String(32))  # ISO8601 UTC


# ── Paper workspace ─────────────────────────────────────────────────────────
class Paper(Base):
    __tablename__ = "paper"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Opaque hash key for external exposure — URLs/API use this key instead of the sequential id
    key: Mapped[str] = mapped_column(String(16), default="", index=True)
    # Owner — manuscripts are accessible only to the owner, invited collaborators, and admins (0 = legacy, unassigned)
    owner_id: Mapped[int] = mapped_column(Integer, default=0, index=True)
    title: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft|submitted|revision|published
    journal: Mapped[str] = mapped_column(String(255), default="")
    content: Mapped[str] = mapped_column(Text, default="")  # LaTeX/Markdown manuscript
    created_by: Mapped[str] = mapped_column(String(128), default="")
    updated_by: Mapped[str] = mapped_column(String(128), default="")
    updated_at: Mapped[str] = mapped_column(String(32), default="")
    lock_user_id: Mapped[int] = mapped_column(Integer, default=0)  # 0 = no lock
    lock_user_name: Mapped[str] = mapped_column(String(128), default="")
    locked_at: Mapped[str] = mapped_column(String(32), default="")


class PaperCollaborator(Base):
    """Manuscript co-authoring invitation — only members invited by the owner can view and edit the manuscript."""

    __tablename__ = "paper_collaborator"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    paper_id: Mapped[int] = mapped_column(Integer, index=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    invited_at: Mapped[str] = mapped_column(String(32), default="")  # ISO8601 UTC


class PaperComment(Base):
    """Review comment — attached to a selected range (quote) of a file. Independent of locking."""

    __tablename__ = "paper_comment"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    paper_id: Mapped[int] = mapped_column(Integer, index=True)
    file_id: Mapped[int] = mapped_column(Integer, index=True)
    author_id: Mapped[int] = mapped_column(Integer, default=0)
    author_name: Mapped[str] = mapped_column(String(128), default="")
    quote: Mapped[str] = mapped_column(Text, default="")  # selected source fragment (anchor)
    anchor: Mapped[int] = mapped_column(Integer, default=0)  # offset hint at time of writing
    body: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="open")  # open | resolved
    created_at: Mapped[str] = mapped_column(String(32), default="")  # ISO8601 UTC


class PaperRevision(Base):
    """Version history — snapshot of text files changed at compile time."""

    __tablename__ = "paper_revision"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    paper_id: Mapped[int] = mapped_column(Integer, index=True)
    file_id: Mapped[int] = mapped_column(Integer, index=True)
    path: Mapped[str] = mapped_column(String(512), default="")
    content: Mapped[str] = mapped_column(Text, default="")
    author_id: Mapped[int] = mapped_column(Integer, default=0)
    author_name: Mapped[str] = mapped_column(String(128), default="")
    created_at: Mapped[str] = mapped_column(String(32), default="")  # ISO8601 UTC


class PaperFile(Base):
    __tablename__ = "paper_file"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    paper_id: Mapped[int] = mapped_column(Integer, index=True)
    path: Mapped[str] = mapped_column(String(512))  # logical path (e.g. sections/intro.tex)
    kind: Mapped[str] = mapped_column(String(16), default="text")  # text | image | folder
    content: Mapped[str] = mapped_column(Text, default="")  # body of a text file
    storage: Mapped[str] = mapped_column(String(512), default="")  # actual image path (/uploads/...)
