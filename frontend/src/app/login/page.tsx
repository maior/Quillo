"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, Loader2 } from "lucide-react";
import { authApi } from "@/lib/api";

const DEV = process.env.NODE_ENV === "development";
const TEST_ADMIN = { email: "admin@quillo.local", password: "change-me-quillo" };

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await authApi.login(email, password);
      router.push("/papers");
    } catch (err) {
      setError((err as Error).message || "로그인에 실패했습니다");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
      >
        <div className="space-y-1 text-center">
          <h1 className="font-display text-2xl font-bold text-slate-900">Quillo</h1>
          <p className="text-sm text-slate-500">협업 LaTeX 논문 워크스페이스</p>
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">이메일</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">비밀번호</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
          로그인
        </button>

        {DEV && (
          <button
            type="button"
            data-testid="dev-credentials"
            onClick={() => {
              setEmail(TEST_ADMIN.email);
              setPassword(TEST_ADMIN.password);
            }}
            className="w-full rounded-lg border border-dashed border-slate-300 py-2 text-xs text-slate-500 hover:bg-slate-50"
          >
            (dev) 테스트 관리자 채우기 — {TEST_ADMIN.email}
          </button>
        )}
      </form>
    </div>
  );
}
