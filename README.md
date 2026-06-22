# Quillo

협업 LaTeX 논문 워크스페이스 — Overleaf 스타일 에디터에 **AI 에이전트 협업**을 더한 도구.
URL + 토큰만으로 Claude Code·Codex CLI 같은 에이전트가 직접 원고를 읽고·수정하고·컴파일한다.

| 영역 | 스택 | 포트 |
|---|---|---|
| 백엔드 | FastAPI + SQLAlchemy 2.0 + SQLite | 8675 |
| 프론트엔드 | Next.js (App Router) + TypeScript + Tailwind | 8678 |

SKKU MSPL 프로젝트에서 추출한 독립 저장소로, **논문 편집툴의 정본**이다.

## 빠른 시작

```bash
scripts/setup.sh      # 최초 1회 — venv·의존성·editable 설치 + 프론트 빌드
scripts/dev.sh        # 로컬 개발 (Ctrl-C 동시 종료)
scripts/start.sh      # 운영 백그라운드 기동 (로그 logs/)
scripts/stop.sh
scripts/restart.sh    # git pull 후 재시작
```

- 사이트: http://localhost:8678 · API 문서: http://localhost:8675/docs
- 첫 기동 시 `backend/quillo.db` 자동 생성, 관리자 1명 시드
  (env `QUILLO_ADMIN_EMAIL`/`QUILLO_ADMIN_PASSWORD`, 기본 `admin@quillo.local`/`change-me-quillo` — **운영 전 변경**)
- LaTeX 컴파일에는 `xelatex` 필요(+ 선택 `bibtex`)

## 테스트

```bash
cd backend && .venv/bin/python -m pytest      # 추출 스모크 테스트 (인메모리 SQLite)
cd frontend && npm run build                  # 타입·빌드 검증
```

## 외부 API (AI 에이전트용)

1. 웹에서 로그인 → API 토큰 발급(`POST /api/auth/token`, 원문은 1회만 노출)
2. 에이전트가 `Authorization: Bearer <token>` 으로 호출:
   - `GET /api/papers/{key}` 원고 조회 · `GET /api/papers/{key}/guide` 사용법
   - 파일 읽기/쓰기, `POST /api/papers/{key}/compile` 컴파일
3. 모든 외부 주소는 순번 id 가 아닌 불투명 해시 `key` 를 쓴다.

## mspl 과의 관계

이 저장소가 정본이며 mspl 은 이것을 **참조**한다(형제 폴더 `skku/quillo`, `skku/mspl`).
Quillo 업그레이드가 mspl 에 자동 반영되도록 연결하는 절차는 `.claude/CLAUDE.md` 와
mspl 의 `docs/QUILLO_LINK.md` 참고.
