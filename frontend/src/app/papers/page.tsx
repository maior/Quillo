"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Lock, Plus } from "lucide-react";
import { authApi, authFetch } from "@/lib/api";

interface PaperMeta {
  id: number;
  key: string; // externally exposed hash key — the URL uses this key instead of the sequential id
  owner_name: string;
  mine: boolean;
  shared: boolean; // accessed via invitation
  title: string;
  status: string;
  journal: string;
  updated_by: string;
  updated_at: string;
  lock_user_name: string;
  locked: boolean;
  lock_mine: boolean;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-gray-100 text-ink/60" },
  submitted: { label: "Submitted", cls: "bg-accent/10 text-accent" },
  revision: { label: "Revision", cls: "bg-amber-50 text-amber-600" },
  published: { label: "Published", cls: "bg-emerald-50 text-emerald-600" },
};

export default function PapersPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [papers, setPapers] = useState<PaperMeta[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");

  useEffect(() => {
    authApi
      .me()
      .then(() => setReady(true))
      .catch(() => router.replace("/login"));
  }, [router]);

  const load = useCallback(async () => {
    setPapers(await authFetch<PaperMeta[]>("/api/papers"));
  }, []);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const paper = await authFetch<PaperMeta>("/api/papers", {
      method: "POST",
      json: { title },
    });
    router.push(`/papers/${paper.key}`);
  };

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center bg-gray-50">
        <Loader2 className="animate-spin text-accent" size={28} />
      </div>
    );
  }

  return (
    <>
      <section className="relative overflow-hidden bg-ink">
        <div className="grid-pattern pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute inset-0 bg-hero-glow" />
        <div className="container-x relative pb-14 pt-32">
          <p className="eyebrow text-accent-cyan">Members Only</p>
          <h1 className="mt-4 font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Paper Workspace
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-white/60">
            A space to manage your in-progress manuscripts together. Edit locks let one person
            write safely at a time.
          </p>
        </div>
      </section>

      <section className="bg-gray-50/70 py-14">
        <div className="container-x max-w-4xl">
          {/* new manuscript */}
          {creating ? (
            <form onSubmit={create} className="flex gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-card">
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Manuscript title"
                className="flex-1 rounded-xl border border-black/10 px-4 py-2.5 text-sm outline-none focus:border-accent"
              />
              <button type="submit" className="btn-primary !px-5 !py-2 text-sm">
                Create
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="btn rounded-full border border-black/10 px-5 text-sm text-ink/60"
              >
                Cancel
              </button>
            </form>
          ) : (
            <button onClick={() => setCreating(true)} className="btn-primary">
              <Plus size={15} /> New manuscript
            </button>
          )}

          {/* list */}
          <div className="mt-8 space-y-3">
            {papers === null ? (
              <div className="py-16 text-center">
                <Loader2 className="mx-auto animate-spin text-accent" size={24} />
              </div>
            ) : papers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/10 bg-white px-6 py-16 text-center">
                <FileText size={26} className="mx-auto text-accent" />
                <p className="mt-4 text-sm text-ink/50">
                  No manuscripts yet. Once you create your first one, it will appear here.
                </p>
              </div>
            ) : (
              (() => {
                const card = (p: PaperMeta) => {
                  const st = STATUS_META[p.status] ?? STATUS_META.draft;
                  return (
                    <Link
                      key={p.id}
                      href={`/papers/${p.key}`}
                      className="group flex items-center gap-4 rounded-2xl border border-black/5 bg-white p-5 shadow-card transition hover:-translate-y-0.5 hover:shadow-card-hover"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${st.cls}`}>
                            {st.label}
                          </span>
                          {p.journal && <span className="text-xs text-ink/40">{p.journal}</span>}
                          {p.shared && (
                            <span
                              data-testid="shared-badge"
                              className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent"
                            >
                              Shared with you
                            </span>
                          )}
                          {p.locked && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-600">
                              <Lock size={11} />
                              {p.lock_mine ? "You are editing" : `${p.lock_user_name} is editing`}
                            </span>
                          )}
                        </div>
                        <p className="mt-2 truncate font-display font-semibold text-ink">{p.title}</p>
                        <p className="mt-1 text-xs text-ink/40">
                          {`Last edited: ${p.updated_by} · ${p.updated_at.slice(0, 10)}`}
                        </p>
                      </div>
                    </Link>
                  );
                };
                const heading = (label: string, count: number) => (
                  <h2
                    data-testid="papers-section"
                    className="mt-10 flex items-baseline gap-2 text-sm font-bold text-ink first:mt-0"
                  >
                    {label}
                    <span className="text-xs font-semibold text-ink/35">{count}</span>
                  </h2>
                );
                const mine = papers.filter((p) => p.mine);
                const shared = papers.filter((p) => p.shared);
                // admin-visible items — grouped by owner (not shown to regular members)
                const others = papers.filter((p) => !p.mine && !p.shared);
                const byOwner = new Map<string, PaperMeta[]>();
                for (const p of others) byOwner.set(p.owner_name, [...(byOwner.get(p.owner_name) ?? []), p]);
                return (
                  <>
                    {mine.length > 0 && (
                      <div className="space-y-3">
                        {heading("My manuscripts", mine.length)}
                        {mine.map(card)}
                      </div>
                    )}
                    {shared.length > 0 && (
                      <div className="space-y-3">
                        {heading("Shared with me", shared.length)}
                        {shared.map(card)}
                      </div>
                    )}
                    {byOwner.size > 0 && (
                      <div className="space-y-3">
                        {heading("Member manuscripts (admin view)", others.length)}
                        {[...byOwner.entries()].map(([owner, list]) => (
                          <div key={owner} data-testid="owner-group" className="space-y-3">
                            <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-ink/40">
                              {owner}
                            </p>
                            {list.map(card)}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()
            )}
          </div>
        </div>
      </section>
    </>
  );
}
