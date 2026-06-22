"""Paper Workspace — simple collaborative authoring based on lock (check-out).

To prevent concurrent-edit conflicts, only one person edits at a time:
acquire lock → save content (holder only) → unlock. Locks auto-expire after 30 minutes.
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
    """user_id of the valid lock holder. 0 if none or expired."""
    if paper.lock_user_id and not _lock_expired(paper):
        return paper.lock_user_id
    return 0


def _new_paper_key(db: Session) -> str:
    """Opaque key for external exposure (11-char url-safe). If all digits, ambiguous with id, so regenerate."""
    while True:
        key = secrets.token_urlsafe(8)
        if key.isdigit():
            continue
        if db.scalar(select(models.Paper).where(models.Paper.key == key)) is None:
            return key


def _resolve_paper(db: Session, ref: str) -> models.Paper | None:
    """Resolve hash key first, fall back to numeric id (for existing internal compatibility)."""
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
    """Owner, invited collaborators, and admin only. owner_id=0 (legacy unset) acts as fully public."""
    if user.role == "admin" or paper.owner_id in (0, user.id):
        return True
    return _is_collaborator(db, paper.id, user.id)


def _get_paper_or_404(db: Session, ref: str, user: models.User) -> models.Paper:
    """Also checks access permission — returns 404 without revealing existence if unauthorized."""
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
    mine: bool  # I am the owner
    shared: bool  # accessed via invitation (not the owner)
    updated_by: str
    updated_at: str
    lock_user_name: str
    locked: bool
    lock_mine: bool


class PaperOut(PaperMeta):
    content: str
    created_by: str
    # Expose entry points so external tools can find usage from the root response alone
    guide: str = ""
    instructions: str = ""


def _full(db: Session, p: models.Paper, user: models.User) -> dict:
    """PaperOut response — meta + content + guide entry point."""
    return {
        **_meta(db, p, user),
        "content": p.content,
        "created_by": p.created_by,
        "guide": f"/api/papers/{p.key}/guide",
        "instructions": (
            f"For usage, first read GET /api/papers/{p.key}/guide (markdown). "
            "Reading is open; writing requires acquiring an edit lock first via POST .../lock (otherwise 423)."
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
    """Accessible manuscripts only — mine, those I'm invited to, (admin sees all)."""
    papers = db.scalars(select(models.Paper).order_by(models.Paper.id.desc()))
    return [_meta(db, p, user) for p in papers if _can_access(db, p, user)]


@router.post("", response_model=PaperOut)
def create_paper(
    body: PaperIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> dict:
    if not (body.title and body.title.strip()):
        raise HTTPException(status_code=422, detail="Please enter a title")
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
    # Default LaTeX skeleton — every project starts from main.tex
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
    # Only the lock holder may change content — 423 Locked
    if "content" in data and _lock_holder(paper) != user.id:
        raise HTTPException(status_code=423, detail="You must acquire the edit lock first")
    if "status" in data and data["status"] not in _STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status value")
    for key in ("title", "status", "journal", "content"):
        if key in data and data[key] is not None:
            setattr(paper, key, data[key])
    paper.updated_by = user.name or user.email
    paper.updated_at = _now()
    # Refresh lock TTL on save (prevent expiry mid-work)
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
            status_code=409, detail=f"{paper.lock_user_name} is currently editing"
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
        raise HTTPException(status_code=403, detail="Only the lock holder or an administrator can release it")
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
        raise HTTPException(status_code=403, detail="Only the owner or an administrator can delete it")
    # Delete files and invitations too — orphan rows would let a new paper inherit old data on id reuse
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
# Share / edit invitations — once the owner invites a member, only that member co-edits
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
                "name": (u.name or u.email) if u else "(deactivated user)",
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
        raise HTTPException(status_code=403, detail="Only the owner can invite")
    target = db.scalar(select(models.User).where(models.User.email == body.email.strip()))
    if target is None or target.status != "active":
        raise HTTPException(status_code=404, detail="No active member with that email")
    if target.id == paper.owner_id:
        raise HTTPException(status_code=409, detail="The owner does not need to be invited")
    if _is_collaborator(db, paper.id, target.id):
        raise HTTPException(status_code=409, detail="This member is already invited")
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
    """Owner/admin can revoke the invitation; a collaborator can remove themselves."""
    paper = _get_paper_or_404(db, paper_ref, user)
    if not (user.role == "admin" or paper.owner_id == user.id or user.id == user_id):
        raise HTTPException(status_code=403, detail="Only the owner or the member themselves can remove this")
    row = db.scalar(
        select(models.PaperCollaborator).where(
            models.PaperCollaborator.paper_id == paper.id,
            models.PaperCollaborator.user_id == user_id,
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="No such invitation")
    db.delete(row)
    db.commit()
    return {"removed": user_id}


# ─────────────────────────────────────────────────────────
# File tree — LaTeX project structure (text/.bib, images, folders)
# All write operations are restricted to the paper's lock holder.
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
_PATH_SEGMENT = re.compile(r"^[\w.\- ]+$")  # \w already matches Unicode letters (incl. CJK)

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
        raise HTTPException(status_code=422, detail="Invalid path")
    segments = [seg for seg in raw.strip("/").split("/")]
    if not segments or any(not seg or seg == ".." or not _PATH_SEGMENT.match(seg) for seg in segments):
        raise HTTPException(status_code=422, detail="Invalid path")
    return "/".join(segments)


def _require_lock(paper: models.Paper, user: models.User) -> None:
    if _lock_holder(paper) != user.id:
        raise HTTPException(status_code=423, detail="You must acquire the edit lock first")


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
        raise HTTPException(status_code=409, detail="A file already exists at this path")
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
            # 409 if target path is occupied — move/rename must not overwrite an existing file
            if db.scalar(
                select(models.PaperFile).where(
                    models.PaperFile.paper_id == paper.id, models.PaperFile.path == new_path
                )
            ):
                raise HTTPException(status_code=409, detail="A file already exists at this path")
            if f.kind == "folder":
                # Forbid moving into self/descendant + cascade child file paths
                if new_path == f.path or new_path.startswith(f.path + "/"):
                    raise HTTPException(status_code=422, detail="Cannot move a folder into its own descendant")
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
    paper.locked_at = _now()  # extend lock during work
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
    # Delete comments too — prevent orphan rows
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
            detail=f"Only image/figure files can be uploaded ({', '.join(sorted(_IMAGE_EXT))})",
        )
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=422, detail="Only files up to 20MB can be uploaded")
    logical = _normalize_path(f"{folder}/{name}" if folder else name)
    if db.scalar(
        select(models.PaperFile).where(
            models.PaperFile.paper_id == paper.id, models.PaperFile.path == logical
        )
    ):
        raise HTTPException(status_code=409, detail="A file already exists at this path")

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
    """ZIP the entire project preserving folder structure — compile directly in local/Overleaf."""
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
    # Content-Disposition allows latin-1 only — restrict to ASCII
    safe = re.sub(r"[^A-Za-z0-9\-]+", "_", paper.title).strip("_")[:40] or "paper"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe}.zip"'},
    )


# ─────────────────────────────────────────────────────────
# Review comments — attached to a selected span (quote). No lock needed (review even while editing)
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
        raise HTTPException(status_code=422, detail="Please enter comment content")
    f = db.get(models.PaperFile, body.file_id)
    if f is None or f.paper_id != paper.id:
        raise HTTPException(status_code=404, detail="File not found")
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
        raise HTTPException(status_code=422, detail="status must be open or resolved")
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
    """Only the author, the manuscript owner, or an admin can delete."""
    paper = _get_paper_or_404(db, paper_ref, user)
    c = db.get(models.PaperComment, comment_id)
    if c is None or c.paper_id != paper.id:
        raise HTTPException(status_code=404, detail="Not found")
    if user.id not in (c.author_id, paper.owner_id) and user.role != "admin":
        raise HTTPException(status_code=403, detail="Only the author or the owner can delete it")
    db.delete(c)
    db.commit()
    return {"status": "deleted"}


# ─────────────────────────────────────────────────────────
# Version history — snapshot changed text files at compile time
# ─────────────────────────────────────────────────────────

import difflib


def _record_revisions(db: Session, paper: models.Paper, user: models.User) -> int:
    """Record a revision only for text files whose content differs from the previous snapshot."""
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
    """Line-level diff — op: ' ' (kept) '+' (added) '-' (removed)."""
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
    """Revision list (newest first) — includes ± line counts vs. the previous snapshot."""
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
    """Revision detail — line-level diff vs. the previous snapshot."""
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
    """Revert the file content to the given revision — lock holder only."""
    paper = _get_paper_or_404(db, paper_ref, user)
    _require_lock(paper, user)
    rev = db.get(models.PaperRevision, rev_id)
    if rev is None or rev.paper_id != paper.id:
        raise HTTPException(status_code=404, detail="Not found")
    f = db.get(models.PaperFile, rev.file_id)
    if f is None:  # if the file was deleted, restore it at the same path
        f = models.PaperFile(paper_id=paper.id, path=rev.path, kind="text", content=rev.content)
        db.add(f)
    else:
        f.content = rev.content
    paper.updated_by = user.name or user.email
    paper.updated_at = _now()
    db.commit()
    return {"restored": rev.id, "file_id": f.id}


# ── Usage manual for agents (self-describing API) ──


@router.get("/{paper_ref}/guide")
def usage_guide(
    paper_ref: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """So external tools (Claude Code, etc.) can work with only a URL + token — usage specific to this project."""
    from fastapi.responses import Response

    paper = _get_paper_or_404(db, paper_ref, user)
    base = f"/api/papers/{paper.key}"
    md = f"""# Quillo — External Editing Guide

This project: **{paper.title}** (`{base}`)
Auth: include the `Authorization: Bearer <token>` header on every request.

## Reading

- `GET {base}` — paper metadata (title, status: draft|submitted|revision|published, journal, locked, lock_user_name)
- `GET {base}/files` — file list [{{id, path, kind: text|image|folder}}]
- `GET {base}/files/{{file_id}}` — file content (content)
- `GET {base}/export` — full project ZIP

## Writing (lock required)

Always acquire the lock before writing. Writing without a lock is rejected with **423**.
If someone else is editing, lock returns 409 — wait, or notify the user.
The lock auto-expires after 30 minutes and is extended on every save.

1. `POST {base}/lock`
2. Edit:
   - `PUT {base}/files/{{file_id}}` body `{{"content": "..."}}` — replace file content
   - `POST {base}/files` body `{{"path": "sections/intro.tex", "kind": "text", "content": "..."}}` — new file
   - `DELETE {base}/files/{{file_id}}` — delete file
   - `POST {base}/apply-template` body `{{"key": "<template key>"}}` — replace main.tex (`GET /api/templates` lists 26 templates)
   - `PUT {base}` body `{{"title"|"status"|"journal": ...}}` — edit metadata
3. `POST {base}/compile` — compile with xelatex. On success, PDF binary; on failure, 422 + error log (fix and retry)
   - `?entry=<path>` previews based on a specific file: if it has \\documentclass, that file is the entry point; otherwise (a section fragment) it borrows main.tex's preamble to typeset
4. `POST {base}/unlock` — always release when done

## Version History

- Every compile auto-snapshots the changed text files.
- `GET {base}/history` — revision list (author, time, ± line counts, newest first)
- `GET {base}/history/{{rev_id}}` — line-level diff vs. the previous revision
- `POST {base}/history/{{rev_id}}/restore` — restore to that version (lock required)

## Review Comments (no lock needed)

- `GET {base}/comments?file_id={{id}}` — comment list (status: open|resolved)
- `POST {base}/comments` body `{{"file_id": N, "quote": "<source fragment>", "anchor": <offset>, "body": "..."}}` — comment on a selected span
- `PUT {base}/comments/{{id}}` body `{{"status": "resolved"}}` — mark as resolved
- You can leave review feedback as comments instead of editing the content — no lock is needed.

## Rules

- The entry point is always `main.tex`. Do not delete the bundled .sty/.cls files.
- Image uploads use multipart `POST {base}/files/upload` (file, folder) — jpg/png/gif/webp/pdf/eps, up to 20MB.
- If compile returns 422, read the `!` lines in the log, fix the LaTeX errors, and compile again.
- When done, verify the PDF is generated via compile and then unlock.
"""
    return Response(content=md, media_type="text/markdown; charset=utf-8")


# ── LaTeX compile (PDF preview) ──

import shutil
import subprocess
import tempfile

from fastapi.responses import Response

def _find_tex_engine() -> str | None:
    # Korean titles/content are common, so prefer Unicode-native xelatex
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
    """Unpack the file tree into a temp directory and compile — PDF or 422+log.

    If entry is given, preview based on that file:
    - if it has \\documentclass, compile that file directly as the entry point
    - otherwise (a section fragment), borrow main.tex's preamble and compile with an \\input wrapper
    """
    if _TEX_ENGINE is None:
        raise HTTPException(status_code=503, detail="LaTeX (pdflatex) is not installed on the server")
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
            raise HTTPException(status_code=404, detail=f"File {entry} not found")
        if "\\documentclass" in ef.content:
            target = entry
        else:
            main = by_path.get("main.tex")
            if main is None:
                raise HTTPException(status_code=422, detail="main.tex is required")
            head, sep, _ = main.content.partition("\\begin{document}")
            if not sep:
                raise HTTPException(
                    status_code=422, detail="main.tex has no \\begin{document}"
                )
            stem = entry[:-4] if entry.endswith(".tex") else entry
            wrapper = head + "\\begin{document}\n\\input{" + stem + "}\n\\end{document}\n"
            target = "__preview__.tex"
    elif "main.tex" not in by_path:
        raise HTTPException(status_code=422, detail="main.tex is required")

    # compile = checkpoint: snapshot changed text files into version history
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

        if wrapper is not None:  # section fragment preview — main preamble + \input wrapper
            with open(os.path.join(tmp, target), "w", encoding="utf-8") as out:
                out.write(wrapper)

        # Run multiple times to resolve references (\ref, table of contents). Block shell-escape.
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
                raise HTTPException(status_code=422, detail="Compilation exceeded 60 seconds")
            out = proc.stdout[-4000:]
            if proc.returncode != 0:
                idx = out.find("\n!")  # '!' is the LaTeX error marker
                detail = out[idx:][:2000] if idx >= 0 else out[-2000:]
                raise HTTPException(status_code=422, detail=detail.strip())
            return out

        # 1) first pass generates .aux
        log = _run_tex()

        # 2) for .bib-based bibliography (\bibliography{}), run bibtex → generate .bbl
        #    when using thebibliography directly there is no \bibdata, so it is skipped (regression guard)
        aux_path = os.path.join(tmp, stem + ".aux")
        if _BIBTEX_ENGINE and os.path.exists(aux_path):
            with open(aux_path, encoding="utf-8", errors="ignore") as fh:
                aux = fh.read()
            if "\\bibdata" in aux:
                try:
                    # even on failure (e.g. .bib syntax error) compilation continues — only references stay empty
                    subprocess.run(
                        [_BIBTEX_ENGINE, stem], cwd=tmp, capture_output=True, text=True, timeout=30
                    )
                except subprocess.TimeoutExpired:
                    pass

        # 3) two more passes to stabilize reference/citation numbering
        for _ in range(2):
            log = _run_tex()

        pdf_name = os.path.splitext(os.path.basename(target))[0] + ".pdf"
        pdf_path = os.path.join(tmp, pdf_name)
        if not os.path.exists(pdf_path):
            raise HTTPException(status_code=422, detail=log[-2000:].strip() or "PDF generation failed")
        with open(pdf_path, "rb") as fh:
            return Response(content=fh.read(), media_type="application/pdf")
