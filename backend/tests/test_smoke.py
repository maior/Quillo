"""Quillo extraction smoke tests — verify the core flow works standalone.

(Porting the full paper test suite from mspl happens during the upgrade phase.)
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
    p = client.post("/api/papers", json={"title": "Smoke Manuscript"}).json()
    assert p["title"] == "Smoke Manuscript"
    key = p["key"]
    assert len(key) >= 8 and not key.isdigit()
    got = client.get(f"/api/papers/{key}")
    assert got.status_code == 200
    assert got.json()["key"] == key
    # appears in the list
    assert key in [x["key"] for x in client.get("/api/papers").json()]


def test_paper_files_roundtrip(client):
    login(client)
    key = client.post("/api/papers", json={"title": "File"}).json()["key"]
    files = client.get(f"/api/papers/{key}/files").json()
    assert isinstance(files, list)
    assert client.post(f"/api/papers/{key}/lock").status_code == 200  # acquire edit lock
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


BOB = {"name": "Bob Researcher", "email": "bob@example.com", "password": "supersecret"}


def test_register_creates_pending_and_blocks_login(client):
    r = client.post("/api/auth/register", json=BOB)
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "pending"
    # pending users cannot log in until approved
    r = client.post("/api/auth/login", json={"email": BOB["email"], "password": BOB["password"]})
    assert r.status_code == 403


def test_register_rejects_duplicate_email(client):
    assert client.post("/api/auth/register", json=BOB).status_code == 201
    dup = {**BOB, "name": "Someone Else"}
    assert client.post("/api/auth/register", json=dup).status_code == 409


def test_register_rejects_short_password(client):
    weak = {**BOB, "password": "short"}
    assert client.post("/api/auth/register", json=weak).status_code == 422


def test_admin_approve_enables_login(client):
    client.post("/api/auth/register", json=BOB)
    login(client)  # admin
    users = client.get("/api/auth/admin/users").json()
    bob = next(u for u in users if u["email"] == BOB["email"])
    assert bob["status"] == "pending" and bob["role"] == "member"
    assert client.post(f"/api/auth/admin/users/{bob['id']}/approve").status_code == 200
    client.post("/api/auth/logout")
    r = client.post("/api/auth/login", json={"email": BOB["email"], "password": BOB["password"]})
    assert r.status_code == 200


def test_admin_reject_removes_pending_user(client):
    client.post("/api/auth/register", json=BOB)
    login(client)
    bob = next(u for u in client.get("/api/auth/admin/users").json() if u["email"] == BOB["email"])
    assert client.delete(f"/api/auth/admin/users/{bob['id']}").status_code == 200
    assert all(u["email"] != BOB["email"] for u in client.get("/api/auth/admin/users").json())


def test_admin_user_management_requires_admin(client):
    # approve Bob, then confirm a non-admin member is forbidden from the admin routes
    client.post("/api/auth/register", json=BOB)
    login(client)
    bob = next(u for u in client.get("/api/auth/admin/users").json() if u["email"] == BOB["email"])
    client.post(f"/api/auth/admin/users/{bob['id']}/approve")
    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={"email": BOB["email"], "password": BOB["password"]})
    assert client.get("/api/auth/admin/users").status_code == 403
    assert client.post(f"/api/auth/admin/users/{bob['id']}/approve").status_code == 403


def test_api_token_bearer_access(client):
    login(client)
    tok = client.post("/api/auth/token").json()["token"]
    assert tok.startswith("quillo_")
    # access the list with bearer only (no cookie) — TestClient shares a session, so verify via header
    r = client.get("/api/papers", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
