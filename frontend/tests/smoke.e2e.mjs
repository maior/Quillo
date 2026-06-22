// Quillo frontend smoke e2e — verifies login → paper list → create → entering the editor.
// Prerequisites: backend :8675, frontend :8678 running. Run: node tests/smoke.e2e.mjs
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
  // 1) Login
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', ADMIN.email);
  await page.fill('input[type="password"]', ADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/papers", { timeout: 10000 });
  ok("redirects to /papers after login", page.url().includes("/papers"));

  // 2) List screen
  await page.waitForSelector("text=New paper", { timeout: 10000 });
  ok("paper list screen renders", await page.isVisible("text=New paper"));

  // 3) Create a paper (New paper button → form appears → enter title → Create)
  const title = `e2e paper ${Date.now()}`;
  await page.click('button:has-text("New paper")');
  await page.fill('input[placeholder="Paper title"]', title);
  await page.click('button:has-text("Create")');
  // After creation, navigate to the editor (router.push(`/papers/${key}`))
  await page.waitForURL(/\/papers\/[^/]+$/, { timeout: 10000 });
  ok("enters the editor after creation", /\/papers\/[^/]+$/.test(new URL(page.url()).pathname));

  // 4) Core editor UI mounts
  await page.waitForSelector('[data-testid="editor-topbar"]', { timeout: 10000 });
  ok("editor top bar (editor-topbar) visible", await page.isVisible('[data-testid="editor-topbar"]'));
  await page.waitForSelector('[data-testid="paper-tree"]', { timeout: 10000 });
  ok("file tree (paper-tree) visible", await page.isVisible('[data-testid="paper-tree"]'));
  ok("preview/compile controls present", await page.isVisible("text=Compile"));

  // 5) Acquire edit lock → editable textarea appears (Overleaf-style lock editing)
  ok("read-only before lock (no textarea)", (await page.locator("textarea").count()) === 0);
  await page.click('button:has-text("Start editing")');
  await page.waitForSelector("textarea", { timeout: 10000 });
  ok("LaTeX editor (textarea) appears after starting edit", (await page.locator("textarea").count()) > 0);

  // 6) Whether body edits are reflected
  await page.fill("textarea", "\\documentclass{article}\\begin{document}Quillo e2e\\end{document}");
  ok("body input reflected", (await page.locator("textarea").inputValue()).includes("Quillo e2e"));

  ok("title reflected on screen", (await page.content()).includes(title));
} catch (e) {
  fail++;
  console.log(`  ✗ exception: ${e.message}`);
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
