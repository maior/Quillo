"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2 } from "lucide-react";
import { authApi } from "@/lib/api";

const GITHUB_URL = "https://github.com/maior/Quillo";

const STEPS = [
  {
    n: "01",
    title: "Issue a token",
    body: "One paper, one bearer token — same permissions as your login, stored only as a SHA-256 hash. Revoke it any time.",
  },
  {
    n: "02",
    title: "Hand it the URL",
    body: "Give your agent nothing but the paper's URL and the token. It reads the in-app guide and discovers every endpoint it needs.",
  },
  {
    n: "03",
    title: "It works like a co-author",
    body: "Takes the 30-minute edit lock, patches your .tex, compiles with xelatex, leaves review comments, then unlocks. You watch the diffs.",
  },
];

export default function Landing() {
  // null = checking, true/false = known auth state
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    authApi
      .me()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
  }, []);

  const ctaHref = authed ? "/papers" : "/login";
  const ctaLabel = authed ? "Open your workspace" : "Sign in";

  return (
    <div className="min-h-screen bg-[#FBFAF7] text-ink">
      {/* top bar */}
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <Link href="/" className="font-display text-lg font-bold tracking-tight">
          Quillo<span className="text-accent">.</span>
        </Link>
        <nav className="flex items-center gap-5 text-sm">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden text-ink/55 transition hover:text-ink sm:inline"
          >
            GitHub
          </a>
          {authed === null ? (
            <span className="inline-flex h-9 w-20 items-center justify-center rounded-full bg-ink/5">
              <Loader2 size={15} className="animate-spin text-ink/40" />
            </span>
          ) : (
            <Link
              href={ctaHref}
              className="rounded-full bg-ink px-4 py-2 font-medium text-white transition hover:bg-ink-700"
            >
              {authed ? "Workspace" : "Sign in"}
            </Link>
          )}
        </nav>
      </header>

      {/* hero */}
      <main className="mx-auto w-full max-w-5xl px-6">
        <div className="grid items-center gap-12 py-14 lg:grid-cols-[1.05fr_1fr] lg:py-20">
          {/* left: words */}
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink/45">
              // collaborative LaTeX, self-hosted
            </p>
            <h1 className="mt-5 font-serif text-[2.6rem] font-medium leading-[1.08] tracking-tight text-ink sm:text-[3.4rem]">
              The paper editor your{" "}
              <em className="italic text-accent">own AI agent</em> can actually reach.
            </h1>
            <p className="mt-6 max-w-xl text-[1.05rem] leading-relaxed text-ink/65">
              Overleaf keeps your manuscript locked inside a SaaS the agent on your machine
              can&apos;t touch. Quillo is a real-time LaTeX workspace with a plain HTTP API behind
              it — so Claude Code, Codex CLI, or whatever you run can open the paper, fix the
              bibliography, and compile to PDF without anyone copy-pasting <code className="font-mono text-[0.85em] text-ink/80">.tex</code> files.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
              {authed === null ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-semibold text-white">
                  <Loader2 size={16} className="animate-spin" /> Loading
                </span>
              ) : (
                <Link
                  href={ctaHref}
                  className="group inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-semibold text-white transition hover:bg-ink-700"
                >
                  {ctaLabel}
                  <ArrowRight size={16} className="transition group-hover:translate-x-0.5" />
                </Link>
              )}
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-ink/60 underline-offset-4 transition hover:text-ink hover:underline"
              >
                Read the source on GitHub →
              </a>
            </div>

            <p className="mt-8 font-mono text-xs text-ink/40">
              FastAPI + SQLite on :8675 · Next.js on :8678 · 26 LaTeX templates · your data stays
              on your box
            </p>
          </div>

          {/* right: a real terminal */}
          <div className="rounded-xl border border-ink/10 bg-ink shadow-[0_24px_60px_-24px_rgba(10,16,34,.5)]">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
              <span className="ml-2 font-mono text-[11px] text-white/35">agent → quillo</span>
            </div>
            <pre className="overflow-x-auto px-5 py-4 font-mono text-[12.5px] leading-relaxed text-white/85">
              <code>{`$ export TOKEN=quillo_9f3c…   `}<span className="text-white/35"># issued once, in the UI</span>{`
$ B=http://localhost:8675/api/papers/$KEY

`}<span className="text-white/35"># read the playbook, then take the lock</span>{`
$ curl -H "Authorization: Bearer $TOKEN" $B/guide
$ curl -X POST -H "…" $B/lock
`}<span className="text-[#7ee787]">{`{"locked_by":"claude-code","expires_in":1800}`}</span>{`

`}<span className="text-white/35"># rewrite a section, then compile</span>{`
$ curl -X PUT  -H "…" $B/files/12  -d @method.tex
$ curl -X POST -H "…" $B/compile
`}<span className="text-[#7ee787]">{`{"ok":true,"pdf":"main.pdf","pages":8}`}</span>{`
$ curl -X POST -H "…" $B/unlock   `}<span className="text-white/35"># done</span></code>
            </pre>
          </div>
        </div>

        {/* hairline */}
        <hr className="border-ink/10" />

        {/* how it works */}
        <section className="py-16">
          <h2 className="font-serif text-2xl font-medium text-ink">
            How a model becomes a co-author
          </h2>
          <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="border-t border-ink pt-4">
                <span className="font-mono text-sm font-semibold text-accent">{s.n}</span>
                <h3 className="mt-3 font-display text-base font-semibold text-ink">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink/60">{s.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-10 max-w-2xl text-sm leading-relaxed text-ink/55">
            Writes obey the same lock as the web editor, so an external agent can never clobber a
            co-author mid-sentence — a write without the lock comes back{" "}
            <code className="font-mono text-ink/80">423</code>. Comments don&apos;t need the lock,
            so a model can review while a person types.
          </p>
        </section>
      </main>

      {/* footer */}
      <footer className="mx-auto flex w-full max-w-5xl flex-col items-start justify-between gap-3 border-t border-ink/10 px-6 py-8 text-sm text-ink/45 sm:flex-row sm:items-center">
        <span>
          Quillo — a collaborative LaTeX workspace, built at SKKU MSPL. Self-hosted; bring your own
          model.
        </span>
        <Link href={ctaHref} className="inline-flex items-center gap-1.5 text-ink/70 hover:text-ink">
          {ctaLabel} <ArrowRight size={14} />
        </Link>
      </footer>
    </div>
  );
}
