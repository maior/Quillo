"""Journal and conference LaTeX template library.

The templates are sourced from the files in seed_data/templates/ (manifest.json +
skeleton .tex + bundled .cls). Every template is verified to actually compile in the
tests — only those guaranteed to work right after applying are exposed.
"""
from __future__ import annotations

import json
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models
from .database import get_db
from .security import get_current_user

router = APIRouter(prefix="/api", tags=["templates"])

TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "seed_data", "templates")


def _manifest() -> list[dict]:
    with open(os.path.join(TEMPLATES_DIR, "manifest.json"), encoding="utf-8") as f:
        return json.load(f)


def _read(name: str) -> str:
    with open(os.path.join(TEMPLATES_DIR, name), encoding="utf-8") as f:
        return f.read()


def _find(key: str) -> dict:
    tpl = next((t for t in _manifest() if t["key"] == key), None)
    if tpl is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return tpl


def _template_files(tpl: dict) -> list[tuple[str, str]]:
    """List of (logical path, content) — main.tex + bundled files."""
    files = [("main.tex", _read(tpl["main"]))]
    for extra in tpl.get("extra_files", []):
        files.append((extra["path"], _read(extra["src"])))
    return files


class TemplateOut(BaseModel):
    key: str
    name: str
    publisher: str
    kind: str
    columns: int  # 1=single column, 2=two column — to distinguish layout in the list
    description: str


@router.get("/templates", response_model=list[TemplateOut])
def list_templates(user: models.User = Depends(get_current_user)) -> list[dict]:
    return _manifest()


@router.post("/templates/{key}/preview")
def preview_template(key: str, user: models.User = Depends(get_current_user)):
    """Compile the template skeleton on the fly and show the typeset PDF."""
    import shutil
    import subprocess
    import tempfile

    from .papers_routes import _TEX_ENGINE

    if _TEX_ENGINE is None:
        raise HTTPException(status_code=503, detail="LaTeX is not installed on the server")
    tpl = _find(key)
    with tempfile.TemporaryDirectory() as tmp:
        for path, content in _template_files(tpl):
            disk = os.path.join(tmp, path)
            os.makedirs(os.path.dirname(disk) or tmp, exist_ok=True)
            with open(disk, "w", encoding="utf-8") as out:
                out.write(content)
        cmd = [_TEX_ENGINE, "-interaction=nonstopmode", "-halt-on-error", "-no-shell-escape", "main.tex"]
        for _ in range(2):
            try:
                proc = subprocess.run(cmd, cwd=tmp, capture_output=True, text=True, timeout=60)
            except subprocess.TimeoutExpired:
                raise HTTPException(status_code=422, detail="Compilation exceeded 60 seconds")
            if proc.returncode != 0:
                raise HTTPException(status_code=422, detail=proc.stdout[-2000:])
        pdf = os.path.join(tmp, "main.pdf")
        if not os.path.exists(pdf):
            raise HTTPException(status_code=422, detail="PDF generation failed")
        from fastapi.responses import Response

        with open(pdf, "rb") as fh:
            return Response(content=fh.read(), media_type="application/pdf")


class ApplyIn(BaseModel):
    key: str


@router.post("/papers/{paper_ref}/apply-template")
def apply_template(
    paper_ref: str,
    body: ApplyIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
) -> dict:
    """Replace main.tex with the template skeleton and copy bundled files (.cls, etc.) into the project."""
    from .papers_routes import _get_paper_or_404, _lock_holder

    paper = _get_paper_or_404(db, paper_ref, user)
    if _lock_holder(paper) != user.id:
        raise HTTPException(status_code=423, detail="You must acquire the edit lock first")

    tpl = _find(body.key)
    for path, content in _template_files(tpl):
        existing = db.scalar(
            select(models.PaperFile).where(
                models.PaperFile.paper_id == paper.id, models.PaperFile.path == path
            )
        )
        if existing:
            existing.content = content
            existing.kind = "text"
        else:
            db.add(models.PaperFile(paper_id=paper.id, path=path, kind="text", content=content))
    db.commit()
    return {"applied": tpl["key"]}
