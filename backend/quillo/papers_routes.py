"""Paper Workspace — 잠금(check-out) 기반 단순 공동 집필.

동시 편집 충돌을 막기 위해 한 번에 한 명만 편집한다:
lock 획득 → 본문 저장(보유자만) → unlock. 잠금은 30분 후 자동 만료된다.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models
from .database import get_db
from .security import get_current_user

router = APIRouter(prefix="/api/papers", tags=["papers"])

LOCK_TTL = timedelta(minutes=30)
_STATUSES = ("draft", "submitted", "revision", "published")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _lock_expired(paper: models.Paper) -> bool:
    if not paper.locked_at:
        return True
    return datetime.fromisoformat(paper.locked_at) + LOCK_TTL < datetime.now(timezone.utc)


def _lock_holder(paper: models.Paper) -> int:
    """유효한 잠금 보유자 user_id. 없거나 만료면 0."""
    if paper.lock_user_id and not _lock_expired(paper):
        return paper.lock_user_id
    return 0


def _new_paper_key(db: Session) -> str:
    """외부 노출용 불투명 키 (11자 url-safe). 전부 숫자면 id 와 모호하므로 재생성."""
    while True:
        key = secrets.token_urlsafe(8)
        if key.isdigit():
            continue
        if db.scalar(select(models.Paper).where(models.Paper.key == key)) is None:
            return key


def _resolve_paper(db: Session, ref: str) -> models.Paper | None:
    """해시 키 우선 해석, 숫자는 id 폴백 (기존 내부 호환)."""
    paper = db.scalar(select(models.Paper).where(models.Paper.key == ref))
    if paper is None and ref.isdigit():
        paper = db.get(models.Paper, int(ref))
    return paper


def _is_collaborator(db: Session, paper_id: int, user_id: int) -> bool:
    return (
        db.scalar(
            select(models.PaperCollaborator).where(
                models.PaperCollaborator.paper_id == paper_id,
                models.PaperCollaborator.user_id == user_id,
            )
        )
        is not None
    )


def _can_access(db: Session, paper: models.Paper, user: models.User) -> bool:
    """소유자·초대된 협업자·admin 만. owner_id=0(구버전 미지정)은 전체 공개로 동작."""
    if user.role == "admin" or paper.owner_id in (0, user.id):
        return True
    return _is_collaborator(db, paper.id, user.id)


def _get_paper_or_404(db: Session, ref: str, user: models.User) -> models.Paper:
    """접근 권한까지 검사 — 권한 없으면 존재를 드러내지 않고 404."""
    paper = _resolve_paper(db, ref)
    if paper is None or not _can_access(db, paper, user):
        raise HTTPException(status_code=404, detail="Not found")
    return paper


class PaperIn(BaseModel):
    title: str | None = None
    status: str | None = None
    journal: str | None = None
    content: str | None = None


class PaperMeta(BaseModel):
    id: int
    key: str
    title: str
    status: str
    journal: str
    owner_name: str
    mine: bool  # 내가 소유자
    shared: bool  # 초대받아 접근 (소유자 아님)
    updated_by: str
    updated_at: str
    lock_user_name: str
    locked: bool
    lock_mine: bool


class PaperOut(PaperMeta):
    content: str
    created_by: str
    # 외부 도구가 루트 응답만 보고도 사용법을 찾아갈 수 있도록 진입점을 노출
    guide: str = ""
    instructions: str = ""


def _full(db: Session, p: models.Paper, user: models.User) -> dict:
    """PaperOut 응답 — 메타 + 본문 + guide 진입점 안내."""
    return {
        **_meta(db, p, user),
        "content": p.content,
        "created_by": p.created_by,
        "guide": f"/api/papers/{p.key}/guide",
        "instructions": (
            f"사용법은 GET /api/papers/{p.key}/guide (마크다운) 를 먼저 읽으세요. "
            "읽기는 자유, 쓰기는 POST .../lock 으로 편집 잠금을 먼저 획득해야 합니다(미획득 시 423)."
        ),
    }


def _meta(db: Session, p: models.Paper, user: models.User) -> dict:
    holder = _lock_holder(p)
    owner = db.get(models.User, p.owner_id) if p.owner_id else None
    return dict(
        id=p.id,
        key=p.key,
        title=p.title,
        status=p.status,
        journal=p.journal,
        owner_name=(owner.name or owner.email) if owner else p.created_by,
        mine=p.owner_id == user.id,
        shared=p.owner_id != user.id and _is_collaborator(db, p.id, user.id),
        updated_by=p.updated_by,
        updated_at=p.updated_at,
        lock_user_name=p.lock_user_name if holder else "",
        locked=holder != 0,
        lock_mine=holder == user.id,
    )


@router.get("", response_model=list[PaperMeta])
def list_papers(
    db: Session = Depends(get_db), user: models.User = Depends(get_current_user)
) -> list[dict]:
    """접근 가능한 원고만 — 내 것·초대받은 것·(admin 은 전체)."""
    papers = db.scalars(select(models.Paper).order_by(models.Paper.id.desc()))
    return [_meta(db, p, user) for p in papers if _can_access(db, p, user)]


@router.post("", response_model=PaperOut)
def create_paper(
    body: PaperIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> dict:
    if not (body.title and body.title.strip()):
        raise HTTPException(status_code=422, detail="제목을 입력해 주세요")
    paper = models.Paper(
        key=_new_paper_key(db),
        owner_id=user.id,
        title=body.title.strip(),
        status=body.status if body.status in _STATUSES else "draft",
        journal=body.journal or "",
        content=body.content or "",
        created_by=user.name or user.email,
        updated_by=user.name or user.email,
        updated_at=_now(),
    )
    db.add(paper)
    db.commit()
    # 기본 LaTeX 골격 — 모든 프로젝트는 main.tex 에서 시작한다
    db.add(
        models.PaperFile(
            paper_id=paper.id,
            path="main.tex",
            kind="text",
            content=MAIN_TEX_TEMPLATE.replace("__TITLE__", paper.title),
        )
    )
    db.commit()
    return _full(db, paper, user)


@router.get("/{paper_ref}", response_model=PaperOut)
def get_paper(
    paper_ref: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> dict:
    paper = _get_paper_or_404(db, paper_ref, user)
    return _full(db, paper, user)


@router.put("/{paper_ref}", response_model=PaperOut)
def update_paper(
    paper_ref: str,
    body: PaperIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> dict:
    paper = _get_paper_or_404(db, paper_ref, user)

    data = body.model_dump(exclude_unset=True)
    # 본문 변경은 잠금 보유자만 — 423 Locked
    if "content" in data and _lock_holder(paper) != user.id:
        raise HTTPException(status_code=423, detail="편집 잠금을 먼저 획득해야 합니다")
    if "status" in data and data["status"] not in _STATUSES:
        raise HTTPException(status_code=422, detail="status 값이 올바르지 않습니다")
    for key in ("title", "status", "journal", "content"):
        if key in data and data[key] is not None:
            setattr(paper, key, data[key])
    paper.updated_by = user.name or user.email
    paper.updated_at = _now()
    # 저장 시 잠금 TTL 갱신 (작업 중 만료 방지)
    if _lock_holder(paper) == user.id:
        paper.locked_at = _now()
    db.commit()
    return _full(db, paper, user)


@router.post("/{paper_ref}/lock", response_model=PaperMeta)
def lock_paper(
    paper_ref: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> dict:
    paper = _get_paper_or_404(db, paper_ref, user)
    holder = _lock_holder(paper)
    if holder and holder != user.id:
        raise HTTPException(
            status_code=409, detail=f"{paper.lock_user_name}님이 편집 중입니다"
        )
    paper.lock_user_id = user.id
    paper.lock_user_name = user.name or user.email
    paper.locked_at = _now()
    db.commit()
    return _meta(db, paper, user)


@router.post("/{paper_ref}/unlock", response_model=PaperMeta)
def unlock_paper(
    paper_ref: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> dict:
    paper = _get_paper_or_404(db, paper_ref, user)
    holder = _lock_holder(paper)
    if holder and holder != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="잠금 보유자 또는 관리자만 해제할 수 있습니다")
    paper.lock_user_id = 0
    paper.lock_user_name = ""
    paper.locked_at = ""
    db.commit()
    return _meta(db, paper, user)


@router.delete("/{paper_ref}")
def delete_paper(
    paper_ref: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> dict:
    paper = _get_paper_or_404(db, paper_ref, user)
    if paper.owner_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="소유자 또는 관리자만 삭제할 수 있습니다")
    # 파일·초대도 함께 삭제 — 고아 행이 남으면 id 재사용 시 새 논문이 옛 데이터를 상속한다
    for f in db.scalars(
        select(models.PaperFile).where(models.PaperFile.paper_id == paper.id)
    ):
        db.delete(f)
    for c in db.scalars(
        select(models.PaperCollaborator).where(models.PaperCollaborator.paper_id == paper.id)
    ):
        db.delete(c)
    for cm in db.scalars(
        select(models.PaperComment).where(models.PaperComment.paper_id == paper.id)
    ):
        db.delete(cm)
    for rv in db.scalars(
        select(models.PaperRevision).where(models.PaperRevision.paper_id == paper.id)
    ):
        db.delete(rv)
    db.delete(paper)
    db.commit()
    return {"status": "deleted"}


# ─────────────────────────────────────────────────────────
# 공유·편집 초대 — 소유자가 멤버를 초대하면 그 멤버만 공동 편집
# ─────────────────────────────────────────────────────────


class InviteIn(BaseModel):
    email: str


@router.get("/{paper_ref}/collaborators")
def list_collaborators(
    paper_ref: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> dict:
    paper = _get_paper_or_404(db, paper_ref, user)
    owner = db.get(models.User, paper.owner_id) if paper.owner_id else None
    rows = db.scalars(
        select(models.PaperCollaborator)
        .where(models.PaperCollaborator.paper_id == paper.id)
        .order_by(models.PaperCollaborator.id)
    )
    collaborators = []
    for c in rows:
        u = db.get(models.User, c.user_id)
        collaborators.append(
            {
                "user_id": c.user_id,
                "name": (u.name or u.email) if u else "(탈퇴한 사용자)",
                "email": u.email if u else "",
                "invited_at": c.invited_at,
            }
        )
    return {
        "owner": {
            "user_id": paper.owner_id,
            "name": (owner.name or owner.email) if owner else paper.created_by,
        },
        "collaborators": collaborators,
        "can_invite": user.role == "admin" or paper.owner_id == user.id,
    }


@router.post("/{paper_ref}/collaborators")
def invite_collaborator(
    paper_ref: str,
    body: InviteIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> dict:
    paper = _get_paper_or_404(db, paper_ref, user)
    if paper.owner_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="소유자만 초대할 수 있습니다")
    target = db.scalar(select(models.User).where(models.User.email == body.email.strip()))
    if target is None or target.status != "active":
        raise HTTPException(status_code=404, detail="해당 이메일의 활성 멤버가 없습니다")
    if target.id == paper.owner_id:
        raise HTTPException(status_code=409, detail="소유자는 초대할 필요가 없습니다")
    if _is_collaborator(db, paper.id, target.id):
        raise HTTPException(status_code=409, detail="이미 초대된 멤버입니다")
    db.add(
        models.PaperCollaborator(paper_id=paper.id, user_id=target.id, invited_at=_now())
    )
    db.commit()
    return {"invited": target.id, "name": target.name or target.email, "email": target.email}


@router.delete("/{paper_ref}/collaborators/{user_id}")
def remove_collaborator(
    paper_ref: str,
    user_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> dict:
    """소유자·admin 은 초대 철회, 협업자 본인은 스스로 나가기."""
    paper = _get_paper_or_404(db, paper_ref, user)
    if not (user.role == "admin" or paper.owner_id == user.id or user.id == user_id):
        raise HTTPException(status_code=403, detail="소유자 또는 본인만 해제할 수 있습니다")
    row = db.scalar(
        select(models.PaperCollaborator).where(
            models.PaperCollaborator.paper_id == paper.id,
            models.PaperCollaborator.user_id == user_id,
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="초대 내역이 없습니다")
    db.delete(row)
    db.commit()
    return {"removed": user_id}


# ─────────────────────────────────────────────────────────
# 파일 트리 — LaTeX 프로젝트 구조 (text/.bib, 이미지, 폴더)
# 모든 쓰기 작업은 paper 잠금 보유자만 가능하다.
# ─────────────────────────────────────────────────────────

import io
import os
import re
import secrets
import zipfile

from fastapi import UploadFile, Form
from fastapi.responses import StreamingResponse

PAPER_UPLOAD_DIR = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "uploads", "papers"
)
_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf", ".eps"}
_PATH_SEGMENT = re.compile(r"^[\w.\-가-힣 ]+$")

MAIN_TEX_TEMPLATE = """\\documentclass{article}
\\usepackage{graphicx}

\\title{__TITLE__}
\\author{}

\\begin{document}
\\maketitle

% \\input{sections/intro}

\\end{document}
"""


def _normalize_path(path: str) -> str:
    raw = (path or "").strip()
    if raw.startswith("/"):
        raise HTTPException(status_code=422, detail="경로가 올바르지 않습니다")
    segments = [seg for seg in raw.strip("/").split("/")]
    if not segments or any(not seg or seg == ".." or not _PATH_SEGMENT.match(seg) for seg in segments):
        raise HTTPException(status_code=422, detail="경로가 올바르지 않습니다")
    return "/".join(segments)


def _require_lock(paper: models.Paper, user: models.User) -> None:
    if _lock_holder(paper) != user.id:
        raise HTTPException(status_code=423, detail="편집 잠금을 먼저 획득해야 합니다")


class FileIn(BaseModel):
    path: str | None = None
    kind: str | None = None  # text | folder
    content: str | None = None


class FileOut(BaseModel):
    id: int
    path: str
    kind: str
    storage: str = ""


class FileDetail(FileOut):
    content: str = ""


def _file_out(f: models.PaperFile) -> dict:
    return {"id": f.id, "path": f.path, "kind": f.kind, "storage": f.storage}


@router.get("/{paper_ref}/files", response_model=list[FileOut])
def list_files(
    paper_ref: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> list[dict]:
    paper = _get_paper_or_404(db, paper_ref, user)
    files = db.scalars(
        select(models.PaperFile)
        .where(models.PaperFile.paper_id == paper.id)
        .order_by(models.PaperFile.path)
    )
    return [_file_out(f) for f in files]


@router.post("/{paper_ref}/files", response_model=FileOut)
def create_file(
    paper_ref: str,
    body: FileIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> dict:
    paper = _get_paper_or_404(db, paper_ref, user)
    _require_lock(paper, user)
    path = _normalize_path(body.path or "")
    kind = body.kind if body.kind in ("text", "folder") else "text"
    exists = db.scalar(
        select(models.PaperFile).where(
            models.PaperFile.paper_id == paper.id, models.PaperFile.path == path
        )
    )
    if exists:
        raise HTTPException(status_code=409, detail="같은 경로의 파일이 이미 있습니다")
    f = models.PaperFile(paper_id=paper.id, path=path, kind=kind, content=body.content or "")
    db.add(f)
    db.commit()
    return _file_out(f)


@router.get("/{paper_ref}/files/{file_id}", response_model=FileDetail)
def get_file(
    paper_ref: str,
    file_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> dict:
    paper = _get_paper_or_404(db, paper_ref, user)
    f = db.get(models.PaperFile, file_id)
    if f is None or f.paper_id != paper.id:
        raise HTTPException(status_code=404, detail="Not found")
    return {**_file_out(f), "content": f.content}


@router.put("/{paper_ref}/files/{file_id}", response_model=FileDetail)
def update_file(
    paper_ref: str,
    file_id: int,
    body: FileIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> dict:
    paper = _get_paper_or_404(db, paper_ref, user)
    _require_lock(paper, user)
    f = db.get(models.PaperFile, file_id)
    if f is None or f.paper_id != paper.id:
        raise HTTPException(status_code=404, detail="Not found")
    if body.content is not None and f.kind == "text":
        f.content = body.content
    if body.path is not None:
        new_path = _normalize_path(body.path)
        if new_path != f.path:
            # 대상 경로 점유 시 409 — 이동/이름변경이 기존 파일을 덮어쓰지 않는다
            if db.scalar(
                select(models.PaperFile).where(
                    models.PaperFile.paper_id == paper.id, models.PaperFile.path == new_path
                )
            ):
                raise HTTPException(status_code=409, detail="같은 경로의 파일이 이미 있습니다")
            if f.kind == "folder":
                # 자기 자신/하위로 이동 금지 + 하위 파일 경로 동반 변경
                if new_path == f.path or new_path.startswith(f.path + "/"):
                    raise HTTPException(status_code=422, detail="폴더를 자기 하위로 옮길 수 없습니다")
                old_prefix = f.path + "/"
                for child in db.scalars(
                    select(models.PaperFile).where(
                        models.PaperFile.paper_id == paper.id,
                        models.PaperFile.path.startswith(old_prefix),
                    )
                ):
                    child.path = new_path + "/" + child.path[len(old_prefix):]
            f.path = new_path
    paper.updated_by = user.name or user.email
    paper.updated_at = _now()
    paper.locked_at = _now()  # 작업 중 잠금 연장
    db.commit()
    return {**_file_out(f), "content": f.content}


@router.delete("/{paper_ref}/files/{file_id}")
def delete_file(
    paper_ref: str,
    file_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> dict:
    paper = _get_paper_or_404(db, paper_ref, user)
    _require_lock(paper, user)
    f = db.get(models.PaperFile, file_id)
    if f is None or f.paper_id != paper.id:
        raise HTTPException(status_code=404, detail="Not found")
    removed_ids = [f.id]
    if f.kind == "folder":
        children = db.scalars(
            select(models.PaperFile).where(
                models.PaperFile.paper_id == paper.id,
                models.PaperFile.path.startswith(f.path + "/"),
            )
        )
        for child in children:
            removed_ids.append(child.id)
            db.delete(child)
    # 코멘트도 함께 삭제 — 고아 행 방지
    for cm in db.scalars(
        select(models.PaperComment).where(models.PaperComment.file_id.in_(removed_ids))
    ):
        db.delete(cm)
    db.delete(f)
    db.commit()
    return {"status": "deleted"}


@router.post("/{paper_ref}/files/upload", response_model=FileOut)
async def upload_paper_file(
    paper_ref: str,
    file: UploadFile,
    folder: str = Form(default=""),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> dict:
    paper = _get_paper_or_404(db, paper_ref, user)
    _require_lock(paper, user)
    name = os.path.basename(file.filename or "file")
    ext = os.path.splitext(name)[1].lower()
    if ext not in _IMAGE_EXT:
        raise HTTPException(
            status_code=422,
            detail=f"이미지/그림 파일만 업로드할 수 있습니다 ({', '.join(sorted(_IMAGE_EXT))})",
        )
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=422, detail="20MB 이하 파일만 업로드할 수 있습니다")
    logical = _normalize_path(f"{folder}/{name}" if folder else name)
    if db.scalar(
        select(models.PaperFile).where(
            models.PaperFile.paper_id == paper.id, models.PaperFile.path == logical
        )
    ):
        raise HTTPException(status_code=409, detail="같은 경로의 파일이 이미 있습니다")

    store_dir = os.path.join(PAPER_UPLOAD_DIR, str(paper.id))
    os.makedirs(store_dir, exist_ok=True)
    stored = f"{secrets.token_hex(8)}{ext}"
    with open(os.path.join(store_dir, stored), "wb") as out:
        out.write(data)

    f = models.PaperFile(
        paper_id=paper.id,
        path=logical,
        kind="image",
        storage=f"/uploads/papers/{paper.id}/{stored}",
    )
    db.add(f)
    db.commit()
    return _file_out(f)


@router.get("/{paper_ref}/export")
def export_zip(
    paper_ref: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> StreamingResponse:
    """프로젝트 전체를 폴더 구조 그대로 ZIP 으로 — 로컬/Overleaf 에서 바로 컴파일."""
    paper = _get_paper_or_404(db, paper_ref, user)
    files = list(
        db.scalars(select(models.PaperFile).where(models.PaperFile.paper_id == paper.id))
    )
    buf = io.BytesIO()
    upload_root = os.path.dirname(os.path.dirname(PAPER_UPLOAD_DIR))
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            if f.kind == "text":
                zf.writestr(f.path, f.content)
            elif f.kind == "image" and f.storage:
                disk = os.path.join(upload_root, f.storage.lstrip("/"))
                if os.path.exists(disk):
                    zf.write(disk, f.path)
    buf.seek(0)
    # Content-Disposition 은 latin-1 만 허용 — ASCII 로 한정
    safe = re.sub(r"[^A-Za-z0-9\-]+", "_", paper.title).strip("_")[:40] or "paper"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe}.zip"'},
    )


# ─────────────────────────────────────────────────────────
# 리뷰 코멘트 — 선택 구간(quote)에 단다. 잠금 불필요(편집 중에도 리뷰 가능)
# ─────────────────────────────────────────────────────────


class CommentIn(BaseModel):
    file_id: int
    quote: str = ""
    anchor: int = 0
    body: str = ""


class CommentUpdate(BaseModel):
    status: str  # open | resolved


def _comment_out(c: models.PaperComment) -> dict:
    return {
        "id": c.id,
        "file_id": c.file_id,
        "author_id": c.author_id,
        "author_name": c.author_name,
        "quote": c.quote,
        "anchor": c.anchor,
        "body": c.body,
        "status": c.status,
        "created_at": c.created_at,
    }


@router.get("/{paper_ref}/comments")
def list_comments(
    paper_ref: str,
    file_id: int | None = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> list[dict]:
    paper = _get_paper_or_404(db, paper_ref, user)
    q = select(models.PaperComment).where(models.PaperComment.paper_id == paper.id)
    if file_id is not None:
        q = q.where(models.PaperComment.file_id == file_id)
    return [_comment_out(c) for c in db.scalars(q.order_by(models.PaperComment.id))]


@router.post("/{paper_ref}/comments")
def create_comment(
    paper_ref: str,
    body: CommentIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> dict:
    paper = _get_paper_or_404(db, paper_ref, user)
    if not body.body.strip():
        raise HTTPException(status_code=422, detail="코멘트 내용을 입력해 주세요")
    f = db.get(models.PaperFile, body.file_id)
    if f is None or f.paper_id != paper.id:
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다")
    c = models.PaperComment(
        paper_id=paper.id,
        file_id=body.file_id,
        author_id=user.id,
        author_name=user.name or user.email,
        quote=body.quote,
        anchor=body.anchor,
        body=body.body.strip(),
        status="open",
        created_at=_now(),
    )
    db.add(c)
    db.commit()
    return _comment_out(c)


@router.put("/{paper_ref}/comments/{comment_id}")
def update_comment(
    paper_ref: str,
    comment_id: int,
    body: CommentUpdate,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> dict:
    paper = _get_paper_or_404(db, paper_ref, user)
    c = db.get(models.PaperComment, comment_id)
    if c is None or c.paper_id != paper.id:
        raise HTTPException(status_code=404, detail="Not found")
    if body.status not in ("open", "resolved"):
        raise HTTPException(status_code=422, detail="status 는 open 또는 resolved")
    c.status = body.status
    db.commit()
    return _comment_out(c)


@router.delete("/{paper_ref}/comments/{comment_id}")
def delete_comment(
    paper_ref: str,
    comment_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> dict:
    """작성자 본인·원고 소유자·admin 만 삭제."""
    paper = _get_paper_or_404(db, paper_ref, user)
    c = db.get(models.PaperComment, comment_id)
    if c is None or c.paper_id != paper.id:
        raise HTTPException(status_code=404, detail="Not found")
    if user.id not in (c.author_id, paper.owner_id) and user.role != "admin":
        raise HTTPException(status_code=403, detail="작성자 또는 소유자만 삭제할 수 있습니다")
    db.delete(c)
    db.commit()
    return {"status": "deleted"}


# ─────────────────────────────────────────────────────────
# 버전 히스토리 — 컴파일 시점에 변경된 텍스트 파일을 스냅샷
# ─────────────────────────────────────────────────────────

import difflib


def _record_revisions(db: Session, paper: models.Paper, user: models.User) -> int:
    """직전 스냅샷과 내용이 다른 텍스트 파일만 리비전으로 기록한다."""
    files = db.scalars(
        select(models.PaperFile).where(
            models.PaperFile.paper_id == paper.id, models.PaperFile.kind == "text"
        )
    )
    count = 0
    for f in files:
        last = db.scalar(
            select(models.PaperRevision)
            .where(models.PaperRevision.file_id == f.id)
            .order_by(models.PaperRevision.id.desc())
            .limit(1)
        )
        if last is None or last.content != f.content:
            db.add(
                models.PaperRevision(
                    paper_id=paper.id,
                    file_id=f.id,
                    path=f.path,
                    content=f.content,
                    author_id=user.id,
                    author_name=user.name or user.email,
                    created_at=_now(),
                )
            )
            count += 1
    if count:
        db.commit()
    return count


def _diff_lines(old: str, new: str) -> list[dict]:
    """줄 단위 diff — op: ' '(유지) '+'(추가) '-'(삭제)."""
    out = []
    for line in difflib.ndiff(old.splitlines(), new.splitlines()):
        if line.startswith("? "):
            continue
        out.append({"op": line[0], "text": line[2:]})
    return out


@router.get("/{paper_ref}/history")
def list_history(
    paper_ref: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> list[dict]:
    """리비전 목록 (최신순) — 직전 스냅샷 대비 ±줄 수 포함."""
    paper = _get_paper_or_404(db, paper_ref, user)
    revs = list(
        db.scalars(
            select(models.PaperRevision)
            .where(models.PaperRevision.paper_id == paper.id)
            .order_by(models.PaperRevision.id)
        )
    )
    prev_by_file: dict[int, str] = {}
    out = []
    for r in revs:
        old = prev_by_file.get(r.file_id, "")
        diff = _diff_lines(old, r.content)
        out.append(
            {
                "id": r.id,
                "file_id": r.file_id,
                "path": r.path,
                "author_name": r.author_name,
                "created_at": r.created_at,
                "added": sum(1 for d in diff if d["op"] == "+"),
                "removed": sum(1 for d in diff if d["op"] == "-"),
                "first": r.file_id not in prev_by_file,
            }
        )
        prev_by_file[r.file_id] = r.content
    return list(reversed(out))


@router.get("/{paper_ref}/history/{rev_id}")
def revision_detail(
    paper_ref: str,
    rev_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> dict:
    """리비전 상세 — 직전 스냅샷 대비 줄 단위 diff."""
    paper = _get_paper_or_404(db, paper_ref, user)
    rev = db.get(models.PaperRevision, rev_id)
    if rev is None or rev.paper_id != paper.id:
        raise HTTPException(status_code=404, detail="Not found")
    prev = db.scalar(
        select(models.PaperRevision)
        .where(models.PaperRevision.file_id == rev.file_id, models.PaperRevision.id < rev.id)
        .order_by(models.PaperRevision.id.desc())
        .limit(1)
    )
    return {
        "id": rev.id,
        "file_id": rev.file_id,
        "path": rev.path,
        "author_name": rev.author_name,
        "created_at": rev.created_at,
        "diff": _diff_lines(prev.content if prev else "", rev.content),
    }


@router.post("/{paper_ref}/history/{rev_id}/restore")
def restore_revision(
    paper_ref: str,
    rev_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> dict:
    """파일 내용을 해당 리비전으로 되돌린다 — 잠금 보유자만."""
    paper = _get_paper_or_404(db, paper_ref, user)
    _require_lock(paper, user)
    rev = db.get(models.PaperRevision, rev_id)
    if rev is None or rev.paper_id != paper.id:
        raise HTTPException(status_code=404, detail="Not found")
    f = db.get(models.PaperFile, rev.file_id)
    if f is None:  # 파일이 삭제됐으면 같은 경로로 복구
        f = models.PaperFile(paper_id=paper.id, path=rev.path, kind="text", content=rev.content)
        db.add(f)
    else:
        f.content = rev.content
    paper.updated_by = user.name or user.email
    paper.updated_at = _now()
    db.commit()
    return {"restored": rev.id, "file_id": f.id}


# ── 에이전트용 사용설명서 (self-describing API) ──


@router.get("/{paper_ref}/guide")
def usage_guide(
    paper_ref: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """외부 도구(Claude Code 등)가 URL+토큰만 받고도 작업할 수 있도록 — 이 프로젝트 전용 사용법."""
    from fastapi.responses import Response

    paper = _get_paper_or_404(db, paper_ref, user)
    base = f"/api/papers/{paper.key}"
    md = f"""# Quillo — 외부 편집 가이드

이 프로젝트: **{paper.title}** (`{base}`)
인증: 모든 요청에 `Authorization: Bearer <토큰>` 헤더.

## 읽기

- `GET {base}` — 논문 메타 (title, status: draft|submitted|revision|published, journal, locked, lock_user_name)
- `GET {base}/files` — 파일 목록 [{{id, path, kind: text|image|folder}}]
- `GET {base}/files/{{file_id}}` — 파일 내용 (content)
- `GET {base}/export` — 프로젝트 전체 ZIP

## 쓰기 (잠금 필수)

쓰기 전 반드시 잠금을 획득한다. 잠금 없이 쓰면 **423** 으로 거절된다.
다른 사람이 편집 중이면 lock 이 409 를 반환한다 — 기다리거나 사용자에게 알릴 것.
잠금은 30분 후 자동 만료되며, 저장할 때마다 연장된다.

1. `POST {base}/lock`
2. 수정:
   - `PUT {base}/files/{{file_id}}` body `{{"content": "..."}}` — 파일 내용 교체
   - `POST {base}/files` body `{{"path": "sections/intro.tex", "kind": "text", "content": "..."}}` — 새 파일
   - `DELETE {base}/files/{{file_id}}` — 파일 삭제
   - `POST {base}/apply-template` body `{{"key": "<템플릿 키>"}}` — main.tex 교체 (`GET /api/templates` 로 26종 목록)
   - `PUT {base}` body `{{"title"|"status"|"journal": ...}}` — 메타 수정
3. `POST {base}/compile` — xelatex 컴파일. 성공 시 PDF 바이너리, 실패 시 422 + 오류 로그 (수정 후 재시도)
   - `?entry=<path>` 로 특정 파일 기준 미리보기: \\documentclass 가 있으면 그 파일을 진입점으로, 없으면(섹션 조각) main.tex 프리앰블을 빌려 조판
4. `POST {base}/unlock` — 작업이 끝나면 반드시 해제

## 버전 히스토리

- 컴파일할 때마다 변경된 텍스트 파일이 자동 스냅샷된다.
- `GET {base}/history` — 리비전 목록 (작성자·시각·±줄 수, 최신순)
- `GET {base}/history/{{rev_id}}` — 직전 대비 줄 단위 diff
- `POST {base}/history/{{rev_id}}/restore` — 해당 버전으로 복원 (잠금 필요)

## 리뷰 코멘트 (잠금 불필요)

- `GET {base}/comments?file_id={{id}}` — 코멘트 목록 (status: open|resolved)
- `POST {base}/comments` body `{{"file_id": N, "quote": "<원문 조각>", "anchor": <오프셋>, "body": "..."}}` — 선택 구간에 코멘트
- `PUT {base}/comments/{{id}}` body `{{"status": "resolved"}}` — 해결 처리
- 리뷰 의견은 본문을 고치는 대신 코멘트로 남길 수 있다 — 잠금이 없어도 된다.

## 규칙

- 진입점은 항상 `main.tex` 다. 동봉된 .sty/.cls 파일은 삭제하지 말 것.
- 이미지 업로드는 multipart `POST {base}/files/upload` (file, folder) — jpg/png/gif/webp/pdf/eps, 20MB 이하.
- 컴파일이 422 면 로그의 `!` 줄을 읽고 LaTeX 오류를 고친 뒤 다시 컴파일한다.
- 작업을 마치면 compile 로 PDF 생성 여부를 검증하고 unlock 한다.
"""
    return Response(content=md, media_type="text/markdown; charset=utf-8")


# ── LaTeX 컴파일 (PDF 미리보기) ──

import shutil
import subprocess
import tempfile

from fastapi.responses import Response

def _find_tex_engine() -> str | None:
    # 한글 제목·본문이 일반적이므로 유니코드 네이티브 xelatex 우선
    for name in ("xelatex", "pdflatex"):
        found = shutil.which(name) or (
            f"/Library/TeX/texbin/{name}"
            if os.path.exists(f"/Library/TeX/texbin/{name}")
            else None
        )
        if found:
            return found
    return None


def _find_bibtex() -> str | None:
    return shutil.which("bibtex") or (
        "/Library/TeX/texbin/bibtex" if os.path.exists("/Library/TeX/texbin/bibtex") else None
    )


_TEX_ENGINE = _find_tex_engine()
_BIBTEX_ENGINE = _find_bibtex()


@router.post("/{paper_ref}/compile")
def compile_paper(
    paper_ref: str,
    entry: str | None = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> Response:
    """파일 트리를 임시 디렉터리에 풀고 컴파일 — PDF 또는 422+로그.

    entry 가 주어지면 그 파일 기준으로 미리보기:
    - \\documentclass 가 있으면 그 파일을 진입점으로 직접 컴파일
    - 없으면(섹션 조각) main.tex 의 프리앰블을 빌려 \\input 래퍼로 컴파일
    """
    if _TEX_ENGINE is None:
        raise HTTPException(status_code=503, detail="서버에 LaTeX(pdflatex)가 설치되어 있지 않습니다")
    paper = _get_paper_or_404(db, paper_ref, user)
    files = list(
        db.scalars(select(models.PaperFile).where(models.PaperFile.paper_id == paper.id))
    )
    by_path = {f.path: f for f in files if f.kind == "text"}

    target = "main.tex"
    wrapper: str | None = None
    if entry and entry != "main.tex":
        ef = by_path.get(entry)
        if ef is None:
            raise HTTPException(status_code=404, detail=f"{entry} 파일을 찾을 수 없습니다")
        if "\\documentclass" in ef.content:
            target = entry
        else:
            main = by_path.get("main.tex")
            if main is None:
                raise HTTPException(status_code=422, detail="main.tex 가 필요합니다")
            head, sep, _ = main.content.partition("\\begin{document}")
            if not sep:
                raise HTTPException(
                    status_code=422, detail="main.tex 에 \\begin{document} 가 없습니다"
                )
            stem = entry[:-4] if entry.endswith(".tex") else entry
            wrapper = head + "\\begin{document}\n\\input{" + stem + "}\n\\end{document}\n"
            target = "__preview__.tex"
    elif "main.tex" not in by_path:
        raise HTTPException(status_code=422, detail="main.tex 가 필요합니다")

    # 컴파일 = 체크포인트: 변경된 텍스트 파일을 버전 히스토리에 스냅샷
    _record_revisions(db, paper, user)

    upload_root = os.path.dirname(os.path.dirname(PAPER_UPLOAD_DIR))
    with tempfile.TemporaryDirectory() as tmp:
        for f in files:
            disk = os.path.join(tmp, f.path)
            if f.kind == "folder":
                os.makedirs(disk, exist_ok=True)
                continue
            os.makedirs(os.path.dirname(disk) or tmp, exist_ok=True)
            if f.kind == "text":
                with open(disk, "w", encoding="utf-8") as out:
                    out.write(f.content)
            elif f.kind == "image" and f.storage:
                src = os.path.join(upload_root, f.storage.lstrip("/"))
                if os.path.exists(src):
                    shutil.copyfile(src, disk)

        if wrapper is not None:  # 섹션 조각 미리보기 — main 프리앰블 + \input 래퍼
            with open(os.path.join(tmp, target), "w", encoding="utf-8") as out:
                out.write(wrapper)

        # 참조(\ref·목차) 해결을 위해 여러 번 실행. shell-escape 차단.
        cmd = [
            _TEX_ENGINE,
            "-interaction=nonstopmode",
            "-halt-on-error",
            "-no-shell-escape",
            target,
        ]
        stem = os.path.splitext(target)[0]

        def _run_tex() -> str:
            try:
                proc = subprocess.run(
                    cmd, cwd=tmp, capture_output=True, text=True, timeout=60
                )
            except subprocess.TimeoutExpired:
                raise HTTPException(status_code=422, detail="컴파일이 60초를 초과했습니다")
            out = proc.stdout[-4000:]
            if proc.returncode != 0:
                idx = out.find("\n!")  # '!' 가 LaTeX 오류 마커
                detail = out[idx:][:2000] if idx >= 0 else out[-2000:]
                raise HTTPException(status_code=422, detail=detail.strip())
            return out

        # 1) 첫 패스로 .aux 생성
        log = _run_tex()

        # 2) .bib 기반 참고문헌(\bibliography{})이면 bibtex 실행 → .bbl 생성
        #    thebibliography 직접 사용 시엔 \bibdata 가 없어 스킵된다 (회귀 방지)
        aux_path = os.path.join(tmp, stem + ".aux")
        if _BIBTEX_ENGINE and os.path.exists(aux_path):
            with open(aux_path, encoding="utf-8", errors="ignore") as fh:
                aux = fh.read()
            if "\\bibdata" in aux:
                try:
                    # 실패해도(.bib 문법오류 등) 컴파일은 계속 — references 만 비게 둔다
                    subprocess.run(
                        [_BIBTEX_ENGINE, stem], cwd=tmp, capture_output=True, text=True, timeout=30
                    )
                except subprocess.TimeoutExpired:
                    pass

        # 3) 참조·인용 번호 안정화를 위해 2회 더
        for _ in range(2):
            log = _run_tex()

        pdf_name = os.path.splitext(os.path.basename(target))[0] + ".pdf"
        pdf_path = os.path.join(tmp, pdf_name)
        if not os.path.exists(pdf_path):
            raise HTTPException(status_code=422, detail=log[-2000:].strip() or "PDF 생성 실패")
        with open(pdf_path, "rb") as fh:
            return Response(content=fh.read(), media_type="application/pdf")
