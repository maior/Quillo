"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Lock, Plus } from "lucide-react";
import { authApi, authFetch } from "@/lib/api";

interface PaperMeta {
  id: number;
  key: string; // 외부 노출용 해시 키 — URL 은 순번 id 대신 이 키
  owner_name: string;
  mine: boolean;
  shared: boolean; // 초대받아 접근
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
  draft: { label: "초안", cls: "bg-gray-100 text-ink/60" },
  submitted: { label: "투고", cls: "bg-accent/10 text-accent" },
  revision: { label: "리비전", cls: "bg-amber-50 text-amber-600" },
  published: { label: "게재", cls: "bg-emerald-50 text-emerald-600" },
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
            진행 중인 원고를 함께 관리하는 공간입니다. 편집 잠금으로 한 번에 한
            명씩 안전하게 작성합니다.
          </p>
        </div>
      </section>

      <section className="bg-gray-50/70 py-14">
        <div className="container-x max-w-4xl">
          {/* 새 원고 */}
          {creating ? (
            <form onSubmit={create} className="flex gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-card">
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="원고 제목"
                className="flex-1 rounded-xl border border-black/10 px-4 py-2.5 text-sm outline-none focus:border-accent"
              />
              <button type="submit" className="btn-primary !px-5 !py-2 text-sm">
                만들기
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="btn rounded-full border border-black/10 px-5 text-sm text-ink/60"
              >
                취소
              </button>
            </form>
          ) : (
            <button onClick={() => setCreating(true)} className="btn-primary">
              <Plus size={15} /> 새 원고
            </button>
          )}

          {/* 목록 */}
          <div className="mt-8 space-y-3">
            {papers === null ? (
              <div className="py-16 text-center">
                <Loader2 className="mx-auto animate-spin text-accent" size={24} />
              </div>
            ) : papers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/10 bg-white px-6 py-16 text-center">
                <FileText size={26} className="mx-auto text-accent" />
                <p className="mt-4 text-sm text-ink/50">
                  아직 원고가 없습니다. 첫 원고를 만들면 이곳에 표시됩니다.
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
                              공유받음
                            </span>
                          )}
                          {p.locked && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-600">
                              <Lock size={11} />
                              {p.lock_mine ? "내가 편집 중" : `${p.lock_user_name} 편집 중`}
                            </span>
                          )}
                        </div>
                        <p className="mt-2 truncate font-display font-semibold text-ink">{p.title}</p>
                        <p className="mt-1 text-xs text-ink/40">
                          {`최근 수정: ${p.updated_by} · ${p.updated_at.slice(0, 10)}`}
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
                // admin 열람분 — 소유자별 그룹 (일반 멤버에게는 없음)
                const others = papers.filter((p) => !p.mine && !p.shared);
                const byOwner = new Map<string, PaperMeta[]>();
                for (const p of others) byOwner.set(p.owner_name, [...(byOwner.get(p.owner_name) ?? []), p]);
                return (
                  <>
                    {mine.length > 0 && (
                      <div className="space-y-3">
                        {heading("내 원고", mine.length)}
                        {mine.map(card)}
                      </div>
                    )}
                    {shared.length > 0 && (
                      <div className="space-y-3">
                        {heading("공유받은 원고", shared.length)}
                        {shared.map(card)}
                      </div>
                    )}
                    {byOwner.size > 0 && (
                      <div className="space-y-3">
                        {heading("멤버 원고 (관리자 열람)", others.length)}
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
