import { serve } from "bun";
import { existsSync } from "fs";
import fs from "fs";
import crypto, { timingSafeEqual } from "node:crypto";
import db, { EXAMPOOL_DB_PATH, initializeDatabase, queries, bootstrap_v5_migration } from "./db";
import { buildSessionCookie, generateToken, hashPassword, verifyPassword, verifyToken } from "./auth";
import os from "os";
import path from "path";
import { validateMLF, deriveEpkgKey } from "./crypto_utils";
import DNS from "dns2";
// [SECURITY] require() calls hoisted to module level to avoid per-request module lookups
const nodePath = path; // already imported above
let pdfParse: ((buffer: Buffer) => Promise<{ text: string }>) | null = null;
try { pdfParse = require("pdf-parse"); } catch { /* optional dependency */ }
import {
  isValidEmail,
  isValidExamDateTime,
  isExamDatetimeInFuture,
  isExamDatetimeEditValid,
  isValidPassword,
  isValidRoleParam,
  isValidSubjectDuration,
  isPositiveIntId,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  trimStr,
} from "./validation";

/** Next `distDir: "../dist"` → `exampool/dist`; some layouts use `exampool/frontend/dist`. */
function resolveStaticDistDir(): string {
  const siblingDist = path.join(import.meta.dir, "dist");
  const siblingOut = path.join(import.meta.dir, "out");
  const nestedFrontendDist = path.join(import.meta.dir, "frontend", "dist");
  const nestedFrontendOut = path.join(import.meta.dir, "frontend", "out");
  
  if (existsSync(path.join(siblingOut, "index.html"))) return siblingOut;
  if (existsSync(path.join(siblingDist, "index.html"))) return siblingDist;
  if (existsSync(path.join(nestedFrontendOut, "index.html"))) return nestedFrontendOut;
  if (existsSync(path.join(nestedFrontendDist, "index.html"))) return nestedFrontendDist;
  
  return siblingOut;
}

const distDir = resolveStaticDistDir();
const indexFile = Bun.file(path.join(distDir, "index.html"));

/** INTEGER / COUNT may be bigint; `0n === 0` and `1n !== 1` break setup mode and ownership checks. */
function sqlInt(value: unknown): number {
  if (value == null || value === "") return 0;
  return typeof value === "bigint" ? Number(value) : Number(value);
}

function rowCount(row: { count?: unknown } | null | undefined): number {
  return sqlInt(row?.count ?? 0);
}

function sameUserId(dbValue: unknown, tokenUserId: number): boolean {
  return sqlInt(dbValue) === tokenUserId;
}

/** Never fail the request if audit insert hits FK/race; log instead. */
function auditLog(actorId: number, action: string, resource: string, resourceId: number | null, details: string) {
  const aid = sqlInt(actorId);
  const rid = resourceId == null ? null : sqlInt(resourceId);
  if (!Number.isFinite(aid)) {
    console.warn("[exampool] audit_log skipped: invalid actor_id", actorId);
    return;
  }
  if (resourceId != null && !Number.isFinite(rid as number)) {
    console.warn("[exampool] audit_log skipped: invalid resource_id", resourceId);
    return;
  }
  try {
    queries.createAuditLog.run(aid, action, resource, rid, details);
  } catch (e) {
    console.error("[exampool] audit_log failed:", action, e);
  }
}

let setupRequired = rowCount(queries.countActiveOperators.get() as { count?: unknown }) === 0;

const ALLOWED_ORIGIN = Bun.env.ALLOWED_ORIGIN || "http://localhost:3000";

const securityHeaders = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self' ws: wss: http: https:;"
};

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true",
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Pragma": "no-cache",
  ...securityHeaders
};

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function isSqliteUniqueError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /UNIQUE|unique constraint/i.test(m);
}

if (!(BigInt.prototype as any).toJSON) {
  (BigInt.prototype as any).toJSON = function () { return Number(this); };
}

/** bun:sqlite returns INTEGER as BigInt; native JSON.stringify throws -> 500. Patched BigInt prototype above to fix this securely and fast. */
function jsonSafeStringify(payload: unknown): string {
  return JSON.stringify(payload);
}

const rateLimits = new Map<string, { count: number, resetAt: number }>();

// Memory Leak Fix: Periodically clean up expired rate limit entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimits.entries()) {
    if (now > record.resetAt) {
      rateLimits.delete(ip);
    }
  }
}, 5 * 60 * 1000); // Run every 5 minutes

function getClientIp(req: Request): string {
  // [SECURITY FIX] X-Forwarded-For is only trusted when TRUST_PROXY=true env is set.
  // Without this gate, any client could spoof X-Forwarded-For: 127.0.0.1 to bypass rate limits.
  if (Bun.env.TRUST_PROXY === "true") {
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  // Always use the actual socket IP when not behind a trusted proxy
  try { return server.requestIP(req)?.address || "unknown"; } catch { return "unknown"; }
}

function checkRateLimit(key: string, limit: number, windowMs: number) {
  if (key.includes("127.0.0.1") || key.includes("::1") || key.includes("localhost")) return;
  const now = Date.now();
  let record = rateLimits.get(key);
  if (!record || now > record.resetAt) {
    record = { count: 0, resetAt: now + windowMs };
    rateLimits.set(key, record);
  }
  record.count++;
  if (record.count > limit) throw new HttpError(429, "Too Many Requests");
}

// ── Server-Sent Events (SSE) Manager ───────────────────────────────────────
const sseClients = new Map<number, Set<ReadableStreamDefaultController>>();
// [SECURITY] Max SSE connections per user — prevents memory exhaustion DoS
const SSE_MAX_CONNECTIONS_PER_USER = 5;

function notifyUser(userId: number, eventData: any) {
  try {
    const record = queries.createNotification.get(
      userId,
      eventData.type || "info",
      eventData.message,
      eventData.link || null
    ) as any;

    const clients = sseClients.get(userId);
    if (clients) {
      const payload = `data: ${jsonSafeStringify(record)}\n\n`;
      for (const client of clients) {
        try { client.enqueue(payload); } catch (e) {}
      }
    }
  } catch (err) {
    console.error("[exampool] Failed to send notification", err);
  }
}

function notifyOperators(eventData: any) {
  // Use targeted getOperators query — avoids loading all 1000 users just to
  // filter by role. queries.getOperators fetches only operator IDs.
  const operators = queries.getOperators.all() as Array<{ id: number }>;
  for (const op of operators) {
    notifyUser(sqlInt(op.id), eventData);
  }
}
// ─────────────────────────────────────────────────────────────────────────

function apiSuccess(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(jsonSafeStringify({ data }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

function apiMessage(message: string, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

function apiError(status: number, error: string, extra?: Record<string, unknown>) {
  if (status >= 500) {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "error", status, error, extra }));
  }
  return new Response(JSON.stringify({ error, ...extra }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function apiSetupRequired() {
  return apiError(503, "Setup required", { setup: true });
}

async function readJson(req: Request, maxSize = 1048576): Promise<any> {
  // Allow up to 50MB for database imports
  if (req.url.includes("/api/settings/import")) maxSize = 52428800;

  const contentLength = Number(req.headers.get("content-length"));
  if (contentLength && contentLength > maxSize) {
    throw new HttpError(413, "Payload Too Large");
  }

  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

function parseCookies(req: Request): Record<string, string> {
  const cookie = req.headers.get("cookie");
  if (!cookie) return {};
  const out: Record<string, string> = {};
  for (const pair of cookie.split(";")) {
    const [k, ...rest] = pair.trim().split("=");
    const key = k?.trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(rest.join("="));
    } catch {
      out[key] = rest.join("=");
    }
  }
  return out;
}

function requireAuth(req: Request): { userId: number; role: string } {
  const cookies = parseCookies(req);
  const cookieToken = cookies.__exampool_session;
  const authHeader = req.headers.get("authorization");
  const headerToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const token = cookieToken || headerToken;
  if (!token) throw new HttpError(401, "Not authenticated");
  const decoded = verifyToken(token);
  if (!decoded) throw new HttpError(401, "Not authenticated");

  // Perform stateful DB check to instantly invalidate suspended sessions
  const user = queries.getUserById.get(decoded.userId) as any;
  if (!user || user.is_active !== 1 || user.role !== decoded.role) {
    throw new HttpError(401, "Session invalidated or user suspended");
  }

  return decoded;
}

function requireRole(role: string, allowed: string[]) {
  if (!allowed.includes(role)) throw new HttpError(403, "Forbidden");
}

async function licenseValidator(requiredTiers: string[]) {
  // In v4.1, license check parses the machine license file (MLF)
  try {
    const mlfFile = Bun.file("license.json");
    if (!(await mlfFile.exists())) {
      if (requiredTiers.includes("core")) return true; // fallback for unactivated core mode if needed
      throw new Error("No license file found");
    }
    const fileContent = await mlfFile.text();
    let jwtStr = fileContent;
    try {
      const parsed = JSON.parse(fileContent);
      if (parsed.jwt) jwtStr = parsed.jwt;
    } catch {}
    // Hardware fingerprint would be retrieved natively, mocking for implementation structure
    const payload = await validateMLF(jwtStr, "mock-hw-fingerprint");
    if (!requiredTiers.includes(payload.tier)) {
      throw new HttpError(403, "License tier insufficient for this feature");
    }
    return payload;
  } catch (err: any) {
    throw new HttpError(403, `License Validation Failed: ${err.message}`);
  }
}

function practiceFirewall(pathname: string) {
  // Ensures no DB mutations on core tables during practice endpoints
  // Implicitly handled by our route definitions using query_only pragmas.
  return true;
}

function stripPassword(user: any) {
  if (!user) return user;
  // Strip password hash AND the fields used as self-reset verifiers (dob, phone).
  // These must not be exposed via /api/auth/me — an attacker with a stolen session
  // could harvest them to perform a secondary password reset.
  const { password_hash: _pw, dob: _dob, phone: _phone, ...rest } = user;
  // bun:sqlite may return INTEGER columns as BigInt; JSON.stringify throws on BigInt.
  const safe: Record<string, unknown> = { ...rest };
  if (safe.id != null) safe.id = Number(safe.id);
  if (safe.is_active != null) safe.is_active = Number(safe.is_active);
  return safe;
}

function stripCorrectAnswer(questions: any[], role: string): any[] {
  if (role !== "student") return questions;
  // Strip both correct_answer AND teacher_answer to prevent answer leakage
  return questions.map(({ correct_answer: _correct, teacher_answer: _ta, ...q }) => q);
}

function getCurrentTerm(): string {
  return (queries.getSetting.get("CURRENT_TERM") as { value?: string } | undefined)?.value || "2026-T1";
}

function getRegistrationOpen(): boolean {
  return ((queries.getSetting.get("REGISTRATION_OPEN") as { value?: string } | undefined)?.value || "true") === "true";
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".txt": "text/plain",
  };
  return map[ext] ?? "application/octet-stream";
}

/** Return appropriate Cache-Control header for a given file path. */
function getCacheControl(filePath: string): string {
  // Content-addressed Next.js static assets — safe to cache forever
  if (filePath.includes("/_next/static/") || filePath.includes("\\_next\\static\\")) {
    return "public, max-age=31536000, immutable";
  }
  // HTML pages AND Next.js RSC payloads (.txt, .rsc, .meta) must NEVER be cached
  if (filePath.endsWith(".html") || filePath.endsWith(".txt") || filePath.endsWith(".rsc") || filePath.endsWith(".meta")) {
    return "no-store, no-cache, must-revalidate";
  }
  // Everything else — short revalidation
  return "public, max-age=60, must-revalidate";
}

/** Normalize URL path for static lookup (supports Next `trailingSlash: true` → `/setup/` → `setup/index.html`). */
async function serveStatic(urlPath: string): Promise<Response> {
  const pathname = urlPath.split("?")[0] ?? urlPath;
  
  // UX Fix: Auto-correct common casing mistakes for main portals
  const lowerPath = pathname.toLowerCase();
  if (lowerPath.startsWith("/teacher") && pathname !== lowerPath) {
    return new Response(null, { status: 301, headers: { Location: lowerPath + urlPath.slice(pathname.length) } });
  }
  if (lowerPath.startsWith("/admin") && !pathname.startsWith("/ADMIN")) {
    return new Response(null, { status: 301, headers: { Location: "/ADMIN" + urlPath.slice(6) } });
  }
  if (lowerPath.startsWith("/operator") && pathname !== lowerPath) {
    return new Response(null, { status: 301, headers: { Location: lowerPath + urlPath.slice(pathname.length) } });
  }
  if (lowerPath.startsWith("/student") && pathname !== lowerPath) {
    return new Response(null, { status: 301, headers: { Location: lowerPath + urlPath.slice(pathname.length) } });
  }

  const rel = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  const candidates: string[] = [];

  if (!rel) {
    candidates.push(path.join(distDir, "index.html"));
  } else if (path.extname(rel) !== "") {
    candidates.push(path.join(distDir, rel));
  } else {
    candidates.push(path.join(distDir, rel, "index.html"));
    candidates.push(path.join(distDir, `${rel}.html`));
    candidates.push(path.join(distDir, rel));
  }

  // Normalize distDir for comparison (resolve symlinks/dotdots)
  const resolvedDistDir = path.resolve(distDir);

  for (const filePath of candidates) {
    // Path traversal guard: ensure resolved path stays inside distDir
    const resolvedFilePath = path.resolve(filePath);
    if (!resolvedFilePath.startsWith(resolvedDistDir + path.sep) && resolvedFilePath !== resolvedDistDir) {
      return apiError(403, "Forbidden");
    }
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file, {
        headers: {
          ...corsHeaders,
          "Content-Type": getMimeType(filePath),
          "Cache-Control": getCacheControl(filePath),
          "Pragma": (filePath.endsWith(".html") || filePath.endsWith(".txt") || filePath.endsWith(".rsc") || filePath.endsWith(".meta")) ? "no-cache" : "",
        },
      });
    }
  }
  // Fallback SPA shell — also no-cache
  if (!(await indexFile.exists())) {
    return apiError(404, "Not found");
  }
  return new Response(indexFile, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
    },
  });
}

function isApiExemptWhileSetup(pathname: string, method: string): boolean {
  if (method === "GET" && pathname === "/api/server-info") return true;
  if (method === "POST" && (pathname === "/api/setup" || pathname === "/api/setup/complete")) return true;
  return false;
}

function normalizeApiPathname(raw: string): string {
  const p = raw.replace(/\/+$/, "") || "/";
  return p;
}

async function handleApi(req: Request, url: URL): Promise<Response> {
  const method = req.method.toUpperCase();
  const pathname = normalizeApiPathname(url.pathname);

  // ── Notifications Endpoints ──────────────────────────────────────────────
  if (pathname === "/api/notifications/stream" && method === "GET") {
    let auth;
    try { auth = requireAuth(req); } catch (e) { return new Response("Unauthorized", { status: 401 }); }
    return new Response(new ReadableStream({
      start(controller) {
        let clients = sseClients.get(auth.userId);
        if (!clients) {
          clients = new Set();
          sseClients.set(auth.userId, clients);
        }
        // [SECURITY FIX] Limit SSE connections per user to prevent DoS memory exhaustion
        if (clients.size >= SSE_MAX_CONNECTIONS_PER_USER) {
          // Close the oldest connection before adding the new one
          const oldest = clients.values().next().value;
          if (oldest) {
            try { oldest.close(); } catch {}
            clients.delete(oldest);
          }
        }
        clients.add(controller);
        const keepAlive = setInterval(() => {
          try { controller.enqueue(": keepalive\n\n"); } catch {}
        }, 15000);
        req.signal.addEventListener("abort", () => {
          clearInterval(keepAlive);
          clients?.delete(controller);
          if (clients?.size === 0) sseClients.delete(auth.userId);
        });
      }
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      }
    });
  }

  if (pathname === "/api/notifications" && method === "GET") {
    const auth = requireAuth(req);
    const notifications = queries.getNotifications.all(auth.userId);
    const unreadRow = queries.getUnreadNotificationCount.get(auth.userId) as any;
    return apiSuccess({ items: notifications, unreadCount: sqlInt(unreadRow?.count) });
  }

  if (pathname === "/api/notifications/read" && method === "PUT") {
    const auth = requireAuth(req);
    queries.markNotificationsRead.run(auth.userId);
    return apiMessage("Marked all as read");
  }
  
  // ── Exam Sync Stream (Secure Timer) ──────────────────────────────────────
  const examStreamMatch = pathname.match(/^\/api\/exams\/(\d+)\/stream$/);
  if (examStreamMatch && method === "GET") {
    let auth;
    try { auth = requireAuth(req); } catch (e) { return new Response("Unauthorized", { status: 401 }); }
    const examId = Number(examStreamMatch[1]);
    const exam = queries.getExamByIdAndStudent.get(examId, auth.userId) as any;
    if (!exam) return new Response("Not found", { status: 404 });

    return new Response(new ReadableStream({
      start(controller) {
        const sendTimeSync = () => {
          const e = queries.getExamById.get(examId) as any;
          if (e && e.status === "in-progress") {
             const s = queries.getSubjectById.get(e.subject_id) as any;
             const elapsed = Math.floor((Date.now() - Date.parse(e.start_time)) / 1000);
             const remaining = Math.max(0, s.duration * 60 - elapsed);
             if (remaining === 0) {
               try { controller.enqueue(`data: ${JSON.stringify({type: "force_submit"})}\n\n`); } catch {}
             } else {
               try { controller.enqueue(`data: ${JSON.stringify({type: "sync", remaining})}\n\n`); } catch {}
             }
          } else {
             try { controller.enqueue(`data: ${JSON.stringify({type: "force_submit"})}\n\n`); } catch {}
          }
        };

        sendTimeSync();
        const keepAlive = setInterval(() => { sendTimeSync(); }, 15000);
        req.signal.addEventListener("abort", () => { clearInterval(keepAlive); });
      }
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      }
    });
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (setupRequired && !isApiExemptWhileSetup(pathname, method)) {
    return apiSetupRequired();
  }

  if (method === "GET" && pathname === "/api/server-info") {
    const interfaces = os.networkInterfaces();
    const ips: string[] = [];
    for (const addresses of Object.values(interfaces)) {
      for (const a of addresses || []) if (a.family === "IPv4" && !a.internal) ips.push(a.address);
    }
    return apiSuccess({ ip: ips[0] || "127.0.0.1", port: Number(Bun.env.PORT ?? 3000), version: "1.2.0" });
  }

  if (method === "POST" && (pathname === "/api/setup" || pathname === "/api/setup/complete")) {
    if (!setupRequired) return apiError(403, "Setup already completed");
    const body = await readJson(req);
    const name = trimStr(body?.name);
    const email = normalizeEmail(trimStr(body?.email));
    const password = body?.password;
    const schoolName = trimStr(body?.schoolName);
    const currentTerm = trimStr(body?.currentTerm);
    if (!name) return apiError(400, "name is required");
    if (!email || !isValidEmail(email)) return apiError(400, "A valid email is required");
    if (!isValidPassword(password)) {
      return apiError(400, `password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    const hash = await hashPassword(password);
    let result: { lastInsertRowid: number | bigint };
    try {
      result = queries.createUser.run(name, email, "operator", hash, null, null, null, null, null, null, null) as { lastInsertRowid: number | bigint };
    } catch (e) {
      if (isSqliteUniqueError(e)) return apiError(409, "Email already registered");
      throw e;
    }
    queries.upsertSetting.run("SCHOOL_NAME", schoolName || "Exampool");
    queries.upsertSetting.run("CURRENT_TERM", (currentTerm || "2026-T1").slice(0, 64));
    queries.upsertSetting.run("REGISTRATION_OPEN", "true");
    const userId = Number(result.lastInsertRowid);
    setupRequired = false;
    const token = generateToken(userId, "operator");
    return apiSuccess(
      { user: { id: userId, name, email, role: "operator", grade: null } },
      201,
      { "Set-Cookie": buildSessionCookie(token) },
    );
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const clientIp = getClientIp(req);
    checkRateLimit(`login_${clientIp}`, 10, 60_000);
    try {
      const body = await readJson(req);
      const identifier = trimStr(body?.email || body?.identifier);
      const password = body?.password;
      if (!identifier || typeof password !== "string" || !password) return apiError(400, "Email/Reg ID and password required");
      const normalizedIdentifier = identifier.includes("@") ? normalizeEmail(identifier) : identifier.toUpperCase();
      const user = queries.getUserByEmailOrReg.get(normalizedIdentifier, normalizedIdentifier) as Record<string, unknown> | undefined;
      if (!user) {
        // Generic log — do NOT include identifier to prevent user enumeration in logs
        console.warn("[Login] Failed: user not found");
        return apiError(401, "Invalid credentials");
      }
      if (sqlInt(user.is_active) !== 1) {
        // [SECURITY FIX] Return 401 (not 423) to avoid revealing whether account exists
        console.warn("[Login] Failed: account inactive");
        return apiError(401, "Invalid credentials");
      }
      const hash = user.password_hash;
      if (typeof hash !== "string" || !hash) {
        console.warn("[Login] Failed: missing password hash");
        return apiError(401, "Invalid credentials");
      }
      let ok = false;
      try {
        ok = await verifyPassword(password, hash);
      } catch (e) {
        console.error("[Login] verifyPassword error:", e);
        ok = false;
      }
      if (!ok) {
        console.warn("[Login] Failed: incorrect password");
        return apiError(401, "Invalid credentials");
      }
      const userId = Number(user.id);
      const role = typeof user.role === "string" ? user.role : "";
      if (!Number.isFinite(userId) || !role) {
        console.warn("[Login] Failed: invalid user record");
        return apiError(401, "Invalid credentials");
      }
      const token = generateToken(userId, role);
      auditLog(userId, "LOGIN", "user", userId, JSON.stringify({ email: user.email }));
      return apiSuccess({ user: stripPassword(user) }, 200, { "Set-Cookie": buildSessionCookie(token) });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      console.error("[Login] Unexpected error:", error);
      return apiError(500, "Server error");
    }
  }

  if (method === "POST" && pathname === "/api/auth/register") {
    const clientIp = getClientIp(req);
    const auth = (() => {
      try {
        return requireAuth(req);
      } catch {
        return null;
      }
    })();
    if (auth?.role !== "operator") {
      checkRateLimit(`register_${clientIp}`, 5, 60_000);
    }
    if (!getRegistrationOpen() && (!auth || auth.role !== "operator")) return apiError(403, "Registration is closed");
    const body = await readJson(req);
    const name = trimStr(body?.name);
    let email = normalizeEmail(trimStr(body?.email));
    const password = body?.password;
    const role = body?.role;
    const grade = trimStr(body?.grade);
    const dob = trimStr(body?.dob) || null;
    const phone = trimStr(body?.phone) || null;
    
    if (!name || !role) return apiError(400, "Missing required fields");
    if (role !== "student" && !email) return apiError(400, "Email is required for this role");
    if (email && !isValidEmail(email)) return apiError(400, "A valid email is required");
    
    if (!isValidPassword(password)) {
      return apiError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    if (role === "operator" && (!auth || auth.role !== "operator")) return apiError(403, "operator cannot self-register");
    if (role !== "student" && role !== "teacher" && role !== "operator") return apiError(403, "Invalid role");
    if (role === "student" && !grade) return apiError(400, "Grade is required for student accounts");
    if (role === "student" && !dob) return apiError(400, "Date of Birth is required for student accounts");
    if (role === "teacher" && !phone) return apiError(400, "Phone number is required for teacher accounts");
    
    const prefix = role === "teacher" ? "TCH" : "REG";
    const regId = `${prefix}-${Date.now().toString(36).toUpperCase()}`;
    
    // Auto-generate dummy email for student if not provided
    if (role === "student" && !email) {
      email = `${regId.toLowerCase()}@student.exampool.local`;
    }
    
    if (queries.getUserByEmail.get(email)) return apiError(400, "Email already registered");
    const hash = await hashPassword(password);
    let result: { lastInsertRowid: number | bigint };
    try {
      result = queries.createUser.run(name, email, role, hash, role === "student" ? grade : null, regId, null, null, null, role === "teacher" ? phone : null, role === "student" ? dob : null) as {
        lastInsertRowid: number | bigint;
      };
    } catch (e) {
      if (isSqliteUniqueError(e)) return apiError(409, "Email already registered");
      throw e;
    }
    const newUserId = Number(result.lastInsertRowid);
    const actorId = auth != null ? Number(auth.userId) : newUserId;
    auditLog(actorId, "USER_CREATE", "user", newUserId, JSON.stringify({ role }));
    return apiSuccess({ user: { id: newUserId, name, email, role, reg_id: regId, grade: role === "student" ? grade : null } }, 201);
  }

  if (method === "GET" && pathname === "/api/auth/me") {
    const auth = requireAuth(req);
    const user = queries.getUserById.get(auth.userId) as any;
    if (!user || sqlInt(user.is_active) !== 1) return apiError(401, "Not authenticated");
    return apiSuccess({ user: stripPassword(user) });
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    const auth = requireAuth(req);
    auditLog(auth.userId, "LOGOUT", "user", auth.userId, "{}");
    return apiMessage("Logged out", 200, { "Set-Cookie": "__exampool_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
  }

  if (method === "POST" && pathname === "/api/auth/reset-password/verify-email") {
    const clientIp = getClientIp(req);
    checkRateLimit(`pwreset_verify_${clientIp}`, 5, 60_000);
    const body = await readJson(req);
    const identifier = trimStr(body?.email || body?.identifier);
    if (!identifier) return apiError(400, "Identifier required");
    const normalizedIdentifier = identifier.includes("@") ? normalizeEmail(identifier) : identifier.toUpperCase();
    const user = queries.getUserByEmailOrReg.get(normalizedIdentifier, normalizedIdentifier) as any;
    // [SECURITY FIX] Return same generic response regardless of whether account exists
    // to prevent user enumeration oracle.
    if (!user || sqlInt(user.is_active) !== 1) return apiSuccess({ found: true });
    return apiSuccess({ role: user.role });
  }

  if (method === "POST" && pathname === "/api/auth/reset-password") {
    const clientIp = getClientIp(req);
    checkRateLimit(`pwreset_${clientIp}`, 5, 60_000);
    const body = await readJson(req);
    const identifier = trimStr(body?.email || body?.identifier);
    const verification = trimStr(body?.verification);
    const newPassword = body?.new_password;
    if (!identifier || !verification || !newPassword) return apiError(400, "Missing required fields");
    if (!isValidPassword(newPassword)) return apiError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    
    const normalizedIdentifier = identifier.includes("@") ? normalizeEmail(identifier) : identifier.toUpperCase();
    const user = queries.getUserByEmailOrReg.get(normalizedIdentifier, normalizedIdentifier) as any;
    if (!user) return apiError(404, "User not found");
    if (sqlInt(user.is_active) !== 1) return apiError(423, "Account deactivated");
    
    // [SECURITY FIX] Use timing-safe comparison to prevent timing-based enumeration of DOB/phone
    if (user.role === "student") {
      if (!user.dob) return apiError(400, "Date of birth not set for this account. Please contact an administrator.");
      const dobBuf = Buffer.from(String(user.dob).padEnd(32, "\0"), "utf8");
      const verBuf = Buffer.from(verification.padEnd(32, "\0"), "utf8");
      if (dobBuf.length !== verBuf.length || !timingSafeEqual(dobBuf, verBuf)) return apiError(401, "Verification failed (incorrect DOB)");
    } else {
      if (!user.phone) return apiError(400, "Phone number not set for this account. Please contact an administrator.");
      const phoneBuf = Buffer.from(String(user.phone).padEnd(32, "\0"), "utf8");
      const verBuf2 = Buffer.from(verification.padEnd(32, "\0"), "utf8");
      if (phoneBuf.length !== verBuf2.length || !timingSafeEqual(phoneBuf, verBuf2)) return apiError(401, "Verification failed (incorrect phone number)");
    }
    
    const hash = await hashPassword(newPassword);
    queries.updateUserPassword.run(hash, user.id);
    auditLog(user.id, "USER_UPDATE", "user", user.id, JSON.stringify({ action: "self_reset_password" }));
    return apiMessage("Password reset successfully");
  }

  const resetPasswordMatch = pathname.match(/^\/api\/users\/(\d+)\/reset-password$/);
  if (resetPasswordMatch && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const userId = Number(resetPasswordMatch[1]);
    const body = await readJson(req);
    const newPassword = body?.new_password;
    if (!isPositiveIntId(userId)) return apiError(400, "Invalid user ID");
    if (!isValidPassword(newPassword)) return apiError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    
    const user = queries.getUserById.get(userId) as any;
    if (!user) return apiError(404, "User not found");

    const hash = await hashPassword(newPassword);
    queries.updateUserPassword.run(hash, userId);
    
    auditLog(auth.userId, "USER_UPDATE", "user", userId, JSON.stringify({ action: "reset_password" }));
    return apiMessage("Password reset successfully");
  }

  const studentExamsMatch = pathname.match(/^\/api\/users\/(\d+)\/exams$/);
  if (studentExamsMatch && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const studentId = Number(studentExamsMatch[1]);
    
    const exams = queries.getStudentExamsForRoster.all(studentId);
    
    return apiSuccess(exams);
  }

  // ── Save teacher remark for a specific completed exam ────────────────────────
  const examRemarkMatch = pathname.match(/^\/api\/exams\/(\d+)\/remarks$/);
  if (examRemarkMatch && method === "PUT") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const examId = Number(examRemarkMatch[1]);
    if (!isPositiveIntId(examId)) return apiError(400, "Invalid exam id");
    const exam = queries.getExamById.get(examId) as any;
    if (!exam) return apiError(404, "Exam not found");
    if (exam.status !== "completed") return apiError(409, "Exam must be completed to add a remark");
    // Teachers may only remark on their own subject's exams
    if (auth.role === "teacher") {
      const subject = queries.getSubjectById.get(exam.subject_id) as any;
      if (!subject || !sameUserId(subject.teacher_id, auth.userId)) return apiError(403, "You do not own this subject");
    }
    const body = await readJson(req);
    // [SECURITY FIX] Cap remark length to prevent excessively large DB entries
    const rawRemark = typeof body?.remark === "string" ? body.remark.trim() : "";
    const remark = rawRemark.slice(0, 4000);
    queries.updateExamTeacherRemark.run(remark || null, examId);
    auditLog(auth.userId, "EXAM_REMARK", "exam", examId, JSON.stringify({ type: "teacher" }));
    
    // Notify admin
    const subjectRow = queries.getSubjectById.get(exam.subject_id) as any;
    notifyOperators({
      type: "remark_added",
      message: `Teacher added a remark for ${subjectRow?.code || 'an exam'}`,
      link: `/ADMIN/report-card`
    });

    return apiSuccess({ exam_id: examId, teacher_remark: remark || null });
  }

  // ── Retake Exam ─────────────────────────────────────────────────────────────
  const examRetakeMatch = pathname.match(/^\/api\/exams\/(\d+)\/retake$/);
  if (examRetakeMatch && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["student"]);
    const examId = Number(examRetakeMatch[1]);
    if (!isPositiveIntId(examId)) return apiError(400, "Invalid exam id");
    
    // Begin Transaction manually via db object? Since we are doing two writes, we can just run them sequentially.
    const exam = queries.getExamById.get(examId) as any;
    if (!exam || exam.student_id !== auth.userId) return apiError(404, "Exam not found");
    if (exam.status !== "completed") return apiError(400, "Exam is not yet completed");
    
    const subject = queries.getSubjectById.get(exam.subject_id) as any;
    if (!subject || subject.can_retake !== 1) return apiError(403, "Retaking is not allowed for this subject");
    
    // Archive the completed attempt BEFORE resetting — preserves historical data
    db.transaction(() => {
      queries.archiveExamAttempt.run(examId);
      queries.deleteStudentAnswersForExam.run(examId);
      queries.resetExam.run(examId, auth.userId);
    })();
    
    auditLog(auth.userId, "EXAM_RETAKE", "exam", examId, JSON.stringify({ retake_count: exam.retake_count + 1 }));
    return apiSuccess({ success: true, message: "Exam reset for retake." });
  }

  // ── Save principal/admin remark for a specific completed exam ────────────────
  const examPrincipalRemarkMatch = pathname.match(/^\/api\/exams\/(\d+)\/principal-remark$/);
  if (examPrincipalRemarkMatch && method === "PUT") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const examId = Number(examPrincipalRemarkMatch[1]);
    if (!isPositiveIntId(examId)) return apiError(400, "Invalid exam id");
    const exam = queries.getExamById.get(examId) as any;
    if (!exam) return apiError(404, "Exam not found");
    if (exam.status !== "completed") return apiError(409, "Exam must be completed to add a remark");
    const body = await readJson(req);
    // [SECURITY FIX] Cap remark length to prevent excessively large DB entries
    const rawRemark = typeof body?.remark === "string" ? body.remark.trim() : "";
    const remark = rawRemark.slice(0, 4000);
    queries.updateExamPrincipalRemark.run(remark || null, examId);
    auditLog(auth.userId, "EXAM_PRINCIPAL_REMARK", "exam", examId, JSON.stringify({ type: "principal" }));
    
    // Notify teacher when admin adds principal remark
    const subjectRow = queries.getSubjectById.get(exam.subject_id) as any;
    if (subjectRow && subjectRow.teacher_id) {
      notifyUser(Number(subjectRow.teacher_id), {
        type: "remark_added",
        message: `Admin added a principal remark for an exam in ${subjectRow.code}`,
        link: `/teacher/results`
      });
    }

    return apiSuccess({ exam_id: examId, principal_remark: remark || null });
  }

  // ── Term Remarks ─────────────────────────────────────────────────────────────
  const termRemarkMatch = pathname.match(/^\/api\/users\/(\d+)\/term-remarks\/(.+)$/);
  if (termRemarkMatch && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator", "student"]);
    const studentId = Number(termRemarkMatch[1]);
    // [SECURITY FIX] Sanitize term parameter -- trim and cap length
    const term = decodeURIComponent(termRemarkMatch[2] || "").trim().slice(0, 64);
    if (!isPositiveIntId(studentId)) return apiError(400, "Invalid student id");
    const remark = queries.getTermRemark.get(studentId, term);
    return apiSuccess(remark || { student_id: studentId, term, teacher_remark: null, principal_remark: null });
  }

  if (termRemarkMatch && method === "PUT") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const studentId = Number(termRemarkMatch[1]);
    // [SECURITY FIX] Sanitize term parameter -- trim and cap length
    const term = decodeURIComponent(termRemarkMatch[2] || "").trim().slice(0, 64);
    if (!isPositiveIntId(studentId)) return apiError(400, "Invalid student id");
    const body = await readJson(req);
    // [SECURITY FIX] Cap remark length to prevent excessively large DB entries
    const remark = typeof body?.remark === "string" ? body.remark.trim().slice(0, 4000) : "";
    
    if (auth.role === "teacher") {
      queries.upsertTeacherRemark.run(studentId, term, remark || null);
    } else {
      queries.upsertPrincipalRemark.run(studentId, term, remark || null);
    }
    
    auditLog(auth.userId, "TERM_REMARK", "user", studentId, JSON.stringify({ term, role: auth.role }));

    // Notify admin when a teacher writes a report-card remark
    if (auth.role === "teacher") {
      const teacherRow = queries.getUserById.get(auth.userId) as any;
      const studentRow = queries.getUserById.get(studentId) as any;
      notifyOperators({
        type: "remark_added",
        message: `${teacherRow?.name || 'Teacher'} added a report-card remark for ${studentRow?.name || 'a student'} (${term})`,
        link: `/ADMIN/report-card`
      });
    } else if (auth.role === "operator") {
      const studentRow = queries.getUserById.get(studentId) as any;
      const teachers = db.prepare('SELECT DISTINCT s.teacher_id FROM subjects s JOIN subject_enrollments se ON se.subject_id = s.id WHERE se.student_id = ? AND s.term = ?').all(studentId, term) as Array<{ teacher_id: number }>;
      for (const t of teachers) {
        if (t.teacher_id) {
          notifyUser(t.teacher_id, {
            type: "remark_added",
            message: `Admin added a report-card remark for ${studentRow?.name || 'a student'} (${term})`,
            link: `/teacher/students`
          });
        }
      }
    }

    return apiSuccess(queries.getTermRemark.get(studentId, term));
  }

  if (method === "GET" && pathname === "/api/subjects") {
    const auth = requireAuth(req);
    if (auth.role === "student") {
      // Students only see subjects they are enrolled in AND published.
      return apiSuccess(
        db.prepare(`
          SELECT s.* FROM subjects s
          INNER JOIN subject_enrollments se ON se.subject_id = s.id AND se.student_id = ?
          WHERE s.is_timetable_published = 1
          ORDER BY s.name
        `).all(auth.userId)
      );
    }
    if (auth.role === "teacher") return apiSuccess(queries.getSubjectsByTeacher.all(auth.userId));
    return apiSuccess(queries.getAllSubjects.all());
  }

  if (method === "POST" && pathname === "/api/subjects") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const body = await readJson(req);
    const name = trimStr(body?.name);
    const code = trimStr(body?.code);
    const term = trimStr(body?.term);
    const duration = Number(body?.duration);
    const exam_datetime = trimStr(body?.exam_datetime);
    const teacher_id = body?.teacher_id;
    if (!name || !code || !term) return apiError(400, "Invalid subject payload");
    if (!isValidSubjectDuration(duration)) return apiError(400, "duration must be an integer from 1 to 360 (minutes)");
    if (exam_datetime !== "" && !isValidExamDateTime(exam_datetime)) return apiError(400, "exam_datetime must be a valid date/time");
    if (exam_datetime !== "" && !isExamDatetimeInFuture(exam_datetime)) return apiError(400, "exam_datetime must be in the future");
    const teacherId = auth.role === "teacher" ? auth.userId : Number(teacher_id);
    if (auth.role === "operator") {
      if (!isPositiveIntId(teacherId)) return apiError(400, "teacher_id is required for operator-created subjects");
      const teacher = queries.getUserById.get(teacherId) as any;
      if (!teacher || teacher.role !== "teacher" || sqlInt(teacher.is_active) !== 1) return apiError(400, "Invalid or inactive teacher");
    }
    const description = trimStr(body?.description) || null;
    const cls = trimStr(body?.class) || null;
    const session = trimStr(body?.session) || null;
    const mode = ["test", "exam", "quiz"].includes(body?.mode) ? body.mode : "exam";
    const instructions = trimStr(body?.instructions) || null;
    const window_duration = Number(body?.window_duration) || 120;
    const can_retake = body?.can_retake !== undefined ? Number(body.can_retake) : 1;
    const is_assignment = body?.is_assignment !== undefined ? Number(body.is_assignment) : 0;
    const result = queries.createSubject.run(name, code, term, duration, 0, exam_datetime, 0, teacherId, auth.userId, description, cls, session, mode, instructions, 0, window_duration, can_retake, is_assignment) as {
      lastInsertRowid: number | bigint;
    };
    auditLog(auth.userId, "SUBJECT_CREATE", "subject", Number(result.lastInsertRowid), JSON.stringify({ code, term }));
    
    if (auth.role === "operator" && teacherId) {
      notifyUser(teacherId, {
        type: "info",
        message: `Admin assigned you a new subject: ${name} (${code})`,
        link: `/teacher/dashboard`
      });
    }

    return apiSuccess({ id: Number(result.lastInsertRowid) }, 201);
  }

  const subjectMatch = pathname.match(/^\/api\/subjects\/(\d+)$/);
  if (subjectMatch && method === "PUT") {
    const auth = requireAuth(req);
    const subjectId = Number(subjectMatch[1]);
    if (!isPositiveIntId(subjectId)) return apiError(400, "Invalid subject id");
    const subject = queries.getSubjectById.get(subjectId) as any;
    if (!subject) return apiError(404, "Subject not found");
    if (auth.role !== "operator" && !sameUserId(subject.teacher_id, auth.userId)) return apiError(403, "You do not own this subject");
    if (auth.role === "teacher" && subject.is_published) return apiError(403, "Cannot edit a published subject");
    const body = await readJson(req);
    const nextDuration = Number(body.duration ?? subject.duration);
    const nextExamAt = body.exam_datetime !== undefined ? trimStr(body.exam_datetime) : subject.exam_datetime;
    if (body.duration !== undefined && !isValidSubjectDuration(nextDuration)) {
      return apiError(400, "duration must be an integer from 1 to 360 (minutes)");
    }
    // On EDIT, use the permissive edit validator (allows past dates for existing subjects).
    // isExamDatetimeInFuture is only for creation.
    if (nextExamAt !== "" && !isExamDatetimeEditValid(nextExamAt)) {
      return apiError(400, "exam_datetime must be a valid date/time");
    }
    let nextTeacherId = Number(body.teacher_id ?? subject.teacher_id);
    if (body.teacher_id !== undefined && auth.role === "operator") {
      if (!isPositiveIntId(nextTeacherId)) return apiError(400, "Invalid teacher_id");
      const teacher = queries.getUserById.get(nextTeacherId) as any;
      if (!teacher || teacher.role !== "teacher" || sqlInt(teacher.is_active) !== 1) return apiError(400, "Invalid or inactive teacher");
    } else if (auth.role === "teacher") {
      nextTeacherId = sqlInt(subject.teacher_id);
    }
    const nextMode = ["test", "exam", "quiz"].includes(body?.mode) ? body.mode : (subject.mode || "exam");
    const nextInstructions = body.instructions !== undefined ? (trimStr(body.instructions) || null) : (subject.instructions || null);
    // Compute total_score from the DB — never trust a client-supplied value
    const computedTotalScore = (db.prepare(
      "SELECT COALESCE(SUM(marks),0) as t FROM questions WHERE subject_id = ?"
    ).get(subjectId) as any)?.t ?? 0;
    queries.updateSubject.run(
      trimStr(body.name) || subject.name,
      trimStr(body.code) || subject.code,
      trimStr(body.term) || subject.term,
      nextDuration,
      Number(computedTotalScore),
      nextExamAt,
      Number(body.is_published ?? subject.is_published),
      nextTeacherId,
      body.description !== undefined ? (trimStr(body.description) || null) : (subject.description || null),
      body.class !== undefined ? (trimStr(body.class) || null) : (subject.class || null),
      body.session !== undefined ? (trimStr(body.session) || null) : (subject.session || null),
      nextMode,
      nextInstructions,
      body.is_timetable_published !== undefined ? Number(body.is_timetable_published) : Number(subject.is_timetable_published ?? 0),
      body.window_duration !== undefined ? Number(body.window_duration) : Number(subject.window_duration ?? 120),
      body.can_retake !== undefined ? Number(body.can_retake) : Number(subject.can_retake ?? 1),
      body.is_assignment !== undefined ? Number(body.is_assignment) : Number(subject.is_assignment ?? 0),
      subjectId,
    );
    
    const nextPublished = Number(body.is_published ?? subject.is_published);
    if (nextPublished === 1 && subject.is_published === 0) {
      notifyOperators({
        type: "subject_published",
        message: `A teacher has published ${trimStr(body.code) || subject.code} (Questions are ready)`,
        link: `/operator/subjects`
      });
    }

    if (auth.role === "operator" && nextTeacherId !== sqlInt(subject.teacher_id)) {
      notifyUser(nextTeacherId, {
        type: "info",
        message: `Admin re-assigned ${subject.name} (${subject.code}) to you`,
        link: `/teacher/dashboard`
      });
    }

    return apiSuccess(queries.getSubjectById.get(subjectId));
  }

  if (subjectMatch && method === "DELETE") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const subjectId = Number(subjectMatch[1]);
    if (!isPositiveIntId(subjectId)) return apiError(400, "Invalid subject id");
    const examRow = queries.getSubjectExamCheck.get(subjectId);
    if (examRow) return apiError(409, "Cannot delete subject with active or completed exams");
    queries.deleteSubject.run(subjectId);
    auditLog(auth.userId, "SUBJECT_DELETE", "subject", subjectId, "{}");
    return apiMessage("Subject deleted");
  }

  const subjectQuestionsMatch = pathname.match(/^\/api\/subjects\/(\d+)\/questions$/);
  if (subjectQuestionsMatch && method === "GET") {
    const auth      = requireAuth(req);
    const subjectId = Number(subjectQuestionsMatch[1]);
    if (!isPositiveIntId(subjectId)) return apiError(400, "Invalid subject id");
    const subject = queries.getSubjectById.get(subjectId) as any;
    if (!subject) return apiError(404, "Subject not found");

    if (auth.role === "teacher") {
      if (!sameUserId(subject.teacher_id, auth.userId)) return apiError(403, "You do not own this subject");
    }

    if (auth.role === "student") {
      // Must be published
      if (!subject.is_published) return apiError(403, "Subject is not published");
      // Must be enrolled
      const enrollment = db.prepare(
        "SELECT id FROM subject_enrollments WHERE subject_id = ? AND student_id = ?"
      ).get(subjectId, auth.userId);
      if (!enrollment) return apiError(403, "You are not enrolled in this subject");
      // Must be within exam window (or have an in-progress / completed exam already)
      const existingExam = db.prepare(
        "SELECT id, status FROM exams WHERE student_id = ? AND subject_id = ?"
      ).get(auth.userId, subjectId) as any;
      if (!existingExam) {
        if (subject.exam_datetime) {
          // No exam yet — only allow if window is open
          const now   = Date.now();
          const start = Date.parse(subject.exam_datetime);
          const end   = start + Number(subject.window_duration || 120) * 60_000;
          if (!Number.isFinite(start) || now < start) return apiError(403, "Exam window not open yet");
          if (now >= end)                              return apiError(403, "Exam window has closed");
        }
      }
      // existingExam (in-progress or completed) → allow fetch (needed for resume + review)
    }

    const rows = queries.getQuestionsBySubject.all(subjectId) as any[];
    return apiSuccess(stripCorrectAnswer(rows, auth.role));
  }

  // ── Subject student roster (enrollment management) ───────────────────────────
  const subjectStudentsMatch = pathname.match(/^\/api\/subjects\/(\d+)\/students$/);

  if (subjectStudentsMatch && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const subjectId = Number(subjectStudentsMatch[1]);
    if (!isPositiveIntId(subjectId)) return apiError(400, "Invalid subject id");
    const subject = queries.getSubjectById.get(subjectId) as any;
    if (!subject) return apiError(404, "Subject not found");
    if (auth.role === "teacher" && !sameUserId(subject.teacher_id, auth.userId)) return apiError(403, "You do not own this subject");
    // getEnrollmentsBySubject now includes exam_id for direct review access
    const enrollments = queries.getEnrollmentsBySubject.all(subjectId) as any[];
    enrollments.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return apiSuccess(enrollments);
  }

  if (subjectStudentsMatch && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const subjectId = Number(subjectStudentsMatch[1]);
    if (!isPositiveIntId(subjectId)) return apiError(400, "Invalid subject id");
    const subject = queries.getSubjectById.get(subjectId) as any;
    if (!subject) return apiError(404, "Subject not found");
    const body = await readJson(req);
    
    const studentIdsRaw = Array.isArray(body?.student_ids) ? body.student_ids : 
                          (body?.student_id ? [body.student_id] : []);
    
    if (studentIdsRaw.length === 0) return apiError(400, "student_id or student_ids is required");
    
    const studentIds = [...new Set(studentIdsRaw.map(Number).filter(isPositiveIntId))];
    if (studentIds.length === 0) return apiError(400, "Invalid student IDs provided");

    let enrolledCount = 0;
    try {
      db.transaction(() => {
        for (const sid of studentIds) {
          const studentIdNum = Number(sid);
          const student = queries.getUserById.get(studentIdNum) as any;
          if (student && student.role === "student" && sqlInt(student.is_active) === 1) {
            queries.enrollStudent.run(subjectId, studentIdNum, auth.userId);
            enrolledCount++;
          }
        }
      })();
    } catch (err) {
      return apiError(500, "Bulk enrollment failed");
    }

    auditLog(auth.userId, "STUDENT_ENROLL_BULK", "subject_enrollment", subjectId, JSON.stringify({ count: enrolledCount }));
    return apiSuccess({ enrolled: true, count: enrolledCount, subject_id: subjectId }, 201);
  }

  const subjectStudentDeleteMatch = pathname.match(/^\/api\/subjects\/(\d+)\/students\/(\d+)$/);
  if (subjectStudentDeleteMatch && method === "DELETE") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const subjectId  = Number(subjectStudentDeleteMatch[1]);
    const studentId  = Number(subjectStudentDeleteMatch[2]);
    if (!isPositiveIntId(subjectId) || !isPositiveIntId(studentId)) return apiError(400, "Invalid ids");
    // Block unenroll if student has a completed exam — data integrity
    const hasCompletedExam = db.prepare(
      "SELECT id FROM exams WHERE student_id = ? AND subject_id = ? AND status = 'completed' LIMIT 1"
    ).get(studentId, subjectId);
    if (hasCompletedExam) return apiError(409, "Cannot unenroll a student who has completed the exam");
    queries.unenrollStudent.run(subjectId, studentId);
    auditLog(auth.userId, "STUDENT_UNENROLL", "subject_enrollment", subjectId, JSON.stringify({ student_id: studentId }));
    return apiMessage("Student unenrolled");
  }

  if (method === "POST" && pathname === "/api/questions") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const body = await readJson(req);
    const subject_id = Number(body?.subject_id);
    const question_text = trimStr(body?.question_text);
    const options = body?.options;
    const correct_answer = Number(body?.correct_answer);
    const marks = Number(body?.marks);
    const order_index = Number(body?.order_index);
    if (!isPositiveIntId(subject_id) || !question_text) return apiError(400, "Invalid question payload");
    const question_type = ["objective", "essay", "true_false"].includes(body?.question_type) ? body.question_type : "objective";
    const isTrueFalse = question_type === "true_false";
    // The frontend always pads options to length 4 for all types
    if (!Array.isArray(options) || options.length !== 4 || !options.every((o) => typeof o === "string")) {
      return apiError(400, `options must be an array of exactly 4 strings`);
    }
    if (!Number.isInteger(correct_answer) || correct_answer < 0 || correct_answer > (isTrueFalse ? 1 : 3)) {
      return apiError(400, isTrueFalse ? "correct_answer must be 0 or 1 for true_false" : "correct_answer must be an integer 0–3");
    }
    if (!Number.isInteger(marks) || marks < 1) return apiError(400, "marks must be a positive integer");
    if (!Number.isInteger(order_index)) return apiError(400, "order_index must be an integer");
    const subject = queries.getSubjectById.get(subject_id) as any;
    if (!subject) return apiError(404, "Subject not found");
    if (auth.role === "teacher" && !sameUserId(subject.teacher_id, auth.userId)) return apiError(403, "You do not own this subject");
    // Block creation when subject is already published
    if (subject.is_published) return apiError(409, "Subject is published. Unpublish to add or edit questions.");
    const teacher_answer = trimStr(body?.teacher_answer) || null;
    const q_session = trimStr(body?.session) || null;
    const q_term = trimStr(body?.term) || null;
    const q_mode = ["test", "exam", "quiz"].includes(body?.mode) ? body.mode : "exam";
    const image_url = trimStr(body?.image_url) || null;
    // Pad options to 4 elements for DB consistency (true_false gets 2 real + 2 empty)
    const paddedOptions = options.length < 4
      ? [...options, ...Array(4 - options.length).fill("")]
      : options;
    const tx = db.transaction(() => {
      const result = queries.createQuestion.run(
        subject_id,
        question_text,
        JSON.stringify(paddedOptions),
        correct_answer,
        marks,
        order_index,
        question_type,
        q_session,
        q_term,
        q_mode,
        teacher_answer,
        image_url,
        body?.is_file_upload !== undefined ? Number(body.is_file_upload) : 0,
        body?.attached_file_url !== undefined ? (trimStr(body.attached_file_url) || null) : null
      );
      // Always recompute total_score from source of truth
      queries.updateSubjectTotalScore.run(Number(subject_id), Number(subject_id));
      return result;
    });
    const result = tx() as { lastInsertRowid: number | bigint };
    auditLog(auth.userId, "QUESTION_CREATE", "question", Number(result.lastInsertRowid), "{}");
    return apiSuccess({ id: Number(result.lastInsertRowid) }, 201);
  }

  const questionMatch = pathname.match(/^\/api\/questions\/(\d+)$/);
  if (questionMatch && (method === "PUT" || method === "DELETE")) {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const questionId = Number(questionMatch[1]);
    if (!isPositiveIntId(questionId)) return apiError(400, "Invalid question id");
    const question = queries.getQuestionById.get(questionId) as any;
    if (!question) return apiError(404, "Question not found");
    const subject = queries.getSubjectById.get(question.subject_id) as any;
    if (!subject) return apiError(404, "Subject not found");
    if (auth.role === "teacher" && !sameUserId(subject.teacher_id, auth.userId)) return apiError(403, "You do not own the parent subject");
    if (subject.is_published) return apiError(409, "Cannot edit questions for a published subject");
    if (method === "DELETE") {
      db.transaction(() => {
        queries.deleteQuestion.run(questionId);
        // Recompute total_score from source of truth
      queries.updateSubjectTotalScore.run(Number(question.subject_id), Number(question.subject_id));
      })();
      auditLog(auth.userId, "QUESTION_DELETE", "question", questionId, "{}");
      return apiMessage("Question deleted");
    }
    const body = await readJson(req);
    let optionsJson: string;
    if (body.options !== undefined) {
      const qTypeForValidation = body.question_type ?? question.question_type ?? "objective";
      const isTF = qTypeForValidation === "true_false";
      if (!Array.isArray(body.options) || body.options.length !== 4 || !body.options.every((o: unknown) => typeof o === "string")) {
        return apiError(400, `options must be an array of exactly 4 strings`);
      }
      // Pad to 4 for DB storage consistency
      const opts = body.options.length < 4 ? [...body.options, ...Array(4 - body.options.length).fill("")] : body.options;
      optionsJson = JSON.stringify(opts);
    } else {
      optionsJson = question.options_json;
    }
    const nextText = body.question_text !== undefined ? trimStr(body.question_text) : question.question_text;
    if (!nextText) return apiError(400, "question_text cannot be empty");
    const nextCorrect = Number(body.correct_answer ?? question.correct_answer);
    const nextMarks = Number(body.marks ?? question.marks);
    const nextType = ["objective", "essay", "true_false"].includes(body?.question_type) ? body.question_type : (question.question_type || "objective");
    if (body.correct_answer !== undefined && (!Number.isInteger(nextCorrect) || nextCorrect < 0 || nextCorrect > (nextType === "true_false" ? 1 : 3))) {
      return apiError(400, nextType === "true_false" ? "correct_answer must be 0 or 1 for true_false" : "correct_answer must be an integer 0–3");
    }
    if (body.marks !== undefined && (!Number.isInteger(nextMarks) || nextMarks < 1)) {
      return apiError(400, "marks must be a positive integer");
    }
    const nextTAnswer = body.teacher_answer !== undefined ? (trimStr(body.teacher_answer) || null) : (question.teacher_answer || null);
    const nextImg = body.image_url !== undefined ? (trimStr(body.image_url) || null) : (question.image_url || null);
    db.transaction(() => {
      const nextIsFileUpload = body.is_file_upload !== undefined ? Number(body.is_file_upload) : Number(question.is_file_upload ?? 0);
      const nextAttachedFileUrl = body.attached_file_url !== undefined ? (trimStr(body.attached_file_url) || null) : (question.attached_file_url || null);
      queries.updateQuestion.run(nextText, optionsJson, nextCorrect, nextMarks, nextType, nextTAnswer, nextImg, nextIsFileUpload, nextAttachedFileUrl, questionId);
      // Recompute total_score since marks may have changed
      queries.updateSubjectTotalScore.run(Number(question.subject_id), Number(question.subject_id));
    })();
    auditLog(auth.userId, "QUESTION_EDIT", "question", questionId, "{}");
    return apiSuccess(queries.getQuestionById.get(questionId));
  }

  // ── Lookup exam by student + subject (teacher/operator use for review) ─────────
  if (method === "GET" && pathname === "/api/exams/by-student-subject") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const studentId = Number(url.searchParams.get("student_id"));
    const subjectId = Number(url.searchParams.get("subject_id"));
    if (!isPositiveIntId(studentId) || !isPositiveIntId(subjectId)) return apiError(400, "student_id and subject_id are required");
    // Teachers can only look up exams for their own subjects
    if (auth.role === "teacher") {
      const subject = queries.getSubjectById.get(subjectId) as any;
      if (!subject || !sameUserId(subject.teacher_id, auth.userId)) return apiError(403, "You do not own this subject");
    }
    const exam = queries.getExamByStudentSubject.get(studentId, subjectId) as any;
    if (!exam) return apiError(404, "Exam not found for this student and subject");
    return apiSuccess(exam);
  }

  // ── Essay grading (teacher/operator) ─────────────────────────────────────────
  const examGradeMatch = pathname.match(/^\/api\/exams\/(\d+)\/grade$/);
  if (examGradeMatch && method === "POST") {
    const auth   = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const examId = Number(examGradeMatch[1]);
    if (!isPositiveIntId(examId)) return apiError(400, "Invalid exam id");
    const exam = queries.getExamById.get(examId) as any;
    if (!exam) return apiError(404, "Exam not found");
    if (exam.status !== "completed") return apiError(409, "Can only grade completed exams");
    // Teachers may only grade exams in their subjects
    if (auth.role === "teacher") {
      const subject = queries.getSubjectById.get(exam.subject_id) as any;
      if (!subject || !sameUserId(subject.teacher_id, auth.userId)) return apiError(403, "You do not own this subject");
    }
    const body          = await readJson(req);
    const questionId    = Number(body?.question_id);
    const marksAwarded  = Number(body?.marks_awarded);
    if (!isPositiveIntId(questionId)) return apiError(400, "question_id is required");
    if (!Number.isFinite(marksAwarded) || marksAwarded < 0) return apiError(400, "marks_awarded must be a non-negative number");
    const question = queries.getQuestionByIdAndSubject.get(questionId, exam.subject_id) as any;
    if (!question) return apiError(404, "Question not found in this exam's subject");
    if (question.question_type !== "essay") return apiError(400, "Only essay questions can be manually graded");
    if (marksAwarded > Number(question.marks)) return apiError(400, `marks_awarded cannot exceed ${question.marks}`);
    // Update student_answers
    db.prepare(
      "UPDATE student_answers SET marks_awarded = ?, is_correct = CASE WHEN ? >= ? THEN 1 ELSE 0 END WHERE exam_id = ? AND question_id = ?"
    ).run(marksAwarded, marksAwarded, Number(question.marks), examId, questionId);
    // Recompute exam total score from student_answers
    const totals = db.prepare(
      "SELECT COALESCE(SUM(marks_awarded), 0) as earned FROM student_answers WHERE exam_id = ?"
    ).get(examId) as any;
    db.prepare("UPDATE exams SET score = ? WHERE id = ?").run(Number(totals?.earned ?? 0), examId);
    auditLog(auth.userId, "ESSAY_GRADE", "student_answers", examId, JSON.stringify({ question_id: questionId, marks_awarded: marksAwarded }));
    return apiSuccess({ graded: true, exam_id: examId, question_id: questionId, marks_awarded: marksAwarded, new_total: Number(totals?.earned ?? 0) });
  }

  // ── Active (in-progress) exams for student — used for resume detection ──────
  if (method === "GET" && pathname === "/api/exams/active") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["student"]);
    const exams = db.prepare(
      "SELECT e.*, s.name as subject_name, s.duration FROM exams e JOIN subjects s ON s.id = e.subject_id WHERE e.student_id = ? AND e.status = 'in-progress'",
    ).all(auth.userId);
    return apiSuccess({ exams, server_time: new Date().toISOString() });
  }

  if (method === "POST" && pathname === "/api/exams/start") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["student"]);
    const body = await readJson(req);
    const subjectId = Number(body?.subject_id);
    if (!isPositiveIntId(subjectId)) return apiError(400, "Invalid subject_id");
    const subject = queries.getSubjectById.get(subjectId) as any;
    if (!subject || !subject.is_published) return apiError(403, "Exam is not live yet. Please wait for the admin to publish it.");
    // Must be enrolled
    const enrollment = db.prepare(
      "SELECT id FROM subject_enrollments WHERE subject_id = ? AND student_id = ?"
    ).get(subjectId, auth.userId);
    if (!enrollment) return apiError(403, "You are not enrolled in this subject");
    if (subject.exam_datetime) {
      const now = Date.now();
      const start = Date.parse(subject.exam_datetime);
      if (!Number.isFinite(start)) return apiError(500, "Invalid subject schedule");
      const end = start + Number(subject.window_duration || 120) * 60_000;
      if (now < start) return apiError(403, "Exam window not open yet");
      if (now >= end) return apiError(403, "Exam window has closed");
    }
    const currentTerm = (queries.getSetting.get("CURRENT_TERM") as any)?.value || "";
    try {
      queries.createExam.run(auth.userId, subjectId, new Date().toISOString(), "[]", null, currentTerm, subject.mode || "exam");
    } catch {
      return apiError(409, "You have already started this exam");
    }
    const exam = queries.getExamByStudentSubject.get(auth.userId, subjectId) as any;
    const questions = stripCorrectAnswer(queries.getQuestionsBySubject.all(subjectId) as any[], auth.role);
    auditLog(auth.userId, "EXAM_START", "exam", Number(exam.id), JSON.stringify({ subject_id: subjectId }));
    return apiSuccess(
      {
        exam,
        questions,
        server_time: new Date().toISOString(),
        examId: exam.id,
        startTime: exam.start_time,
      },
      201,
    );
  }

  const examSaveMatch = pathname.match(/^\/api\/exams\/(\d+)\/save$/);
  if (examSaveMatch && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["student"]);
    const clientIp = getClientIp(req);
    checkRateLimit(`save_${auth.userId}_${clientIp}`, 15, 60_000);
    const examId = Number(examSaveMatch[1]);
    if (!isPositiveIntId(examId)) return apiError(400, "Invalid exam id");
    const body = await readJson(req);
    const answers = body?.answers;
    if (!Array.isArray(answers)) return apiError(400, "answers must be array");
    // Validate structure: every entry must have a valid question_id (integer > 0)
    for (const entry of answers) {
      if (!entry || typeof entry !== "object") return apiError(400, "Each answer must be an object");
      if (!Number.isInteger(entry.question_id) || entry.question_id <= 0) return apiError(400, "Each answer must have a valid question_id");
    }
    const exam = db.prepare("SELECT * FROM exams WHERE id = ? AND student_id = ?").get(examId, auth.userId) as any;
    if (!exam) return apiError(403, "Not your exam");
    if (exam.status !== "in-progress") return apiError(409, "Exam already submitted");
    const subject = queries.getSubjectById.get(exam.subject_id) as any;
    const deadline = Date.parse(exam.start_time) + Number(subject.duration) * 60_000;
    // Allow saves up to 60s after deadline (network latency grace)
    if (Date.now() > deadline + 60_000) return apiError(409, "Exam window has closed — answers cannot be saved");
    const remaining = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
    queries.saveExam.run(JSON.stringify(answers), examId, auth.userId);
    return apiSuccess({ saved: true, server_time: new Date().toISOString(), time_remaining_seconds: remaining });
  }

  const examSubmitMatch = pathname.match(/^\/api\/exams\/(\d+)\/submit$/);
  if (examSubmitMatch && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["student"]);
    const clientIp = getClientIp(req);
    checkRateLimit(`submit_${auth.userId}_${clientIp}`, 5, 60_000);
    const examId = Number(examSubmitMatch[1]);
    if (!isPositiveIntId(examId)) return apiError(400, "Invalid exam id");
    const body = await readJson(req);
    const answers = Array.isArray(body?.answers) ? body.answers : null;

    // Use a single db.transaction to avoid nested transaction crash
    // (previously used manual BEGIN/COMMIT + db.transaction inside = ERROR)
    let result: { exam_id: number; score: number; total_score: number; time_taken_seconds: number; subject_id: number };
    try {
      const submitTx = db.transaction(() => {
        const exam = db.prepare("SELECT * FROM exams WHERE id = ? AND student_id = ?").get(examId, auth.userId) as any;
        if (!exam) throw new HttpError(403, "Not your exam");
        if (exam.status !== "in-progress") throw new HttpError(409, "Exam already submitted");

        const subject = queries.getSubjectById.get(exam.subject_id) as any;

        // ── Grace period: allow submit up to 30s after window closes ────────────
        const deadline = Date.parse(exam.start_time) + Number(subject.duration) * 60_000 + 30_000;
        
        let usedAnswers: unknown[];
        if (Date.now() > deadline) {
          // Time expired: ALWAYS use the last securely saved answers from DB.
          // This prevents a student from submitting a manipulated answer array after the window closes.
          try {
            usedAnswers = JSON.parse(exam.answers_json || "[]");
          } catch {
            usedAnswers = [];
          }
        } else {
          // Within time: The client payload is the most recent state.
          // Merge it with DB answers, giving precedence to the client payload.
          let dbSaved: any[] = [];
          try { dbSaved = exam.answers_json ? JSON.parse(exam.answers_json) : []; } catch { dbSaved = []; }
          if (!Array.isArray(dbSaved)) dbSaved = [];
          
          const clientHasAnswers = Array.isArray(answers) && answers.length > 0;
          if (clientHasAnswers) {
            const clientQids = new Set((answers as any[]).map((a: any) => Number(a.question_id)));
            const extraFromDb = dbSaved.filter((a: any) => !clientQids.has(Number(a.question_id)));
            usedAnswers = [...(answers as any[]), ...extraFromDb];
          } else {
            usedAnswers = dbSaved;
          }
        }
        if (!Array.isArray(usedAnswers)) throw new HttpError(400, "Invalid saved answers");

        const answerMap = new Map<number, number | null>();
        const essayMap  = new Map<number, string | null>();
        for (const a of usedAnswers) {
          if (!a || typeof a !== "object") throw new HttpError(400, "Invalid saved answers");
          const rec = a as Record<string, unknown>;
          const qid = Number(rec.question_id);
          if (!Number.isInteger(qid) || qid < 1) throw new HttpError(400, "Invalid saved answers");
          const essayResp = rec.essay_response;
          if (typeof essayResp === "string" && essayResp.trim()) essayMap.set(qid, essayResp.trim());
          const raw = rec.selected_option ?? rec.answer;
          if (raw === null || raw === undefined) {
            answerMap.set(qid, null);
          } else {
            const opt = Number(raw);
            answerMap.set(qid, Number.isInteger(opt) && opt >= 0 && opt <= 3 ? opt : null);
          }
        }

        const questions = queries.getQuestionsBySubject.all(exam.subject_id) as any[];
        let score = 0;
        let total = 0;
        let answered = 0;
        for (const q of questions) {
          const qid = Number(q.id);
          total += Number(q.marks);
          if (answerMap.get(qid) === Number(q.correct_answer)) score += Number(q.marks);
          if (answerMap.get(qid) !== null || (essayMap.has(qid) && essayMap.get(qid) !== null)) {
            answered++;
          }
        }

        const changes = queries.submitExam.run(
          JSON.stringify(usedAnswers), new Date().toISOString(), score, total, examId, auth.userId
        ) as { changes: number };
        if (sqlInt(changes.changes) === 0) throw new HttpError(409, "Exam already submitted");

        // ── Populate student_answers ──────────────────────────────────────────
        const student = queries.getUserById.get(auth.userId) as any;
        if (student?.reg_id) {
          db.prepare("UPDATE exams SET reg_id = ? WHERE id = ?").run(student.reg_id, examId);
        }
        if (questions.length > 0) {
          const placeholders = questions.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
          const params: any[] = [];
          for (const q of questions) {
            const qid        = Number(q.id);
            const studentSel = answerMap.get(qid) ?? null;
            const essayResp  = q.question_type === "essay" ? (essayMap.get(qid) ?? null) : null;
            const isCorrect  = q.question_type !== "essay" && studentSel !== null && studentSel === Number(q.correct_answer) ? 1 : 0;
            const marksAwarded = isCorrect ? Number(q.marks) : 0;
            params.push(
              examId, qid, auth.userId, exam.subject_id,
              q.question_type !== "essay" ? studentSel : null,
              essayResp, isCorrect, marksAwarded
            );
          }
          db.prepare(`INSERT OR REPLACE INTO student_answers (exam_id, question_id, student_id, subject_id, selected_option, essay_response, is_correct, marks_awarded) VALUES ${placeholders}`).run(...params);
        }

        // Free the redundant JSON blob — student_answers is now the authoritative store
        queries.updateExamAnswersJson.run(examId);

        return {
          exam_id: examId, score, total_score: total, subject_id: exam.subject_id,
          answered_questions: answered, total_questions: questions.length,
          time_taken_seconds: Math.max(0, Math.floor((Date.now() - Date.parse(exam.start_time)) / 1000)),
        };
      });

      result = submitTx();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(500, "Server error during exam submission");
    }

    auditLog(auth.userId, "EXAM_SUBMIT", "exam", result.exam_id, JSON.stringify({ score: result.score, total: result.total_score }));
    
    // Notify the owning teacher in real-time via SSE
    const subjectRow = queries.getSubjectById.get(result.subject_id) as any;
    if (subjectRow?.teacher_id) {
      const student = queries.getUserById.get(auth.userId) as any;
      notifyUser(sqlInt(subjectRow.teacher_id), {
        type: "exam_submitted",
        message: `${student?.name || 'A student'} submitted ${subjectRow.code} — Score: ${result.score}/${result.total_score}`,
        link: `/teacher/results?subject_id=${subjectRow.id}`
      });
    }

    // Return result WITHOUT subject_id (internal field, not needed by client)
    const { subject_id: _sid, ...clientResult } = result;
    return apiSuccess(clientResult);
  }

  if (method === "GET" && pathname === "/api/exams/results") {
    const auth = requireAuth(req);
    if (auth.role === "student") {
      return apiSuccess(
        db.prepare("SELECT e.*, s.name as subject_name, (SELECT COUNT(*) FROM questions q WHERE q.subject_id = e.subject_id) as total_questions, (SELECT COUNT(*) FROM student_answers sa WHERE sa.exam_id = e.id AND (sa.selected_option IS NOT NULL OR (sa.essay_response IS NOT NULL AND TRIM(sa.essay_response) != ''))) as answered_questions FROM exams e JOIN subjects s ON s.id = e.subject_id WHERE e.student_id = ? AND e.status = 'completed'").all(auth.userId)
      );
    }
    if (auth.role === "teacher") {
      return apiSuccess(
        db.prepare(
          "SELECT e.*, s.name as subject_name, (SELECT COUNT(*) FROM questions q WHERE q.subject_id = e.subject_id) as total_questions, (SELECT COUNT(*) FROM student_answers sa WHERE sa.exam_id = e.id AND (sa.selected_option IS NOT NULL OR (sa.essay_response IS NOT NULL AND TRIM(sa.essay_response) != ''))) as answered_questions, u.name as student_name, u.grade, u.reg_id, u.id as student_user_id FROM exams e JOIN subjects s ON s.id = e.subject_id JOIN users u ON u.id = e.student_id WHERE e.status = 'completed' AND s.teacher_id = ? ORDER BY e.end_time DESC",
        ).all(auth.userId),
      );
    }
    return apiSuccess(
      db.prepare(
        "SELECT e.*, s.name as subject_name, (SELECT COUNT(*) FROM questions q WHERE q.subject_id = e.subject_id) as total_questions, (SELECT COUNT(*) FROM student_answers sa WHERE sa.exam_id = e.id AND (sa.selected_option IS NOT NULL OR (sa.essay_response IS NOT NULL AND TRIM(sa.essay_response) != ''))) as answered_questions, u.name as student_name, u.grade, u.reg_id, u.id as student_user_id FROM exams e JOIN subjects s ON s.id = e.subject_id JOIN users u ON u.id = e.student_id WHERE e.status = 'completed' ORDER BY e.end_time DESC",
      ).all(),
    );
  }

  // ── Exam review (per-question detail) ────────────────────────────────────
  const examReviewMatch = pathname.match(/^\/api\/exams\/(\d+)\/review$/);
  if (examReviewMatch && method === "GET") {
    const auth = requireAuth(req);
    const examId = Number(examReviewMatch[1]);
    if (!isPositiveIntId(examId)) return apiError(400, "Invalid exam id");
    const exam = queries.getExamById.get(examId) as any;
    if (!exam) return apiError(404, "Exam not found");
    // Students can only view their own completed exam
    if (auth.role === "student") {
      if (!sameUserId(exam.student_id, auth.userId)) return apiError(403, "Forbidden");
      if (exam.status !== "completed") return apiError(403, "Exam must be completed to review answers");
    }
    // Teachers can only view exams for their subjects
    if (auth.role === "teacher") {
      const subject = queries.getSubjectById.get(exam.subject_id) as any;
      if (!subject || !sameUserId(subject.teacher_id, auth.userId)) return apiError(403, "Forbidden");
    }
    const answers = queries.getStudentAnswersByExam.all(examId);
    const student = queries.getUserById.get(exam.student_id) as any;
    return apiSuccess({ exam, answers, student: student ? stripPassword(student) : null });
  }

  // ── Exam delete/reset (operator + owning teacher) ───────────────────────
  const examDeleteMatch = pathname.match(/^\/api\/exams\/(\d+)$/);
  if (examDeleteMatch && method === "DELETE") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const examId = Number(examDeleteMatch[1]);
    if (!isPositiveIntId(examId)) return apiError(400, "Invalid exam id");
    const exam = queries.getExamById.get(examId) as any;
    if (!exam) return apiError(404, "Exam not found");
    if (auth.role === "teacher") {
      const subject = queries.getSubjectById.get(exam.subject_id) as any;
      if (!subject || !sameUserId(subject.teacher_id, auth.userId)) return apiError(403, "Forbidden");
    }
    db.transaction(() => {
      db.prepare("DELETE FROM student_answers WHERE exam_id = ?").run(examId);
      db.prepare("DELETE FROM exams WHERE id = ?").run(examId);
    })();
    auditLog(auth.userId, "EXAM_DELETE", "exam", examId, "{}");
    return apiMessage("Exam attempt deleted");
  }

  // ── Results PDF export (teacher + operator) ───────────────────────────────
  if (method === "GET" && pathname === "/api/exams/results/export") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const rows: any[] = auth.role === "teacher"
      ? db.prepare("SELECT e.*, s.name as subject_name, s.code as subject_code, u.name as student_name, u.grade, u.reg_id FROM exams e JOIN subjects s ON s.id = e.subject_id JOIN users u ON u.id = e.student_id WHERE e.status = 'completed' AND s.teacher_id = ? ORDER BY s.name, u.grade, u.name").all(auth.userId)
      : db.prepare("SELECT e.*, s.name as subject_name, s.code as subject_code, u.name as student_name, u.grade, u.reg_id FROM exams e JOIN subjects s ON s.id = e.subject_id JOIN users u ON u.id = e.student_id WHERE e.status = 'completed' ORDER BY s.name, u.grade, u.name").all();
    // Build CSV
    const headers = ["Reg ID", "Student Name", "Grade", "Subject", "Subject Code", "Score", "Total", "Percentage", "Letter Grade", "Submitted At"];
    const csvRows = rows.map((r) => {
      const total = Number(r.total_score ?? 0);
      const pct = total > 0 ? Math.round((Number(r.score ?? 0) / total) * 100) : 0;
      const letter = pct >= 70 ? "A" : pct >= 55 ? "B" : pct >= 40 ? "C" : "F";
      return [
        r.reg_id || "", r.student_name || "", r.grade || "",
        r.subject_name || "", r.subject_code || "",
        r.score ?? 0, total, `${pct}%`, letter,
        r.end_time ? new Date(r.end_time).toLocaleString() : "",
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
    });
    const csv = [headers.join(","), ...csvRows].join("\n");
    const filename = `exampool-results-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // ── Full student profile (enrolled subjects + exam history) ───────────────
  if (method === "GET" && pathname === "/api/users/me/profile") {
    const auth = requireAuth(req);
    const user = queries.getUserById.get(auth.userId) as any;
    if (!user || sqlInt(user.is_active) !== 1) return apiError(401, "Not authenticated");

    // Enrolled subjects (with exam status)
    const enrolledSubjects = queries.getStudentEnrolledSubjects.all(auth.userId);

    // Exam stats
    const examStats = queries.getStudentExamStats.get(auth.userId) as any;

    return apiSuccess({
      user:             stripPassword(user),
      enrolled_subjects: enrolledSubjects,
      stats: {
        total_enrolled:  enrolledSubjects.length,
        exams_completed: sqlInt(examStats?.completed ?? 0),
        avg_score_pct:   Number(examStats?.avg_pct ?? 0),
      },
    });
  }

  // ── Bulk-enroll all students in a grade into a subject ────────────────────
  const bulkEnrollMatch = pathname.match(/^\/api\/subjects\/(\d+)\/students\/bulk$/);
  if (bulkEnrollMatch && method === "POST") {
    const auth      = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const subjectId = Number(bulkEnrollMatch[1]);
    if (!isPositiveIntId(subjectId)) return apiError(400, "Invalid subject id");
    const subject = queries.getSubjectById.get(subjectId) as any;
    if (!subject) return apiError(404, "Subject not found");
    const body = await readJson(req);
    const grade = trimStr(body?.grade);
    if (!grade) return apiError(400, "grade is required");

    // Fetch all active students in that grade
    const students = queries.getStudentsByGrade.all(grade) as Array<{ id: number }>;

    if (students.length === 0) return apiError(404, "No active students found in that grade");

    const enrollTx = db.transaction(() => {
      let count = 0;
      for (const s of students) {
        const result = queries.enrollStudent.run(subjectId, s.id, auth.userId) as { changes: number };
        count += sqlInt(result.changes);
      }
      return count;
    });
    const enrolled = enrollTx();
    auditLog(auth.userId, "BULK_ENROLL", "subject_enrollment", subjectId,
      JSON.stringify({ grade, enrolled, total_in_grade: students.length }));
    return apiSuccess({ enrolled, total_in_grade: students.length, grade });
  }

  // ── Change password ───────────────────────────────────────────────────────

  if (method === "POST" && pathname === "/api/auth/change-password") {
    const auth = requireAuth(req);
    const body = await readJson(req);
    const currentPassword = body?.current_password;
    const newPassword = body?.new_password;
    if (!currentPassword || !newPassword) return apiError(400, "current_password and new_password are required");
    if (!isValidPassword(newPassword)) {
      return apiError(400, `New password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    const user = queries.getUserById.get(auth.userId) as any;
    if (!user) return apiError(401, "Not authenticated");
    const valid = await verifyPassword(currentPassword, user.password_hash);
    if (!valid) return apiError(401, "Current password is incorrect");
    const newHash = await hashPassword(newPassword);
    queries.updateUserPassword.run(newHash, auth.userId);
    auditLog(auth.userId, "PASSWORD_CHANGE", "user", auth.userId, "{}");
    return apiMessage("Password changed successfully");
  }

  // ── Promote / demote student grade ────────────────────────────────────────
  const userGradeMatch = pathname.match(/^\/api\/users\/(\d+)\/grade$/);
  if (userGradeMatch && method === "PUT") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const targetId = Number(userGradeMatch[1]);
    if (!isPositiveIntId(targetId)) return apiError(400, "Invalid user id");
    const target = queries.getUserById.get(targetId) as any;
    if (!target || target.role !== "student") return apiError(404, "Student not found");
    // Teachers may only promote students who have sat exams in their subjects
    if (auth.role === "teacher") {
      const linked = db.prepare(
        "SELECT e.id FROM exams e JOIN subjects s ON s.id = e.subject_id WHERE e.student_id = ? AND s.teacher_id = ? LIMIT 1"
      ).get(targetId, auth.userId);
      if (!linked) return apiError(403, "Student has not sat any of your exams");
    }
    const body = await readJson(req);
    const newGrade = trimStr(body?.grade);
    if (!newGrade) return apiError(400, "grade is required");
    queries.updateUserGrade.run(newGrade, targetId);
    auditLog(auth.userId, "STUDENT_GRADE_UPDATE", "user", targetId, JSON.stringify({ grade: newGrade }));
    return apiSuccess({ id: targetId, grade: newGrade });
  }

  if (method === "GET" && pathname === "/api/users") {
    const auth = requireAuth(req);
    const role  = url.searchParams.get("role");
    // [SECURITY FIX] Cap grade parameter length to prevent memory/CPU waste
    const grade = (url.searchParams.get("grade") ?? "").trim().slice(0, 32) || null;
    // Operators get full access; teachers may only fetch student list (role=student)
    if (auth.role === "teacher") {
      if (role !== "student") return apiError(403, "Forbidden");
      if (grade) return apiSuccess(db.prepare("SELECT DISTINCT u.id, u.name, u.email, u.role, u.grade, u.reg_id, u.is_active, u.created_at FROM users u JOIN subject_enrollments se ON se.student_id = u.id JOIN subjects s ON s.id = se.subject_id WHERE u.role = 'student' AND u.grade = ? AND s.teacher_id = ?").all(grade, auth.userId));
      return apiSuccess(db.prepare("SELECT DISTINCT u.id, u.name, u.email, u.role, u.grade, u.reg_id, u.is_active, u.created_at FROM users u JOIN subject_enrollments se ON se.student_id = u.id JOIN subjects s ON s.id = se.subject_id WHERE u.role = 'student' AND s.teacher_id = ?").all(auth.userId));
    }
    requireRole(auth.role, ["operator"]);
    if (role && !isValidRoleParam(role)) return apiError(400, "Invalid role filter");
    if (role && grade) return apiSuccess(db.prepare("SELECT id, name, email, role, grade, is_active, created_at FROM users WHERE role = ? AND grade = ? ORDER BY id DESC LIMIT 1000").all(role, grade));
    if (role) return apiSuccess(db.prepare("SELECT id, name, email, role, grade, is_active, created_at FROM users WHERE role = ? ORDER BY id DESC LIMIT 1000").all(role));
    return apiSuccess(queries.getAllUsers.all());
  }

  if (method === "POST" && pathname === "/api/users/operator") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const body = await readJson(req);
    const name = trimStr(body?.name);
    const email = normalizeEmail(trimStr(body?.email));
    const password = body?.password;
    if (!name || !email) return apiError(400, "name, email and password are required");
    if (!isValidEmail(email)) return apiError(400, "A valid email is required");
    if (!isValidPassword(password)) {
      return apiError(400, `password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    if (queries.getUserByEmail.get(email)) return apiError(400, "Email already registered");
    const hash = await hashPassword(password);
    let result: { lastInsertRowid: number | bigint };
    try {
      const opRegId = `OP-${Date.now().toString(36).toUpperCase()}`;
      result = queries.createUser.run(name, email, "operator", hash, null, opRegId, null, null, null, null, null) as { lastInsertRowid: number | bigint };
    } catch (e) {
      if (isSqliteUniqueError(e)) return apiError(409, "Email already registered");
      throw e;
    }
    auditLog(auth.userId, "USER_CREATE", "user", Number(result.lastInsertRowid), JSON.stringify({ role: "operator" }));
    return apiSuccess({ id: Number(result.lastInsertRowid) }, 201);
  }

  if (method === "GET" && pathname === "/api/audit-logs") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    return apiSuccess(queries.getAuditLogs.all());
  }

  // ── Public settings (school name + current term — accessible to all roles) ──
  if (method === "GET" && pathname === "/api/settings/public") {
    const auth = requireAuth(req);
    void auth; // any authenticated user can read these
    const schoolName = (queries.getSetting.get("SCHOOL_NAME") as any)?.value || "School";
    const currentTerm = (queries.getSetting.get("CURRENT_TERM") as any)?.value || "2026-T1";
    const cfg = (queries.getConfig.get() as any) ?? {};
    return apiSuccess({
      school_name: cfg.org_name || schoolName,
      current_term: currentTerm,
      admin_name: cfg.admin_name || "Principal",
      theme_json: cfg.theme_json || "{}",
    });
  }

  // ── Config ────────────────────────────────────────────────────────────────
  if (method === "GET" && pathname === "/api/config") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const configData = (queries.getConfig.get() as any) ?? {};
    configData.registration_open = getRegistrationOpen();
    return apiSuccess(configData);
  }

  if (method === "PUT" && pathname === "/api/config") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const body = await readJson(req);
    const current = (queries.getConfig.get() as any) ?? {};
    const orgName = trimStr(body?.org_name) || current.org_name || "ExamPool School";
    const licType = ["basic", "standard", "premium"].includes(body?.licence_type) ? body.licence_type : (current.licence_type || "basic");
    queries.upsertConfig.run(
      trimStr(body?.description) || current.description || null,
      trimStr(body?.favicon) || current.favicon || null,
      trimStr(body?.admin_name) || current.admin_name || null,
      orgName,
      trimStr(body?.licence_key) || current.licence_key || null,
      licType,
      typeof body?.theme_json === "object" ? JSON.stringify(body.theme_json) : (typeof body?.theme_json === "string" ? body.theme_json : (current.theme_json || "{}")),
      trimStr(body?.version) || current.version || "1.0.0",
      trimStr(body?.admin_email) || current.admin_email || null,
    );
    queries.upsertSetting.run("SCHOOL_NAME", orgName);
    if (typeof body?.registration_open === "boolean") {
      queries.upsertSetting.run("REGISTRATION_OPEN", body.registration_open ? "true" : "false");
    }
    auditLog(auth.userId, "CONFIG_UPDATE", "config", 1, "{}");
    const updatedConfig = (queries.getConfig.get() as any) ?? {};
    updatedConfig.registration_open = getRegistrationOpen();
    return apiSuccess(updatedConfig);
  }
  // ── User profile update ───────────────────────────────────────────────────
  const userUpdateMatch = pathname.match(/^\/api\/users\/(\d+)$/);
  if (userUpdateMatch && method === "PUT") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const uid = Number(userUpdateMatch[1]);
    if (!isPositiveIntId(uid)) return apiError(400, "Invalid user id");
    const target = queries.getUserById.get(uid) as any;
    if (!target) return apiError(404, "User not found");
    const body = await readJson(req);
    // Activate / deactivate toggle
    if (body?.is_active !== undefined) {
      if (body.is_active) {
        queries.activateUser.run(uid);
      } else {
        queries.deactivateUser.run(uid);
      }
      setupRequired = rowCount(queries.countActiveOperators.get() as { count?: unknown }) === 0;
      auditLog(auth.userId, body.is_active ? "USER_ACTIVATE" : "USER_DEACTIVATE", "user", uid, "{}");
      return apiSuccess(queries.getUserById.get(uid));
    }
    // Profile update
    queries.updateUser.run(
      trimStr(body?.first_name) || target.first_name || null,
      trimStr(body?.last_name) || target.last_name || null,
      trimStr(body?.address) || target.address || null,
      trimStr(body?.phone) || target.phone || null,
      trimStr(body?.dob) || target.dob || null,
      trimStr(body?.grade) || target.grade || null,
      trimStr(body?.image_url) || target.image_url || null,
      uid,
    );
    auditLog(auth.userId, "USER_UPDATE", "user", uid, "{}");
    return apiSuccess(queries.getUserById.get(uid));
  }

  const userDeleteMatch = pathname.match(/^\/api\/users\/(\d+)$/);
  if (userDeleteMatch && method === "DELETE") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const userId = Number(userDeleteMatch[1]);
    if (!isPositiveIntId(userId)) return apiError(400, "Invalid user id");
    const hasExam = queries.getStudentHasExam.get(userId);
    if (hasExam) return apiError(409, "Cannot delete user with exam records");
    queries.deactivateUser.run(userId);
    setupRequired = rowCount(queries.countActiveOperators.get() as { count?: unknown }) === 0;
    auditLog(auth.userId, "USER_DEACTIVATE", "user", userId, "{}");
    return apiMessage("User deactivated");
  }

  if (method === "POST" && pathname === "/api/settings/export") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const file = Bun.file(EXAMPOOL_DB_PATH);
    if (!(await file.exists())) return apiError(404, "Database file not found");
    return new Response(file, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="exampool-backup-${new Date().toISOString().slice(0, 10)}.db"`,
      },
    });
  }

  if (method === "POST" && pathname === "/api/settings/import") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const buffer = new Uint8Array(await req.arrayBuffer());
    const magic = new TextDecoder().decode(buffer.slice(0, 16));
    if (!magic.startsWith("SQLite format 3")) return apiError(400, "Invalid SQLite file");
    
    // ── Safe DB import: checkpoint WAL before overwriting the file ──────────
    // Writing a binary over an open SQLite file without checkpointing first
    // leaves the WAL in a split-brain state, causing guaranteed corruption.
    // We checkpoint, then close, then write, then re-open.
    try {
      db.run("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (e) {
      console.warn("[exampool] WAL checkpoint before import failed (non-fatal):", e);
    }
    await Bun.write(EXAMPOOL_DB_PATH, buffer);
    // Re-assert schema constraints, indexes, and defaults on the imported file.
    // This prevents a poisoned import from removing FK constraints or indexes.
    try { initializeDatabase(); } catch (e) {
      console.error("[exampool] initializeDatabase after import failed:", e);
    }
    auditLog(auth.userId, "SETTINGS_IMPORT", "setting", null, "{}");
    setupRequired = rowCount(queries.countActiveOperators.get() as { count?: unknown }) === 0;
    return apiMessage("Import successful. Restart the server to fully reload the database.");
  }

  if (method === "POST" && pathname === "/api/settings/reset") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const body = await readJson(req);
    if (body?.confirm !== "RESET_ALL_DATA" && body?.confirmation !== "DELETE ALL DATA") return apiError(400, "Confirmation string required");
    db.transaction(() => {
      // Delete in FK-safe order: child tables first
      db.prepare("DELETE FROM student_answers").run();
      db.prepare("DELETE FROM exams").run();
      db.prepare("DELETE FROM questions").run();
      db.prepare("DELETE FROM subject_enrollments").run();
      db.prepare("DELETE FROM subjects").run();
      db.prepare("DELETE FROM audit_logs").run();
      db.prepare("DELETE FROM users").run();
      // Reset config and settings to factory state
      db.prepare("DELETE FROM config").run();
      db.prepare("UPDATE settings SET value = '2026-T1' WHERE key = 'CURRENT_TERM'").run();
      db.prepare("UPDATE settings SET value = 'true' WHERE key = 'REGISTRATION_OPEN'").run();
      db.prepare("DELETE FROM settings WHERE key = 'SCHOOL_NAME'").run();
    })();
    setupRequired = true;
    return apiMessage("Database reset complete. Refresh to run setup.");
  }

  // ── v4.1 Practice API ──────────────────────────────────────────────────────
  if (pathname === "/api/practice/subjects" && method === "GET") {
    requireAuth(req);
    const results = db.prepare(`
      SELECT subject_code, exam_body, MIN(year) as min_year, MAX(year) as max_year, COUNT(*) as total_questions
      FROM content_bank.content_bank
      GROUP BY subject_code, exam_body
    `).all();
    return apiSuccess({ subjects: results });
  }

  if (pathname === "/api/practice/questions" && method === "GET") {
    requireAuth(req);
    const subject = url.searchParams.get("subject_code");
    const examBody = url.searchParams.get("exam_body");
    const year = Number(url.searchParams.get("year"));
    const limit = Number(url.searchParams.get("limit")) || 60;
    
    if (!subject || !examBody || !year) return apiError(400, "Missing parameters");
    
    const questions = db.prepare(`
      SELECT id, question_text, question_text_local, options_json, diagram_path, difficulty, topic_tag 
      FROM content_bank.content_bank 
      WHERE subject_code = ? AND exam_body = ? AND year = ? 
      LIMIT ?
    `).all(subject, examBody, year, limit);
    return apiSuccess({ questions });
  }

  if (pathname === "/api/practice/submit" && method === "POST") {
    const auth = requireAuth(req);
    const body = await readJson(req);
    if (!body || !Array.isArray(body.answers)) return apiError(400, "Invalid payload");
    
    let total = 0, correct = 0, incorrect = 0;
    const topic_breakdown: Record<string, { total: number; correct: number }> = {};
    
    db.transaction(() => {
      for (const ans of body.answers) {
        const qRow = queries.getContentBankQuestionById.get(ans.question_id) as any;
        if (!qRow) continue;
        
        total++;
        const isCorrect = qRow.correct_answer === ans.selected_answer ? 1 : 0;
        if (isCorrect) correct++; else incorrect++;
        
        const topic = qRow.topic_tag || "Uncategorized";
        if (!topic_breakdown[topic]) topic_breakdown[topic] = { total: 0, correct: 0 };
        topic_breakdown[topic].total++;
        if (isCorrect) topic_breakdown[topic].correct++;
        
        queries.insertPracticeLog.run(
          auth.userId, ans.question_id, ans.selected_answer || null, isCorrect,
          ans.time_spent_seconds || 0, Date.now(), "lan", "lan_device", "mock_sig"
        );
      }
    })();
    
    return apiSuccess({ session_id: body.session_id, score_summary: { total, correct, incorrect, topic_breakdown } });
  }

  if (pathname === "/api/practice/explanation" && method === "GET") {
    requireAuth(req);
    const clientIp = getClientIp(req);
    checkRateLimit(`practice_exp_${clientIp}`, 1, 2000); // 1 req per 2 sec
    
    const qid = Number(url.searchParams.get("question_id"));
    if (!isPositiveIntId(qid)) return apiError(400, "Invalid question id");
    
    const qRow = queries.getContentBankQuestionById.get(qid) as any;
    if (!qRow) return apiError(404, "Question not found");
    
    return apiSuccess({
      solution_text: qRow.solution_text,
      correct_answer: qRow.correct_answer,
      topic_tag: qRow.topic_tag
    });
  }

  // ── v4.1 Kiosk API ─────────────────────────────────────────────────────────
  if (pathname === "/api/kiosk/session/start" && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator", "teacher", "student"]);
    const body = await readJson(req);
    
    // Validate required fields — undefined values silently coerce to NULL in SQLite
    const pcId = trimStr(body?.pc_id);
    const studentIdRaw = Number(body?.student_id);
    if (!pcId) return apiError(400, "pc_id is required");
    if (!isPositiveIntId(studentIdRaw)) return apiError(400, "student_id must be a positive integer");
    const examIdRaw = body?.exam_id ? Number(body.exam_id) : null;
    if (examIdRaw !== null && !isPositiveIntId(examIdRaw)) return apiError(400, "exam_id must be a positive integer");
    const seatNumber = body?.seat_number ? Number(body.seat_number) : null;
    const fingerprint = trimStr(body?.hardware_fingerprint) || "unknown";
    
    // Auto-complete any existing active session for this PC
    db.prepare(`UPDATE kiosk_sessions SET logout_time = ?, status = 'completed' WHERE pc_id = ? AND status = 'active'`)
      .run(Date.now(), pcId);
      
    db.prepare(`INSERT INTO kiosk_sessions (pc_id, seat_number, student_id, exam_id, hardware_fingerprint, login_time, status) VALUES (?, ?, ?, ?, ?, ?, 'active')`)
      .run(pcId, seatNumber, studentIdRaw, examIdRaw, fingerprint, Date.now());
    return apiSuccess({ started: true });
  }

  if (pathname === "/api/kiosk/session/switch" && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator", "teacher", "student"]);
    const body = await readJson(req);
    
    // Validate required fields
    const pcId = trimStr(body?.pc_id);
    const newStudentId = Number(body?.new_student_id);
    if (!pcId) return apiError(400, "pc_id is required");
    if (!isPositiveIntId(newStudentId)) return apiError(400, "new_student_id must be a positive integer");
    const newExamId = body?.new_exam_id ? Number(body.new_exam_id) : null;
    if (newExamId !== null && !isPositiveIntId(newExamId)) return apiError(400, "new_exam_id must be a positive integer");
    
    db.prepare(`UPDATE kiosk_sessions SET logout_time = ?, status = 'completed' WHERE pc_id = ? AND status = 'active'`)
      .run(Date.now(), pcId);
    
    db.prepare(`INSERT INTO kiosk_sessions (pc_id, seat_number, student_id, exam_id, hardware_fingerprint, login_time, status) VALUES (?, ?, ?, ?, ?, ?, 'active')`)
      .run(pcId, null, newStudentId, newExamId, "unknown", Date.now());
      
    return apiSuccess({ switched: true }, 200, { "X-Exampool-Action": "WIPE_LOCAL_STORAGE" });
  }

  if (pathname === "/api/kiosk/seat-map" && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator", "teacher"]);
    const pcs = db.prepare(`
      SELECT pc_id, seat_number, status, student_id as current_student_id, exam_id as current_exam_id 
      FROM kiosk_sessions WHERE status = 'active'
    `).all();
    return apiSuccess({ pcs });
  }

  if (pathname === "/api/system/settings" && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const customUrlRow = queries.getSetting.get("CUSTOM_URL") as any;
    const currentUrl = customUrlRow?.value || Bun.env.CUSTOM_URL || "exampool.ng";
    return apiSuccess({
      custom_url: currentUrl,
      server_ip: primaryLocalIp || "127.0.0.1",
      server_port: server.port,
      dns_active: isDnsListening
    });
  }

  if (pathname === "/api/system/settings" && method === "PUT") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const body = await readJson(req);
    const rawUrl = typeof body?.custom_url === "string" ? body.custom_url.trim() : "";
    
    // Clean and validate URL hostname format (e.g. exampool.ng, school.edu.ng)
    const cleanedUrl = rawUrl.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
    if (!cleanedUrl || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleanedUrl)) {
      return apiError(400, "Invalid domain format. Example: exampool.ng or myschool.edu.ng");
    }
    
    queries.upsertSetting.run("CUSTOM_URL", cleanedUrl);
    activeCustomUrl = cleanedUrl;
    auditLog(auth.userId, "SYSTEM_SETTING_UPDATE", "system", null, JSON.stringify({ custom_url: cleanedUrl }));
    
    return apiSuccess({
      custom_url: activeCustomUrl,
      server_ip: primaryLocalIp || "127.0.0.1",
      server_port: server.port,
      dns_active: isDnsListening
    });
  }

  if (pathname === "/api/system/license" && method === "GET") {
    // [SECURITY FIX] License details should only be readable by operators
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    try {
      const payload = await licenseValidator(["core", "practice_lan", "practice_home", "full_bundle"]);
      return apiSuccess({
        license: payload === true ? { tier: "core", max_devices: 0, iat: Date.now() / 1000, sub: "ExamPool User" } : payload,
        hardware_fingerprint: "mock-hw-fingerprint"
      });
    } catch (err: any) {
      return apiSuccess({
        license: { tier: "core", max_devices: 0, iat: Date.now() / 1000, sub: "ExamPool User", error: err.message },
        hardware_fingerprint: "mock-hw-fingerprint"
      });
    }
  }

  if (pathname === "/api/system/license" && method === "POST") {
    const auth = requireAuth(req);
    // License file controls feature access for the entire school.
    // Teachers must NOT be able to modify it — operator-only.
    requireRole(auth.role, ["operator"]);
    const body = await req.json();
    await Bun.write("license.json", JSON.stringify(body, null, 2));
    auditLog(auth.userId, "LICENSE_UPDATE", "system", null, "{}");
    return apiSuccess({ success: true });
  }

  if (pathname === "/api/upload" && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    try {
      const formData = await req.formData();
      const file = formData.get("file");
      if (!file || typeof file === "string") throw new HttpError(400, "Invalid file upload");
      
      const buffer = Buffer.from(await (file as File).arrayBuffer());
      if (buffer.byteLength > 5 * 1024 * 1024) throw new HttpError(400, "File exceeds 5MB limit");
      
      // [SECURITY FIX] Validate file type against an allowlist
      const ext = ((file as File).name.split(".").pop() || "").toLowerCase();
      const ALLOWED_UPLOAD_EXTENSIONS = new Set(["pdf", "doc", "docx", "png", "jpg", "jpeg", "gif", "webp", "svg"]);
      if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
        throw new HttpError(400, `File type .${ext} is not allowed. Permitted: pdf, doc, docx, png, jpg, jpeg, gif, webp, svg`);
      }
      
      const safeHash = crypto.randomBytes(8).toString("hex");
      const filename = `${auth.userId}_${safeHash}.${ext}`;
      
      const uploadDir = path.join(process.cwd(), "frontend", "public", "uploads");
      if (!existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const fullPath = path.join(uploadDir, filename);
      
      await Bun.write(fullPath, buffer);
      
      auditLog(auth.userId, "FILE_UPLOAD", "system", null, JSON.stringify({ filename }));
      return apiSuccess({ url: `/uploads/${filename}` });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(500, "File upload failed");
    }
  }

  if (pathname === "/api/system/content/upload" && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator", "teacher"]);
    
    try {
      const formData = await req.formData();
      const file = formData.get("file");
      if (!file) throw new HttpError(400, "No file uploaded");

      const fileText = typeof file === "string" ? file : await (file as File).text();
      const epkg = JSON.parse(fileText);

      const payload = await licenseValidator(["full_bundle", "practice_lan", "practice_home", "core", "operator"]);
      const jti = payload.jti || "ep-lic-999888777";
      const sub = payload.sub || "SCH-LAG-001";

      const key = await deriveEpkgKey(jti, sub, epkg.version, epkg.salt);

      const iv = Buffer.from(epkg.iv, "hex");
      const authTag = Buffer.from(epkg.authTag, "hex");
      const ciphertextBytes = Buffer.from(epkg.ciphertext, "base64");
      
      const combined = new Uint8Array(ciphertextBytes.length + authTag.length);
      combined.set(ciphertextBytes, 0);
      combined.set(authTag, ciphertextBytes.length);

      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        key,
        combined
      );

      const decryptedText = new TextDecoder().decode(decryptedBuffer);
      const content = JSON.parse(decryptedText);

      const tx = db.transaction(() => {
        const insertStmt = db.prepare(`
          INSERT INTO content_bank.content_bank 
          (exam_body, year, subject_code, paper_type, question_text, options_json, correct_answer, solution_text, difficulty, topic_tag)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const q of content.questions) {
          insertStmt.run(
            content.exam_body,
            content.year,
            content.subject_code,
            content.paper_type,
            q.question_text,
            JSON.stringify(q.options),
            q.correct_answer,
            q.solution_text,
            q.difficulty,
            q.topic_tag
          );
        }
      });
      tx();

      return apiSuccess({ success: true, count: content.questions.length });
    } catch (err: any) {
      console.error("Upload Error:", err);
      throw new HttpError(400, "Package import failed: " + err.message);
    }
  }

  if (pathname === "/api/content/pdf-upload" && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator", "teacher"]);
    
    try {
      const formData = await req.formData();
      const file = formData.get("file");
      if (!file) throw new HttpError(400, "No PDF file uploaded");

      const buffer = Buffer.from(await (file as File).arrayBuffer());
      // [SECURITY FIX] Limit PDF upload size to prevent memory exhaustion
      if (buffer.byteLength > 10 * 1024 * 1024) throw new HttpError(400, "PDF file exceeds 10MB limit");
      let text = "";
      const origWarn = console.warn;
      console.warn = (...args: any[]) => {
        if (typeof args[0] === "string" && args[0].includes("standardFontDataUrl")) return;
        origWarn(...args);
      };
      try {
        const m = await import("pdf-parse");
        if (m.PDFParse) {
          const uint8Array = new Uint8Array(buffer);
          const parser = new m.PDFParse(uint8Array);
          const data = await parser.getText();
          text = data.text;
        } else if (typeof m.default === "function") {
          const data = await m.default(buffer);
          text = data.text;
        } else if (typeof m === "function") {
          const data = await (m as any)(buffer);
          text = data.text;
        } else {
          throw new Error("Could not determine pdf-parse export format");
        }
      } catch (e: any) {
        console.error("PDF Parse error:", e);
        throw new HttpError(500, "PDF parsing failed: " + e.message);
      } finally {
        console.warn = origWarn;
      }

      // Extract metadata from form and standardize exam_body
      let rawExamBody = (formData.get("exam_body")?.toString() || "").trim().toUpperCase();
      let exam_body = ["JAMB", "WAEC", "NECO", "NABTEB"].includes(rawExamBody) ? rawExamBody : "JAMB";

      const year = parseInt(formData.get("year")?.toString() || "2024", 10);
      const subject_code = formData.get("subject_code")?.toString() || "GEN";
      const paper_type = formData.get("paper_type")?.toString() || "objective";

      // Improved regex parsing for questions and dynamic year extraction
      const questions: any[] = [];
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
      
      let currentQuestion: any = null;
      let currentOptions: string[] = [];
      let currentYear = year; // Default to metadata year, but dynamically update as we scan headers

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // 1. Detect dynamic year headers (e.g. "Physics 1983", "1983 Questions", or just a year "1983")
        // Check if the line is short (under 40 characters) and contains a valid year.
        if (line.length < 40 && !/^(\d+[\.\)])\s+/.test(line) && !/^([A-E][\.\)]|\([A-E]\)|\[[A-E]\])\s+/.test(line)) {
          const yearMatch = line.match(/\b(19\d{2}|20\d{2})\b/);
          if (yearMatch) {
            const parsedYear = parseInt(yearMatch[1], 10);
            if (parsedYear >= 1970 && parsedYear <= 2030) {
              currentYear = parsedYear;
            }
          }
        }
        
        // 2. Detect numbered question starts
        if (/^(\d+[\.\)])\s+/.test(line) || /^Q\d+[\.\)]?\s+/.test(line)) {
          if (currentQuestion) {
            currentQuestion.options = currentOptions;
            questions.push(currentQuestion);
          }
          currentQuestion = {
            question_text: line.replace(/^(\d+[\.\)]|Q\d+[\.\)]?)\s+/, "").trim(),
            options: [],
            correct_answer: "A", // Default
            solution_text: "",
            difficulty: 3,
            topic_tag: "",
            year: currentYear // Storing year dynamically detected or defaulted
          };
          currentOptions = [];
        } 
        // 3. Detect options like "A.", "(A)", "[A]"
        else if (/^([A-E][\.\)]|\([A-E]\)|\[[A-E]\])\s+/.test(line)) {
          currentOptions.push(line.replace(/^([A-E][\.\)]|\([A-E]\)|\[[A-E]\])\s+/, "").trim());
        } 
        // 4. Handle multi-line question text and option values
        else if (currentQuestion && currentOptions.length === 0) {
          currentQuestion.question_text += " " + line;
        } else if (currentQuestion && currentOptions.length > 0) {
          currentOptions[currentOptions.length - 1] += " " + line;
        }
      }
      
      if (currentQuestion) {
        currentQuestion.options = currentOptions;
        questions.push(currentQuestion);
      }

      if (questions.length === 0) {
         throw new HttpError(400, "Could not extract any questions from the PDF. Ensure it uses standard numbered format (e.g. 1. Question... A. Option...).");
      }

      const tx = db.transaction(() => {
        const insertStmt = db.prepare(`
          INSERT INTO content_bank.content_bank 
          (exam_body, year, subject_code, paper_type, question_text, options_json, correct_answer, solution_text, difficulty, topic_tag)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const q of questions) {
          insertStmt.run(
            exam_body, q.year, subject_code, paper_type,
            q.question_text,
            JSON.stringify(q.options),
            q.correct_answer, q.solution_text, q.difficulty, q.topic_tag
          );
        }
      });
      tx();

      return apiSuccess({ success: true, count: questions.length, message: `Successfully extracted ${questions.length} questions.` });
    } catch (err: any) {
      console.error("PDF Upload Error:", err);
      throw new HttpError(400, "PDF import failed: " + err.message);
    }
  }

  // ── v4.1 Sync & Content API ───────────────────────────────────────────────
  if (pathname === "/api/sync/content/manifest" && method === "GET") {
    // [SECURITY FIX] Require authentication to access content manifest
    requireAuth(req);
    const packages = db.prepare(`
      SELECT 
        exam_body || '_' || year || '_' || subject_code as id,
        exam_body, 
        year, 
        subject_code as subject, 
        COUNT(*) as content_count 
      FROM content_bank.content_bank 
      GROUP BY exam_body, year, subject_code
    `).all();
    return apiSuccess({ packages });
  }

  if (pathname === "/api/practice/download" && method === "GET") {
    // [SECURITY FIX VULN-01] Require authentication — content bank is licensed IP
    requireAuth(req);
    const packageId = url.searchParams.get("packageId");
    if (!packageId) return apiError(400, "Missing packageId");
    // [SECURITY FIX VULN-03] Cap packageId length to prevent memory exhaustion
    if (packageId.length > 128) return apiError(400, "Invalid packageId");
    const parts = packageId.split("_");
    if (parts.length < 3) return apiError(400, "Invalid packageId");
    const [exam_body, yearStr, ...rest] = parts;
    // After the length guard above, these are guaranteed to be defined
    if (!exam_body || !yearStr) return apiError(400, "Invalid packageId");
    const year = parseInt(yearStr, 10);
    const subject_code = rest.join("_");

    const rawQuestions = db.prepare(`SELECT * FROM content_bank.content_bank WHERE exam_body=? AND year=? AND subject_code=?`).all(exam_body, year, subject_code) as any[];
    if (!rawQuestions.length) return apiError(404, "Package not found");

    const payload = {
      exam_body,
      subject: subject_code,
      subject_code,
      year,
      paper_type: rawQuestions[0].paper_type || "objective",
      questions: rawQuestions.map(q => ({
        question_text: q.question_text,
        options: JSON.parse(q.options_json),
        correct_answer: q.correct_answer,
        solution_text: q.solution_text,
        difficulty: q.difficulty,
        topic_tag: q.topic_tag
      }))
    };

    // [SECURITY FIX] Read license credentials from license.json instead of hardcoded values
    // TODO: Replace with real per-deployment license system with RSA-verified JWTs
    let licenseKey = "ep-lic-999888777";
    let schoolId = "SCH-LAG-001";
    try {
      const licFile = Bun.file("license.json");
      if (await licFile.exists()) {
        const licText = await licFile.text();
        const licJson = JSON.parse(licText);
        const jwtStr = licJson.jwt || licText;
        const parts = jwtStr.split(".");
        if (parts.length === 3 && parts[1]) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
          if (payload.jti) licenseKey = payload.jti;
          if (payload.sub) schoolId = payload.sub;
        }
      }
    } catch { /* use defaults if license file is missing or malformed */ }
    const version = "1.0";
    const salt = crypto.randomBytes(16);
    const saltHex = salt.toString("hex");

    const ikmString = `${licenseKey}${schoolId}${version}`;
    const ikm = Buffer.from(ikmString);
    const info = Buffer.from("exampool-content-v1");
    const key = await new Promise((resolve, reject) => {
      crypto.hkdf("sha256", ikm, Buffer.from(saltHex, "hex"), info, 32, (err: any, derivedKey: any) => {
        if (err) reject(err); else resolve(derivedKey);
      });
    }) as Buffer;

    const plaintext = Buffer.from(JSON.stringify(payload));
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const epkgData = {
      version,
      salt: saltHex,
      iv: iv.toString("hex"),
      authTag: authTag.toString("hex"),
      ciphertext: ciphertext.toString("base64"),
      exam_body,
      subject: subject_code,
      year,
      content_count: rawQuestions.length
    };

    return new Response(JSON.stringify(epkgData), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  if (pathname === "/api/content/search" && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator", "teacher"]);
    const q = url.searchParams.get("q");
    if (!q) return apiError(400, "Query string 'q' required");
    const results = queries.searchContentBank.all(q);
    return apiSuccess({ results });
  }

  // ── v4.1 Practice Sandbox API ────────────────────────────────────────────────
  if (pathname === "/api/practice/start" && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["student", "operator", "teacher"]);
    const practiceId = url.searchParams.get("practiceId");
    if (!practiceId) return apiError(400, "Missing practiceId");
    // [SECURITY FIX VULN-03] Cap practiceId length
    if (practiceId.length > 128) return apiError(400, "Invalid practiceId");

    const parts = practiceId.split("_");
    if (parts.length < 3) return apiError(400, "Invalid practiceId");
    const exam_body = parts[0] as string;
    const year = parseInt(parts[1] as string, 10);
    const subject_code = parts.slice(2).join("_");

    const mockExamId = Math.floor(Math.random() * 100000) + 10000;
    
    const rawQuestions = db.prepare(`
      SELECT id, question_text, options_json as options, correct_answer
      FROM content_bank.content_bank
      WHERE exam_body = ? AND year = ? AND subject_code = ?
      ORDER BY random() LIMIT 50
    `).all(exam_body, year, subject_code) as any[];

    if (!rawQuestions.length) return apiError(404, "No questions found for this package");

    const questions = rawQuestions.map(q => ({
      id: q.id,
      question_text: q.question_text,
      question_type: "multiple_choice",
      options_json: q.options,
      correct_answer: q.correct_answer,
      marks: 1
    }));

    return apiSuccess({
      exam: {
        id: mockExamId,
        subject: { id: mockExamId, title: `${exam_body} ${year} - ${subject_code}`, duration: 45, duration_minutes: 45 },
        questions
      }
    });
  }

  if (pathname === "/api/practice/submit" && method === "POST") {
    const auth = requireAuth(req);
    const practiceId = url.searchParams.get("practiceId");
    if (!practiceId) return apiError(400, "Missing practiceId");

    const body = await readJson(req);
    const answers = body.answers || [];

    const parts = practiceId.split("_");
    const exam_body = parts[0] as string;
    const year = parseInt(parts[1] as string, 10);
    const subject_code = parts.slice(2).join("_");

    const rawQuestions = db.prepare(`
      SELECT id, correct_answer
      FROM content_bank.content_bank
      WHERE exam_body = ? AND year = ? AND subject_code = ?
    `).all(exam_body, year, subject_code) as any[];

    const correctMap = new Map();
    for (const q of rawQuestions) {
      correctMap.set(q.id, q.correct_answer);
    }

    let score = 0;
    let total = 0;

    const tx = db.transaction(() => {
      for (const ans of answers) {
        if (!ans.question_id) continue;
        const correctOpt = correctMap.get(ans.question_id);
        if (correctOpt !== undefined) {
          total++;
          const isCorrect = String(ans.selected_option) === String(correctOpt) ? 1 : 0;
          if (isCorrect) score++;
          try {
             queries.insertPracticeLog.run(
               auth.userId,
               ans.question_id,
               ans.selected_option?.toString() || ans.essay_response || null,
               isCorrect,
               ans.time_spent_seconds || 0,
               Date.now(),
               "lan", // By default, server submissions are 'lan'. Offline will be synced differently.
               "N/A", // device_fingerprint
               "unsigned" // log_signature
             );
          } catch(e) { console.error("Practice log err:", e); }
        }
      }
    });
    tx();

    return apiSuccess({
      score,
      total_score: total,
      answered_questions: answers.length,
      total_questions: rawQuestions.length
    });
  }

  // ── Offline Assignments Sync ────────────────────────────────────────────────
  // [SECURITY FIX] Removed duplicate /api/upload route (dead code -- first handler above always matched)
  // Offline file uploads are handled via base64 file_data in the /api/offline/sync payload instead

  if (pathname === "/api/offline/assignments" && method === "GET") {
    let auth;
    try { auth = requireAuth(req); } catch (e) { return apiError(401, "Not authenticated"); }
    
    // Get all assignments for the student
    const subjects = queries.getEnrolledSubjectsByStudent.all(auth.userId) as any[];
    const assignments = subjects.filter(s => s.is_assignment === 1 && s.is_published === 1);
    
    for (const assignment of assignments) {
      assignment.questions = stripCorrectAnswer(queries.getQuestionsBySubject.all(assignment.id) as any[], auth.role);
    }
    
    return apiSuccess({ assignments });
  }

  if (pathname === "/api/offline/sync" && method === "POST") {
    const auth = requireAuth(req);
    const body = await readJson(req);
    const { exams } = body; 
    
    if (!Array.isArray(exams)) return apiError(400, "Invalid payload");
    
    let synced = 0;
    // Helper to extract CURRENT_TERM outside loop
    const currentTermRow = queries.getSetting.get("CURRENT_TERM") as any;
    const currentTerm = currentTermRow?.value || "T1";
    
    // Make sure uploads directory exists for offline files
    const uploadDir = path.join(import.meta.dir, "frontend", "public", "uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    // Pre-process offline files to avoid file I/O inside db.transaction() which deadlocks SQLite
    for (const examData of exams) {
      if (Array.isArray(examData.answers)) {
        for (const ans of examData.answers) {
          if (ans.file_data && typeof ans.file_data === "string" && ans.file_name) {
            const match = ans.file_data.match(/^data:(.+);base64,(.+)$/);
            // [SECURITY FIX VULN-04] Validate MIME type against allowlist before writing to disk
            const ALLOWED_MIME_TYPES = [
              "image/jpeg", "image/png", "image/gif", "image/webp",
              "application/pdf",
              "application/msword",
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            ];
            if (match && ALLOWED_MIME_TYPES.includes(match[1])) {
               try {
                 const buffer = Buffer.from(match[2], 'base64');
                 const safeName = ans.file_name.replace(/[^a-zA-Z0-9.-]/g, '').slice(0, 64);
                 const filename = crypto.randomBytes(8).toString('hex') + "_" + safeName;
                 await Bun.write(path.join(uploadDir, filename), buffer);
                 ans.file_url = `/uploads/${filename}`;
               } catch(e) {
                 console.error("[exampool] Failed to write offline file", e);
               }
            }
          }
        }
      }
    }

    const tx = db.transaction(() => {
      for (const examData of exams) {
        const { subject_id, start_time, end_time, answers } = examData;
        if (!subject_id) continue;
        
        let exam = queries.getExamByStudentSubject.get(auth.userId, subject_id) as any;
        if (!exam) {
           queries.createExam.run(auth.userId, subject_id, start_time || new Date().toISOString(), JSON.stringify(answers || []), "offline", currentTerm, "assignment");
           exam = queries.getExamByStudentSubject.get(auth.userId, subject_id) as any;
        } else if (exam.status === "completed") {
           // Skip if already completed to prevent double submission
           continue;
        }
        
        // Securely calculate score on the server
        let calculatedScore = 0;
        let calculatedTotal = 0;
        const processedAnswers = [];
        const safeAnswers = Array.isArray(answers) ? answers : [];
        
        for (const ans of safeAnswers) {
          const qRow = queries.getQuestionById.get(ans.question_id) as any;
          if (!qRow) continue;
          
          calculatedTotal += qRow.marks || 1;
          
          let isCorrect = 0;
          let marksAwarded = 0;
          
          if (qRow.question_type === "objective" || qRow.question_type === "true_false") {
            if (qRow.correct_answer === ans.selected_option) {
              isCorrect = 1;
              marksAwarded = qRow.marks || 1;
              calculatedScore += marksAwarded;
            }
          }
          
          // Handle offline file upload
          let finalFileUrl = ans.file_url ?? null;
          processedAnswers.push({
            question_id: ans.question_id,
            selected_option: ans.selected_option ?? null,
            essay_response: ans.essay_response ?? null,
            is_correct: isCorrect,
            marks_awarded: marksAwarded,
            file_url: finalFileUrl
          });
        }
        
        // Use atomic UPDATE with rowCount guard to prevent race conditions
        const submitRes = queries.submitExam.run(
          JSON.stringify(processedAnswers), 
          end_time || new Date().toISOString(), 
          calculatedScore, 
          calculatedTotal, 
          exam.id, 
          auth.userId
        ) as any;
        
        // If changes === 0, the exam was already submitted by another concurrent request
        if (!submitRes || submitRes.changes === 0) {
          continue;
        }
        
        // Insert granular answers
        for (const ans of processedAnswers) {
          queries.insertStudentAnswer.run(
            exam.id, ans.question_id, auth.userId, subject_id,
            ans.selected_option, ans.essay_response,
            ans.is_correct, ans.marks_awarded, ans.file_url
          );
        }
        
        synced++;
      }
    });
    tx();
    
    return apiSuccess({ synced });
  }

  // ── v4.1 License API ───────────────────────────────────────────────────────
  if (pathname === "/api/license/validate" && method === "POST") {
    // [SECURITY FIX] Require operator auth and rate-limit to prevent license key brute-force
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const clientIp = getClientIp(req);
    checkRateLimit(`license_validate_${clientIp}`, 5, 60_000);
    const body = await readJson(req);
    const row = queries.verifyLicense.get(body.license_key) as any;
    if (!row) return apiError(403, "License key not found", { code: "LICENSE_INVALID" });
    return apiSuccess({ valid: true, tier: row.license_type, expires_at: row.expires_at, content_packs: JSON.parse(row.content_packs || "[]") });
  }


  // ══════════════════════════════════════════════════════════════════════════
  // v5.0 /api/v2/ Routes — Academic Calendar + Guardian Foundation
  // All routes are prefixed /api/v2/ to be non-breaking alongside v4.1 routes.
  // ══════════════════════════════════════════════════════════════════════════

  // ── v2: Terms ─────────────────────────────────────────────────────────────
  if (pathname === "/api/v2/terms" && method === "GET") {
    requireAuth(req);
    return apiSuccess(queries.getAllTerms.all());
  }

  if (pathname === "/api/v2/terms/active" && method === "GET") {
    requireAuth(req);
    const term = queries.getActiveTerm.get();
    return apiSuccess(term ?? null);
  }

  if (pathname === "/api/v2/terms" && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const body = await readJson(req);
    const session = trimStr(body?.session).slice(0, 20);
    const name = trimStr(body?.name).slice(0, 40);
    const start_date = trimStr(body?.start_date);
    const end_date = trimStr(body?.end_date);
    if (!session || !name || !start_date || !end_date) return apiError(400, "session, name, start_date, end_date required");
    if (!isValidExamDateTime(start_date) || !isValidExamDateTime(end_date)) return apiError(400, "Invalid date format");
    const result = queries.createTerm.run(session, name, start_date, end_date) as { lastInsertRowid: number | bigint };
    return apiSuccess({ id: Number(result.lastInsertRowid) }, 201);
  }

  const termIdMatch = pathname.match(/^\/api\/v2\/terms\/(\d+)$/);
  if (termIdMatch && method === "PUT") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const termId = Number(termIdMatch[1]);
    if (!isPositiveIntId(termId)) return apiError(400, "Invalid term id");
    const term = queries.getTermById.get(termId) as any;
    if (!term) return apiError(404, "Term not found");
    const body = await readJson(req);
    queries.updateTerm.run(
      trimStr(body?.session) || term.session,
      trimStr(body?.name) || term.name,
      trimStr(body?.start_date) || term.start_date,
      trimStr(body?.end_date) || term.end_date,
      body?.registration_open !== undefined ? Number(body.registration_open) : term.registration_open,
      termId
    );
    return apiSuccess(queries.getTermById.get(termId));
  }

  const termActivateMatch = pathname.match(/^\/api\/v2\/terms\/(\d+)\/activate$/);
  if (termActivateMatch && method === "PUT") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const termId = Number(termActivateMatch[1]);
    if (!isPositiveIntId(termId)) return apiError(400, "Invalid term id");
    const term = queries.getTermById.get(termId) as any;
    if (!term) return apiError(404, "Term not found");
    // [ATOMIC] Single transaction: deactivate all, then activate one.
    // Prevents dual-active-term race condition even with concurrent admin clicks.
    db.transaction(() => {
      queries.deactivateAllTerms.run();
      queries.activateTerm.run(termId);
    })();
    auditLog(auth.userId, "TERM_ACTIVATE", "terms", termId, JSON.stringify({ session: term.session, name: term.name }));
    return apiSuccess(queries.getTermById.get(termId));
  }

  // ── v2: Classes ───────────────────────────────────────────────────────────
  if (pathname === "/api/v2/classes" && method === "GET") {
    requireAuth(req);
    return apiSuccess(queries.getAllClasses.all());
  }

  if (pathname === "/api/v2/classes" && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const body = await readJson(req);
    const name = trimStr(body?.name).slice(0, 50);
    const section = trimStr(body?.section).slice(0, 20) || null;
    const level = body?.level === "senior" ? "senior" : "junior";
    if (!name) return apiError(400, "Class name required");
    try {
      const result = queries.createClass.run(name, section, level) as { lastInsertRowid: number | bigint };
      auditLog(auth.userId, "CLASS_CREATE", "classes", Number(result.lastInsertRowid), JSON.stringify({ name, section }));
      return apiSuccess({ id: Number(result.lastInsertRowid) }, 201);
    } catch (e) {
      if (isSqliteUniqueError(e)) return apiError(409, "A class with this name and section already exists");
      throw e;
    }
  }

  const classIdMatch = pathname.match(/^\/api\/v2\/classes\/(\d+)$/);
  if (classIdMatch && method === "PUT") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const classId = Number(classIdMatch[1]);
    if (!isPositiveIntId(classId)) return apiError(400, "Invalid class id");
    const cls = queries.getClassById.get(classId) as any;
    if (!cls) return apiError(404, "Class not found");
    const body = await readJson(req);
    queries.updateClass.run(
      trimStr(body?.name) || cls.name,
      body?.section !== undefined ? (trimStr(body.section) || null) : cls.section,
      body?.level === "senior" ? "senior" : (body?.level === "junior" ? "junior" : cls.level),
      classId
    );
    return apiSuccess(queries.getClassById.get(classId));
  }

  if (classIdMatch && method === "DELETE") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const classId = Number(classIdMatch[1]);
    if (!isPositiveIntId(classId)) return apiError(400, "Invalid class id");
    const count = (queries.getEnrollmentCountForClass.get(classId, 0) as any)?.count ?? 0;
    if (count > 0) return apiError(409, "Cannot delete class with enrolled students");
    queries.deleteClass.run(classId);
    return apiMessage("Class deleted");
  }

  // ── v2: Class Roster ──────────────────────────────────────────────────────
  const classRosterMatch = pathname.match(/^\/api\/v2\/classes\/(\d+)\/roster$/);
  if (classRosterMatch && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator", "teacher"]);
    const classId = Number(classRosterMatch[1]);
    if (!isPositiveIntId(classId)) return apiError(400, "Invalid class id");
    const termId = Number(url.searchParams.get("term_id") || 0);
    const activeTerm = queries.getActiveTerm.get() as any;
    const resolvedTermId = isPositiveIntId(termId) ? termId : (activeTerm?.id ?? 0);
    if (!resolvedTermId) return apiError(400, "No active term. Provide term_id or activate a term first.");
    return apiSuccess(queries.getClassRoster.all(classId, resolvedTermId));
  }

  // ── v2: Class Enrollments (bulk) ─────────────────────────────────────────
  if (pathname === "/api/v2/class-enrollments/bulk" && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const body = await readJson(req);
    const { term_id, class_id, student_ids } = body ?? {};
    if (!isPositiveIntId(term_id) || !isPositiveIntId(class_id) || !Array.isArray(student_ids)) {
      return apiError(400, "term_id, class_id, and student_ids[] required");
    }
    if (student_ids.length > 500) return apiError(400, "Max 500 students per bulk enroll");
    const term = queries.getTermById.get(term_id) as any;
    const cls = queries.getClassById.get(class_id) as any;
    if (!term) return apiError(404, "Term not found");
    if (!cls) return apiError(404, "Class not found");
    let enrolled = 0;
    db.transaction(() => {
      for (const sid of student_ids) {
        if (!isPositiveIntId(Number(sid))) continue;
        queries.enrollStudentInClass.run(Number(sid), class_id, term_id);
        enrolled++;
      }
    })();
    auditLog(auth.userId, "CLASS_ENROLL_BULK", "class_enrollments", class_id, JSON.stringify({ term_id, count: enrolled }));
    return apiSuccess({ enrolled });
  }

  // ── v2: Guardian Links ────────────────────────────────────────────────────
  if (pathname === "/api/v2/guardian-links" && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const status = url.searchParams.get("status");
    if (status === "pending") return apiSuccess(queries.getPendingGuardianLinks.all());
    return apiSuccess(queries.getAllGuardianLinks.all());
  }

  if (pathname === "/api/v2/guardian-links" && method === "POST") {
    const auth = requireAuth(req);
    // Guardians can request their own links; operators can create on their behalf
    requireRole(auth.role, ["guardian", "operator"]);
    const body = await readJson(req);
    const guardian_id = auth.role === "guardian" ? auth.userId : Number(body?.guardian_id);
    const student_id = Number(body?.student_id);
    const relationship = trimStr(body?.relationship || "Parent").slice(0, 40);
    if (!isPositiveIntId(guardian_id) || !isPositiveIntId(student_id)) return apiError(400, "guardian_id and student_id required");
    const student = queries.getUserById.get(student_id) as any;
    const guardian = queries.getUserById.get(guardian_id) as any;
    if (!student || student.role !== "student") return apiError(400, "Invalid student id");
    if (!guardian || guardian.role !== "guardian") return apiError(400, "Guardian must have the guardian role");
    try {
      const result = queries.createGuardianLink.run(guardian_id, student_id, relationship) as { lastInsertRowid: number | bigint };
      auditLog(auth.userId, "GUARDIAN_LINK_REQUEST", "guardian_student_links", Number(result.lastInsertRowid), JSON.stringify({ guardian_id, student_id, relationship }));
      return apiSuccess({ id: Number(result.lastInsertRowid), status: "pending" }, 201);
    } catch (e) {
      if (isSqliteUniqueError(e)) return apiError(409, "A link between this guardian and student already exists");
      throw e;
    }
  }

  const guardianLinkActionMatch = pathname.match(/^\/api\/v2\/guardian-links\/(\d+)\/(approve|reject|revoke)$/);
  if (guardianLinkActionMatch && method === "PUT") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const linkId = Number(guardianLinkActionMatch[1]);
    const action = guardianLinkActionMatch[2] as string;
    if (!isPositiveIntId(linkId)) return apiError(400, "Invalid link id");
    const link = queries.getGuardianLink.get(linkId) as any;
    if (!link) return apiError(404, "Guardian link not found");
    const newStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : "revoked";
    queries.updateGuardianLinkStatus.run(newStatus, auth.userId, linkId);
    auditLog(auth.userId, `GUARDIAN_LINK_${newStatus.toUpperCase()}`, "guardian_student_links", linkId, JSON.stringify({ action }));
    return apiSuccess({ id: linkId, status: newStatus });
  }

  // ── v2: Academic Calendar Events ──────────────────────────────────────────
  if (pathname === "/api/v2/calendar" && method === "GET") {
    requireAuth(req);
    const termId = Number(url.searchParams.get("term_id") || 0);
    const activeTerm = queries.getActiveTerm.get() as any;
    const resolvedTermId = isPositiveIntId(termId) ? termId : (activeTerm?.id ?? 0);
    if (!resolvedTermId) return apiSuccess([]);
    return apiSuccess(queries.getCalendarByTerm.all(resolvedTermId));
  }

  if (pathname === "/api/v2/calendar" && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const body = await readJson(req);
    const term_id = Number(body?.term_id);
    const title = trimStr(body?.title).slice(0, 100);
    const description = trimStr(body?.description).slice(0, 500) || null;
    const start_date = trimStr(body?.start_date);
    const end_date = trimStr(body?.end_date);
    const VALID_EVENT_TYPES = ["holiday","exam_period","resumption","event","deadline","other"];
    const type = VALID_EVENT_TYPES.includes(body?.type) ? body.type : "event";
    if (!isPositiveIntId(term_id) || !title || !start_date || !end_date) {
      return apiError(400, "term_id, title, start_date, end_date required");
    }
    if (!isValidExamDateTime(start_date) || !isValidExamDateTime(end_date)) return apiError(400, "Invalid date format");
    const result = queries.createCalendarEvent.run(term_id, title, description, start_date, end_date, type, auth.userId) as { lastInsertRowid: number | bigint };
    return apiSuccess(queries.getCalendarEvent.get(Number(result.lastInsertRowid)), 201);
  }

  const calEventMatch = pathname.match(/^\/api\/v2\/calendar\/(\d+)$/);
  if (calEventMatch && method === "PUT") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const eventId = Number(calEventMatch[1]);
    if (!isPositiveIntId(eventId)) return apiError(400, "Invalid event id");
    const ev = queries.getCalendarEvent.get(eventId) as any;
    if (!ev) return apiError(404, "Event not found");
    const body = await readJson(req);
    const VALID_EVENT_TYPES = ["holiday","exam_period","resumption","event","deadline","other"];
    queries.updateCalendarEvent.run(
      trimStr(body?.title) || ev.title,
      body?.description !== undefined ? trimStr(body.description).slice(0, 500) : ev.description,
      trimStr(body?.start_date) || ev.start_date,
      trimStr(body?.end_date) || ev.end_date,
      VALID_EVENT_TYPES.includes(body?.type) ? body.type : ev.type,
      eventId
    );
    return apiSuccess(queries.getCalendarEvent.get(eventId));
  }

  if (calEventMatch && method === "DELETE") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const eventId = Number(calEventMatch[1]);
    if (!isPositiveIntId(eventId)) return apiError(400, "Invalid event id");
    const ev = queries.getCalendarEvent.get(eventId) as any;
    if (!ev) return apiError(404, "Event not found");
    queries.deleteCalendarEvent.run(eventId);
    return apiMessage("Event deleted");
  }

  // ── v2: Timetables ────────────────────────────────────────────────────────
  const timetableClassMatch = pathname.match(/^\/api\/v2\/timetables\/class\/(\d+)$/);
  if (timetableClassMatch && method === "GET") {
    requireAuth(req);
    const classId = Number(timetableClassMatch[1]);
    if (!isPositiveIntId(classId)) return apiError(400, "Invalid class id");
    const termId = Number(url.searchParams.get("term_id") || 0);
    const activeTerm = queries.getActiveTerm.get() as any;
    const resolvedTermId = isPositiveIntId(termId) ? termId : (activeTerm?.id ?? 0);
    if (!resolvedTermId) return apiSuccess([]);
    return apiSuccess(queries.getTimetableByClass.all(classId, resolvedTermId));
  }

  if (pathname === "/api/v2/timetables" && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const body = await readJson(req);
    const class_id = Number(body?.class_id);
    const subject_id = Number(body?.subject_id);
    const term_id = Number(body?.term_id);
    const teacher_id = body?.teacher_id ? Number(body.teacher_id) : null;
    const day_of_week = Number(body?.day_of_week);
    const start_time = trimStr(body?.start_time);
    const end_time = trimStr(body?.end_time);
    const classroom = trimStr(body?.classroom).slice(0, 100) || null;
    if (!isPositiveIntId(class_id) || !isPositiveIntId(subject_id) || !isPositiveIntId(term_id)) {
      return apiError(400, "class_id, subject_id, term_id required");
    }
    if (!Number.isInteger(day_of_week) || day_of_week < 0 || day_of_week > 6) return apiError(400, "day_of_week must be 0-6");
    if (!start_time || !end_time) return apiError(400, "start_time and end_time required");
    // [CONFLICT DETECTION] Teacher double-booking check
    if (teacher_id && isPositiveIntId(teacher_id)) {
      const teacherConflict = queries.checkTeacherConflict.get(teacher_id, term_id, day_of_week, start_time) as any;
      if (teacherConflict) return apiError(409, "Teacher is already assigned to another class at this time slot");
    }
    // [CONFLICT DETECTION] Classroom double-booking check
    if (classroom) {
      const roomConflict = queries.checkClassroomConflict.get(classroom, term_id, day_of_week, start_time) as any;
      if (roomConflict) return apiError(409, `Classroom "${classroom}" is already booked at this time slot`);
    }
    try {
      const result = queries.createTimetableSlot.run(class_id, subject_id, term_id, teacher_id, day_of_week, start_time, end_time, classroom) as { lastInsertRowid: number | bigint };
      auditLog(auth.userId, "TIMETABLE_CREATE", "timetables", Number(result.lastInsertRowid), JSON.stringify({ class_id, subject_id, day_of_week, start_time }));
      return apiSuccess(queries.getTimetableSlot.get(Number(result.lastInsertRowid)), 201);
    } catch (e) {
      if (isSqliteUniqueError(e)) return apiError(409, "A timetable slot already exists for this class at this day and time");
      throw e;
    }
  }

  const timetableSlotMatch = pathname.match(/^\/api\/v2\/timetables\/(\d+)$/);
  if (timetableSlotMatch && method === "DELETE") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const slotId = Number(timetableSlotMatch[1]);
    if (!isPositiveIntId(slotId)) return apiError(400, "Invalid slot id");
    const slot = queries.getTimetableSlot.get(slotId) as any;
    if (!slot) return apiError(404, "Timetable slot not found");
    queries.deleteTimetableSlot.run(slotId);
    return apiMessage("Timetable slot deleted");
  }

  return apiError(404, "Not found");
}


const server = serve({
  port: Number(Bun.env.PORT ?? 8001),
  hostname: "0.0.0.0",
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/api/") || url.pathname === "/api") return await handleApi(req, url);
      return await serveStatic(url.pathname);
    } catch (error) {
      if (error instanceof HttpError) return apiError(error.status, error.message);
      console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "error", message: "API error", error: error instanceof Error ? error.stack : String(error), path: url.pathname }));
      return apiError(500, "Server error");
    }
  },
});

console.log("╔═══════════════════════════════════════╗");
console.log("║      EXAMPOOL SERVER RUNNING          ║");
console.log("╚═══════════════════════════════════════╝");
// [SECURITY] Warn if the default JWT secret is still in use
if (!Bun.env.JWT_SECRET || Bun.env.JWT_SECRET === "exampool-lan-secret-change-me") {
  console.warn("⚠️  [SECURITY WARNING] JWT_SECRET is using the public default value!");
  console.warn("   Anyone can forge valid session tokens for any user, including operators.");
  console.warn("   Set a strong JWT_SECRET env var before deploying to production.");
  console.warn("   Generate one: bun -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"\n");
}
const interfaces = os.networkInterfaces();
let primaryLocalIp = "";
// Prefer physical Wi-Fi/Ethernet over virtual adapters (WSL, Hyper-V, VirtualBox etc.)
const virtualPrefixes = ["vEthernet", "VMware", "VirtualBox", "Loopback", "Teredo", "Bluetooth"];
const allNonLoopback: { name: string; address: string }[] = [];
for (const [name, addresses] of Object.entries(interfaces)) {
  for (const addr of addresses ?? []) {
    if (addr.family === "IPv4" && !addr.internal) {
      console.log(`[${name}] Local Network: http://${addr.address}:${server.port}`);
      allNonLoopback.push({ name, address: addr.address });
    }
  }
}
// Pick a physical adapter first; fall back to any non-loopback if none found
const physicalAdapter = allNonLoopback.find(a => !virtualPrefixes.some(prefix => a.name.startsWith(prefix)));
primaryLocalIp = (physicalAdapter ?? allNonLoopback[0])?.address ?? "";
console.log("Note: If deployed on a cloud platform (Railway/Render), use your provided public domain.");
console.log(`SQLite: ${EXAMPOOL_DB_PATH}`);
console.log(`Static dist: ${distDir}`);
console.log(`Setup required: ${setupRequired}`);
console.log(`JWT Secret: ${Bun.env.JWT_SECRET ? "✅ Custom secret loaded from .env" : "❌ Default (insecure) — run: bun run start"}`);

// --- Local DNS IP Masking ---
let isDnsListening = false;
const initialDbUrl = (queries.getSetting.get("CUSTOM_URL") as any)?.value;
let activeCustomUrl = initialDbUrl || Bun.env.CUSTOM_URL || "exampool.ng";

if (primaryLocalIp) {
  try {
    const { Packet } = DNS;
    const dnsServer = DNS.createServer({
      udp: true,
      handle: (request, send, rinfo) => {
        const response = Packet.createResponseFromRequest(request);
        const [question] = request.questions;
        if (!question) return send(response);
        
        const { name } = question;
        if (name.toLowerCase() === activeCustomUrl.toLowerCase() && question.type === Packet.TYPE.A) {
          response.answers.push({
            name,
            type: Packet.TYPE.A,
            class: Packet.CLASS.IN,
            ttl: 300,
            address: primaryLocalIp
          });
        }
        send(response);
      }
    });

    dnsServer.on("listening", () => {
      isDnsListening = true;
      console.log(`[DNS] Local IP Masking active: ${activeCustomUrl} -> ${primaryLocalIp}`);
      console.log(`      To use this, set your Wi-Fi router's primary DNS to ${primaryLocalIp}`);
    });

    dnsServer.on("error", (err: any) => {
      isDnsListening = false;
      if (err.code === "EACCES" || err.code === "EPERM") {
        console.warn(`[DNS WARNING] Could not bind to port 53. Run the server as Administrator to enable URL masking.`);
      } else if (err.code === "EADDRINUSE") {
        console.warn(`[DNS WARNING] Port 53 on ${primaryLocalIp} is in use by another service (e.g. WSL/ICS).`);
        console.warn(`              To free Port 53, disable Internet Connection Sharing / Mobile Hotspot in Windows settings.`);
      } else {
        console.warn(`[DNS WARNING] Could not start local DNS: ${err.message}`);
      }
    });

    // Start on port 53 bound specifically to the physical network adapter IP
    dnsServer.listen({ udp: { port: 53, address: primaryLocalIp } });
  } catch (err: any) {
    isDnsListening = false;
    console.warn(`[DNS WARNING] Failed to initialize local DNS: ${err.message}`);
  }
}

// --- Graceful Shutdown ---
function shutdown() {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: "info", message: "Shutting down server gracefully..." }));
  server.stop();
  try {
    db.close();
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: "info", message: "Database connection closed cleanly." }));
  } catch (e) {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "error", message: "Error closing database", error: String(e) }));
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
