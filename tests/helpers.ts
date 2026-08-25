/**
 * tests/helpers.ts
 * ─────────────────────────────────────────────────────────────────
 * Shared utilities for all Exampool test suites.
 * Uses an in-memory SQLite database so tests never touch exampool.db.
 */

import { Database } from "bun:sqlite";

import db from "../db";
import { hashPassword } from "../auth";

export const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:8001";
export const TEST_DB_PATH = ":memory:";   // overridden by EXAMPOOL_DB env

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

/** Bootstrap an operator user reliably across fresh and pre-configured databases */
export async function bootstrapOperator(email: string, password: string): Promise<string> {
  const setupRes = await apiPost("/api/setup", {
    name: "Test Operator",
    email,
    password,
    schoolName: "QA School",
    currentTerm: "2026-T1",
  });
  if (setupRes.status === 201) {
    const body = await json(setupRes);
    return extractToken(setupRes, body);
  }
  const existing = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
  if (!existing) {
    const pHash = await hashPassword(password);
    db.prepare("INSERT INTO users (name, email, role, password_hash, is_active) VALUES ('Test Operator', ?, 'operator', ?, 1)")
      .run(email, pHash);
  }
  const loginRes = await apiPost("/api/auth/login", { email, password });
  const loginBody = await json(loginRes);
  return extractToken(loginRes, loginBody);
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

  // Make sure a grade level exists if student
  let gradeLevelId = 1;
  if (role === "student") {
    const gl = db.prepare("SELECT id FROM grade_levels LIMIT 1").get() as any;
    if (gl) gradeLevelId = gl.id;
  }

  const regRes = await apiPost(
    "/api/auth/register",
    {
      name,
      email,
      password,
      role,
      phone: role === "teacher" ? "08012345678" : undefined,
      dob: role === "student" ? "2008-01-01" : undefined,
      grade_level_id: role === "student" ? gradeLevelId : undefined,
      grade: role === "student" ? "JSS1" : undefined,
    },
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
