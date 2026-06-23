"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Loader2, Trash2, ShieldCheck } from "lucide-react";
import { adminApi, authApi, type AuthUser } from "@/lib/api";

export default function AdminUsersPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [users, setUsers] = useState<AuthUser[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    authApi
      .me()
      .then((u) => {
        if (u.role !== "admin") {
          router.replace("/papers");
          return;
        }
        setReady(true);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  const load = useCallback(async () => {
    try {
      setUsers(await adminApi.listUsers());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  async function act(id: number, fn: () => Promise<unknown>) {
    setBusyId(id);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50">
        <Loader2 className="animate-spin text-slate-400" size={28} />
      </div>
    );
  }

  const pending = users?.filter((u) => u.status === "pending") ?? [];
  const active = users?.filter((u) => u.status === "active") ?? [];

  const row = (u: AuthUser) => (
    <div
      key={u.id}
      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900">
          {u.name || "(no name)"}
          {u.role === "admin" && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-white">
              <ShieldCheck size={11} /> admin
            </span>
          )}
        </p>
        <p className="truncate text-xs text-slate-500">{u.email}</p>
      </div>
      {u.status === "pending" ? (
        <>
          <button
            onClick={() => act(u.id, () => adminApi.approve(u.id))}
            disabled={busyId === u.id}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            <Check size={13} /> Approve
          </button>
          <button
            onClick={() => act(u.id, () => adminApi.remove(u.id))}
            disabled={busyId === u.id}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
          >
            Reject
          </button>
        </>
      ) : u.role !== "admin" ? (
        <button
          onClick={() => act(u.id, () => adminApi.remove(u.id))}
          disabled={busyId === u.id}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
        >
          <Trash2 size={13} /> Remove
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        <Link
          href="/papers"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft size={15} /> Back to workspace
        </Link>

        <h1 className="mt-5 font-display text-2xl font-bold text-slate-900">User management</h1>
        <p className="mt-1 text-sm text-slate-500">
          Approve new registrations and manage member accounts.
        </p>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        {users === null ? (
          <div className="py-16 text-center">
            <Loader2 className="mx-auto animate-spin text-slate-400" size={24} />
          </div>
        ) : (
          <div className="mt-8 space-y-8">
            <section>
              <h2 className="flex items-baseline gap-2 text-sm font-bold text-slate-900">
                Pending approval
                <span className="text-xs font-semibold text-slate-400">{pending.length}</span>
              </h2>
              <div className="mt-3 space-y-2">
                {pending.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
                    No accounts waiting for approval.
                  </p>
                ) : (
                  pending.map(row)
                )}
              </div>
            </section>

            <section>
              <h2 className="flex items-baseline gap-2 text-sm font-bold text-slate-900">
                Active members
                <span className="text-xs font-semibold text-slate-400">{active.length}</span>
              </h2>
              <div className="mt-3 space-y-2">{active.map(row)}</div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
