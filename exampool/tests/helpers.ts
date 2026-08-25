/**
 * tests/helpers.ts
 * ─────────────────────────────────────────────────────────────────
 * Shared utilities for all Exampool test suites.
 * Uses an in-memory SQLite database so tests never touch exampool.db.
 */

import { Database } from "bun:sqlite";

export const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:8000";
export const TEST_DB_PATH = ":memory:";   // overridden by EXAMPOOL_DB env

// Shared test operator credentials (must match across test files for shared DB)
export const TEST_OPERATOR_EMAIL = "test_operator@exampool.test";
export const TEST_OPERATOR_PASSWORD = "Secure@123";
export const TEST_OPERATOR_NAME = "Test Operator";

// ── Typed response helpers ──────────────────────────────────────────────────

export async function apiGet(path: string, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(`${BASE_URL}${path}`, { headers });
}

export async function apiPost(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

export async function apiPut(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(`${BASE_URL}${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
}

export async function apiDelete(path: string, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(`${BASE_URL}${path}`, { method: "DELETE", headers });
}

export async function json<T = any>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

// ── Account factory ─────────────────────────────────────────────────────────

let _seq = Date.now();
function uid() { return ++_seq; }

/** Register a fresh account and return its Bearer token. */
export async function registerAndLogin(
  role: "student" | "teacher",
  operatorToken: string,
): Promise<{ token: string; userId: number; email: string }> {
  const email = `test_${role}_${uid()}@exampool.test`;
  const password = "Password123";
  const name = `Test ${role} ${uid()}`;

  const regRes = await apiPost(
    "/api/auth/register",
    { name, email, password, role, grade: role === "student" ? "JSS1" : undefined },
    operatorToken,
  );
  if (!regRes.ok) {
    const err = await regRes.json();
    throw new Error(`register failed (${regRes.status}): ${JSON.stringify(err)}`);
  }

  const loginRes = await apiPost("/api/auth/login", { email, password });
  const loginBody = await json(loginRes);
  // Token is delivered via Set-Cookie; extract it for tests
  const cookie = loginRes.headers.get("set-cookie") ?? "";
  const token = cookie.match(/__exampool_session=([^;]+)/)?.[1] ?? loginBody?.data?.token ?? "";
  const userId = loginBody?.data?.user?.id ?? 0;
  return { token, userId, email };
}

/** Login as an existing user, returns cookie token. */
export async function login(email: string, password: string): Promise<string> {
  const res = await apiPost("/api/auth/login", { email, password });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const cookie = res.headers.get("set-cookie") ?? "";
  return cookie.match(/__exampool_session=([^;]+)/)?.[1] ?? "";
}

/** Pull Bearer token from Set-Cookie header or response body. */
export function extractToken(res: Response, body: any): string {
  const cookie = res.headers.get("set-cookie") ?? "";
  return cookie.match(/__exampool_session=([^;]+)/)?.[1] ?? body?.data?.token ?? "";
}
