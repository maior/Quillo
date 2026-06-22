// Quillo 프론트 스모크 e2e — 로그인 → 원고 목록 → 생성 → 편집화면 진입 검증.
// 사전: 백엔드 :8675, 프론트 :8678 구동. 실행: node tests/smoke.e2e.mjs
import { chromium } from "playwright";

const BASE = process.env.QUILLO_WEB ?? "http://localhost:8678";
const ADMIN = { email: "admin@quillo.local", password: "change-me-quillo" };

let pass = 0,
  fail = 0;
function ok(name, cond) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage();
try {
  // 1) 로그인
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', ADMIN.email);
  await page.fill('input[type="password"]', ADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/papers", { timeout: 10000 });
  ok("로그인 후 /papers 로 이동", page.url().includes("/papers"));

  // 2) 목록 화면
  await page.waitForSelector("text=새 원고", { timeout: 10000 });
  ok("원고 목록 화면 렌더", await page.isVisible("text=새 원고"));

  // 3) 원고 생성 (새 원고 버튼 → 폼 노출 → 제목 입력 → 만들기)
  const title = `e2e 원고 ${Date.now()}`;
  await page.click('button:has-text("새 원고")');
  await page.fill('input[placeholder="원고 제목"]', title);
  await page.click('button:has-text("만들기")');
  // 생성 후 편집화면으로 이동 (router.push(`/papers/${key}`))
  await page.waitForURL(/\/papers\/[^/]+$/, { timeout: 10000 });
  ok("생성 후 편집화면으로 진입", /\/papers\/[^/]+$/.test(new URL(page.url()).pathname));

  // 4) 편집화면 핵심 UI 마운트
  await page.waitForSelector('[data-testid="editor-topbar"]', { timeout: 10000 });
  ok("편집 상단바(editor-topbar) 표시", await page.isVisible('[data-testid="editor-topbar"]'));
  await page.waitForSelector('[data-testid="paper-tree"]', { timeout: 10000 });
  ok("파일 트리(paper-tree) 표시", await page.isVisible('[data-testid="paper-tree"]'));
  ok("미리보기/컴파일 컨트롤 존재", await page.isVisible("text=컴파일"));

  // 5) 편집 잠금 획득 → 편집 가능한 textarea 노출 (Overleaf 식 lock 편집)
  ok("잠금 전엔 읽기 전용(textarea 없음)", (await page.locator("textarea").count()) === 0);
  await page.click('button:has-text("편집 시작")');
  await page.waitForSelector("textarea", { timeout: 10000 });
  ok("편집 시작 후 LaTeX 에디터(textarea) 노출", (await page.locator("textarea").count()) > 0);

  // 6) 본문 편집이 반영되는지
  await page.fill("textarea", "\\documentclass{article}\\begin{document}Quillo e2e\\end{document}");
  ok("본문 입력 반영", (await page.locator("textarea").inputValue()).includes("Quillo e2e"));

  ok("제목이 화면에 반영", (await page.content()).includes(title));
} catch (e) {
  fail++;
  console.log(`  ✗ 예외: ${e.message}`);
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
