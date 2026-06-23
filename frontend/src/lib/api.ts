// Quillo backend (FastAPI :8675) API client.

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8675";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: "admin" | "member";
  status: "active" | "pending";
}

/** Authenticated request — includes the session cookie, client components only. */
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
  register: (name: string, email: string, password: string) =>
    authFetch<{ status: string; message: string }>("/api/auth/register", {
      method: "POST",
      json: { name, email, password },
    }),
  logout: () => authFetch<{ status: string }>("/api/auth/logout", { method: "POST" }),
  me: () => authFetch<AuthUser>("/api/auth/me"),
};

/** Admin-only user management (approve registrations, remove accounts). */
export const adminApi = {
  listUsers: () => authFetch<AuthUser[]>("/api/auth/admin/users"),
  approve: (id: number) =>
    authFetch<AuthUser>(`/api/auth/admin/users/${id}/approve`, { method: "POST" }),
  remove: (id: number) =>
    authFetch<{ removed: boolean }>(`/api/auth/admin/users/${id}`, { method: "DELETE" }),
};
