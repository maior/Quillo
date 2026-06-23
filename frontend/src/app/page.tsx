"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  FileText,
  Github,
  Loader2,
  LockKeyhole,
  LogIn,
  Users,
} from "lucide-react";
import { authApi } from "@/lib/api";

const GITHUB_URL = "https://github.com/maior/Quillo";

const FEATURES = [
  {
    icon: Bot,
    title: "Bring your own LLM",
    body: "Connect Claude Code, Codex CLI, or any agent through a scoped API token. Your AI reads, edits, and compiles the manuscript alongside you — no vendor lock-in.",
  },
  {
    icon: Users,
    title: "Collaborate safely",
    body: "Invite co-authors to a manuscript. A 30-minute edit lock guarantees only one writer touches a file at a time, so changes never clash.",
  },
  {
    icon: FileText,
    title: "Compile to PDF",
    body: "Multi-file LaTeX projects compile with xelatex (and bibtex) on the server. Preview the rendered PDF right next to the editor.",
  },
];

export default function Landing() {
  // null = still checking, true/false = known auth state
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    authApi
      .me()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
  }, []);

  const primaryHref = authed ? "/papers" : "/login";
  const primaryLabel = authed ? "Open workspace" : "Sign in";
  const PrimaryIcon = authed ? ArrowRight : LogIn;

  return (
    <div className="flex min-h-screen flex-col bg-ink">
      {/* top bar */}
      <header className="container-x flex items-center justify-between py-5">
        <Link href="/" className="font-display text-xl font-bold text-white">
          Quillo
        </Link>
        <nav className="flex items-center gap-2">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost !px-4 !py-2 text-sm"
          >
            <Github size={15} /> GitHub
          </a>
          {authed === null ? (
            <span className="btn !px-4 !py-2 text-sm text-white/40">
              <Loader2 size={15} className="animate-spin" />
            </span>
          ) : (
            <Link href={primaryHref} className="btn-primary !px-5 !py-2 text-sm">
              <PrimaryIcon size={15} /> {primaryLabel}
            </Link>
          )}
        </nav>
      </header>

      {/* hero */}
      <section className="relative flex-1 overflow-hidden">
        <div className="grid-pattern pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute inset-0 bg-hero-glow" />
        <div className="container-x relative flex flex-col items-center pb-20 pt-20 text-center sm:pt-28">
          <p className="eyebrow text-accent-cyan">Collaborative LaTeX · Bring your own LLM</p>
          <h1 className="mt-6 max-w-3xl font-display text-4xl font-bold tracking-tight text-white sm:text-6xl">
            Write papers together with your{" "}
            <span className="text-gradient">own AI agent</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-white/60">
            Quillo is an Overleaf-style LaTeX workspace where people and AI agents read, edit, and
            compile manuscripts side by side. Connect the LLM you already use — no proprietary
            assistant, no lock-in.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            {authed === null ? (
              <span className="btn-primary">
                <Loader2 size={16} className="animate-spin" /> Loading
              </span>
            ) : (
              <Link href={primaryHref} className="btn-primary">
                <PrimaryIcon size={16} /> {primaryLabel}
              </Link>
            )}
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="btn-ghost">
              <Github size={16} /> View on GitHub
            </a>
          </div>

          {!authed && (
            <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-white/40">
              <LockKeyhole size={13} /> Members only — sign in with the account your admin created.
            </p>
          )}

          {/* feature cards */}
          <div className="mt-16 grid w-full gap-4 text-left sm:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm"
              >
                <div className="inline-flex rounded-xl bg-accent/15 p-2.5 text-accent-cyan">
                  <Icon size={20} />
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/55">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* footer */}
      <footer className="container-x flex flex-col items-center justify-between gap-2 border-t border-white/10 py-6 text-sm text-white/40 sm:flex-row">
        <span>Quillo — Collaborative LaTeX Paper Workspace</span>
        <Link href={primaryHref} className="inline-flex items-center gap-1.5 hover:text-white">
          {primaryLabel} <ArrowRight size={14} />
        </Link>
      </footer>
    </div>
  );
}
