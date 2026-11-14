"""Editor tooling — compile errors with file/line, autocomplete symbols, DOI → BibTeX."""
from __future__ import annotations

import json
import shutil

import pytest

from conftest import ADMIN


def login(client, creds=ADMIN):
    r = client.post("/api/auth/login", json=creds)
    assert r.status_code == 200, r.text
    return r.json()


def make_paper(client) -> str:
    login(client)
    key = client.post("/api/papers", json={"title": "Tools"}).json()["key"]
    assert client.post(f"/api/papers/{key}/lock").status_code == 200  # acquire edit lock
    return key


def put_main(client, key: str, content: str) -> None:
    files = client.get(f"/api/papers/{key}/files").json()
    main = next(f for f in files if f["path"] == "main.tex")
    assert client.put(f"/api/papers/{key}/files/{main['id']}", json={"content": content}).status_code == 200


@pytest.mark.skipif(shutil.which("xelatex") is None, reason="xelatex not installed")
def test_compile_error_lists_file_and_line(client):
    """The failing file and line number arrive in X-Compile-Errors — the UI jumps to that line."""
    key = make_paper(client)
    put_main(client, key, "\\documentclass{article}\n\\begin{document}\nok\n\\undefinedmacro\n\\end{document}")
    r = client.post(f"/api/papers/{key}/compile")
    assert r.status_code == 422
    errors = json.loads(r.headers["X-Compile-Errors"])
    assert errors and errors[0]["file"] == "main.tex" and errors[0]["line"] == 4
    assert "Undefined control sequence" in errors[0]["message"]
    assert "Undefined control sequence" in r.json()["detail"]


def test_symbols_lists_cite_keys_and_labels(client):
    key = make_paper(client)
    put_main(client, key, "\\section{A}\\label{sec:intro}\n\\begin{equation}x\\label{eq:heat}\\end{equation}")
    r = client.post(
        f"/api/papers/{key}/files",
        json={
            "path": "refs.bib",
            "kind": "text",
            "content": "@article{kim2024ipl,\n  title={Photothermal effects},\n  year={2024}\n}\n@book{jung1995,\n  title = \"Soldering\",\n}",
        },
    )
    assert r.status_code in (200, 201), r.text
    s = client.get(f"/api/papers/{key}/symbols").json()
    assert [c["key"] for c in s["cites"]] == ["kim2024ipl", "jung1995"]
    assert s["cites"][0]["title"] == "Photothermal effects" and s["cites"][1]["title"] == "Soldering"
    assert {"key": "sec:intro", "file": "main.tex"} in s["labels"]
    assert {"key": "eq:heat", "file": "main.tex"} in s["labels"]


def test_bibtex_doi_rejects_bad_input_and_needs_login(client):
    login(client)
    assert client.get("/api/papers/bibtex/doi", params={"doi": "not a doi"}).status_code == 400
    client.cookies.clear()
    assert client.get("/api/papers/bibtex/doi", params={"doi": "10.1000/x"}).status_code in (401, 403)
