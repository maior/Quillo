// Quillo 백엔드(FastAPI :8675) API 클라이언트.

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8675";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: "admin" | "member";
}

/** 인증 호출 — 세션 쿠키 포함, 클라이언트 컴포넌트 전용. */
export async function authFetch<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    cache: "no-store",
    ...(json !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) }
      : {}),
    ...rest,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw Object.assign(new Error(detail.detail ?? `API ${path} failed`), {
      status: res.status,
    });
  }
  return res.json() as Promise<T>;
}

export const authApi = {
  login: (email: string, password: string) =>
    authFetch<AuthUser>("/api/auth/login", { method: "POST", json: { email, password } }),
  logout: () => authFetch<{ status: string }>("/api/auth/logout", { method: "POST" }),
  me: () => authFetch<AuthUser>("/api/auth/me"),
};
