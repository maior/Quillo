"""Quillo 추출 스모크 테스트 — standalone 으로 핵심 흐름이 도는지 검증.

(mspl 의 전체 paper 테스트 스위트 포팅은 업그레이드 단계에서 진행)
"""
from __future__ import annotations

from conftest import ADMIN


def login(client, creds=ADMIN):
    r = client.post("/api/auth/login", json=creds)
    assert r.status_code == 200, r.text
    return r.json()


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_papers_require_auth(client):
    assert client.get("/api/papers").status_code == 401


def test_login_and_me(client):
    me = login(client)
    assert me["role"] == "admin"
    assert client.get("/api/auth/me").json()["email"] == ADMIN["email"]


def test_paper_create_get_by_key(client):
    login(client)
    p = client.post("/api/papers", json={"title": "스모크 원고"}).json()
    assert p["title"] == "스모크 원고"
    key = p["key"]
    assert len(key) >= 8 and not key.isdigit()
    got = client.get(f"/api/papers/{key}")
    assert got.status_code == 200
    assert got.json()["key"] == key
    # 목록에 보인다
    assert key in [x["key"] for x in client.get("/api/papers").json()]


def test_paper_files_roundtrip(client):
    login(client)
    key = client.post("/api/papers", json={"title": "파일"}).json()["key"]
    files = client.get(f"/api/papers/{key}/files").json()
    assert isinstance(files, list)
    assert client.post(f"/api/papers/{key}/lock").status_code == 200  # 편집 잠금 선점
    created = client.post(
        f"/api/papers/{key}/files",
        json={"path": "sections/intro.tex", "kind": "text", "content": "Hello"},
    )
    assert created.status_code in (200, 201), created.text
    fid = created.json()["id"]
    updated = client.put(
        f"/api/papers/{key}/files/{fid}", json={"content": "Hello, Quillo"}
    )
    assert updated.status_code == 200


def test_templates_listed(client):
    login(client)
    tpls = client.get("/api/templates").json()
    assert len(tpls) >= 20
    assert all("key" in t and "name" in t for t in tpls)


def test_api_token_bearer_access(client):
    login(client)
    tok = client.post("/api/auth/token").json()["token"]
    assert tok.startswith("quillo_")
    # bearer 만으로 목록 접근 (쿠키 없이) — TestClient 는 같은 세션이므로 헤더로 검증
    r = client.get("/api/papers", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
