"""SQLAlchemy ORM 모델 — 논문 워크스페이스(Quillo) 전용.

mspl 에서 추출. User/AuthSession/ApiToken 은 standalone 인증을 위한 최소 모델이며,
호스트 앱에 임베드할 때는 get_current_user/get_db 를 override 해 호스트 사용자 체계를 쓴다.
"""
from __future__ import annotations

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


# ── 인증 (standalone 최소 구성) ─────────────────────────────────────────────
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
    """외부 도구(Claude Code 등)용 개인 API 토큰 — 사용자당 1개, 해시만 저장."""

    __tablename__ = "api_token"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), index=True)  # sha256 hex
    prefix: Mapped[str] = mapped_column(String(16))  # 식별용 앞 10자
    created_at: Mapped[str] = mapped_column(String(32))  # ISO8601 UTC


# ── 논문 워크스페이스 ───────────────────────────────────────────────────────
class Paper(Base):
    __tablename__ = "paper"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # 외부 노출용 불투명 해시 키 — URL/API 는 순번 id 대신 이 키를 쓴다
    key: Mapped[str] = mapped_column(String(16), default="", index=True)
    # 소유자 — 원고는 소유자·초대된 협업자·admin 만 접근한다 (0 = 미지정 구버전)
    owner_id: Mapped[int] = mapped_column(Integer, default=0, index=True)
    title: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft|submitted|revision|published
    journal: Mapped[str] = mapped_column(String(255), default="")
    content: Mapped[str] = mapped_column(Text, default="")  # LaTeX/Markdown 원고
    created_by: Mapped[str] = mapped_column(String(128), default="")
    updated_by: Mapped[str] = mapped_column(String(128), default="")
    updated_at: Mapped[str] = mapped_column(String(32), default="")
    lock_user_id: Mapped[int] = mapped_column(Integer, default=0)  # 0 = 잠금 없음
    lock_user_name: Mapped[str] = mapped_column(String(128), default="")
    locked_at: Mapped[str] = mapped_column(String(32), default="")


class PaperCollaborator(Base):
    """원고 공동 집필 초대 — 소유자가 초대한 멤버만 해당 원고를 보고 편집한다."""

    __tablename__ = "paper_collaborator"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    paper_id: Mapped[int] = mapped_column(Integer, index=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    invited_at: Mapped[str] = mapped_column(String(32), default="")  # ISO8601 UTC


class PaperComment(Base):
    """리뷰 코멘트 — 파일의 선택 구간(quote)에 단다. 잠금과 무관."""

    __tablename__ = "paper_comment"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    paper_id: Mapped[int] = mapped_column(Integer, index=True)
    file_id: Mapped[int] = mapped_column(Integer, index=True)
    author_id: Mapped[int] = mapped_column(Integer, default=0)
    author_name: Mapped[str] = mapped_column(String(128), default="")
    quote: Mapped[str] = mapped_column(Text, default="")  # 선택된 원문 조각 (앵커)
    anchor: Mapped[int] = mapped_column(Integer, default=0)  # 작성 시점 오프셋 힌트
    body: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="open")  # open | resolved
    created_at: Mapped[str] = mapped_column(String(32), default="")  # ISO8601 UTC


class PaperRevision(Base):
    """버전 히스토리 — 컴파일 시점에 변경된 텍스트 파일의 스냅샷."""

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
    path: Mapped[str] = mapped_column(String(512))  # 논리 경로 (예: sections/intro.tex)
    kind: Mapped[str] = mapped_column(String(16), default="text")  # text | image | folder
    content: Mapped[str] = mapped_column(Text, default="")  # text 파일 본문
    storage: Mapped[str] = mapped_column(String(512), default="")  # 이미지 실제 경로(/uploads/...)
