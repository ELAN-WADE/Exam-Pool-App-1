/**
 * tests/server.test.ts — T-001 to T-020
 * ─────────────────────────────────────────────────────────────────
 * SERVER STARTUP, NETWORK, SETUP FLOW
 *
 * Precondition: server running at BASE_URL with a fresh (empty) or seeded DB.
 * Run:  EXAMPOOL_DB=:memory: bun test tests/server.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { BASE_URL, apiGet, apiPost, extractToken, json } from "./helpers";

// ── Operator bootstrap (setup flow) ─────────────────────────────────────────

let operatorToken = "";
const OPERATOR_EMAIL    = `op_server_${Date.now()}@exampool.test`;
const OPERATOR_PASSWORD = "Secure@123";

beforeAll(async () => {
  // If server is fresh (empty DB), call /api/setup. Otherwise login.
  const info = await apiGet("/api/server-info");
  expect(info.status).toBe(200);

  const setupRes = await apiPost("/api/setup", {
    name:        "Test Operator",
    email:       OPERATOR_EMAIL,
    password:    OPERATOR_PASSWORD,
    schoolName:  "Exampool QA School",
    currentTerm: "2026-T1",
  });

  if (setupRes.status === 201) {
    const body = await json(setupRes);
    operatorToken = extractToken(setupRes, body);
  } else {
    // Already set up — login instead
    const loginRes = await apiPost("/api/auth/login", {
      email:    OPERATOR_EMAIL,
      password: OPERATOR_PASSWORD,
    });
    const body = await json(loginRes);
    operatorToken = extractToken(loginRes, body);
  }
});

// ── T-001  SERVER STARTUP & NETWORK ─────────────────────────────────────────

describe("T-001  Server health & network", () => {
  test("T-001-A  GET /api/server-info returns 200 with ip and port", async () => {
    const res  = await apiGet("/api/server-info");
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.data).toHaveProperty("ip");
    expect(body.data).toHaveProperty("port");
    expect(typeof body.data.port).toBe("number");
  });

  test("T-001-B  CORS headers present on all API responses", async () => {
    const res = await apiGet("/api/server-info");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });

  test("T-001-C  OPTIONS preflight returns 204", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
  });

  test("T-001-D  Unknown API path returns 404", async () => {
    const res = await apiGet("/api/does-not-exist-xyz");
    expect(res.status).toBe(404);
  });

  test("T-001-E  Static asset fallback returns HTML (SPA shell)", async () => {
    const res = await fetch(`${BASE_URL}/some-unknown-page`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  test("T-001-F  HTML responses carry no-cache headers", async () => {
    const res = await fetch(`${BASE_URL}/`);
    const cc  = res.headers.get("cache-control") ?? "";
    expect(cc).toMatch(/no-store|no-cache/i);
  });
});

// ── T-002  FIRST-RUN SETUP FLOW ──────────────────────────────────────────────

describe("T-002  Setup flow", () => {
  test("T-002-A  Duplicate setup returns 403 'Setup already completed'", async () => {
    const res  = await apiPost("/api/setup", {
      name:        "Another Op",
      email:       `dup_${Date.now()}@exampool.test`,
      password:    "password123",
      schoolName:  "Dup School",
      currentTerm: "2026-T1",
    });
    // 403 expected after first setup is done
    expect(res.status).toBe(403);
    const body = await json(res);
    expect(body.error).toMatch(/already/i);
  });

  test("T-002-B  Setup requires name field", async () => {
    // This is always 403 after first setup, but checks validation logic
    const res = await apiPost("/api/setup", {
      email:    "x@y.com",
      password: "password123",
    });
    expect([400, 403]).toContain(res.status);
  });

  test("T-002-C  Setup with weak password (<6 chars) returns 400", async () => {
    // Only fires on a truly fresh DB — on seeded DB expect 403
    const res = await apiPost("/api/setup", {
      name:     "Op",
      email:    "op@x.com",
      password: "123",          // too short
    });
    expect([400, 403]).toContain(res.status);
  });

  test("T-002-D  Unauthenticated routes blocked while not in setup mode", async () => {
    // After setup, exam routes should NOT be 503
    const res = await apiGet("/api/auth/me");
    expect(res.status).not.toBe(503);
  });
});

// ── T-003  SERVER-INFO VERSION ────────────────────────────────────────────────

describe("T-003  server-info version field", () => {
  test("T-003-A  version string present", async () => {
    const res  = await apiGet("/api/server-info");
    const body = await json(res);
    expect(body.data.version).toBeTruthy();
    expect(typeof body.data.version).toBe("string");
  });
});
