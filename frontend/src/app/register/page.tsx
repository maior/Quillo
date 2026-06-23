"use client";

import { useState } from "react";
import Link from "next/link";
import { UserPlus, Loader2, CheckCircle2 } from "lucide-react";
import { authApi } from "@/lib/api";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await authApi.register(name, email, password);
      setDone(true);
    } catch (err) {
      setError((err as Error).message || "Registration failed");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="space-y-1 text-center">
          <Link href="/" className="font-display text-2xl font-bold text-slate-900 hover:text-slate-700">
            Quillo
          </Link>
          <p className="text-sm text-slate-500">Create your account</p>
        </div>

        {done ? (
          <div className="mt-6 space-y-4 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <p className="text-sm text-slate-700">
              Thanks! Your account is <strong>awaiting administrator approval</strong>. You can sign
              in once an admin approves it.
            </p>
            <Link
              href="/login"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-700"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-5">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-slate-700">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium text-slate-700">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium text-slate-700">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
              />
              <span className="text-xs text-slate-400">At least 8 characters.</span>
            </label>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Create account
            </button>

            <p className="text-center text-sm text-slate-500">
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-slate-900 hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
