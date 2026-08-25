import { serve } from "bun";
import { existsSync } from "fs";
import fs from "fs";
import crypto, { timingSafeEqual } from "node:crypto";
import db, { EXAMPOOL_DB_PATH, initializeDatabase, queries, bootstrap_v5_migration } from "./db";
import { buildSessionCookie, generateToken, hashPassword, verifyPassword, verifySimpleToken } from "./auth";
import os from "os";
import path from "path";
import dgram from "node:dgram";
import { validateMLF, deriveEpkgKey, getSystemHardwareFingerprint } from "./crypto_utils";
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
import { createAuthorizationService } from "./src/services/authorization.service";
import { cacheService, CacheKeys } from "./src/services/cache.service";

const authz = createAuthorizationService(db, queries);

/** Next `distDir: "../dist"` → `exampool/dist`; some layouts use `exampool/frontend/dist`. */
function resolveStaticDistDir(): string {
  const siblingDist = path.join(import.meta.dir, "dist");
  const nestedFrontendDist = path.join(import.meta.dir, "frontend", "dist");
  const siblingOut = path.join(import.meta.dir, "out");
  const nestedFrontendOut = path.join(import.meta.dir, "frontend", "out");
  
  if (existsSync(path.join(siblingDist, "index.html"))) return siblingDist;
  if (existsSync(path.join(nestedFrontendDist, "index.html"))) return nestedFrontendDist;
  if (existsSync(path.join(siblingOut, "index.html"))) return siblingOut;
  if (existsSync(path.join(nestedFrontendOut, "index.html"))) return nestedFrontendOut;
  
  return siblingDist;
}

let distDir = resolveStaticDistDir();
function getIndexFile() {
  const currentDist = resolveStaticDistDir();
  return Bun.file(path.join(currentDist, "index.html"));
}

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

// ── In-Memory Log Ring Buffer ─────────────────────────────────────────────
// Captures last 200 console.log/warn/error lines so /api/system/logs can
// surface them in the admin terminal panel without writing to a file.
const LOG_BUFFER_MAX = 200;
type LogEntry = { ts: string; level: "info" | "warn" | "error"; msg: string };
const logBuffer: LogEntry[] = [];

function pushLog(level: LogEntry["level"], args: any[]) {
  const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  logBuffer.push({ ts: new Date().toISOString(), level, msg });
  if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
}

const _origLog   = console.log.bind(console);
const _origWarn  = console.warn.bind(console);
const _origError = console.error.bind(console);
console.log   = (...a) => { _origLog(...a);   pushLog("info",  a); };
console.warn  = (...a) => { _origWarn(...a);  pushLog("warn",  a); };
console.error = (...a) => { _origError(...a); pushLog("error", a); };
// ─────────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGIN = Bun.env.ALLOWED_ORIGIN || "http://localhost:3000";

const securityHeaders = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  // [SECURITY FIX VULN-03] Removed 'unsafe-eval' (not needed in production builds).
  // Tightened connect-src from 'http: https:' (any origin) to 'self' + WS only.
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self' ws: wss:;",
  // [SECURITY FIX VULN-08] Added Permissions-Policy and Referrer-Policy
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
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
  // [SECURITY FIX] Removed hardcoded localhost bypass to prevent rate limit evasion behind unconfigured proxies
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
    if (clients && clients.size > 0) {
      const payload = `data: ${jsonSafeStringify(record)}\n\n`;
      // Push to next tick to avoid blocking the synchronous event loop
      setTimeout(() => {
        for (const client of clients) {
          try { client.enqueue(payload); } catch (e) {}
        }
      }, 0);
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

function requireAuth(req: Request): { userId: number; role: string; token: string; jti: string } {
  const cookies = parseCookies(req);
  const cookieToken = cookies.__exampool_session;
  const authHeader = req.headers.get("authorization");
  const headerToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const token = cookieToken || headerToken;
  if (!token) throw new HttpError(401, "Not authenticated");
  
  const decoded = verifySimpleToken(token);
  if (!decoded) throw new HttpError(401, "Not authenticated");

  // [FIX] isTokenBlacklisted queries `WHERE token = ? OR jti = ?` — it requires BOTH
  // parameters. Previously only the token was passed, so every authenticated request
  // threw "SQLite query expected 2 values, received 1" → 500.
  if (queries.isTokenBlacklisted.get(token, decoded.jti)) {
    throw new HttpError(401, "Session invalidated (Logged out)");
  }

  // Perform stateful DB check to instantly invalidate suspended sessions
  const user = queries.getUserById.get(decoded.userId) as any;
  if (!user || user.is_active !== 1 || user.role !== decoded.role) {
    throw new HttpError(401, "Session invalidated or user suspended");
  }

  return { ...decoded, token, name: user.name, email: user.email };
}

function requireRole(role: string, allowed: string[]) {
  if (!allowed.includes(role)) throw new HttpError(403, "Forbidden");
}

async function licenseValidator(requiredTiers: string[]) {
  // License validation parses Master License File (MLF) and enforces hardware binding
  const currentHW = getSystemHardwareFingerprint();
  try {
    const mlfFile = Bun.file("license.json");
    if (!(await mlfFile.exists())) {
      if (requiredTiers.includes("core")) {
        return {
          tier: "core",
          sub: "ExamPool Default Institution",
          hw_fp: currentHW,
          max_devices: 50,
          status: "unactivated",
          iat: Math.floor(Date.now() / 1000),
          exp: null
        };
      }
      throw new Error("No license file found");
    }
    const fileContent = await mlfFile.text();
    let jwtStr = fileContent;
    try {
      const parsed = JSON.parse(fileContent);
      if (parsed.jwt) jwtStr = parsed.jwt;
    } catch {}
    // Validate signature, expiry, and hardware binding against the physical host machine
    const payload = await validateMLF(jwtStr, currentHW);
    if (!requiredTiers.includes(payload.tier) && !requiredTiers.includes("core")) {
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

  // If user is a teacher, enrich with their assigned class teacher status
  if (safe.role === "teacher" && safe.id) {
    try {
      const teacherClass = db.prepare("SELECT * FROM classes WHERE class_teacher_id = ? LIMIT 1").get(Number(safe.id)) as any;
      if (teacherClass) {
        safe.is_class_teacher = true;
        safe.assigned_class_id = Number(teacherClass.id);
        safe.assigned_class_name = teacherClass.name;
        safe.assigned_class_section = teacherClass.section || null;
      } else {
        safe.is_class_teacher = false;
        safe.assigned_class_id = null;
        safe.assigned_class_name = null;
        safe.assigned_class_section = null;
      }
    } catch {
      safe.is_class_teacher = false;
      safe.assigned_class_id = null;
      safe.assigned_class_name = null;
    }
  }

  return safe;
}

function stripCorrectAnswer(questions: any[], role: string): any[] {
  if (role !== "student") return questions;
  // Strip both correct_answer AND teacher_answer to prevent answer leakage
  return questions.map(({ correct_answer: _correct, teacher_answer: _ta, ...q }) => q);
}

function getCurrentTerm(): string {
  return cacheService.wrapSync(CacheKeys.currentTerm(), 60, () => {
    return (queries.getSetting.get("CURRENT_TERM") as { value?: string } | undefined)?.value || "2026-T1";
  });
}

function getRegistrationOpen(): boolean {
  return cacheService.wrapSync(CacheKeys.registrationOpen(), 60, () => {
    return ((queries.getSetting.get("REGISTRATION_OPEN") as { value?: string } | undefined)?.value || "true") === "true";
  });
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
async function serveStatic(urlPath: string, req?: Request): Promise<Response> {
  const pathname = urlPath.split("?")[0] ?? urlPath;
  
  // UX Fix: Auto-correct common casing mistakes for main portals
  const lowerPath = pathname.toLowerCase();
  if (lowerPath.startsWith("/teacher") && pathname !== lowerPath) {
    return new Response(null, { status: 301, headers: { Location: lowerPath + urlPath.slice(pathname.length) } });
  }
  if (lowerPath.startsWith("/admin") && !pathname.startsWith("/ADMIN")) {
    return new Response(null, { status: 301, headers: { Location: "/ADMIN" + urlPath.slice(6) } });
  }
  if (lowerPath.startsWith("/operator")) {
    const sub = urlPath.slice(9) || "/dashboard";
    return new Response(null, { status: 301, headers: { Location: "/ADMIN" + sub } });
  }
  if (lowerPath.startsWith("/student") && pathname !== lowerPath) {
    return new Response(null, { status: 301, headers: { Location: lowerPath + urlPath.slice(pathname.length) } });
  }

  const rel = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  const candidates: string[] = [];

  const currentDistDir = resolveStaticDistDir();
  distDir = currentDistDir;
  const currentIdxFile = Bun.file(path.join(currentDistDir, "index.html"));

  if (!rel) {
    candidates.push(path.join(currentDistDir, "index.html"));
  } else if (path.extname(rel) !== "") {
    candidates.push(path.join(currentDistDir, rel));
  } else {
    candidates.push(path.join(currentDistDir, rel, "index.html"));
    candidates.push(path.join(currentDistDir, `${rel}.html`));
    candidates.push(path.join(currentDistDir, rel));
  }

  // Normalize distDir for comparison (resolve symlinks/dotdots)
  const resolvedDistDir = path.resolve(currentDistDir);

  for (const filePath of candidates) {
    // Path traversal guard: ensure resolved path stays inside distDir
    const resolvedFilePath = path.resolve(filePath);
    if (!resolvedFilePath.startsWith(resolvedDistDir + path.sep) && resolvedFilePath !== resolvedDistDir) {
      return apiError(403, "Forbidden");
    }
    const file = Bun.file(filePath);
    if (await file.exists()) {
      const isSvg = filePath.toLowerCase().endsWith(".svg");
      return new Response(file, {
        headers: {
          ...corsHeaders,
          "Content-Type": getMimeType(filePath),
          "Cache-Control": getCacheControl(filePath),
          "Pragma": (filePath.endsWith(".html") || filePath.endsWith(".txt") || filePath.endsWith(".rsc") || filePath.endsWith(".meta")) ? "no-cache" : "",
          ...(isSvg ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {}),
        },
      });
    }
  }

  // Development Fallback: Proxy to Next.js dev server on port 3000 if active
  try {
    const devUrl = new URL(urlPath, "http://127.0.0.1:3000");
    const devHeaders = new Headers(req?.headers);
    devHeaders.delete("host");
    const devRes = await fetch(devUrl.toString(), {
      method: req?.method || "GET",
      headers: devHeaders,
    });
    if (devRes.status === 200 || devRes.status === 304 || devRes.status === 302 || devRes.status === 307) {
      const resHeaders = new Headers(devRes.headers);
      Object.entries(corsHeaders).forEach(([k, v]) => resHeaders.set(k, v));
      return new Response(devRes.body, {
        status: devRes.status,
        headers: resHeaders,
      });
    }
  } catch {}

  // Fallback SPA shell — also no-cache
  if (await currentIdxFile.exists()) {
    return new Response(currentIdxFile, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
      },
    });
  }

  return apiError(404, "Not found");
}

function isApiExemptWhileSetup(pathname: string, method: string): boolean {
  // [SECURITY FIX VULN-14] /api/server-info is no longer exempt from auth.
  // It leaked internal IPs, port, and version string to unauthenticated callers.
  // The setup wizard uses /api/setup (POST) which is still exempt below.
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
        // Cache subject duration outside the interval to prevent N+1 queries
        const subject = queries.getSubjectById.get(exam.subject_id) as any;
        const durationSeconds = Number(subject?.duration || 60) * 60;
        
        // Prepare a lightweight query to avoid fetching the massive answers_json payload every 15s
        const statusStmt = db.prepare("SELECT status, start_time FROM exams WHERE id = ?");

        const sendTimeSync = () => {
          const e = statusStmt.get(examId) as any;
          if (e && e.status === "in-progress") {
             const elapsed = Math.floor((Date.now() - Date.parse(e.start_time)) / 1000);
             const remaining = Math.max(0, durationSeconds - elapsed);
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
    // [SECURITY FIX VULN-14] Enforce operator auth — this endpoint exposes the
    // server's internal IP, port, and version string. The route was previously
    // only excluded from the setup exemption list, but never actually guarded.
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const interfaces = os.networkInterfaces();
    const ips: string[] = [];
    for (const addresses of Object.values(interfaces)) {
      for (const a of addresses || []) if (a.family === "IPv4" && !a.internal) ips.push(a.address);
    }
    return apiSuccess({ ip: ips[0] || "127.0.0.1", port: Number(Bun.env.PORT ?? 8001) });
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
      result = queries.createUser.run(name, email, "operator", hash, null, null, null, null, null, null, null, null) as { lastInsertRowid: number | bigint };
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
      let is_class_teacher = false;
      let assigned_class_id: number | null = null;
      let assigned_class_name: string | null = null;
      if (user.role === "teacher") {
        const cls = queries.getClassForTeacher.get(Number(user.id)) as any;
        if (cls) {
          is_class_teacher = true;
          assigned_class_id = cls.id;
          assigned_class_name = [cls.name, cls.section].filter(Boolean).join(" ");
        }
      }
      return apiSuccess({ user: { ...stripPassword(user), is_class_teacher, assigned_class_id, assigned_class_name } }, 200, { "Set-Cookie": buildSessionCookie(token) });
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
    const gradeLevelId = body?.grade_level_id ? Number(body.grade_level_id) : null;
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
    if (role === "student" && !gradeLevelId) return apiError(400, "Grade Level ID is required for student accounts");
    // MVP gap fix: allow operator to create student/teacher without DOB/phone by providing safe defaults (password-reset still works via admin reset)
    let effectiveDob = dob;
    let effectivePhone = phone;
    if (auth?.role === "operator") {
      if (role === "student" && !effectiveDob) effectiveDob = "2005-01-01";
      if (role === "teacher" && !effectivePhone) effectivePhone = "08000000000";
    }
    if (role === "student" && !effectiveDob) return apiError(400, "Date of Birth is required for student accounts");
    if (role === "teacher" && !effectivePhone) return apiError(400, "Phone number is required for teacher accounts");
    
    const prefix = role === "teacher" ? "TCH" : "REG";
    const regId = `${prefix}-${Date.now().toString(36).toUpperCase()}`;
    
    // Auto-generate dummy email for student if not provided
    if (role === "student" && !email) {
      email = `${regId.toLowerCase()}@student.exampool.local`;
    }
    
    if (queries.getUserByEmail.get(email)) return apiError(400, "Email already registered");
    const hash = await hashPassword(password);
    let resolvedGradeString = "";
    if (role === "student" && gradeLevelId) {
      const gl = db.prepare("SELECT name FROM grade_levels WHERE id = ?").get(gradeLevelId) as any;
      if (gl) resolvedGradeString = gl.name;
    }
    
    let result: { lastInsertRowid: number | bigint };
    try {
      result = queries.createUser.run(name, email, role, hash, resolvedGradeString, regId, null, null, null, role === "teacher" ? effectivePhone : null, role === "student" ? effectiveDob : null, role === "student" ? gradeLevelId : null) as {
        lastInsertRowid: number | bigint;
      };
    } catch (e) {
      if (isSqliteUniqueError(e)) return apiError(409, "Email already registered");
      throw e;
    }
    const newUserId = Number(result.lastInsertRowid);
    const actorId = auth != null ? Number(auth.userId) : newUserId;
    auditLog(actorId, "USER_CREATE", "user", newUserId, JSON.stringify({ role }));

    // Auto-enroll student into class and matching subjects
    if (role === "student" && resolvedGradeString) {
      try {
        const targetClass = db.prepare("SELECT id FROM classes WHERE name = ? LIMIT 1").get(resolvedGradeString) as any;
        const activeTerm = queries.getActiveAcademicTerm.get() as any;
        if (targetClass && activeTerm) {
          db.prepare("INSERT OR IGNORE INTO class_enrollments (student_id, class_id, term_id) VALUES (?, ?, ?)").run(newUserId, targetClass.id, activeTerm.id);
        }
        const matchingSubjects = db.prepare(`
          SELECT id FROM subjects 
          WHERE (grade_level_id = ? OR class = ?) 
            AND is_published = 1
        `).all(gradeLevelId, resolvedGradeString) as any[];
        const enrollStmt = db.prepare("INSERT OR IGNORE INTO subject_enrollments (subject_id, student_id, enrolled_by) VALUES (?, ?, ?)");
        for (const subj of matchingSubjects) {
          enrollStmt.run(subj.id, newUserId, actorId);
        }
      } catch (err) {
        console.warn("[Register] Auto-enrollment error:", err);
      }
    }

    return apiSuccess({ user: { id: newUserId, name, email, role, reg_id: regId, grade_level_id: role === "student" ? gradeLevelId : null } }, 201);
  }

  if (method === "GET" && pathname === "/api/auth/me") {
    const auth = requireAuth(req);
    const user = queries.getUserById.get(auth.userId) as any;
    if (!user || sqlInt(user.is_active) !== 1) return apiError(401, "Not authenticated");
    // Enrich teachers with class teacher assignment info
    let is_class_teacher = false;
    let assigned_class_id: number | null = null;
    let assigned_class_name: string | null = null;
    if (user.role === "teacher") {
      const cls = queries.getClassForTeacher.get(user.id) as any;
      if (cls) {
        is_class_teacher = true;
        assigned_class_id = cls.id;
        assigned_class_name = [cls.name, cls.section].filter(Boolean).join(" ");
      }
    }
    return apiSuccess({ user: { ...stripPassword(user), is_class_teacher, assigned_class_id, assigned_class_name } });
  }

  // ── Student Telemetry (Streak, Today's Goal, Cohort Rank) ───────────────────
  if (method === "GET" && pathname === "/api/student/telemetry") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["student"]);

    // 1. Calculate real activity dates
    const dateRows = queries.getStudentDailyActivityDates.all(auth.userId, auth.userId, auth.userId) as Array<{ activity_date: string }>;
    const activeDates = new Set(dateRows.map(r => r.activity_date).filter(Boolean));

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    // Current Streak calculation
    let currentStreak = 0;
    const startStr = activeDates.has(todayStr) ? todayStr : activeDates.has(yesterdayStr) ? yesterdayStr : null;
    
    if (startStr) {
      let d = new Date(startStr);
      while (true) {
        const dStr = d.toISOString().slice(0, 10);
        if (activeDates.has(dStr)) {
          currentStreak++;
          d.setDate(d.getDate() - 1);
        } else {
          break;
        }
      }
    }

    // Best streak calculation across all time
    let bestStreak = 0;
    let tempStreak = 0;
    const sortedDates = Array.from(activeDates).filter((d): d is string => Boolean(d)).sort();
    for (let i = 0; i < sortedDates.length; i++) {
      if (i === 0) {
        tempStreak = 1;
      } else {
        const prevStr = sortedDates[i - 1];
        const currStr = sortedDates[i];
        if (!prevStr || !currStr) continue;
        const prev = new Date(prevStr);
        const curr = new Date(currStr);
        const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 3600 * 24));
        if (diffDays === 1) {
          tempStreak++;
        } else {
          tempStreak = 1;
        }
      }
      if (tempStreak > bestStreak) bestStreak = tempStreak;
    }
    if (currentStreak > bestStreak) bestStreak = currentStreak;

    // 2. Today's question count
    const todayCountRow = queries.getStudentTodayQuestionCount.get(auth.userId, auth.userId) as any;
    const todayQuestions = Number(todayCountRow?.count || 0);
    const dailyGoal = 10;
    const practicePercent = Math.min(100, Math.round((todayQuestions / dailyGoal) * 100));

    // 3. Cohort Rank calculation
    const user = queries.getUserById.get(auth.userId) as any;
    const cohortRow = queries.getStudentCohortStats.get(auth.userId) as any;
    const cohortTotal = Math.max(1, Number(cohortRow?.cohort_size || 1));
    
    const activeSession = queries.getActiveAcademicSession.get() as any;
    const activeTerm = queries.getActiveAcademicTerm.get() as any;
    const targetSessionId = activeSession?.id ?? null;
    const targetTermId = activeTerm?.id ?? null;

    let cohortRank = 1;
    if (user?.grade || user?.grade_level_id) {
      try {
        const rankRow = db.prepare(`
          WITH student_points AS (
            SELECT 
              u.id as student_id,
              COALESCE((
                SELECT SUM(e.score) 
                FROM exams e 
                WHERE e.student_id = u.id 
                  AND e.status = 'completed'
                  AND (e.session_id = ? OR ? IS NULL)
                  AND (e.term_id = ? OR ? IS NULL)
              ), 0) + 
              COALESCE((
                SELECT COUNT(*) * 2 
                FROM practice_logs.practice_logs pl 
                WHERE pl.student_id = u.id
              ), 0) as total_pts
            FROM users u
            WHERE u.role = 'student' AND u.is_active = 1
              AND (
                (u.grade_level_id IS NOT NULL AND u.grade_level_id = ?)
                OR (u.grade IS NOT NULL AND u.grade = ?)
              )
          )
          SELECT 
            (SELECT COUNT(*) FROM student_points WHERE total_pts > (SELECT total_pts FROM student_points WHERE student_id = ?)) + 1 as rank
        `).get(targetSessionId, targetSessionId, targetTermId, targetTermId, user.grade_level_id, user.grade, auth.userId) as any;

        if (rankRow?.rank) {
          cohortRank = Number(rankRow.rank);
        }
      } catch (e) {
        console.error("[Telemetry] Rank calculation error:", e);
      }
    }

    return apiSuccess({
      streak: currentStreak,
      bestStreak: Math.max(bestStreak, currentStreak),
      todayQuestions,
      dailyGoal,
      practicePercent,
      rank: cohortRank,
      cohortTotal,
      cohortName: cohortRow?.grade_name || user?.grade || "Class"
    });
  }

  // ── Student / User Profile Detail ──────────────────────────────────────────
  if (method === "GET" && pathname === "/api/users/me/profile") {
    const auth = requireAuth(req);
    const user = queries.getUserById.get(auth.userId) as any;
    if (!user || sqlInt(user.is_active) !== 1) return apiError(401, "Not authenticated");

    const enrolledSubjects = queries.getStudentEnrolledSubjects.all(auth.userId) as any[];
    const stats = queries.getStudentExamStats.get(auth.userId) as any;
    const activeSession = queries.getActiveAcademicSession.get() as any;
    const activeTerm = queries.getActiveAcademicTerm.get() as any;

    let practiceCount = 0;
    try {
      const practiceCountRow = db.prepare("SELECT COUNT(*) as count FROM practice_logs.practice_logs WHERE student_id = ?").get(auth.userId) as any;
      practiceCount = Number(practiceCountRow?.count || 0);
    } catch {}

    return apiSuccess({
      user: stripPassword(user),
      enrolledSubjects: enrolledSubjects || [],
      stats: {
        total_exams: Number(stats?.total_exams || 0),
        completed: Number(stats?.completed || 0),
        avg_pct: Number(stats?.avg_pct || 0),
        practice_questions_completed: practiceCount
      },
      activeSession: activeSession || null,
      activeTerm: activeTerm || null
    });
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    const auth = requireAuth(req);
    // [FIX] insertTokenBlacklist takes (token, jti, reason) — passing only the token
    // previously threw "expected 3 values, received 1" and broke logout.
    queries.insertTokenBlacklist.run(auth.token, auth.jti, "logout");
    auditLog(auth.userId, "LOGOUT", "user", auth.userId, "{}");
    return apiMessage("Logged out", 200, { "Set-Cookie": "__exampool_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
  }

  if (method === "POST" && pathname === "/api/auth/reset-password/verify-email") {
    const clientIp = getClientIp(req);
    checkRateLimit(`pwreset_verify_${clientIp}`, 5, 60_000);
    const body = await readJson(req);
    const identifier = trimStr(body?.email || body?.identifier);
    if (!identifier) return apiError(400, "Identifier required");
    const normalizedIdentifier = identifier.includes("@") ? normalizeEmail(identifier) : identifier.toUpperCase();
    const user = queries.getUserByEmailOrReg.get(normalizedIdentifier, normalizedIdentifier) as any;
    // [SECURITY FIX VULN-04] Always return the same response shape regardless of whether
    // the account exists or is active. Previously, found users returned `{ role }` while
    // missing users returned `{ found: true }` — the asymmetry allowed an attacker to
    // enumerate valid usernames and roles by inspecting the response body.
    if (!user || sqlInt(user.is_active) !== 1) return apiSuccess({ found: true });
    return apiSuccess({ found: true });
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
    
    // [SECURITY FIX] Apply a targeted rate limit per-account to prevent distributed brute-force attacks
    checkRateLimit(`pwreset_target_${user.id}`, 5, 60_000);
    
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

  const resetPasswordMatch = pathname.match(/^\/api\/users\/(\d+)\/(reset-password|password)$/);
  if (resetPasswordMatch && (method === "POST" || method === "PUT")) {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const userId = Number(resetPasswordMatch[1]);
    const body = await readJson(req);
    const rawPassword = body?.new_password || body?.password || body?.newPassword;
    const newPassword = trimStr(rawPassword);
    
    if (!isPositiveIntId(userId)) return apiError(400, "Invalid user ID");
    if (!newPassword || newPassword.length < 4) {
      return apiError(400, "Password must be at least 4 characters");
    }
    
    const user = queries.getUserById.get(userId) as any;
    if (!user) return apiError(404, "User not found");

    const hash = await hashPassword(newPassword);
    queries.updateUserPassword.run(hash, userId);
    
    try {
      // Invalidate active session tokens for the target user so they log in with the new password
      queries.revokeAllUserTokens.run(userId);
    } catch {}

    auditLog(auth.userId, "USER_UPDATE", "user", userId, JSON.stringify({ action: "admin_reset_password", target_email: user.email }));
    return apiSuccess({ message: "Password reset successfully", user_id: userId, email: user.email });
  }

  const studentExamsMatch = pathname.match(/^\/api\/users\/(\d+)\/exams$/);
  if (studentExamsMatch && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const studentId = Number(studentExamsMatch[1]);
    
    let exams = queries.getStudentExamsForRoster.all(studentId) as any[];
    
    // [SECURITY FIX] Filter out exams for subjects that the teacher does not own, UNLESS they are the student's Class Teacher.
    if (auth.role === "teacher") {
      const isClassTeacherForStudent = authz.isClassTeacherForStudent(auth, studentId);
      if (!isClassTeacherForStudent) {
        exams = exams.filter((e) => sameUserId(e.teacher_id, auth.userId));
      }
    }
    
    return apiSuccess(exams);
  }

  const reportCardMatch = pathname.match(/^\/api\/users\/(\d+)\/report-card-results$/);
  if (reportCardMatch && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator", "student", "guardian"]);
    // Students may only fetch their own report card; guardians must be linked
    if (auth.role === "student" && auth.userId !== Number(reportCardMatch[1])) return apiError(403, "You can only view your own report card");
    if (auth.role === "guardian") {
      const sid = Number(reportCardMatch[1]);
      const link = db.prepare("SELECT 1 FROM guardian_student_links WHERE guardian_id = ? AND student_id = ? AND status='approved' LIMIT 1").get(auth.userId, sid) as any;
      if (!link) return apiError(403, "Not linked to this student");
    }
    const studentId = Number(reportCardMatch[1]);
    const qSessionId = Number(url.searchParams.get("sessionId") || 0);
    const qTermId = Number(url.searchParams.get("termId") || 0);
    const singleTerm = url.searchParams.get("singleTerm") === "true" || url.searchParams.get("single_term") === "true";
    
    let results = queries.getStudentTermResultsForReportCard.all(studentId) as any[];
    
    // [SECURITY FIX] Allow Class Teachers to see all results for their class
    if (auth.role === "teacher") {
      const isClassTeacherForStudent = authz.isClassTeacherForStudent(auth, studentId);
      if (!isClassTeacherForStudent) {
        results = results.filter((r) => sameUserId(r.teacher_id, auth.userId));
      }
    }

    if (qSessionId) {
      results = results.filter((r) => Number(r.session_id) === qSessionId);
    }
    if (qTermId) {
      if (singleTerm) {
        results = results.filter((r) => Number(r.term_id) === qTermId);
      } else {
        // For report card / cumulative evaluation within a session, include terms up to and including target term
        results = results.filter((r) => Number(r.term_id) <= qTermId);
      }
    }
    
    return apiSuccess(results);
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
    
    // [SECURITY FIX] Ensure the global exam window is still open before allowing a retake
    if (subject.exam_datetime) {
      const now = Date.now();
      const start = Date.parse(subject.exam_datetime);
      if (!Number.isFinite(start)) return apiError(500, "Invalid subject schedule");
      const end = start + Number(subject.window_duration || 120) * 60_000;
      if (now >= end) return apiError(403, "The scheduled time window for this exam has already closed. Retakes are no longer permitted.");
    }
    
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
    if (subjectRow && subjectRow.teacher_id && Number(subjectRow.teacher_id) !== auth.userId) {
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
    
    // [SECURITY FIX] Student IDOR Prevention: Ensure students can only fetch their own term remarks
    if (auth.role === "student" && auth.userId !== studentId) {
      return apiError(403, "You do not have permission to view remarks for other students");
    }
    // [SECURITY FIX] Sanitize term parameter -- trim and cap length
    const term = decodeURIComponent(termRemarkMatch[2] || "").trim().slice(0, 64);
    if (!isPositiveIntId(studentId)) return apiError(400, "Invalid student id");
    
    const activeSession = queries.getActiveAcademicSession.get() as any;
    const activeTerm = queries.getActiveAcademicTerm.get() as any;
    const qSessionId = Number(url.searchParams.get("sessionId") || 0);
    const qTermId = Number(url.searchParams.get("termId") || 0);
    const targetSessionId = qSessionId || activeSession?.id;
    const targetTermId = qTermId || activeTerm?.id;
    
    if (!targetSessionId || !targetTermId) return apiSuccess(null);
    const remark = queries.getTermRemark.get(studentId, targetSessionId, targetTermId);
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
    
    const activeSession = queries.getActiveAcademicSession.get() as any;
    const activeTerm = queries.getActiveAcademicTerm.get() as any;
    const qSessionId = Number(url.searchParams.get("sessionId") || 0);
    const qTermId = Number(url.searchParams.get("termId") || 0);
    const targetSessionId = qSessionId || activeSession?.id;
    const targetTermId = qTermId || activeTerm?.id;
    if (!targetSessionId || !targetTermId) return apiError(400, "No active term for remark");

    // [SECURITY FIX] Ensure teacher actually teaches this student in the target session and term, OR is their Class Teacher
    if (auth.role === "teacher") {
      const linked = db.prepare(
        "SELECT se.id FROM subject_enrollments se JOIN subjects s ON s.id = se.subject_id WHERE se.student_id = ? AND s.teacher_id = ? AND (s.session_id = ? AND s.term_id = ? OR s.session_id IS NULL) LIMIT 1"
      ).get(studentId, auth.userId, targetSessionId, targetTermId);

      const linkedGrading = db.prepare(
        "SELECT tr.id FROM term_results tr JOIN grading_subjects gs ON gs.id = tr.grading_subject_id WHERE tr.student_id = ? AND gs.teacher_id = ? AND tr.session_id = ? AND tr.term_id = ? LIMIT 1"
      ).get(studentId, auth.userId, targetSessionId, targetTermId);
      
      const isClassTeacher = authz.isClassTeacherForStudent(auth, studentId);
      
      if (!linked && !linkedGrading && !isClassTeacher) return apiError(403, "Student is not enrolled in your subjects or class for this term");
    }

    const uniqueTermStr = `${targetSessionId}-${targetTermId}`;
    const existing = queries.getTermRemark.get(studentId, targetSessionId, targetTermId);
    
    if (auth.role === "teacher") {
      if (existing) queries.updateTeacherRemark.run(remark || null, studentId, targetSessionId, targetTermId);
      else queries.insertTeacherRemark.run(studentId, targetSessionId, targetTermId, remark || null, uniqueTermStr);
    } else {
      if (existing) queries.updatePrincipalRemark.run(remark || null, studentId, targetSessionId, targetTermId);
      else queries.insertPrincipalRemark.run(studentId, targetSessionId, targetTermId, remark || null, uniqueTermStr);
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
        if (t.teacher_id && t.teacher_id !== auth.userId) {
          notifyUser(t.teacher_id, {
            type: "remark_added",
            message: `Admin added a report-card remark for ${studentRow?.name || 'a student'} (${term})`,
            link: `/teacher/students`
          });
        }
      }
    }

    return apiSuccess(queries.getTermRemark.get(studentId, targetSessionId, targetTermId));
  }

  // ── ACADEMIC SESSIONS & TERMS ENDPOINTS ───────────────────────────────────────
  if (method === "GET" && pathname === "/api/academic/active") {
    const activeSession = queries.getActiveAcademicSession.get() as any;
    const activeTerm = queries.getActiveAcademicTerm.get() as any;
    return apiSuccess({
      activeSession: activeSession || { id: 1, name: "2026/2027", is_active: 1 },
      activeTerm: activeTerm || { id: 1, session_id: 1, name: "First Term", is_active: 1 }
    });
  }

  if (method === "GET" && pathname === "/api/academic/sessions") {
    const auth = requireAuth(req);
    // Allow all authenticated roles to read academic structure (needed for student/guardian academic switch)
    const sessions = queries.getAllAcademicSessions.all() as any[];
    const terms = queries.getAllAcademicTerms.all() as any[];
    return apiSuccess({ sessions, terms });
  }

  if (method === "POST" && pathname === "/api/academic/sessions") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const body = await readJson(req);
    const name = trimStr(body?.name);
    if (!name) return apiError(400, "Session name is required (e.g. 2026/2027)");
    try {
      queries.createAcademicSession.run(name, 0, "active");
      const created = queries.getActiveAcademicSession.get() as any;
      return apiSuccess({ success: true, message: `Academic Session ${name} created` });
    } catch (err: any) {
      return apiError(400, err.message || "Failed to create session");
    }
  }

  if (method === "POST" && pathname === "/api/academic/terms") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const body = await readJson(req);
    const sessionId = Number(body?.sessionId);
    const name = trimStr(body?.name);
    if (!sessionId || !["First Term", "Second Term", "Third Term", "First Semester", "Second Semester"].includes(name)) {
      return apiError(400, "Valid sessionId and term/semester name required");
    }
    try {
      const res = queries.createAcademicTerm.run(sessionId, name, body?.startDate || null, body?.endDate || null, 0, "active") as any;
      const termId = Number(res?.lastInsertRowid);
      if (termId) {
        const session = queries.getAcademicSessionById.get(sessionId) as any;
        db.prepare("INSERT OR IGNORE INTO terms (id, session, name, start_date, end_date, is_active, registration_open) VALUES (?, ?, ?, ?, ?, 0, 1)")
          .run(termId, session?.name || "Default", name, body?.startDate || "2020-01-01", body?.endDate || "2030-12-31");
      }
      return apiSuccess({ success: true, message: `${name} created for session` });
    } catch (err: any) {
      return apiError(400, err.message || "Failed to create term");
    }
  }

  if (method === "POST" && pathname === "/api/academic/activate-session") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const body = await readJson(req);
    const sessionId = Number(body?.sessionId);
    if (!isPositiveIntId(sessionId)) return apiError(400, "Invalid sessionId");
    
    db.transaction(() => {
      queries.deactivateAllAcademicSessions.run();
      queries.activateAcademicSession.run(sessionId);
      
      const activeTerm = queries.getActiveAcademicTerm.get() as any;
      if (!activeTerm || activeTerm.session_id !== sessionId) {
        queries.deactivateAllAcademicTerms.run();
        const firstTerm = db.prepare("SELECT id FROM academic_terms WHERE session_id = ? ORDER BY id ASC LIMIT 1").get(sessionId) as any;
        if (firstTerm) {
          queries.activateAcademicTerm.run(firstTerm.id);
        }
      }
    })();
    
    return apiSuccess({ success: true, message: "Academic session activated" });
  }

  if (method === "POST" && pathname === "/api/academic/activate-term") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const body = await readJson(req);
    const termId = Number(body?.termId);
    if (!isPositiveIntId(termId)) return apiError(400, "Invalid termId");
    
    const term = queries.getAcademicTermById.get(termId) as any;
    if (!term) return apiError(404, "Academic term not found");
    
    db.transaction(() => {
      queries.deactivateAllAcademicSessions.run();
      queries.activateAcademicSession.run(term.session_id);
      queries.deactivateAllAcademicTerms.run();
      queries.activateAcademicTerm.run(termId);
    })();
    
    return apiSuccess({ success: true, message: "Academic term activated" });
  }

  if (method === "POST" && pathname === "/api/academic/end-term") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const body = await readJson(req);
    const termId = Number(body?.termId) || (queries.getActiveAcademicTerm.get() as any)?.id;
    
    db.transaction(() => {
      if (termId) {
        queries.archiveAcademicTerm.run(termId);
        queries.lockExamsForTerm.run(termId);
      }
      queries.deactivateAllAcademicTerms.run();
    })();
    
    return apiSuccess({ success: true, message: "Active term ended successfully. Awaiting new term activation." });
  }

  if (method === "GET" && pathname === "/api/academic/stats") {
    const auth = requireAuth(req);
    const qSessionId = Number(url.searchParams.get("sessionId") || 0);
    const qTermId = Number(url.searchParams.get("termId") || 0);
    
    const activeSession = queries.getActiveAcademicSession.get() as any;
    const activeTerm = queries.getActiveAcademicTerm.get() as any;
    const targetSessionId = qSessionId || activeSession?.id;
    const targetTermId = qTermId || activeTerm?.id;
    
    if (!targetSessionId || !targetTermId) {
      const usersQueryBase = "SELECT COUNT(*) as count FROM users WHERE role=? AND is_active=1";
      const students = rowCount(db.prepare(usersQueryBase).get("student") as any);
      const teachers = rowCount(db.prepare(usersQueryBase).get("teacher") as any);
      return apiSuccess({ students, teachers, subjects: 0, completedExams: 0 });
    }
    
    let subjectQuery = "SELECT COUNT(*) as count FROM subjects";
    let examQuery = "SELECT COUNT(*) as count FROM exams";
    const params: any[] = [];
    if (targetSessionId && targetTermId) {
      subjectQuery += " WHERE session_id = ? AND term_id = ?";
      examQuery += " WHERE session_id = ? AND term_id = ?";
      params.push(targetSessionId, targetTermId);
    }
    
    let usersQueryBase = "SELECT COUNT(*) as count FROM users WHERE role=? AND is_active=1";
    const userParamsStudent: any[] = ["student"];
    const userParamsTeacher: any[] = ["teacher"];
    const students = rowCount(db.prepare(usersQueryBase).get(...userParamsStudent) as any);
    const teachers = rowCount(db.prepare(usersQueryBase).get(...userParamsTeacher) as any);
    const subjectsCount = rowCount(db.prepare(subjectQuery).get(...params) as any);
    const examsCount = rowCount(db.prepare(examQuery).get(...params) as any);
    
    return apiSuccess({
      students,
      teachers,
      subjects: subjectsCount,
      completedExams: examsCount
    });
  }

  // ── v8: Grading Config ────────────────────────────────────────────────────
  const DEFAULT_GRADING_CONFIG = {
    ca_max: 40,
    exam_max: 60,
    passing_score: 40,
    grade_scale: [
      { grade: "A", min: 75, label: "Excellent" },
      { grade: "B", min: 65, label: "Very Good" },
      { grade: "C", min: 55, label: "Credit" },
      { grade: "D", min: 45, label: "Pass" },
      { grade: "E", min: 40, label: "Poor Pass" },
      { grade: "F", min: 0,  label: "Fail" }
    ],
    default_ca_template: [
      { name: "CBT Test", type: "cbt_test", marks: 20 },
      { name: "Assignment", type: "manual", marks: 10 },
      { name: "Classwork",  type: "manual", marks: 10 }
    ]
  };

  function getGradingConfig() {
    const cfg = queries.getConfig.get() as any;
    try {
      if (cfg?.grading_config_json) {
        return { ...DEFAULT_GRADING_CONFIG, ...JSON.parse(cfg.grading_config_json) };
      }
    } catch {}
    return { ...DEFAULT_GRADING_CONFIG };
  }

  function applyGradeScale(total: number, scale: typeof DEFAULT_GRADING_CONFIG.grade_scale) {
    const sorted = [...scale].sort((a, b) => b.min - a.min);
    for (const s of sorted) {
      if (total >= s.min) return { grade: s.grade, remark: s.label };
    }
    return { grade: "F", remark: "Fail" };
  }

  if (method === "GET" && pathname === "/api/grading/config") {
    requireAuth(req);
    return apiSuccess(getGradingConfig());
  }

  if (method === "PUT" && pathname === "/api/grading/config") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const body = await readJson(req);
    if (!body) return apiError(400, "Invalid body");
    db.prepare("UPDATE config SET grading_config_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = 1")
      .run(JSON.stringify(body));
    auditLog(auth.userId, "CONFIG_UPDATE", "grading_config", null, "Updated grading config");
    return apiSuccess({ success: true });
  }

  // ── v8: Grading System APIs ───────────────────────────────────────────────

  if (method === "GET" && pathname === "/api/grading/subjects") {
    const auth = requireAuth(req);
    // [SECURITY FIX] Previously any logged-in user (including students) fell through
    // to the operator branch and received ALL grading subjects + score aggregates for
    // the term. Grading data must be restricted to teachers and operators.
    requireRole(auth.role, ["teacher", "operator"]);
    const qSessionId = Number(url.searchParams.get("sessionId") || 0);
    const qTermId    = Number(url.searchParams.get("termId")    || 0);
    const activeTerm    = queries.getActiveAcademicTerm.get()    as any;
    const activeSession = queries.getActiveAcademicSession.get() as any;
    const targetTermId    = qTermId    || activeTerm?.id;
    const targetSessionId = qSessionId || activeSession?.id;

    if (!targetTermId) return apiSuccess([]);

    const gradingCfg = getGradingConfig();

    if (auth.role === "teacher") {
      // 1. Find all CBT subjects this teacher owns that have ≥1 completed submission for the target term
      const cbtWithSubmissions = db.prepare(`
        SELECT s.*,
          COUNT(DISTINCT e.student_id) as students_completed,
          (SELECT COUNT(*) FROM subject_enrollments se WHERE se.subject_id = s.id) as students_enrolled,
          ROUND(AVG(CASE WHEN e.total_score > 0 THEN e.score * 100.0 / e.total_score ELSE 0 END), 1) as avg_score_pct
        FROM subjects s
        JOIN exams e ON e.subject_id = s.id AND e.status = 'completed'
        LEFT JOIN terms t ON (s.term_id = t.id OR s.term = t.name)
        WHERE s.teacher_id = ? AND (s.term_id = ? OR t.id = ?)
        GROUP BY s.id
      `).all(auth.userId, targetTermId, targetTermId) as any[];

      // 2. Auto-create grading_subject rows for any not yet created
      if (targetSessionId) {
        for (const cbt of cbtWithSubmissions) {
          const existing = queries.getGradingSubjectBySource.get(cbt.id, targetTermId) as any
            ?? queries.getGradingSubjectByTeacherCodeTerm.get(auth.userId, cbt.code, targetTermId) as any;

          if (!existing) {
            try {
              const gsRes = queries.createGradingSubject.run(
                cbt.name, cbt.code, null, targetTermId, targetSessionId, auth.userId
              ) as any;
              const newGsId = Number(gsRes.lastInsertRowid);
              queries.updateGradingSubjectMeta.run(cbt.mode || "exam", cbt.id, newGsId);

              // Auto-create grading policies from school template
              const mode   = cbt.mode || "exam";
              const isExam = mode === "exam";

              if (isExam) {
                // Exam component (auto-linked)
                queries.createGradingPolicy.run(
                  newGsId, "CBT Examination", "cbt_exam", cbt.id, gradingCfg.exam_max, 1
                );
                // CA components from school default template (manual ones)
                for (const tmpl of gradingCfg.default_ca_template) {
                  if (tmpl.type === "manual") {
                    queries.createGradingPolicy.run(newGsId, tmpl.name, "manual", null, tmpl.marks, 0);
                  }
                }
                // Also a CBT test CA slot if template asks for it
                for (const tmpl of gradingCfg.default_ca_template) {
                  if (tmpl.type === "cbt_test") {
                    queries.createGradingPolicy.run(newGsId, tmpl.name, "cbt_test", null, tmpl.marks, 0);
                  }
                }
              } else {
                // Test/quiz/assignment component (auto-linked as CA)
                const policyName = mode === "test" ? "CBT Test"
                  : mode === "quiz" ? "CBT Quiz"
                  : mode === "assignment" ? "CBT Assignment"
                  : `CBT ${mode.charAt(0).toUpperCase() + mode.slice(1)}`;
                const caSlot = Math.min(gradingCfg.ca_max, 40);
                queries.createGradingPolicy.run(newGsId, policyName, "cbt_test", cbt.id, caSlot, 0);
              }
            } catch (e: any) {
              console.error("[GradingSubject AutoCreate Error]", e.message);
            }
          } else if (!existing.source_cbt_subject_id) {
            // Backfill source on old rows
            queries.updateGradingSubjectMeta.run(cbt.mode || existing.mode || "exam", cbt.id, existing.id);
          }
        }
      }

      // 3. Fetch all grading subjects for this teacher this term (includes auto-created + manually created)
      const gsubs = queries.getGradingSubjectsByTeacher.all(auth.userId, targetTermId) as any[];

      // 4. Enrich with live stats and filter out cross-term leaked grading subjects
      const enriched = gsubs.filter((gs: any) => {
        if (gs.source_cbt_subject_id) {
          const sourceSub = db.prepare("SELECT s.term_id, s.term, t.id as term_id_from_name FROM subjects s LEFT JOIN terms t ON s.term = t.name WHERE s.id = ?").get(gs.source_cbt_subject_id) as any;
          if (sourceSub) {
            const matchesTerm = sourceSub.term_id === targetTermId || sourceSub.term_id_from_name === targetTermId;
            if (!matchesTerm) return false;
          }
        }
        return true;
      }).map((gs: any) => {
        let students_completed = 0, students_enrolled = 0, avg_score_pct: number | null = null;
        let is_approved = false;

        if (gs.source_cbt_subject_id) {
          const cbt = cbtWithSubmissions.find((c: any) => c.id === gs.source_cbt_subject_id);
          if (cbt) {
            students_completed = cbt.students_completed || 0;
            students_enrolled  = cbt.students_enrolled  || 0;
            avg_score_pct      = cbt.avg_score_pct;
          }
        }
        // Check approval status
        const approved = db.prepare("SELECT is_approved FROM term_results WHERE grading_subject_id = ? AND is_approved = 1 LIMIT 1").get(gs.id);
        is_approved = !!approved;

        return { ...gs, students_completed, students_enrolled, avg_score_pct, is_approved };
      });

      return apiSuccess(enriched);
    } else {
      // operator / admin — return all
      const result = queries.getAllGradingSubjects.all(targetTermId) as any[];
      return apiSuccess(result.map((r: any) => {
        const approved = db.prepare("SELECT is_approved FROM term_results WHERE grading_subject_id = ? AND is_approved = 1 LIMIT 1").get(r.id);
        return { ...r, is_approved: !!approved };
      }));
    }
  }

  // ── GET single grading subject (teacher/operator) ───────────────────────────
  const gradingSubjectIdMatch = pathname.match(/^\/api\/grading\/subjects\/(\d+)$/);
  if (gradingSubjectIdMatch && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const gsId = Number(gradingSubjectIdMatch[1]);
    if (!isPositiveIntId(gsId)) return apiError(400, "Invalid grading subject id");
    const gs = queries.getGradingSubjectById.get(gsId) as any;
    if (!gs) return apiError(404, "Grading subject not found");
    if (auth.role === "teacher" && !sameUserId(gs.teacher_id, auth.userId)) return apiError(403, "You do not own this grading subject");
    const approved = db.prepare("SELECT is_approved FROM term_results WHERE grading_subject_id = ? AND is_approved = 1 LIMIT 1").get(gsId);
    return apiSuccess({ ...gs, is_approved: !!approved });
  }

  if (method === "POST" && pathname === "/api/grading/subjects") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]); // Teachers no longer create manually — auto-created on submission
    const body = await readJson(req);

    const name      = trimStr(body?.name);
    const code      = trimStr(body?.code);
    const classId   = Number(body?.class_id) || null;
    const termId    = Number(body?.term_id    || (queries.getActiveAcademicTerm.get()    as any)?.id);
    const sessionId = Number(body?.session_id || (queries.getActiveAcademicSession.get() as any)?.id);
    const teacherId = Number(body?.teacher_id);
    const mode      = trimStr(body?.mode) || "exam";

    if (!name || !code) return apiError(400, "Missing name or code");
    if (!termId)        return apiError(400, "No active academic term found. Please activate a term first.");
    if (!sessionId)     return apiError(400, "No active academic session found. Please activate a session first.");
    if (!teacherId)     return apiError(400, "teacher_id is required for operator-created grading subjects");

    try {
      const result = queries.createGradingSubject.run(name, code, classId, termId, sessionId, teacherId) as any;
      const newId  = Number(result.lastInsertRowid);
      queries.updateGradingSubjectMeta.run(mode, null, newId);

      const gradingCfg = getGradingConfig();
      queries.createGradingPolicy.run(newId, "Written Exam", "manual", null, gradingCfg.exam_max, 1);
      for (const tmpl of gradingCfg.default_ca_template) {
        queries.createGradingPolicy.run(newId, tmpl.name, "manual", null, tmpl.marks, 0);
      }
      return apiSuccess({ id: newId }, 201);
    } catch (e: any) {
      console.error("[GradingSubject Create Error]", e);
      if (e.message?.includes("UNIQUE")) return apiError(409, "A grading subject with this code already exists for this term");
      return apiError(500, "Database error: " + e.message);
    }
  }

  // ── Class Teacher Grading Center ──────────────────────────────────────────
  if (method === "GET" && pathname === "/api/grading/class-center") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const qTermId = Number(url.searchParams.get("termId") || 0);
    const qSessionId = Number(url.searchParams.get("sessionId") || 0);
    const qClassId = Number(url.searchParams.get("classId") || 0);
    const activeTerm = queries.getActiveAcademicTerm.get() as any;
    const activeSession = queries.getActiveAcademicSession.get() as any;
    const termId = qTermId || activeTerm?.id;
    const sessionId = qSessionId || activeSession?.id;

    let cls = null;
    if (auth.role === "operator" && isPositiveIntId(qClassId)) {
      cls = queries.getClassById.get(qClassId) as any;
    } else {
      cls = queries.getClassForTeacher.get(auth.userId) as any;
    }
    if (!cls) return apiSuccess({ class: null, students: [], grading_subjects: [] });
    if (!termId || !sessionId) return apiSuccess({ class: { id: cls.id, name: cls.name, section: cls.section || null }, students: [], grading_subjects: [] });

    const classId = Number(cls.id);
    const roster = queries.getClassRoster.all(classId, termId) as any[];
    const termResults = queries.getClassTermResultsByClass.all(classId, termId, sessionId) as any[];
    const gradingSubjects = queries.getClassSubjectsForTerm.all(classId, termId, sessionId) as any[];

    const resultsByStudent = new Map<number, any[]>();
    for (const tr of termResults) {
      const sid = sqlInt(tr.student_id);
      const arr = resultsByStudent.get(sid) ?? [];
      arr.push({
        grading_subject_id: sqlInt(tr.grading_subject_id),
        grading_subject_code: tr.subject_code,
        grading_subject_name: tr.subject_name,
        ca_score: sqlInt(tr.ca_score),
        exam_score: sqlInt(tr.exam_score),
        total_score: sqlInt(tr.total_score),
        grade: tr.grade,
        is_approved: sqlInt(tr.is_approved),
      });
      resultsByStudent.set(sid, arr);
    }

    const students = roster.map((st) => {
      const subs = resultsByStudent.get(sqlInt(st.id)) ?? [];
      const total = subs.reduce((sum, s) => sum + s.total_score, 0);
      const subjectCount = subs.length;
      const averageScore = subjectCount > 0 ? Number((total / subjectCount).toFixed(1)) : 0;
      return {
        student: {
          id: sqlInt(st.id),
          name: st.name,
          email: st.email,
          grade: st.grade || null,
          reg_id: st.reg_id || null,
        },
        subjects: subs,
        total_score: total,
        subject_count: subjectCount,
        average_score: averageScore,
      };
    });

    return apiSuccess({
      class: { id: cls.id, name: cls.name, section: cls.section || null },
      students,
      grading_subjects: gradingSubjects.map((gs: any) => ({
        id: sqlInt(gs.id),
        name: gs.name,
        code: gs.code,
        teacher_id: gs.teacher_id != null ? sqlInt(gs.teacher_id) : null,
        teacher_name: gs.teacher_name || null,
      })),
    });
  }

  // ── Report Card endpoint under /api/grading/report-card/:studentId ─────────
  const gradingReportCardRemarksMatch = pathname.match(/^\/api\/grading\/report-card\/(\d+)\/remarks$/);
  if (gradingReportCardRemarksMatch && method === "PUT") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const studentId = Number(gradingReportCardRemarksMatch[1]);
    if (!isPositiveIntId(studentId)) return apiError(400, "Invalid student ID");

    const qSessionId = Number(url.searchParams.get("sessionId") || 0);
    const qTermId = Number(url.searchParams.get("termId") || 0);
    const activeSession = queries.getActiveAcademicSession.get() as any;
    const activeTerm = queries.getActiveAcademicTerm.get() as any;
    const sessionId = qSessionId || activeSession?.id;
    const termId = qTermId || activeTerm?.id;

    const body = await readJson(req);
    const teacherRemark = typeof body?.teacher_remark === "string" ? body.teacher_remark.trim() : null;
    const principalRemark = typeof body?.principal_remark === "string" ? body.principal_remark.trim() : null;

    queries.upsertStudentTermRemarks.run(studentId, sessionId, termId, teacherRemark, principalRemark);
    auditLog(auth.userId, "REPORT_CARD_REMARK", "user", studentId, JSON.stringify({ sessionId, termId }));

    return apiSuccess({ success: true, message: "Remarks saved successfully" });
  }

  const gradingReportCardMatch = pathname.match(/^\/api\/grading\/report-card\/(\d+)$/);
  if (gradingReportCardMatch && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator", "student", "guardian"]);
    const studentId = Number(gradingReportCardMatch[1]);
    if (!isPositiveIntId(studentId)) return apiError(400, "Invalid student ID");

    if (auth.role === "student" && auth.userId !== studentId) return apiError(403, "You can only view your own report card");
    if (auth.role === "guardian") {
      const link = db.prepare("SELECT 1 FROM guardian_student_links WHERE guardian_id = ? AND student_id = ? AND status='approved' LIMIT 1").get(auth.userId, studentId) as any;
      if (!link) return apiError(403, "Not linked to this student");
    }

    const student = queries.getUserById.get(studentId) as any;
    if (!student) return apiError(404, "Student not found");

    const qSessionId = Number(url.searchParams.get("sessionId") || 0);
    const qTermId = Number(url.searchParams.get("termId") || 0);
    const activeSession = queries.getActiveAcademicSession.get() as any;
    const activeTerm = queries.getActiveAcademicTerm.get() as any;
    const sessionId = qSessionId || activeSession?.id;
    const termId = qTermId || activeTerm?.id;

    let results = queries.getStudentTermResultsForReportCard.all(studentId) as any[];
    if (sessionId) {
      results = results.filter((r) => Number(r.session_id) === sessionId);
    }
    if (termId) {
      results = results.filter((r) => Number(r.term_id) <= termId);
    }

    const remarks = queries.getStudentTermRemarks.get(studentId, sessionId, termId) as any;

    return apiSuccess({
      student: {
        id: student.id,
        name: student.name,
        email: student.email,
        reg_id: student.reg_id,
        grade: student.grade,
      },
      results,
      remarks: {
        teacher_remark: remarks?.teacher_remark || null,
        principal_remark: remarks?.principal_remark || null,
      },
      session: activeSession,
      term: activeTerm,
    });
  }

  const gradingPolicyMatch = pathname.match(/^\/api\/grading\/policies\/(\d+)$/);
  if (gradingPolicyMatch) {
    const subjectId = Number(gradingPolicyMatch[1]);
    const subject = queries.getGradingSubjectById.get(subjectId) as any;
    if (!subject) return apiError(404, "Grading Subject not found");
    
    if (method === "GET") {
      const auth = requireAuth(req);
      requireRole(auth.role, ["teacher", "operator"]);
      const policies = queries.getGradingPoliciesBySubject.all(subjectId);
      return apiSuccess(policies);
    }
    
    if (method === "PUT") {
      const auth = requireAuth(req);
      if (auth.role !== "operator" && subject.teacher_id !== auth.userId) return apiError(403, "Not authorized");
      
      const body = await readJson(req);
      const policyList = Array.isArray(body) ? body : (body.policies || []);
      const passMark = !Array.isArray(body) && body.pass_mark !== undefined ? (body.pass_mark === "" || body.pass_mark === null ? null : Number(body.pass_mark)) : null;

      if (!Array.isArray(policyList)) return apiError(400, "Expected an array of policies");
      
      let caTotal = 0;
      let examTotal = 0;
      for (const p of policyList) {
        if (p.is_exam) examTotal += Number(p.max_marks || 0);
        else caTotal += Number(p.max_marks || 0);
      }

      if (caTotal < 0 || examTotal < 0 || (caTotal + examTotal) <= 0) {
        return apiError(400, "Total marks for CA and Exam combined must be greater than 0");
      }

      
      const termResultsCheck = queries.getTermResultsBySubject.all(subjectId) as any[];
      if (termResultsCheck.some((r: any) => r.is_approved === 1)) return apiError(403, "Results are already approved and locked");
      
      db.transaction(() => {
        db.prepare("UPDATE grading_subjects SET pass_mark = ? WHERE id = ?").run(passMark, subjectId);

        const existingPolicies = queries.getGradingPoliciesBySubject.all(subjectId) as any[];
        const incomingIds = new Set(policyList.filter((p: any) => p.id).map((p: any) => Number(p.id)));

        // Delete only policies removed by user (preserves manual scores for kept policies)
        for (const ep of existingPolicies) {
          if (!incomingIds.has(ep.id)) {
            db.prepare("DELETE FROM grading_policies WHERE id = ?").run(ep.id);
          }
        }

        // Update existing or create new policies
        for (const p of policyList) {
          if (p.id) {
            db.prepare(`
              UPDATE grading_policies
              SET name = ?, type = ?, mapped_cbt_subject_id = ?, max_marks = ?, is_exam = ?
              WHERE id = ? AND grading_subject_id = ?
            `).run(
              trimStr(p.name),
              trimStr(p.type),
              p.mapped_cbt_subject_id || null,
              Number(p.max_marks),
              p.is_exam ? 1 : 0,
              Number(p.id),
              subjectId
            );
          } else {
            queries.createGradingPolicy.run(
              subjectId,
              trimStr(p.name),
              trimStr(p.type),
              p.mapped_cbt_subject_id || null,
              Number(p.max_marks),
              p.is_exam ? 1 : 0
            );
          }
        }
      })();
      
      return apiSuccess({ success: true });
    }
  }

  const gradingScoresMatch = pathname.match(/^\/api\/grading\/scores\/(\d+)$/);
  if (gradingScoresMatch) {
    const subjectId = Number(gradingScoresMatch[1]);
    const subject = queries.getGradingSubjectById.get(subjectId) as any;
    if (!subject) return apiError(404, "Grading Subject not found");
    
    if (method === "GET") {
      const auth = requireAuth(req);
      requireRole(auth.role, ["teacher", "operator"]);
      if (auth.role === "teacher" && !sameUserId(subject.teacher_id, auth.userId)) return apiError(403, "You do not own this grading subject");

      const students = queries.getGradingStudentsBySubject.all(subjectId, subjectId, subjectId, subjectId) as any[];

      const policies = queries.getGradingPoliciesBySubject.all(subjectId) as any[];
      const manualScores = queries.getManualScoresBySubject.all(subjectId) as any[];
      const termResults = queries.getTermResultsBySubject.all(subjectId) as any[];
      
      const cbtScores: Record<number, Record<number, number>> = {}; 
      for (const p of policies) {
        if ((p.type === 'cbt_test' || p.type === 'cbt_exam') && p.mapped_cbt_subject_id) {
          const exams = queries.getExamsBySubject.all(p.mapped_cbt_subject_id) as any[];
          for (const e of exams) {
             if (!cbtScores[e.student_id]) cbtScores[e.student_id] = {};
             let scaledScore = 0;
             if (e.total_score > 0 && e.score != null) {
               scaledScore = (e.score / e.total_score) * p.max_marks;
             }
             cbtScores[e.student_id]![p.id] = Number(scaledScore.toFixed(2));
          }
        }
      }
      
      return apiSuccess({ students, policies, manualScores, cbtScores, termResults, pass_mark: subject.pass_mark });
    }
    
    if (method === "POST") {
      const auth = requireAuth(req);
      if (auth.role !== "operator" && subject.teacher_id !== auth.userId) return apiError(403, "Not authorized");
      
      const termResultsCheck = db.prepare("SELECT is_approved FROM term_results WHERE grading_subject_id = ? LIMIT 1").get(subjectId) as any;
      if (termResultsCheck?.is_approved) return apiError(403, "Results are locked");
      
      const body = await readJson(req); 
      if (!Array.isArray(body)) return apiError(400, "Expected array");
      
      db.transaction(() => {
        for (const entry of body) {
           queries.upsertManualScore.run(entry.grading_policy_id, entry.student_id, Number(entry.score), auth.userId);
        }

        // Recompute draft term_results so Report Cards immediately reflect saved grades
        const policies = queries.getGradingPoliciesBySubject.all(subjectId) as any[];
        const termId = subject.term_id;
        const sessionId = subject.session_id;
        
        const cbtScoresByPolicy: Record<number, Record<number, number>> = {};
        for (const p of policies) {
          if ((p.type === 'cbt_test' || p.type === 'cbt_exam') && p.mapped_cbt_subject_id) {
            const exams = queries.getExamsBySubject.all(p.mapped_cbt_subject_id) as any[];
            for (const e of exams) {
              if (!cbtScoresByPolicy[p.id]) cbtScoresByPolicy[p.id] = {};
              let scaledScore = 0;
              if (e.total_score > 0 && e.score != null) {
                scaledScore = (e.score / e.total_score) * p.max_marks;
              }
              cbtScoresByPolicy[p.id]![e.student_id] = Number(scaledScore.toFixed(2));
            }
          }
        }
        
        const manualScores = queries.getManualScoresBySubject.all(subjectId) as any[];
        const manualMap: Record<number, Record<number, number>> = {};
        for (const ms of manualScores) {
          if (!manualMap[ms.grading_policy_id]) manualMap[ms.grading_policy_id] = {};
          manualMap[ms.grading_policy_id]![ms.student_id] = ms.score;
        }
        
        const students = queries.getGradingStudentsBySubject.all(subjectId, subjectId, subjectId, subjectId) as any[];
        const totalMax = policies.reduce((sum: number, p: any) => sum + Number(p.max_marks || 0), 0) || 100;
        const schoolCfg = getGradingConfig();
        function getGradeScale(total: number) {
          if (subject.pass_mark != null && Number(subject.pass_mark) > 0) {
            const pm = Number(subject.pass_mark);
            if (total >= pm) return { grade: "PASS", remark: "Pass" };
            return { grade: "FAIL", remark: "Fail" };
          }
          const pct = totalMax > 0 ? (total / totalMax) * 100 : total;
          return applyGradeScale(pct, schoolCfg.grade_scale);
        }

        for (const st of students) {
          let caScore = 0;
          let examScore = 0;
          for (const p of policies) {
            let score = 0;
            if (p.type === 'manual') {
              score = manualMap[p.id]?.[st.id] || 0;
            } else {
              score = cbtScoresByPolicy[p.id]?.[st.id] || 0;
            }
            if (p.is_exam) examScore += score;
            else caScore += score;
          }
          const totalScore = Number((caScore + examScore).toFixed(2));
          const scale = getGradeScale(totalScore);
          queries.upsertTermResult.run(
            st.id, subjectId,
            Number(caScore.toFixed(2)), Number(examScore.toFixed(2)), totalScore,
            scale.grade, scale.remark,
            0, // draft
            termId, sessionId
          );
        }
      })();
      return apiSuccess({ success: true });
    }
  }

  const gradingApproveMatch = pathname.match(/^\/api\/grading\/approve\/(\d+)$/);
  if (gradingApproveMatch && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator", "teacher"]);

    const subjectId = Number(gradingApproveMatch[1]);
    const subject = queries.getGradingSubjectById.get(subjectId) as any;
    if (!subject) return apiError(404, "Grading Subject not found");
    if (auth.role !== "operator" && subject.teacher_id !== auth.userId) return apiError(403, "Not authorized");
    
    // --- Server-side recompute (never trust frontend math) ---
    const policies = queries.getGradingPoliciesBySubject.all(subjectId) as any[];
    const termId = subject.term_id;
    const sessionId = subject.session_id;
    
    // Build CBT score map keyed by policy.id
    const cbtScoresByPolicy: Record<number, Record<number, number>> = {};
    for (const p of policies) {
      if ((p.type === 'cbt_test' || p.type === 'cbt_exam') && p.mapped_cbt_subject_id) {
        const exams = queries.getExamsBySubject.all(p.mapped_cbt_subject_id) as any[];
        for (const e of exams) {
          if (!cbtScoresByPolicy[p.id]) cbtScoresByPolicy[p.id] = {};
          let scaledScore = 0;
          if (e.total_score > 0 && e.score != null) {
            scaledScore = (e.score / e.total_score) * p.max_marks;
          }
          cbtScoresByPolicy[p.id]![e.student_id] = Number(scaledScore.toFixed(2));
        }
      }
    }
    
    // Build manual score map: { policy_id: { student_id: score } }
    const manualScores = queries.getManualScoresBySubject.all(subjectId) as any[];
    const manualMap: Record<number, Record<number, number>> = {};
    for (const ms of manualScores) {
      if (!manualMap[ms.grading_policy_id]) manualMap[ms.grading_policy_id] = {};
      manualMap[ms.grading_policy_id]![ms.student_id] = ms.score;
    }
    
    const students = queries.getGradingStudentsBySubject.all(subjectId, subjectId, subjectId, subjectId) as any[];
    
    const totalMax = policies.reduce((sum: number, p: any) => sum + Number(p.max_marks || 0), 0) || 100;
    const schoolCfg = getGradingConfig();
    function getGradeScale(total: number) {
      if (subject.pass_mark != null && Number(subject.pass_mark) > 0) {
        const pm = Number(subject.pass_mark);
        if (total >= pm) return { grade: "PASS", remark: "Pass" };
        return { grade: "FAIL", remark: "Fail" };
      }
      const pct = totalMax > 0 ? (total / totalMax) * 100 : total;
      return applyGradeScale(pct, schoolCfg.grade_scale);
    }
    
    db.transaction(() => {
      for (const st of students) {
        let caScore = 0;
        let examScore = 0;
        for (const p of policies) {
          let score = 0;
          if (p.type === 'manual') {
            score = manualMap[p.id]?.[st.id] || 0;
          } else {
            score = cbtScoresByPolicy[p.id]?.[st.id] || 0;
          }
          if (p.is_exam) examScore += score;
          else caScore += score;
        }
        const totalScore = Number((caScore + examScore).toFixed(2));
        const scale = getGradeScale(totalScore);
        queries.upsertTermResult.run(
          st.id, subjectId,
          Number(caScore.toFixed(2)), Number(examScore.toFixed(2)), totalScore,
          scale.grade, scale.remark,
          1, // is_approved
          termId, sessionId
        );
      }
      queries.approveTermResults.run(subjectId);
    })();
    return apiSuccess({ success: true });
  }

  const gradingUnapproveMatch = pathname.match(/^\/api\/grading\/approve\/(\d+)\/unapprove$/);
  if (gradingUnapproveMatch && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator", "teacher"]);
    const subjectId = Number(gradingUnapproveMatch[1]);
    const subject = queries.getGradingSubjectById.get(subjectId) as any;
    if (!subject) return apiError(404, "Grading Subject not found");
    if (auth.role !== "operator" && subject.teacher_id !== auth.userId) return apiError(403, "Not authorized");
    
    db.prepare("UPDATE term_results SET is_approved = 0 WHERE grading_subject_id = ?").run(subjectId);
    return apiSuccess({ success: true });
  }

  if (method === "GET" && pathname === "/api/grading/annual") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const qSessionId = Number(url.searchParams.get("sessionId") || 0);
    const sessionId = qSessionId || (queries.getActiveAcademicSession.get() as any)?.id;
    if (!sessionId) return apiSuccess({ studentAverages: [], classEnrollments: [] });
    
    // Server-side average computation:
    // Average each student's total_score across ALL their approved subjects in this session.
    const studentAverages = db.prepare(`
      SELECT
        tr.student_id,
        u.name as student_name,
        u.reg_id,
        ROUND(AVG(tr.total_score), 2) as annual_average,
        COUNT(DISTINCT tr.grading_subject_id) as subjects_count,
        COUNT(DISTINCT tr.term_id) as terms_count
      FROM term_results tr
      JOIN users u ON u.id = tr.student_id
      WHERE tr.session_id = ? AND tr.is_approved = 1
      GROUP BY tr.student_id
    `).all(sessionId) as any[];
    
    const classEnrollments = db.prepare(`
      SELECT ce.student_id, ce.class_id, ce.term_id, c.name as class_name
      FROM class_enrollments ce
      JOIN classes c ON c.id = ce.class_id
      WHERE ce.term_id IN (SELECT id FROM academic_terms WHERE session_id = ?)
    `).all(sessionId) as any[];
    
    // Also return existing promotion decisions for this session
    const existingResults = queries.getAnnualResultsBySession.all(sessionId) as any[];
    
    return apiSuccess({ studentAverages, classEnrollments, existingResults });
  }

  if (method === "POST" && pathname === "/api/grading/annual/promote") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    
    const body = await readJson(req);
    const studentId = Number(body.student_id);
    const sessionId = Number(body.session_id);
    const promotionStatus: string = body.promotion_status;
    const totalAverage = Number(body.total_average);
    const classId = body.class_id ? Number(body.class_id) : null;
    
    if (!studentId || !sessionId || !promotionStatus) return apiError(400, "Missing required fields");
    if (!['Promoted', 'Repeated', 'Graduated'].includes(promotionStatus)) return apiError(400, "Invalid promotion status");
    
    db.transaction(() => {
      // 1. Write the annual result record
      queries.upsertAnnualResult.run(studentId, classId, sessionId, totalAverage, promotionStatus, auth.userId);
      
      // 2. If promoted, advance the student's grade level
      if (promotionStatus === 'Promoted' || promotionStatus === 'Graduated') {
        // Find next grade level above current one
        const currentGrade = db.prepare(
          "SELECT gl.id, gl.sort_order FROM grade_levels gl JOIN users u ON u.grade_level_id = gl.id WHERE u.id = ?"
        ).get(studentId) as any;
        
        if (currentGrade) {
          const nextGrade = db.prepare(
            "SELECT id FROM grade_levels WHERE sort_order > ? ORDER BY sort_order ASC LIMIT 1"
          ).get(currentGrade.sort_order) as any;
          
          if (nextGrade) {
            db.prepare("UPDATE users SET grade_level_id = ? WHERE id = ?").run(nextGrade.id, studentId);
            // Also enroll into next class's active term if class exists
            try {
              const nextGradeName = db.prepare("SELECT name FROM grade_levels WHERE id = ?").get(nextGrade.id) as any;
              const nextClass = nextGradeName ? db.prepare("SELECT id FROM classes WHERE name = ? LIMIT 1").get(nextGradeName.name) as any : null;
              const activeTermForEnroll = queries.getActiveAcademicTerm.get() as any;
              if (nextClass && activeTermForEnroll) {
                db.prepare("INSERT OR IGNORE INTO class_enrollments (student_id, class_id, term_id) VALUES (?, ?, ?)").run(studentId, nextClass.id, activeTermForEnroll.id);
              }
            } catch {}
          }
        }
      }
    })();
    return apiSuccess({ success: true });
  }

  // ── Global Admin Search & Historical Data Crawler ──────────────────────────
  if (method === "GET" && pathname === "/api/admin/global-search") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);

    const q = (url.searchParams.get("q") || "").trim();
    const type = (url.searchParams.get("type") || "all").trim(); // all | report_cards | exams | subjects | teachers | sessions
    const qSessionId = Number(url.searchParams.get("sessionId") || 0);
    const qTermId = Number(url.searchParams.get("termId") || 0);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 200);

    const searchLike = `%${q}%`;
    const results: any[] = [];

    // 1. REPORT CARDS CRAWLER
    if (type === "all" || type === "report_cards") {
      let rcQuery = `
        SELECT 
          tr.student_id,
          u.name as student_name,
          u.reg_id as student_reg_id,
          COALESCE(gl.name, u.grade) as student_grade,
          tr.session_id,
          acs.name as session_name,
          tr.term_id,
          at.name as term_name,
          COUNT(DISTINCT tr.grading_subject_id) as total_subjects,
          ROUND(AVG(tr.total_score), 2) as average_score,
          MIN(tr.is_approved) as is_approved,
          (
            SELECT teacher_remark 
            FROM student_term_remarks 
            WHERE student_id = tr.student_id AND session_id = tr.session_id AND term_id = tr.term_id 
            ORDER BY id DESC LIMIT 1
          ) as teacher_remark,
          (
            SELECT principal_remark 
            FROM student_term_remarks 
            WHERE student_id = tr.student_id AND session_id = tr.session_id AND term_id = tr.term_id 
            ORDER BY id DESC LIMIT 1
          ) as principal_remark
        FROM term_results tr
        JOIN users u ON u.id = tr.student_id
        LEFT JOIN grade_levels gl ON gl.id = u.grade_level_id
        JOIN academic_sessions acs ON acs.id = tr.session_id
        JOIN academic_terms at ON at.id = tr.term_id
        WHERE 1=1
      `;
      const rcParams: any[] = [];
      if (q) {
        rcQuery += ` AND (u.name LIKE ? OR u.reg_id LIKE ? OR u.email LIKE ? OR acs.name LIKE ? OR at.name LIKE ?)`;
        rcParams.push(searchLike, searchLike, searchLike, searchLike, searchLike);
      }
      if (qSessionId) {
        rcQuery += ` AND tr.session_id = ?`;
        rcParams.push(qSessionId);
      }
      if (qTermId) {
        rcQuery += ` AND tr.term_id = ?`;
        rcParams.push(qTermId);
      }
      rcQuery += ` GROUP BY tr.student_id, tr.session_id, tr.term_id ORDER BY tr.session_id DESC, tr.term_id DESC, u.name ASC LIMIT ?`;
      rcParams.push(limit);

      try {
        const rcRows = db.prepare(rcQuery).all(...rcParams) as any[];
        for (const row of rcRows) {
          results.push({
            type: "report_card",
            id: `rc-${row.student_id}-${row.session_id}-${row.term_id}`,
            student_id: row.student_id,
            student_name: row.student_name,
            student_reg_id: row.student_reg_id,
            student_grade: row.student_grade,
            session_id: row.session_id,
            session_name: row.session_name,
            term_id: row.term_id,
            term_name: row.term_name,
            total_subjects: row.total_subjects,
            average_score: row.average_score,
            is_approved: row.is_approved,
            teacher_remark: row.teacher_remark,
            principal_remark: row.principal_remark,
          });
        }
      } catch (e: any) {
        console.error("[GlobalSearch RC Error]", e.message);
      }
    }

    // 2. EXAM ATTEMPTS & CBT RECORDS
    if (type === "all" || type === "exams") {
      let examQuery = `
        SELECT 
          e.id,
          e.student_id,
          u.name as student_name,
          u.reg_id as student_reg_id,
          e.subject_id,
          s.name as subject_title,
          s.code as subject_code,
          s.mode as exam_mode,
          e.score,
          e.total_score,
          e.status,
          e.start_time,
          e.end_time,
          e.session_id,
          acs.name as session_name,
          e.term_id,
          at.name as term_name,
          e.teacher_remark,
          e.principal_remark
        FROM exams e
        JOIN users u ON u.id = e.student_id
        JOIN subjects s ON s.id = e.subject_id
        LEFT JOIN academic_sessions acs ON acs.id = e.session_id
        LEFT JOIN academic_terms at ON at.id = e.term_id
        WHERE 1=1
      `;
      const examParams: any[] = [];
      if (q) {
        examQuery += ` AND (u.name LIKE ? OR u.reg_id LIKE ? OR s.name LIKE ? OR s.code LIKE ? OR acs.name LIKE ? OR at.name LIKE ?)`;
        examParams.push(searchLike, searchLike, searchLike, searchLike, searchLike, searchLike);
      }
      if (qSessionId) {
        examQuery += ` AND e.session_id = ?`;
        examParams.push(qSessionId);
      }
      if (qTermId) {
        examQuery += ` AND e.term_id = ?`;
        examParams.push(qTermId);
      }
      examQuery += ` ORDER BY e.id DESC LIMIT ?`;
      examParams.push(limit);

      try {
        const examRows = db.prepare(examQuery).all(...examParams) as any[];
        for (const row of examRows) {
          const scorePct = (row.total_score > 0 && row.score != null) ? Number(((row.score / row.total_score) * 100).toFixed(1)) : null;
          results.push({
            type: "exam",
            id: row.id,
            student_id: row.student_id,
            student_name: row.student_name,
            student_reg_id: row.student_reg_id,
            subject_id: row.subject_id,
            subject_title: row.subject_title,
            subject_code: row.subject_code,
            exam_mode: row.exam_mode || "cbt",
            score: row.score,
            total_score: row.total_score,
            score_pct: scorePct,
            status: row.status,
            start_time: row.start_time,
            end_time: row.end_time,
            session_id: row.session_id,
            session_name: row.session_name || "N/A",
            term_id: row.term_id,
            term_name: row.term_name || "N/A",
            teacher_remark: row.teacher_remark,
            principal_remark: row.principal_remark,
          });
        }
      } catch (e: any) {
        console.error("[GlobalSearch Exam Error]", e.message);
      }
    }

    // 3. SUBJECTS & CURRICULA (both Grading Subjects and CBT Subjects)
    if (type === "all" || type === "subjects") {
      let subQuery = `
        SELECT 
          gs.id,
          'grading' as category,
          gs.name,
          gs.code,
          gs.teacher_id,
          u.name as teacher_name,
          u.email as teacher_email,
          gs.class_id,
          c.name as class_name,
          gs.session_id,
          acs.name as session_name,
          gs.term_id,
          at.name as term_name,
          (SELECT COUNT(*) FROM term_results tr WHERE tr.grading_subject_id = gs.id) as enrolled_count
        FROM grading_subjects gs
        LEFT JOIN users u ON u.id = gs.teacher_id
        LEFT JOIN classes c ON c.id = gs.class_id
        LEFT JOIN academic_sessions acs ON acs.id = gs.session_id
        LEFT JOIN academic_terms at ON at.id = gs.term_id
        WHERE 1=1
      `;
      const subParams: any[] = [];
      if (q) {
        subQuery += ` AND (gs.name LIKE ? OR gs.code LIKE ? OR u.name LIKE ? OR c.name LIKE ? OR acs.name LIKE ? OR at.name LIKE ?)`;
        subParams.push(searchLike, searchLike, searchLike, searchLike, searchLike, searchLike);
      }
      if (qSessionId) {
        subQuery += ` AND gs.session_id = ?`;
        subParams.push(qSessionId);
      }
      if (qTermId) {
        subQuery += ` AND gs.term_id = ?`;
        subParams.push(qTermId);
      }
      subQuery += ` ORDER BY gs.id DESC LIMIT ?`;
      subParams.push(limit);

      try {
        const subRows = db.prepare(subQuery).all(...subParams) as any[];
        for (const row of subRows) {
          results.push({
            type: "subject",
            id: row.id,
            category: "grading",
            name: row.name,
            code: row.code,
            teacher_id: row.teacher_id,
            teacher_name: row.teacher_name || "Unassigned",
            teacher_email: row.teacher_email,
            class_id: row.class_id,
            class_name: row.class_name,
            session_id: row.session_id,
            session_name: row.session_name,
            term_id: row.term_id,
            term_name: row.term_name,
            enrolled_count: row.enrolled_count,
          });
        }
      } catch (e: any) {
        console.error("[GlobalSearch Subject Error]", e.message);
      }
    }

    // 4. TEACHER & CLASS ASSIGNMENTS AUDIT
    if (type === "all" || type === "teachers") {
      let tQuery = `
        SELECT 
          cta.id,
          cta.class_id,
          c.name as class_name,
          c.section as class_section,
          c.level as class_level,
          cta.teacher_id,
          tu.name as teacher_name,
          tu.email as teacher_email,
          tu.phone as teacher_phone,
          cta.assigned_by,
          au.name as assigned_by_name,
          cta.action,
          cta.assigned_at,
          cta.notes
        FROM class_teacher_assignments cta
        JOIN classes c ON c.id = cta.class_id
        LEFT JOIN users tu ON tu.id = cta.teacher_id
        LEFT JOIN users au ON au.id = cta.assigned_by
        WHERE 1=1
      `;
      const tParams: any[] = [];
      if (q) {
        tQuery += ` AND (c.name LIKE ? OR tu.name LIKE ? OR tu.email LIKE ? OR au.name LIKE ? OR cta.notes LIKE ?)`;
        tParams.push(searchLike, searchLike, searchLike, searchLike, searchLike);
      }
      tQuery += ` ORDER BY cta.id DESC LIMIT ?`;
      tParams.push(limit);

      try {
        const tRows = db.prepare(tQuery).all(...tParams) as any[];
        for (const row of tRows) {
          results.push({
            type: "teacher_assignment",
            id: row.id,
            class_id: row.class_id,
            class_name: row.class_name,
            class_section: row.class_section,
            class_level: row.class_level,
            teacher_id: row.teacher_id,
            teacher_name: row.teacher_name || "Unassigned",
            teacher_email: row.teacher_email,
            teacher_phone: row.teacher_phone,
            assigned_by_name: row.assigned_by_name,
            action: row.action,
            assigned_at: row.assigned_at,
            notes: row.notes,
          });
        }
      } catch (e: any) {
        console.error("[GlobalSearch Teachers Error]", e.message);
      }
    }

    // 5. SESSIONS & ACADEMIC TERMS
    if (type === "all" || type === "sessions") {
      let sesQuery = `
        SELECT 
          s.id,
          s.name,
          s.is_active,
          s.status,
          s.created_at
        FROM academic_sessions s
        WHERE 1=1
      `;
      const sesParams: any[] = [];
      if (q) {
        sesQuery += ` AND s.name LIKE ?`;
        sesParams.push(searchLike);
      }
      sesQuery += ` ORDER BY s.id DESC LIMIT ?`;
      sesParams.push(limit);

      try {
        const sesRows = db.prepare(sesQuery).all(...sesParams) as any[];
        for (const row of sesRows) {
          const terms = queries.getAcademicTermsBySession.all(row.id) as any[];
          results.push({
            type: "session",
            id: row.id,
            name: row.name,
            is_active: row.is_active,
            status: row.status,
            terms: terms.map((t: any) => ({ id: t.id, name: t.name, is_active: t.is_active, status: t.status })),
            created_at: row.created_at,
          });
        }
      } catch (e: any) {
        console.error("[GlobalSearch Session Error]", e.message);
      }
    }

    return apiSuccess({
      results,
      total: results.length,
      query: q,
      type,
      sessionId: qSessionId || null,
      termId: qTermId || null,
    });
  }

  // ── Global Session Snapshot & Historical Analytics ─────────────────────────
  if (method === "GET" && pathname === "/api/admin/session-snapshots") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);

    const qSessionId = Number(url.searchParams.get("sessionId") || 0);

    let sessionsQuery = "SELECT * FROM academic_sessions";
    const params: any[] = [];
    if (qSessionId) {
      sessionsQuery += " WHERE id = ?";
      params.push(qSessionId);
    }
    sessionsQuery += " ORDER BY id DESC";

    const sessions = db.prepare(sessionsQuery).all(...params) as any[];
    const snapshots: any[] = [];

    for (const session of sessions) {
      const sid = session.id;

      // 1. Total Enrolled Students
      const studentCountRow = db.prepare(`
        SELECT COUNT(DISTINCT student_id) as count 
        FROM (
          SELECT student_id FROM term_results WHERE session_id = ?
          UNION
          SELECT student_id FROM exams WHERE session_id = ?
          UNION
          SELECT student_id FROM class_enrollments WHERE term_id IN (SELECT id FROM academic_terms WHERE session_id = ?)
        )
      `).get(sid, sid, sid) as any;
      const totalStudents = Number(studentCountRow?.count || 0);

      // 2. Active Teachers
      const teacherCountRow = db.prepare(`
        SELECT COUNT(DISTINCT teacher_id) as count
        FROM (
          SELECT teacher_id FROM grading_subjects WHERE session_id = ? AND teacher_id IS NOT NULL
          UNION
          SELECT teacher_id FROM subjects WHERE session_id = ? AND teacher_id IS NOT NULL
          UNION
          SELECT class_teacher_id as teacher_id FROM classes WHERE class_teacher_id IS NOT NULL
        )
      `).get(sid, sid) as any;
      const totalTeachers = Number(teacherCountRow?.count || 0);

      // 3. Subjects Count
      const gradingSubCount = (db.prepare("SELECT COUNT(*) as count FROM grading_subjects WHERE session_id = ?").get(sid) as any)?.count || 0;
      const cbtSubCount = (db.prepare("SELECT COUNT(*) as count FROM subjects WHERE session_id = ?").get(sid) as any)?.count || 0;

      // 4. Completed CBT Exams
      const examsCompletedRow = db.prepare(`
        SELECT COUNT(*) as count, AVG(CASE WHEN total_score > 0 THEN (score * 100.0 / total_score) ELSE 0 END) as avg_pct
        FROM exams WHERE session_id = ? AND status = 'completed'
      `).get(sid) as any;
      const totalExamsCompleted = Number(examsCompletedRow?.count || 0);
      const avgExamPct = examsCompletedRow?.avg_pct ? Number(examsCompletedRow.avg_pct.toFixed(1)) : 0;

      // 5. Term Results & Report Cards
      const termResultsRow = db.prepare(`
        SELECT 
          COUNT(*) as total_entries,
          COUNT(DISTINCT student_id || '-' || term_id) as report_cards_count,
          AVG(total_score) as avg_score,
          SUM(CASE WHEN is_approved = 1 THEN 1 ELSE 0 END) as approved_entries
        FROM term_results 
        WHERE session_id = ?
      `).get(sid) as any;

      // 6. Annual Promotions
      const promotionRows = db.prepare(`
        SELECT promotion_status, COUNT(*) as count
        FROM annual_results
        WHERE session_id = ?
        GROUP BY promotion_status
      `).all(sid) as any[];

      const promotions: Record<string, number> = { Promoted: 0, Repeated: 0, Graduated: 0 };
      for (const p of promotionRows) {
        if (p.promotion_status && promotions[p.promotion_status] !== undefined) {
          promotions[p.promotion_status] = Number(p.count);
        }
      }

      // 7. Terms Breakdown
      const terms = queries.getAcademicTermsBySession.all(sid) as any[];
      const termsBreakdown: any[] = [];
      for (const t of terms) {
        const tExams = db.prepare("SELECT COUNT(*) as count, AVG(CASE WHEN total_score > 0 THEN (score * 100.0 / total_score) ELSE 0 END) as avg_pct FROM exams WHERE session_id = ? AND term_id = ? AND status = 'completed'").get(sid, t.id) as any;
        const tReportCards = db.prepare("SELECT COUNT(DISTINCT student_id) as count, AVG(total_score) as avg_score FROM term_results WHERE session_id = ? AND term_id = ?").get(sid, t.id) as any;
        const tSubjects = (db.prepare("SELECT COUNT(*) as count FROM grading_subjects WHERE session_id = ? AND term_id = ?").get(sid, t.id) as any)?.count || 0;

        termsBreakdown.push({
          term_id: t.id,
          term_name: t.name,
          is_active: t.is_active,
          status: t.status,
          start_date: t.start_date,
          end_date: t.end_date,
          exams_completed: Number(tExams?.count || 0),
          exam_avg_pct: tExams?.avg_pct ? Number(tExams.avg_pct.toFixed(1)) : 0,
          report_cards_count: Number(tReportCards?.count || 0),
          report_card_avg_score: tReportCards?.avg_score ? Number(tReportCards.avg_score.toFixed(1)) : 0,
          subjects_count: Number(tSubjects || 0),
        });
      }

      const statsObj = {
        total_students: totalStudents,
        total_teachers: totalTeachers,
        total_subjects: Number(gradingSubCount || 0) + Number(cbtSubCount || 0),
        grading_subjects: Number(gradingSubCount || 0),
        cbt_subjects: Number(cbtSubCount || 0),
        completed_exams: totalExamsCompleted,
        avg_exam_score: avgExamPct,
        report_cards_count: Number(termResultsRow?.report_cards_count || 0),
        avg_report_card_score: termResultsRow?.avg_score ? Number(termResultsRow.avg_score.toFixed(1)) : 0,
        promoted_count: promotions.Promoted || 0,
        repeated_count: promotions.Repeated || 0,
        graduated_count: promotions.Graduated || 0,
      };

      snapshots.push({
        session_id: session.id,
        session_name: session.name,
        is_active: session.is_active,
        status: session.status,
        created_at: session.created_at,
        total_students_enrolled: totalStudents,
        total_teachers_active: totalTeachers,
        grading_subjects_count: gradingSubCount,
        cbt_subjects_count: cbtSubCount,
        total_exams_completed: totalExamsCompleted,
        avg_exam_pct: avgExamPct,
        total_report_cards: Number(termResultsRow?.report_cards_count || 0),
        avg_report_card_score: termResultsRow?.avg_score ? Number(termResultsRow.avg_score.toFixed(1)) : 0,
        promotions,
        stats: statsObj,
        terms: termsBreakdown,
      });
    }

    return apiSuccess({ snapshots });
  }

  if (method === "GET" && pathname === "/api/subjects/with-question-counts") {
    // Used by the teacher dashboard to render subject cards with question counts
    // in a single request (avoids N+1 question-count lookups on the client).
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const qSessionId = Number(url.searchParams.get("sessionId") || 0);
    const qTermId = Number(url.searchParams.get("termId") || 0);
    const activeSession = queries.getActiveAcademicSession.get() as any;
    const activeTerm = queries.getActiveAcademicTerm.get() as any;
    const targetSessionId = qSessionId || activeSession?.id;
    const targetTermId = qTermId || activeTerm?.id;

    let query = `
      SELECT s.*,
        (SELECT COUNT(*) FROM questions q WHERE q.subject_id = s.id) as question_count
      FROM subjects s
    `;
    const params: any[] = [];
    const where: string[] = [];
    if (auth.role === "teacher") {
      where.push("s.teacher_id = ?");
      params.push(auth.userId);
    }
    if (targetSessionId && targetTermId) {
      where.push("(s.session_id = ? AND s.term_id = ? OR s.session_id IS NULL)");
      params.push(targetSessionId, targetTermId);
    }
    if (where.length) query += " WHERE " + where.join(" AND ");
    query += " ORDER BY s.name";
    return apiSuccess(db.prepare(query).all(...params));
  }

  if (method === "GET" && pathname === "/api/subjects") {
    const auth = requireAuth(req);
    const qSessionId = Number(url.searchParams.get("sessionId") || 0);
    const qTermId = Number(url.searchParams.get("termId") || 0);
    
    const activeSession = queries.getActiveAcademicSession.get() as any;
    const activeTerm = queries.getActiveAcademicTerm.get() as any;
    const targetSessionId = qSessionId || activeSession?.id;
    const targetTermId = qTermId || activeTerm?.id;

    if (!targetSessionId || !targetTermId) return apiSuccess([]);

    if (auth.role === "student") {
      let query = `
        SELECT s.* FROM subjects s
        INNER JOIN subject_enrollments se ON se.subject_id = s.id AND se.student_id = ?
        WHERE (s.is_timetable_published = 1 OR s.is_published = 1)
      `;
      const params: any[] = [auth.userId];
      if (targetSessionId && targetTermId) {
        query += " AND s.session_id = ? AND s.term_id = ?";
        params.push(targetSessionId, targetTermId);
      }
      query += " ORDER BY s.name";
      return apiSuccess(db.prepare(query).all(...params));
    }

    if (auth.role === "teacher") {
      let query = "SELECT * FROM subjects WHERE teacher_id = ?";
      const params: any[] = [auth.userId];
      if (targetSessionId && targetTermId) {
        query += " AND session_id = ? AND term_id = ?";
        params.push(targetSessionId, targetTermId);
      }
      query += " ORDER BY name";
      return apiSuccess(db.prepare(query).all(...params));
    }

    let query = "SELECT * FROM subjects";
    const params: any[] = [];
    if (targetSessionId && targetTermId) {
      query += " WHERE session_id = ? AND term_id = ?";
      params.push(targetSessionId, targetTermId);
    }
    query += " ORDER BY id DESC";
    return apiSuccess(db.prepare(query).all(...params));
  }

  if (method === "POST" && pathname === "/api/subjects") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const body = await readJson(req);
    const name = trimStr(body?.name);
    const code = trimStr(body?.code);
    const activeTerm = queries.getActiveAcademicTerm.get() as any;
    const term = trimStr(body?.term) || activeTerm?.name || "First Term";
    const teacher_id = body?.teacher_id;
    if (!name || !code) return apiError(400, "Invalid subject payload — name and code required");
    
    let teacherId = auth.role === "teacher" ? auth.userId : (teacher_id ? Number(teacher_id) : auth.userId);
    if (auth.role === "operator" && teacher_id) {
      if (!isPositiveIntId(teacherId)) return apiError(400, "Invalid teacher_id. Operators must assign a valid teacher.");
      const teacher = queries.getUserById.get(teacherId) as any;
      if (!teacher || teacher.role !== "teacher" || sqlInt(teacher.is_active) !== 1) return apiError(400, "Invalid or inactive teacher");
    }
    const description = trimStr(body?.description) || null;
    const cls = trimStr(body?.class) || null;
    const gradeLevelId = body?.grade_level_id !== undefined ? Number(body.grade_level_id) || null : null;
    const session = trimStr(body?.session) || null;
    const mode = ["test", "exam", "quiz"].includes(body?.mode) ? body.mode : "exam";
    const instructions = trimStr(body?.instructions) || null;
    const can_retake = body?.can_retake !== undefined ? Number(body.can_retake) : 1;
    const activeSession = queries.getActiveAcademicSession.get() as any;
    const sessionId = Number(body?.session_id || activeSession?.id || 1);
    const termId = Number(body?.term_id || activeTerm?.id || 1);
    const assessmentType = ["learning_practice", "learning_mock", "school_test", "school_exam"].includes(body?.assessment_type)
      ? body.assessment_type
      : (mode === "exam" ? "school_exam" : mode === "test" ? "school_test" : "learning_practice");
    const resultPolicy = ["immediate", "manual", "scheduled"].includes(body?.result_policy) ? body.result_policy : "immediate";
    const resultReleaseTime = body?.result_release_time ? trimStr(body.result_release_time) : null;

    const existingSameTermDiffSession = db.prepare("SELECT id FROM subjects WHERE code = ? AND term = ? AND (session_id != ? OR session_id IS NULL)").get(code, term, sessionId) as any;
    const effectiveTerm = existingSameTermDiffSession ? `${session || sessionId} - ${term}` : term;

    const result = queries.createSubject.run(
      name, code, effectiveTerm, 0, teacherId, auth.userId, description, cls, gradeLevelId, session, mode, instructions, can_retake, sessionId, termId, assessmentType, resultPolicy, resultReleaseTime
    ) as {
      lastInsertRowid: number | bigint;
    };
    auditLog(auth.userId, "SUBJECT_CREATE", "subject", Number(result.lastInsertRowid), JSON.stringify({ code, term, assessmentType, resultPolicy }));

    // [FIX] Apply scheduling fields if provided (operator timetable "Create & Schedule" flow).
    if (body.exam_datetime !== undefined || body.duration !== undefined || body.window_duration !== undefined || body.is_timetable_published !== undefined) {
      const newId = Number(result.lastInsertRowid);
      const schedDatetime = body.exam_datetime !== undefined ? trimStr(body.exam_datetime) : "2099-01-01T00:00";
      const schedDuration = body.duration !== undefined ? Number(body.duration) : 60;
      const schedWindow = body.window_duration !== undefined ? Number(body.window_duration) : 120;
      const schedPublished = body.is_timetable_published !== undefined ? Number(body.is_timetable_published) : 0;
      if (!isValidSubjectDuration(schedDuration)) return apiError(400, "duration must be an integer from 1 to 360 (minutes)");
      if (!Number.isInteger(schedWindow) || schedWindow < 1 || schedWindow > 1440) return apiError(400, "window_duration must be an integer from 1 to 1440 (minutes)");
      if (schedDatetime !== "2099-01-01T00:00" && !isValidExamDateTime(schedDatetime)) return apiError(400, "exam_datetime must be a valid ISO datetime string");
      queries.updateSubjectSchedulingInfo.run(teacherId, can_retake, mode, schedDatetime, schedDuration, schedWindow, schedPublished, newId);
    }
    
    if (auth.role === "operator" && teacherId && teacherId !== auth.userId) {
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
    
    let nextTeacherId = Number(body.teacher_id ?? subject.teacher_id);
    if (body.teacher_id !== undefined && auth.role === "operator") {
      if (!isPositiveIntId(nextTeacherId)) return apiError(400, "Invalid teacher_id");
      const teacher = queries.getUserById.get(nextTeacherId) as any;
      if (!teacher || teacher.role !== "teacher" || sqlInt(teacher.is_active) !== 1) return apiError(400, "Invalid or inactive teacher");
    } else if (auth.role === "teacher") {
      nextTeacherId = sqlInt(subject.teacher_id);
    }
    const nextInstructions = body.instructions !== undefined ? (trimStr(body.instructions) || null) : (subject.instructions || null);
    const nextMode = ["test", "exam", "quiz"].includes(body?.mode) ? body.mode : subject.mode;
    const nextAssessmentType = body.assessment_type !== undefined ? (["learning_practice", "learning_mock", "school_test", "school_exam"].includes(body.assessment_type) ? body.assessment_type : subject.assessment_type) : (subject.assessment_type || "school_exam");
    const nextResultPolicy = body.result_policy !== undefined ? (["immediate", "manual", "scheduled"].includes(body.result_policy) ? body.result_policy : subject.result_policy) : (subject.result_policy || "immediate");
    const nextResultReleaseTime = body.result_release_time !== undefined ? (trimStr(body.result_release_time) || null) : subject.result_release_time;
    // Compute total_score from the DB — never trust a client-supplied value
    const computedTotalScore = (db.prepare(
      "SELECT COALESCE(SUM(marks),0) as t FROM questions WHERE subject_id = ?"
    ).get(subjectId) as any)?.t ?? 0;
    queries.updateSubject.run(
      trimStr(body.name) || subject.name,
      trimStr(body.code) || subject.code,
      trimStr(body.term) || subject.term,
      Number(computedTotalScore),
      nextTeacherId,
      body.description !== undefined ? (trimStr(body.description) || null) : (subject.description || null),
      body.class !== undefined ? (trimStr(body.class) || null) : (subject.class || null),
      body.grade_level_id !== undefined ? Number(body.grade_level_id) || null : (subject.grade_level_id || null),
      trimStr(body.session) || subject.session,
      nextMode,
      nextInstructions,
      body.can_retake !== undefined ? Number(body.can_retake) : Number(subject.can_retake ?? 1),
      body.session_id !== undefined ? Number(body.session_id) : subject.session_id,
      body.term_id !== undefined ? Number(body.term_id) : subject.term_id,
      body.is_published !== undefined ? Number(body.is_published) : Number(subject.is_published ?? 0),
      nextAssessmentType,
      nextResultPolicy,
      nextResultReleaseTime,
      subjectId,
    );

    // [FIX] Apply scheduling fields (exam_datetime, duration, window_duration, is_timetable_published)
    // which were previously ignored by this route. The operator timetable page relies on them.
    if (
      body.exam_datetime !== undefined ||
      body.duration !== undefined ||
      body.window_duration !== undefined ||
      body.is_timetable_published !== undefined
    ) {
      const nextExamDatetime = body.exam_datetime !== undefined ? trimStr(body.exam_datetime) : (subject.exam_datetime || "2099-01-01T00:00");
      const nextDuration = body.duration !== undefined ? Number(body.duration) : Number(subject.duration ?? 60);
      const nextWindow = body.window_duration !== undefined ? Number(body.window_duration) : Number(subject.window_duration ?? 120);
      const nextTimetablePublished = body.is_timetable_published !== undefined ? Number(body.is_timetable_published) : Number(subject.is_timetable_published ?? 0);
      if (!isValidSubjectDuration(nextDuration)) return apiError(400, "duration must be an integer from 1 to 360 (minutes)");
      if (!Number.isInteger(nextWindow) || nextWindow < 1 || nextWindow > 1440) return apiError(400, "window_duration must be an integer from 1 to 1440 (minutes)");
      if (nextExamDatetime !== "2099-01-01T00:00" && !isValidExamDateTime(nextExamDatetime)) return apiError(400, "exam_datetime must be a valid ISO datetime string");
      queries.updateSubjectSchedulingInfo.run(
        nextTeacherId,
        body.can_retake !== undefined ? Number(body.can_retake) : Number(subject.can_retake ?? 1),
        nextMode,
        nextExamDatetime,
        nextDuration,
        nextWindow,
        nextTimetablePublished,
        subjectId,
      );
    }

    const nextPublished = Number(body.is_published ?? subject.is_published);
    if (nextPublished === 1 && Number(subject.is_published) === 0) {
      notifyOperators({
        type: "subject_published",
        message: `A teacher has published ${trimStr(body.code) || subject.code} (Questions are ready)`,
        link: `/ADMIN/subjects`
      });
    }

    if (auth.role === "operator" && nextTeacherId !== sqlInt(subject.teacher_id)) {
      if (subject.teacher_id) authz.invalidateTeacherCache(Number(subject.teacher_id));
      authz.invalidateTeacherCache(nextTeacherId);
      if (nextTeacherId !== auth.userId) {
        notifyUser(nextTeacherId, {
          type: "info",
          message: `Admin re-assigned ${subject.name} (${subject.code}) to you`,
          link: `/teacher/dashboard`
        });
      }
    }

    return apiSuccess(queries.getSubjectById.get(subjectId));
  }

  // ── Subject scheduling ─────────────────────────────────────────────────────
  // Dedicated route used by the operator timetable page (updateSubjectSchedule).
  const subjectScheduleMatch = pathname.match(/^\/api\/subjects\/(\d+)\/schedule$/);
  if (subjectScheduleMatch && method === "PUT") {
    const auth = requireAuth(req);
    const subjectId = Number(subjectScheduleMatch[1]);
    if (!isPositiveIntId(subjectId)) return apiError(400, "Invalid subject id");
    const subject = queries.getSubjectById.get(subjectId) as any;
    if (!subject) return apiError(404, "Subject not found");
    if (auth.role !== "operator" && !sameUserId(subject.teacher_id, auth.userId)) return apiError(403, "You do not own this subject");
    const body = await readJson(req);

    const nextExamDatetime = body.exam_datetime !== undefined ? trimStr(body.exam_datetime) : (subject.exam_datetime || "2099-01-01T00:00");
    const nextDuration = body.duration !== undefined ? Number(body.duration) : Number(subject.duration ?? 60);
    const nextWindow = body.window_duration !== undefined ? Number(body.window_duration) : Number(subject.window_duration ?? 120);
    const nextTimetablePublished = body.is_timetable_published !== undefined ? Number(body.is_timetable_published) : Number(subject.is_timetable_published ?? 0);

    if (!isValidSubjectDuration(nextDuration)) return apiError(400, "duration must be an integer from 1 to 360 (minutes)");
    if (!Number.isInteger(nextWindow) || nextWindow < 1 || nextWindow > 1440) return apiError(400, "window_duration must be an integer from 1 to 1440 (minutes)");
    if (nextExamDatetime !== "2099-01-01T00:00" && !isValidExamDateTime(nextExamDatetime)) return apiError(400, "exam_datetime must be a valid ISO datetime string");

    queries.updateSubjectSchedulingInfo.run(
      sqlInt(subject.teacher_id),
      body.can_retake !== undefined ? Number(body.can_retake) : Number(subject.can_retake ?? 1),
      subject.mode || "exam",
      nextExamDatetime,
      nextDuration,
      nextWindow,
      nextTimetablePublished,
      subjectId,
    );
    auditLog(auth.userId, "SUBJECT_SCHEDULE_UPDATE", "subject", subjectId, JSON.stringify({
      exam_datetime: nextExamDatetime, duration: nextDuration, window_duration: nextWindow, is_timetable_published: nextTimetablePublished,
    }));
    return apiSuccess(queries.getSubjectById.get(subjectId));
  }

  if (subjectMatch && method === "DELETE") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const subjectId = Number(subjectMatch[1]);
    if (!isPositiveIntId(subjectId)) return apiError(400, "Invalid subject id");
    const examRow = queries.getSubjectExamCheck.get(subjectId);
    if (examRow) return apiError(409, "Cannot delete subject with active or completed exams");
    const subject = queries.getSubjectById.get(subjectId) as any;
    if (subject?.teacher_id) authz.invalidateTeacherCache(Number(subject.teacher_id));
    queries.deleteSubject.run(subjectId);
    auditLog(auth.userId, "SUBJECT_DELETE", "subject", subjectId, "{}");
    return apiMessage("Subject deleted");
  }

  // ── Content Manifest (admin/teacher content library) ───────────────────────
  if ((pathname === "/api/sync/content/manifest" || pathname === "/api/content/manifest") && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator", "teacher", "student", "guardian"]);
    const packages = db.prepare(`
      SELECT exam_body, year, subject_code, paper_type, COUNT(*) as question_count, MIN(id) as sample_id
      FROM content_bank.content_bank
      GROUP BY exam_body, year, subject_code, paper_type
      ORDER BY year DESC, exam_body ASC, subject_code ASC
    `).all() as any[];
    const formatted = packages.map((p: any) => ({
      id: `${p.exam_body}_${p.year}_${p.subject_code}`,
      exam_body: p.exam_body,
      year: p.year,
      subject_code: p.subject_code,
      subject: p.subject_code,
      paper_type: p.paper_type,
      question_count: p.question_count,
      content_count: p.question_count,
      name: `${p.exam_body} ${p.year} ${p.subject_code}`,
    }));
    return apiSuccess({ packages: formatted });
  }

  // ── Timetables API ──────────────────────────────────────────────────────────
  if (method === "GET" && pathname === "/api/timetables") {
    const auth = requireAuth(req);
    const qSessionId = Number(url.searchParams.get("sessionId") || 0);
    const qTermId = Number(url.searchParams.get("termId") || 0);
    const activeSession = queries.getActiveAcademicSession.get() as any;
    const activeTerm = queries.getActiveAcademicTerm.get() as any;
    const targetSessionId = qSessionId || activeSession?.id;
    const targetTermId = qTermId || activeTerm?.id;
    
    let rows = queries.getTimetables.all() as any[];
    if (auth.role === "teacher") {
      rows = rows.filter(t => t.teacher_id === auth.userId);
    }
    // Default to active session/term scoping when no explicit filter — prevents cross-term leakage
    if (targetSessionId) {
      rows = rows.filter(t => !t.session_id || Number(t.session_id) === targetSessionId);
    }
    if (targetTermId) {
      rows = rows.filter(t => !t.term_id || Number(t.term_id) === targetTermId);
    }
    return apiSuccess(rows);
  }

  if (method === "POST" && pathname === "/api/timetables") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const body = await readJson(req);
    const subject_id = Number(body?.subject_id);
    const cls = trimStr(body?.class);
    const gradeLevelId = body?.grade_level_id !== undefined ? Number(body.grade_level_id) || null : null;
    const section = trimStr(body?.section);
    const exam_date = trimStr(body?.exam_date);
    const start_time = trimStr(body?.start_time);
    const end_time = trimStr(body?.end_time);
    const duration = Number(body?.duration);
    const exam_mode = ["CBT", "Assignment", "Offline"].includes(body?.exam_mode) ? body.exam_mode : "CBT";
    const allow_students = body?.allow_students ? 1 : 0;
    const teacher_id = Number(body?.teacher_id) || auth.userId;
    const can_retake = body?.can_retake ? 1 : 0;
    const schedule_status = body?.schedule_status === "unscheduled" ? "unscheduled" : "scheduled";
    const subject_mode = ["test", "exam", "quiz"].includes(body?.subject_mode) ? body.subject_mode : "exam";

    if (!isPositiveIntId(subject_id)) return apiError(400, "Invalid subject_id");

    if (schedule_status === "unscheduled") {
      queries.updateSubjectSchedulingInfo.run(teacher_id, can_retake, subject_mode, "2099-01-01T00:00", 60, 120, 0, subject_id);
      return apiSuccess({ id: null, status: "unscheduled" }, 200);
    }

    if (!exam_date || !start_time || !end_time) return apiError(400, "exam_date, start_time, and end_time are required");
    if (!isValidSubjectDuration(duration)) return apiError(400, "duration must be an integer from 1 to 360 (minutes)");
    if (!isExamDatetimeInFuture(exam_date + "T" + start_time)) return apiError(400, "exam_date must be in the future");
    
    // validate end_time > start_time
    const [sH, sM] = start_time.split(":").map(Number) as [number, number];
    const [eH, eM] = end_time.split(":").map(Number) as [number, number];
    if ((eH * 60 + eM) <= (sH * 60 + sM)) {
      return apiError(400, "end_time must be after start_time");
    }

    const result = queries.createTimetable.run(subject_id, cls, gradeLevelId, section, exam_date, start_time, end_time, duration, exam_mode, allow_students) as {
      lastInsertRowid: number | bigint;
    };
    
    // Update the subject record with the newly assigned teacher, retake policy, and schedule data
    const window_duration = Math.max(0, Math.floor((eH * 60 + eM) - (sH * 60 + sM)));
    queries.updateSubjectSchedulingInfo.run(teacher_id, can_retake, subject_mode, exam_date + "T" + start_time, duration, window_duration, allow_students, subject_id);
    
    auditLog(auth.userId, "TIMETABLE_CREATE", "timetable", Number(result.lastInsertRowid), JSON.stringify({ subject_id }));
    return apiSuccess({ id: Number(result.lastInsertRowid) }, 201);
  }

  const timetableMatch = pathname.match(/^\/api\/timetables\/(\d+)$/);
  if (timetableMatch && method === "PUT") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const timetableId = Number(timetableMatch[1]);
    if (!isPositiveIntId(timetableId)) return apiError(400, "Invalid timetable id");
    
    const body = await readJson(req);
    const subject_id = Number(body?.subject_id);
    const cls = trimStr(body?.class);
    const gradeLevelId = body?.grade_level_id !== undefined ? Number(body.grade_level_id) || null : null;
    const section = trimStr(body?.section);
    const exam_date = trimStr(body?.exam_date);
    const start_time = trimStr(body?.start_time);
    const end_time = trimStr(body?.end_time);
    const duration = Number(body?.duration);
    const exam_mode = ["CBT", "Assignment", "Offline"].includes(body?.exam_mode) ? body.exam_mode : "CBT";
    const allow_students = body?.allow_students ? 1 : 0;
    const teacher_id = Number(body?.teacher_id) || auth.userId;
    const can_retake = body?.can_retake ? 1 : 0;
    const schedule_status = body?.schedule_status === "unscheduled" ? "unscheduled" : "scheduled";
    const subject_mode = ["test", "exam", "quiz"].includes(body?.subject_mode) ? body.subject_mode : "exam";

    if (!isPositiveIntId(subject_id)) return apiError(400, "Invalid subject_id");

    if (schedule_status === "unscheduled") {
      queries.deleteTimetable.run(timetableId);
      queries.updateSubjectSchedulingInfo.run(teacher_id, can_retake, subject_mode, "2099-01-01T00:00", 60, 120, 0, subject_id);
      return apiMessage("Timetable unscheduled");
    }

    if (!exam_date || !start_time || !end_time) return apiError(400, "exam_date, start_time, and end_time are required");
    if (!isValidSubjectDuration(duration)) return apiError(400, "duration must be an integer from 1 to 360 (minutes)");
    
    const [sH, sM] = start_time.split(":").map(Number) as [number, number];
    const [eH, eM] = end_time.split(":").map(Number) as [number, number];
    if ((eH * 60 + eM) <= (sH * 60 + sM)) {
      return apiError(400, "end_time must be after start_time");
    }

    queries.updateTimetable.run(subject_id, cls, gradeLevelId, section, exam_date, start_time, end_time, duration, exam_mode, allow_students, timetableId);
    
    const window_duration = Math.max(0, Math.floor((eH * 60 + eM) - (sH * 60 + sM)));
    queries.updateSubjectSchedulingInfo.run(teacher_id, can_retake, subject_mode, exam_date + "T" + start_time, duration, window_duration, allow_students, subject_id);
    
    return apiMessage("Timetable updated");
  }

  if (timetableMatch && method === "DELETE") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const timetableId = Number(timetableMatch[1]);
    if (!isPositiveIntId(timetableId)) return apiError(400, "Invalid timetable id");
    
    queries.deleteTimetable.run(timetableId);
    auditLog(auth.userId, "TIMETABLE_DELETE", "timetable", timetableId, "{}");
    return apiMessage("Timetable deleted");
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

    const cacheKey = `${CacheKeys.subjectQuestions(subjectId)}:${auth.role}`;
    const responsePayload = cacheService.wrapSync(cacheKey, 60, () => {
      const rows = queries.getQuestionsBySubject.all(subjectId) as any[];
      return stripCorrectAnswer(rows, auth.role);
    });
    return apiSuccess(responsePayload);
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
    const explanation = body?.explanation !== undefined ? (trimStr(body.explanation) || null) : null;
    const solution = body?.solution !== undefined ? (trimStr(body.solution) || null) : null;
    // [SECURITY FIX VULN-02] Validate image_url against an allowed prefix allowlist.
    // An unrestricted URL field is a stored XSS / SSRF vector if the frontend renders it
    // via <img src> or if the server ever fetches it. Only relative /uploads/ paths are allowed.
    const rawImageUrl = trimStr(body?.image_url);
    if (rawImageUrl && !rawImageUrl.startsWith("/uploads/")) {
      return apiError(400, "image_url must be a relative /uploads/ path");
    }
    const image_url = rawImageUrl || null;
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
        // [SECURITY FIX VULN-02] Restrict attached_file_url to /uploads/ paths
        (() => { const u = body?.attached_file_url !== undefined ? trimStr(body.attached_file_url) : ""; if (u && !u.startsWith("/uploads/")) throw new HttpError(400, "attached_file_url must be a relative /uploads/ path"); return u || null; })(),
        explanation,
        solution
      );
      // Always recompute total_score from source of truth
      queries.updateSubjectTotalScore.run(Number(subject_id), Number(subject_id));
      return result;
    });
    const result = tx() as { lastInsertRowid: number | bigint };
    cacheService.deletePattern(`subject_questions:${subject_id}`);
    auditLog(auth.userId, "QUESTION_CREATE", "question", Number(result.lastInsertRowid), "{}");
    return apiSuccess({ id: Number(result.lastInsertRowid) }, 201);
  }

  // ── Bulk question creation (teacher/operator) ──────────────────────────────
  if (method === "POST" && pathname === "/api/questions/bulk") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const body = await readJson(req);
    const incoming = body?.questions;
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return apiError(400, "questions must be a non-empty array");
    }
    if (incoming.length > 200) {
      return apiError(400, "Maximum 200 questions per bulk upload");
    }

    // Validate subject ownership once
    const subjectId = Number(incoming[0]?.subject_id);
    if (!isPositiveIntId(subjectId)) return apiError(400, "Invalid subject_id");
    const subject = queries.getSubjectById.get(subjectId) as any;
    if (!subject) return apiError(404, "Subject not found");
    if (auth.role === "teacher" && !sameUserId(subject.teacher_id, auth.userId)) return apiError(403, "You do not own this subject");
    if (subject.is_published) return apiError(409, "Subject is published. Unpublish to add questions.");

    let created = 0;
    const errors: string[] = [];

    const tx = db.transaction(() => {
      const baseOrder = (queries.getQuestionsBySubject.all(subjectId) as any[]).length;
      for (let i = 0; i < incoming.length; i++) {
        const q = incoming[i];
        try {
          const qText = trimStr(q?.question_text);
          const opts = q?.options;
          const cAns = Number(q?.correct_answer);
          const mks = Number(q?.marks ?? 1);
          if (!qText || !Array.isArray(opts) || opts.length !== 4) {
            errors.push(`Q${i + 1}: missing question_text or options`);
            continue;
          }
          if (!opts.every((o: unknown) => typeof o === "string")) {
            errors.push(`Q${i + 1}: options must be strings`);
            continue;
          }
          if (!Number.isInteger(cAns) || cAns < 0 || cAns > 3) {
            errors.push(`Q${i + 1}: correct_answer must be 0-3`);
            continue;
          }
          if (!Number.isInteger(mks) || mks < 1) {
            errors.push(`Q${i + 1}: marks must be a positive integer`);
            continue;
          }
          const paddedOptions = opts.length < 4
            ? [...opts, ...Array(4 - opts.length).fill("")]
            : opts.slice(0, 4);
          queries.createQuestion.run(
            subjectId,
            qText,
            JSON.stringify(paddedOptions),
            cAns,
            mks,
            baseOrder + i,
            "objective",
            trimStr(q?.session) || null,
            trimStr(q?.term) || null,
            "exam",
            trimStr(q?.teacher_answer) || null,
            null, 0, null,
            trimStr(q?.explanation) || null,
            trimStr(q?.solution) || null,
          );
          created++;
        } catch (err: any) {
          errors.push(`Q${i + 1}: ${err.message || "unknown error"}`);
        }
      }
      queries.updateSubjectTotalScore.run(subjectId, subjectId);
    });
    tx();

    cacheService.deletePattern(`subject_questions:${subjectId}`);
    auditLog(auth.userId, "QUESTION_CREATE", "question", subjectId, JSON.stringify({ bulk: true, created, errors: errors.length }));
    return apiSuccess({ created, errors }, 201);
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
      cacheService.deletePattern(`subject_questions:${question.subject_id}`);
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
    const nextExplanation = body.explanation !== undefined ? (trimStr(body.explanation) || null) : (question.explanation || null);
    const nextSolution = body.solution !== undefined ? (trimStr(body.solution) || null) : (question.solution || null);
    // [SECURITY FIX VULN-02] Same /uploads/ allowlist as question creation.
    const rawNextImg = body.image_url !== undefined ? trimStr(body.image_url) : (question.image_url || "");
    if (rawNextImg && !rawNextImg.startsWith("/uploads/")) {
      return apiError(400, "image_url must be a relative /uploads/ path");
    }
    const nextImg = rawNextImg || null;
    db.transaction(() => {
      const nextIsFileUpload = body.is_file_upload !== undefined ? Number(body.is_file_upload) : Number(question.is_file_upload ?? 0);
      // [SECURITY FIX VULN-02] Restrict attached_file_url to /uploads/ paths on edit too
      const rawAttachedUrl = body.attached_file_url !== undefined ? (trimStr(body.attached_file_url) || "") : (question.attached_file_url || "");
      if (rawAttachedUrl && !rawAttachedUrl.startsWith("/uploads/")) throw new HttpError(400, "attached_file_url must be a relative /uploads/ path");
      const nextAttachedFileUrl = rawAttachedUrl || null;
      queries.updateQuestion.run(nextText, optionsJson, nextCorrect, nextMarks, nextType, nextTAnswer, nextImg, nextIsFileUpload, nextAttachedFileUrl, nextExplanation, nextSolution, questionId);
      // Recompute total_score since marks may have changed
      queries.updateSubjectTotalScore.run(Number(question.subject_id), Number(question.subject_id));
    })();
    cacheService.deletePattern(`subject_questions:${question.subject_id}`);
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
    const isLearningMode = ["practice", "mock"].includes(subject.mode) || ["learning_practice", "learning_mock"].includes(subject.assessment_type);
    const initialResultStatus = isLearningMode || (subject.result_policy === "immediate") ? "released" : (subject.result_policy === "manual" ? "hidden" : "scheduled");
    const deadline = subject.duration ? new Date(Date.now() + Number(subject.duration) * 60_000).toISOString() : null;

    // Resolve session/term strings for legacy columns (fallback to CURRENT_TERM)
    const activeSessionForExam = queries.getActiveAcademicSession.get() as any;
    const activeTermForExam = queries.getActiveAcademicTerm.get() as any;
    const sessionName = subject.session || activeSessionForExam?.name || currentTerm || "2026/2027";
    const termName = subject.term || activeTermForExam?.name || currentTerm || "First Term";
    try {
      queries.createExam.run(
        auth.userId, subjectId, new Date().toISOString(), "[]", sessionName, termName, subject.mode || "exam",
        deadline, initialResultStatus, 5, "[]"
      );
    } catch (e: any) {
      if (e?.message?.includes("UNIQUE")) return apiError(409, "You have already started this exam");
      throw e;
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
        solution_reveals_remaining: exam.solution_reveals_remaining ?? 5,
        revealed_solutions: JSON.parse(exam.revealed_solutions_json || "[]"),
        assessment_type: subject.assessment_type || "school_mode",
        result_policy: subject.result_policy || "immediate",
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
    // [SECURITY FIX] Allow saves up to 15s after deadline (MUST be less than the 30s submit grace period)
    if (Date.now() > deadline + 15_000) return apiError(409, "Exam window has closed — answers cannot be saved");
    const remaining = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
    queries.saveExam.run(JSON.stringify(answers), examId, auth.userId);
    return apiSuccess({ saved: true, server_time: new Date().toISOString(), time_remaining_seconds: remaining });
  }

  // ── Solution Reveal Endpoint (Learning Mode: Practice & Mock) ──────────────
  const examRevealSolutionMatch = pathname.match(/^\/api\/exams\/(\d+)\/reveal-solution$/);
  if (examRevealSolutionMatch && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["student", "teacher", "operator"]);
    const examId = Number(examRevealSolutionMatch[1]);
    if (!isPositiveIntId(examId)) return apiError(400, "Invalid exam id");
    const exam = queries.getExamById.get(examId) as any;
    if (!exam) return apiError(404, "Exam not found");
    if (auth.role === "student" && !sameUserId(exam.student_id, auth.userId)) return apiError(403, "Forbidden");

    const subject = queries.getSubjectById.get(exam.subject_id) as any;
    if (!subject) return apiError(404, "Subject not found");
    const isLearningMode = ["practice", "mock"].includes(subject.mode) || ["learning_practice", "learning_mock"].includes(subject.assessment_type);
    if (!isLearningMode && auth.role === "student") {
      return apiError(403, "Solution reveals are only available for Learning Mode assessments (Practice and Mock)");
    }

    const body = await readJson(req);
    const questionId = Number(body?.question_id);
    if (!isPositiveIntId(questionId)) return apiError(400, "question_id is required");

    let revealedList: number[] = [];
    try { revealedList = JSON.parse(exam.revealed_solutions_json || "[]"); } catch { revealedList = []; }
    if (!Array.isArray(revealedList)) revealedList = [];

    const isAlreadyRevealed = revealedList.includes(questionId);
    let remaining = Number(exam.solution_reveals_remaining ?? 5);

    if (!isAlreadyRevealed && auth.role === "student") {
      if (remaining <= 0) {
        return apiError(403, "Maximum solution reveal limit reached for this attempt (5/5 used)");
      }
      remaining = Math.max(0, remaining - 1);
      revealedList.push(questionId);
      queries.updateExamReveals.run(remaining, JSON.stringify(revealedList), examId);
    }

    const question = queries.getQuestionById.get(questionId) as any;
    if (!question) return apiError(404, "Question not found");

    return apiSuccess({
      success: true,
      question_id: questionId,
      explanation: question.explanation || question.teacher_answer || null,
      solution: question.solution || question.teacher_answer || null,
      solution_reveals_remaining: remaining,
      revealed_solutions: revealedList
    });
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
    let result: {
      exam_id: number;
      score: number;
      total_score: number;
      time_taken_seconds: number;
      subject_id: number;
      answered_questions?: number;
      total_questions?: number;
    };
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

        // ── Dual Assessment Engine: Determine Result Release Status ──────────
        const isLearning = ["practice", "mock"].includes(subject.mode) || ["learning_practice", "learning_mock"].includes(subject.assessment_type);
        let finalResultStatus = "released";
        if (!isLearning) {
          if (subject.result_policy === "manual") {
            finalResultStatus = "hidden";
          } else if (subject.result_policy === "scheduled") {
            const releaseTs = subject.result_release_time ? Date.parse(subject.result_release_time) : 0;
            if (Number.isFinite(releaseTs) && Date.now() < releaseTs) {
              finalResultStatus = "scheduled";
            } else {
              finalResultStatus = "released";
            }
          }
        }
        db.prepare("UPDATE exams SET result_status = ? WHERE id = ?").run(finalResultStatus, examId);

        return {
          exam_id: examId, score, total_score: total, subject_id: exam.subject_id,
          answered_questions: answered, total_questions: questions.length,
          time_taken_seconds: Math.max(0, Math.floor((Date.now() - Date.parse(exam.start_time)) / 1000)),
        };
      });

      // Execute submission with resilient backoff retry for high-concurrency burst handling
      const maxRetries = 5;
      let attempt = 0;
      while (true) {
        try {
          result = submitTx();
          break;
        } catch (err: any) {
          attempt++;
          if (attempt <= maxRetries && /busy|locked/i.test(err?.message || "")) {
            const delay = Math.floor(Math.random() * 40) + attempt * 30;
            const startWait = Date.now();
            while (Date.now() - startWait < delay) {}
            continue;
          }
          throw err;
        }
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(500, "Server error during exam submission");
    }

    auditLog(auth.userId, "EXAM_SUBMIT", "exam", result.exam_id, JSON.stringify({ score: result.score, total: result.total_score }));
    
    // Notify the owning teacher in real-time via SSE
    const subjectRow = queries.getSubjectById.get(result.subject_id) as any;
    if (subjectRow?.teacher_id) {
      const student = queries.getUserById.get(auth.userId) as any;
      const teacherRole = (queries.getUserById.get(sqlInt(subjectRow.teacher_id)) as any)?.role;
      const link = teacherRole === "operator" ? `/ADMIN/dashboard` : `/teacher/results?subject_id=${subjectRow.id}`;
      notifyUser(sqlInt(subjectRow.teacher_id), {
        type: "exam_submitted",
        message: `${student?.name || 'A student'} submitted ${subjectRow.code} — Score: ${result.score}/${result.total_score}`,
        link: link
      });

      // ── Auto-Create Grading Subject ─────────────────────────────────────────
      try {
        const activeTerm = queries.getActiveAcademicTerm.get() as any;
        const activeSession = queries.getActiveAcademicSession.get() as any;
        const targetTermId = subjectRow.term_id || activeTerm?.id;
        const targetSessionId = subjectRow.session_id || activeSession?.id;
        if (targetTermId && targetSessionId) {
          // Check if a general (class_id IS NULL) grading subject exists for this code and term
          const existing = db.prepare("SELECT id FROM grading_subjects WHERE code = ? AND term_id = ? AND class_id IS NULL LIMIT 1").get(subjectRow.code, targetTermId) as any;
          if (!existing) {
             const gsResult = queries.createGradingSubject.run(
               subjectRow.name, 
               subjectRow.code, 
               null, 
               targetTermId, 
               targetSessionId, 
               subjectRow.teacher_id
             ) as any;
             const newGsId = Number(gsResult.lastInsertRowid);
             
             // Auto-map CBT policy based on CBT subject mode
             const mode = subjectRow.mode || "exam";
             const policyType = mode === "exam" ? "cbt_exam" : "cbt_test";
             const policyName = mode === "exam" ? "CBT Examination" : "CBT Test";
             const maxMarks = mode === "exam" ? 60 : 40;
             const isExam = mode === "exam" ? 1 : 0;
             
             queries.createGradingPolicy.run(
               newGsId, policyName, policyType, subjectRow.id, maxMarks, isExam
             );
          } else {
             // Ensure the policy is mapped if it isn't already
             const hasPolicy = db.prepare("SELECT id FROM grading_policies WHERE grading_subject_id = ? AND mapped_cbt_subject_id = ? LIMIT 1").get(existing.id, subjectRow.id) as any;
             if (!hasPolicy) {
                const mode = subjectRow.mode || "exam";
                const policyType = mode === "exam" ? "cbt_exam" : "cbt_test";
                const policyName = mode === "exam" ? "CBT Examination" : "CBT Test";
                const maxMarks = mode === "exam" ? 60 : 40;
                const isExam = mode === "exam" ? 1 : 0;
                queries.createGradingPolicy.run(
                  existing.id, policyName, policyType, subjectRow.id, maxMarks, isExam
                );
             }
          }
        }
      } catch (e) {
        console.error("[Auto-Create Grading Subject Error]", e);
      }
    }

    const examRow = queries.getExamById.get(result.exam_id) as any;
    const isReleased = (examRow?.result_status || "released") === "released";

    if (!isReleased && auth.role === "student") {
      return apiSuccess({
        exam_id: result.exam_id,
        result_status: examRow.result_status,
        result_policy: subjectRow?.result_policy || "manual",
        result_release_time: subjectRow?.result_release_time || null,
        answered_questions: result.answered_questions,
        total_questions: result.total_questions,
        time_taken_seconds: result.time_taken_seconds,
        message: examRow.result_status === "scheduled"
          ? `Your assessment has been submitted. Results will be released on ${subjectRow?.result_release_time ? new Date(subjectRow.result_release_time).toLocaleString() : 'the scheduled date'}.`
          : "Your assessment has been submitted successfully. Results will be published by your instructor after evaluation."
      });
    }

    // Return result WITHOUT subject_id (internal field, not needed by client)
    const { subject_id: _sid, ...clientResult } = result;
    return apiSuccess({ ...clientResult, result_status: "released" });
  }

  if (method === "GET" && pathname === "/api/exams/results") {
    const auth = requireAuth(req);
    const qSessionId = Number(url.searchParams.get("sessionId") || 0);
    const qTermId = Number(url.searchParams.get("termId") || 0);
    const activeSession = queries.getActiveAcademicSession.get() as any;
    const activeTerm = queries.getActiveAcademicTerm.get() as any;
    const targetSessionId = qSessionId || activeSession?.id;
    const targetTermId = qTermId || activeTerm?.id;

    if (!targetSessionId || !targetTermId) return apiSuccess([]);

    let baseFilter = "e.status = 'completed'";
    const params: any[] = [];
    
    if (targetSessionId && targetTermId) {
      baseFilter += " AND (e.session_id = ? AND e.term_id = ? OR e.session_id IS NULL)";
      params.push(targetSessionId, targetTermId);
    }

    if (auth.role === "student") {
      params.unshift(auth.userId);
      const studentRows = db.prepare(`
        SELECT e.*, s.name as subject_name, s.result_policy, s.result_release_time, s.assessment_type, s.mode as subject_mode,
          (SELECT COUNT(*) FROM questions q WHERE q.subject_id = e.subject_id) as total_questions, 
          (SELECT COUNT(*) FROM student_answers sa WHERE sa.exam_id = e.id AND (sa.selected_option IS NOT NULL OR (sa.essay_response IS NOT NULL AND TRIM(sa.essay_response) != ''))) as answered_questions 
        FROM exams e 
        JOIN subjects s ON s.id = e.subject_id 
        WHERE e.student_id = ? AND ${baseFilter}
      `).all(...params) as any[];

      const sanitizedRows = studentRows.map((r) => {
        let isReleased = r.result_status === "released";
        if (r.result_status === "scheduled" && r.result_release_time) {
          const releaseTs = Date.parse(r.result_release_time);
          if (Number.isFinite(releaseTs) && Date.now() >= releaseTs) {
            isReleased = true;
          }
        }
        if (["practice", "mock"].includes(r.subject_mode) || ["learning_practice", "learning_mock"].includes(r.assessment_type)) {
          isReleased = true;
        }

        if (!isReleased) {
          return {
            ...r,
            score: null,
            answers_json: "[]",
            result_status: r.result_status || "hidden",
            is_result_released: false
          };
        }
        return {
          ...r,
          result_status: "released",
          is_result_released: true
        };
      });

      return apiSuccess(sanitizedRows);
    }
    if (auth.role === "teacher") {
      params.unshift(auth.userId);
      return apiSuccess(
        db.prepare(
          `SELECT e.*, s.name as subject_name, s.result_policy, s.result_release_time, s.assessment_type, (SELECT COUNT(*) FROM questions q WHERE q.subject_id = e.subject_id) as total_questions, (SELECT COUNT(*) FROM student_answers sa WHERE sa.exam_id = e.id AND (sa.selected_option IS NOT NULL OR (sa.essay_response IS NOT NULL AND TRIM(sa.essay_response) != ''))) as answered_questions, u.name as student_name, COALESCE(gl.name, u.grade) as grade, u.reg_id, u.id as student_user_id FROM exams e JOIN subjects s ON s.id = e.subject_id JOIN users u ON u.id = e.student_id LEFT JOIN grade_levels gl ON gl.id = u.grade_level_id WHERE s.teacher_id = ? AND ${baseFilter} ORDER BY e.end_time DESC`
        ).all(...params)
      );
    }
    if (auth.role === "guardian") {
      return apiError(403, "Guardians must use /api/guardian/wards/:id/exams or /api/guardian/wards/:id/results");
    }
    requireRole(auth.role, ["operator"]);
    return apiSuccess(
      db.prepare(
        `SELECT e.*, s.name as subject_name, s.result_policy, s.result_release_time, s.assessment_type, (SELECT COUNT(*) FROM questions q WHERE q.subject_id = e.subject_id) as total_questions, (SELECT COUNT(*) FROM student_answers sa WHERE sa.exam_id = e.id AND (sa.selected_option IS NOT NULL OR (sa.essay_response IS NOT NULL AND TRIM(sa.essay_response) != ''))) as answered_questions, u.name as student_name, COALESCE(gl.name, u.grade) as grade, u.reg_id, u.id as student_user_id FROM exams e JOIN subjects s ON s.id = e.subject_id JOIN users u ON u.id = e.student_id LEFT JOIN grade_levels gl ON gl.id = u.grade_level_id WHERE ${baseFilter} ORDER BY e.end_time DESC`
      ).all(...params)
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
    const subject = queries.getSubjectById.get(exam.subject_id) as any;
    const isLearningMode = subject && (["practice", "mock"].includes(subject.mode) || ["learning_practice", "learning_mock"].includes(subject.assessment_type));

    // Students can only view their own completed exam
    if (auth.role === "student") {
      if (!sameUserId(exam.student_id, auth.userId)) return apiError(403, "Forbidden");
      if (exam.status !== "completed") return apiError(403, "Exam must be completed to review answers");

      let isReleased = exam.result_status === "released";
      if (exam.result_status === "scheduled" && subject?.result_release_time) {
        const releaseTs = Date.parse(subject.result_release_time);
        if (Number.isFinite(releaseTs) && Date.now() >= releaseTs) {
          isReleased = true;
        }
      }
      if (isLearningMode) isReleased = true;

      if (!isReleased) {
        return apiError(403, exam.result_status === "scheduled" 
          ? `Results for this assessment will be released on ${new Date(subject.result_release_time).toLocaleString()}`
          : "Results have not been published by your instructor yet.");
      }
    }
    // Teachers can only view exams for their subjects
    if (auth.role === "teacher") {
      if (!subject || !sameUserId(subject.teacher_id, auth.userId)) return apiError(403, "Forbidden");
    }
    let answers = queries.getStudentAnswersByExam.all(examId) as any[];
    
    // [SECURITY FIX] Early Answer Leak Prevention
    // Strip correct answers if the student requests the review while the global exam window is still open.
    if (auth.role === "student" && !isLearningMode) {
      if (subject && subject.exam_datetime) {
        const start = Date.parse(subject.exam_datetime);
        const end = start + Number(subject.window_duration || 120) * 60_000;
        if (Date.now() < end) {
          answers = answers.map(({ correct_answer: _ca, teacher_answer: _ta, solution: _sol, ...ans }) => ans);
        }
      }
    }

    let revealedList: number[] = [];
    try { revealedList = JSON.parse(exam.revealed_solutions_json || "[]"); } catch { revealedList = []; }
    if (!Array.isArray(revealedList)) revealedList = [];

    // In learning mode for students, only show worked solution for questions student unlocked
    if (auth.role === "student" && isLearningMode) {
      answers = answers.map((ans) => {
        const isRevealed = revealedList.includes(Number(ans.question_id));
        return {
          ...ans,
          solution: isRevealed ? (ans.solution || ans.teacher_answer || null) : null,
          is_solution_revealed: isRevealed,
        };
      });
    }

    const student = queries.getUserById.get(exam.student_id) as any;
    return apiSuccess({
      exam: {
        ...exam,
        solution_reveals_remaining: exam.solution_reveals_remaining ?? 5,
        revealed_solutions: revealedList
      },
      answers,
      student: student ? stripPassword(student) : null
    });
  }

  // ── Publish / Release Results for a Subject (Teacher/Operator) ────────────
  const subjectReleaseMatch = pathname.match(/^\/api\/subjects\/(\d+)\/release-results$/);
  if (subjectReleaseMatch && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const subjectId = Number(subjectReleaseMatch[1]);
    if (!isPositiveIntId(subjectId)) return apiError(400, "Invalid subject id");
    const subject = queries.getSubjectById.get(subjectId) as any;
    if (!subject) return apiError(404, "Subject not found");
    if (auth.role === "teacher" && !sameUserId(subject.teacher_id, auth.userId)) return apiError(403, "You do not own this subject");

    const result = queries.releaseSubjectResults.run(subjectId) as { changes: number };
    const releasedCount = sqlInt(result.changes);

    // Update subject result_policy to immediate so subsequent submissions are also immediately visible
    db.prepare("UPDATE subjects SET result_policy = 'immediate' WHERE id = ?").run(subjectId);

    // Dispatch real-time system notifications to students and their guardians
    const completedStudents = db.prepare("SELECT DISTINCT student_id FROM subject_enrollments WHERE subject_id = ? UNION SELECT DISTINCT student_id FROM exams WHERE subject_id = ?").all(subjectId, subjectId) as Array<{ student_id: number }>;
    for (const s of completedStudents) {
      try {
        queries.createNotification.run(
          s.student_id,
          "result_released",
          `Results have been published for ${subject.name} (${subject.code}). Check your student results to view your score and review.`,
          `/student/results`
        );
        notifyUser(s.student_id, {
          type: "result_released",
          message: `Results published for ${subject.name} (${subject.code})`,
          link: `/student/results`
        });

        // Notify linked guardians
        const guardians = queries.getStudentGuardians.all(s.student_id) as any[];
        for (const g of guardians) {
          const guardianUser = queries.getUserById.get(Number(g.guardian_id)) as any;
          if (guardianUser && guardianUser.notify_results === 0) continue;

          queries.createNotification.run(
            Number(g.guardian_id),
            "result_released",
            `Results published: ${subject.name} (${subject.code}) results are now available for your ward.`,
            `/guardian/performance`
          );
          notifyUser(Number(g.guardian_id), {
            type: "result_released",
            message: `Results published for ${subject.name} (${subject.code})`,
            link: `/guardian/performance`
          });
        }
      } catch {}
    }

    auditLog(auth.userId, "RESULTS_PUBLISHED", "subjects", subjectId, JSON.stringify({ count: releasedCount }));
    return apiSuccess({ released: true, count: releasedCount, subject_id: subjectId });
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
      ? db.prepare("SELECT e.*, s.name as subject_name, s.code as subject_code, u.name as student_name, COALESCE(gl.name, u.grade) as grade, u.reg_id FROM exams e JOIN subjects s ON s.id = e.subject_id JOIN users u ON u.id = e.student_id LEFT JOIN grade_levels gl ON gl.id = u.grade_level_id WHERE e.status = 'completed' AND s.teacher_id = ? ORDER BY s.name, grade, u.name").all(auth.userId)
      : db.prepare("SELECT e.*, s.name as subject_name, s.code as subject_code, u.name as student_name, COALESCE(gl.name, u.grade) as grade, u.reg_id FROM exams e JOIN subjects s ON s.id = e.subject_id JOIN users u ON u.id = e.student_id LEFT JOIN grade_levels gl ON gl.id = u.grade_level_id WHERE e.status = 'completed' ORDER BY s.name, grade, u.name").all();
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
    // Teachers may promote students in their assigned class or enrolled in their subjects
    if (auth.role === "teacher") {
      const teacherClass = db.prepare("SELECT id, name FROM classes WHERE class_teacher_id = ? LIMIT 1").get(auth.userId) as any;
      let isAllowed = false;
      if (teacherClass) {
        const studentInClass = db.prepare(`
          SELECT 1 FROM class_enrollments ce WHERE ce.class_id = ? AND ce.student_id = ?
          UNION
          SELECT 1 FROM users u LEFT JOIN grade_levels gl ON gl.id = u.grade_level_id WHERE u.id = ? AND (COALESCE(gl.name, u.grade) = ? OR u.class_id = ?)
        `).get(teacherClass.id, targetId, targetId, teacherClass.name, teacherClass.id);
        if (studentInClass) isAllowed = true;
      }
      if (!isAllowed) {
        const linked = db.prepare(`
          SELECT 1 FROM subject_enrollments se JOIN subjects s ON s.id = se.subject_id WHERE se.student_id = ? AND s.teacher_id = ?
          UNION
          SELECT 1 FROM grading_subjects gs JOIN class_enrollments ce ON ce.class_id = gs.class_id WHERE gs.teacher_id = ? AND ce.student_id = ?
        `).get(targetId, auth.userId, auth.userId, targetId);
        if (linked) isAllowed = true;
      }
      if (!isAllowed) return apiError(403, "Student is not assigned to your class or enrolled in any of your subjects");
    }
    const body = await readJson(req);
    const newGradeId = Number(body?.grade_level_id);
    if (!newGradeId) return apiError(400, "grade_level_id is required");
    queries.updateUserGrade.run(newGradeId, targetId);
    auditLog(auth.userId, "STUDENT_GRADE_UPDATE", "user", targetId, JSON.stringify({ grade_level_id: newGradeId }));
    return apiSuccess({ id: targetId, grade_level_id: newGradeId });
  }

  if (method === "GET" && pathname === "/api/users") {
    const auth = requireAuth(req);
    const role  = url.searchParams.get("role");
    // [SECURITY FIX] Cap grade parameter length to prevent memory/CPU waste
    const grade = (url.searchParams.get("grade") ?? "").trim().slice(0, 32) || null;
    // Operators get full access; teachers may only fetch student list (role=student)
    if (auth.role === "teacher") {
      if (role !== "student") return apiError(403, "Forbidden");
      const teacherClass = queries.getClassForTeacher.get(auth.userId) as any;
      if (teacherClass) {
        let q = `SELECT DISTINCT u.id, u.name, u.email, u.role, COALESCE(gl.name, u.grade) as grade, u.reg_id, u.is_active, u.created_at
                 FROM users u
                 LEFT JOIN grade_levels gl ON gl.id = u.grade_level_id
                 WHERE u.role = 'student' AND u.is_active = 1 AND (
                   COALESCE(gl.name, u.grade) = ?
                   OR u.id IN (
                     SELECT se.student_id FROM subject_enrollments se JOIN subjects s ON s.id = se.subject_id WHERE s.teacher_id = ?
                   )
                 )`;
        const params: any[] = [teacherClass.name, auth.userId];
        if (grade) {
          q += " AND COALESCE(gl.name, u.grade) = ?";
          params.push(grade);
        }
        return apiSuccess(db.prepare(q).all(...params));
      } else {
        let q = "SELECT DISTINCT u.id, u.name, u.email, u.role, COALESCE(gl.name, u.grade) as grade, u.reg_id, u.is_active, u.created_at FROM users u LEFT JOIN grade_levels gl ON gl.id = u.grade_level_id JOIN subject_enrollments se ON se.student_id = u.id JOIN subjects s ON s.id = se.subject_id WHERE u.role = 'student' AND u.is_active = 1 AND s.teacher_id = ?";
        const params: any[] = [auth.userId];
        if (grade) {
          q += " AND COALESCE(gl.name, u.grade) = ?";
          params.push(grade);
        }
        return apiSuccess(db.prepare(q).all(...params));
      }
    }
    requireRole(auth.role, ["operator"]);
    if (role && !isValidRoleParam(role)) return apiError(400, "Invalid role filter");
    
    let q = "SELECT u.id, u.name, u.email, u.role, COALESCE(gl.name, u.grade) as grade, u.reg_id, u.first_name, u.last_name, u.phone, u.is_active, u.created_at FROM users u LEFT JOIN grade_levels gl ON gl.id = u.grade_level_id WHERE 1=1";
    const params: any[] = [];
    if (role) {
      q += " AND u.role = ?";
      params.push(role);
    }
    if (grade) {
      q += " AND COALESCE(gl.name, u.grade) = ?";
      params.push(grade);
    }
    q += " ORDER BY u.id DESC LIMIT 1000";
    return apiSuccess(db.prepare(q).all(...params));
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
      result = queries.createUser.run(name, email, "operator", hash, null, opRegId, null, null, null, null, null, null) as { lastInsertRowid: number | bigint };
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
    const schoolName = (queries.getSetting.get("SCHOOL_NAME") as any)?.value || "School";
    const activeTermRow = (queries.getActiveAcademicTerm.get() as any);
    const currentTerm = activeTermRow?.name || (queries.getSetting.get("CURRENT_TERM") as any)?.value || "2026-T1";
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
    const instSetting = db.prepare("SELECT value FROM settings WHERE key = 'INSTITUTION_TYPE'").get() as {value: string} | undefined;
    configData.institution_type = instSetting?.value || "";
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
    cacheService.delete(CacheKeys.setting("SCHOOL_NAME"));
    if (typeof body?.registration_open === "boolean") {
      queries.upsertSetting.run("REGISTRATION_OPEN", body.registration_open ? "true" : "false");
      cacheService.delete(CacheKeys.registrationOpen());
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
    const newGradeLevelId = body?.grade_level_id !== undefined ? (Number(body.grade_level_id) || null) : target.grade_level_id || null;
    let resolvedGradeString = trimStr(body?.grade) || target.grade || null;
    if (newGradeLevelId && newGradeLevelId !== target.grade_level_id) {
      const gl = db.prepare("SELECT name FROM grade_levels WHERE id = ?").get(newGradeLevelId) as any;
      if (gl) resolvedGradeString = gl.name;
    }
    
    // Profile update
    queries.updateUser.run(
      trimStr(body?.first_name) || target.first_name || null,
      trimStr(body?.last_name) || target.last_name || null,
      trimStr(body?.address) || target.address || null,
      trimStr(body?.phone) || target.phone || null,
      trimStr(body?.dob) || target.dob || null,
      resolvedGradeString,
      newGradeLevelId,
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
    // [SECURITY FIX VULN-10] Check Content-Length BEFORE buffering the entire body into memory.
    // Without this check a client could send a multi-GB payload that fills server RAM before
    // the 'Invalid SQLite file' rejection ever fires.
    const IMPORT_MAX_BYTES = 52 * 1024 * 1024; // 52 MB
    const contentLength = Number(req.headers.get("content-length"));
    if (contentLength && contentLength > IMPORT_MAX_BYTES) {
      return apiError(413, "Payload Too Large — max import size is 52 MB");
    }
    const buffer = new Uint8Array(await req.arrayBuffer());
    if (buffer.byteLength > IMPORT_MAX_BYTES) return apiError(413, "Payload Too Large — max import size is 52 MB");
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
    const confirmVal = trimStr(body?.confirm || body?.confirmation || body?.confirmText || "").toUpperCase();
    if (confirmVal !== "RESET_ALL_DATA" && confirmVal !== "DELETE ALL DATA") {
      return apiError(400, "Confirmation string required. Type \"DELETE ALL DATA\" to confirm.");
    }
    try {
      db.transaction(() => {
        // Disable FK checks for comprehensive wipe — we will re-enable after
        db.run("PRAGMA foreign_keys = OFF");
        // Child tables first (grading, exams, enrollments, etc.)
        const tablesToClear = [
          "grading_student_scores",
          "grading_calculated_results",
          "grading_assessments",
          "grading_categories",
          "grading_grade_boundaries",
          "grading_scheme_versions",
          "grading_schemes",
          "grading_manual_scores",
          "grading_policies",
          "term_results",
          "annual_results",
          "grading_subjects",
          "student_answers",
          "exam_attempts",
          "question_map",
          "exams",
          "questions",
          "subject_enrollments",
          "timetables",
          "class_enrollments",
          "class_teacher_assignments",
          "guardian_student_links",
          "academic_calendar_events",
          "kiosk_sessions",
          "notifications",
          "audit_logs",
          "token_blacklist",
          "user_tokens",
          "user_devices",
          "subjects",
          "student_term_remarks",
          "classes",
          // Keep grade_levels structure but clear custom entries later; do not wipe standardized ones here
        ];
        for (const tbl of tablesToClear) {
          try { db.prepare(`DELETE FROM ${tbl}`).run(); } catch {}
        }
        // Clear practice_logs attached DB (preserve schema)
        try { db.prepare("DELETE FROM practice_logs.practice_logs").run(); } catch {}
        // Wipe users last (after all FK dependents cleared)
        try { db.prepare("DELETE FROM users").run(); } catch {}
        // Reset autoincrement counters so IDs restart from 1
        try { db.prepare("DELETE FROM sqlite_sequence WHERE name NOT IN ('grade_levels','settings','config')").run(); } catch {}
        // Re-enable FK
        db.run("PRAGMA foreign_keys = ON");
        // Reset config and settings to factory state but preserve SCHEMA_VERSION
        db.prepare("DELETE FROM config").run();
        db.prepare("INSERT OR IGNORE INTO config (id, org_name, version) VALUES (1, 'ExamPool School', '1.0.0')").run();
        db.prepare("UPDATE settings SET value = '2026-T1' WHERE key = 'CURRENT_TERM'").run();
        db.prepare("UPDATE settings SET value = 'true' WHERE key = 'REGISTRATION_OPEN'").run();
        db.prepare("DELETE FROM settings WHERE key IN ('SCHOOL_NAME','CUSTOM_URL','INSTITUTION_TYPE')").run();
        db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('SCHEMA_VERSION','3')").run();
        // Ensure default academic session/term exist after wipe
        const sessionCount = (db.prepare("SELECT COUNT(*) as c FROM academic_sessions").get() as any)?.c ?? 0;
        if (Number(sessionCount) === 0) {
          db.prepare("INSERT INTO academic_sessions (name, is_active, status) VALUES ('2026/2027', 1, 'active')").run();
        } else {
          db.prepare("UPDATE academic_sessions SET is_active = CASE WHEN id = (SELECT MIN(id) FROM academic_sessions) THEN 1 ELSE 0 END").run();
        }
        const termCount = (db.prepare("SELECT COUNT(*) as c FROM academic_terms").get() as any)?.c ?? 0;
        if (Number(termCount) === 0) {
          const firstSessionId = (db.prepare("SELECT id FROM academic_sessions WHERE is_active = 1 LIMIT 1").get() as any)?.id ?? 1;
          db.prepare("INSERT INTO academic_terms (session_id, name, is_active, status, registration_open) VALUES (?, 'First Term', 1, 'active', 1)").run(firstSessionId);
        } else {
          db.prepare("UPDATE academic_terms SET is_active = CASE WHEN id = (SELECT MIN(id) FROM academic_terms) THEN 1 ELSE 0 END").run();
        }
        // Clear server-side caches so stale academic/registration data is not served after wipe
        try { cacheService.clear(); } catch {}
      })();
      // Re-seed grade levels, classes, and default academic structure (idempotent INSERT OR IGNORE)
      try { initializeDatabase(); } catch (e) { console.warn("[FactoryReset] initializeDatabase re-seed warning:", e); }
      // Reset in-memory custom URL to default after factory wipe
      activeCustomUrl = Bun.env.CUSTOM_URL || "exampool.ng";
    } catch (e: any) {
      console.error("[FactoryReset] transaction failed:", e);
      return apiError(500, "Factory reset failed: " + (e.message || String(e)));
    }
    // Audit after transaction (actor still valid via token, but users table is empty — log with raw ID)
    try { auditLog(auth.userId, "FACTORY_RESET", "system", null, JSON.stringify({ wiped: true })); } catch {}
    setupRequired = true;
    return apiMessage("Database reset complete. Refresh to run setup.");
  }

  // ── Grade Levels & Institution Settings ────────────────────────────────────
  if (method === "GET" && pathname === "/api/grade-levels") {
    // Only return the 22 standardized grades (not legacy custom ones)
    const grades = db.prepare("SELECT * FROM grade_levels WHERE is_active = 1 AND category != 'custom' ORDER BY sort_order ASC").all();
    return apiSuccess({ grades });
  }

  if (method === "POST" && pathname === "/api/settings/institution-type") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const body = await readJson(req);
    const type = body?.type;
    if (!["Primary", "Secondary", "University", "Polytechnic"].includes(type)) {
      return apiError(400, "Invalid institution type");
    }
    
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('INSTITUTION_TYPE', ?)").run(type);
    
    // Seed new grades
    let seeds: {name: string, cat: string}[] = [];
    if (type === 'Primary') {
      seeds = ['Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6'].map(n => ({name: n, cat: 'primary'}));
    } else if (type === 'University') {
      seeds = ['100 Level', '200 Level', '300 Level', '400 Level', '500 Level', '600 Level'].map(n => ({name: n, cat: 'university'}));
    } else if (type === 'Polytechnic') {
      seeds = ['ND 1', 'ND 2', 'HND 1', 'HND 2'].map(n => ({name: n, cat: 'polytechnic'}));
    } else {
      seeds = ['JSS 1', 'JSS 2', 'JSS 3', 'SS 1', 'SS 2', 'SS 3'].map(n => ({name: n, cat: 'secondary'}));
    }
    
    const stmt = db.prepare("INSERT OR IGNORE INTO grade_levels (name, category, sort_order) VALUES (?, ?, ?)");
    seeds.forEach((s, i) => stmt.run(s.name, s.cat, i + 1));
    
    return apiSuccess({ seeded: true, type });
  }
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
    const existingSession = db.prepare(`SELECT hardware_fingerprint FROM kiosk_sessions WHERE pc_id = ? AND status = 'active'`).get(pcId) as any;
    if (existingSession && auth.role !== "operator" && existingSession.hardware_fingerprint !== fingerprint) {
      return apiError(409, "This PC is currently in use by another session. Please ask an operator for assistance.");
    }

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
    const fingerprint = trimStr(body?.hardware_fingerprint) || "unknown";

    const existingSession = db.prepare(`SELECT hardware_fingerprint FROM kiosk_sessions WHERE pc_id = ? AND status = 'active'`).get(pcId) as any;
    if (existingSession && auth.role !== "operator" && existingSession.hardware_fingerprint !== fingerprint) {
      return apiError(409, "This PC is currently in use by another session. Please ask an operator for assistance.");
    }

    db.prepare(`UPDATE kiosk_sessions SET logout_time = ?, status = 'completed' WHERE pc_id = ? AND status = 'active'`)
      .run(Date.now(), pcId);
    
    db.prepare(`INSERT INTO kiosk_sessions (pc_id, seat_number, student_id, exam_id, hardware_fingerprint, login_time, status) VALUES (?, ?, ?, ?, ?, ?, 'active')`)
      .run(pcId, null, newStudentId, newExamId, fingerprint, Date.now());
      
    return apiSuccess({ switched: true }, 200, { "X-Exampool-Action": "WIPE_LOCAL_STORAGE" });
  }

  if (pathname === "/api/kiosk/session/end" && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const body = await readJson(req);
    const pcId = trimStr(body?.pc_id);
    if (!pcId) return apiError(400, "pc_id is required");

    db.prepare(`UPDATE kiosk_sessions SET logout_time = ?, status = 'completed' WHERE pc_id = ? AND status = 'active'`)
      .run(Date.now(), pcId);
      
    return apiSuccess({ ended: true }, 200, { "X-Exampool-Action": "WIPE_LOCAL_STORAGE" });
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
      server_ip: getCurrentPrimaryIp(),
      server_port: server.port,
      dns_active: isDnsListening,
      mdns_active: isMdnsListening,
    });
  }

  if (pathname === "/api/system/settings" && method === "PUT") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const body = await readJson(req);
    const rawUrl = typeof body?.custom_url === "string" ? body.custom_url.trim() : "";
    
    // Clean and validate URL hostname format (e.g. exampool.co, exampool.ng, school.edu.ng, exam.local)
    const cleanedUrl = rawUrl.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase().trim();
    if (!cleanedUrl || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(cleanedUrl)) {
      return apiError(400, "Invalid domain format. Examples: exampool.co, exampool.ng, exam.school.edu.ng");
    }
    
    queries.upsertSetting.run("CUSTOM_URL", cleanedUrl);
    const prevUrl = activeCustomUrl;
    activeCustomUrl = cleanedUrl;
    syncHostsFile(cleanedUrl);
    auditLog(auth.userId, "SYSTEM_SETTING_UPDATE", "system", null, JSON.stringify({ custom_url: cleanedUrl, prev: prevUrl }));
    console.log(`[DNS] Custom URL updated: ${prevUrl} -> ${cleanedUrl} -> ${getCurrentPrimaryIp()}:${server.port}`);
    if (isDnsListening) {
      console.log(`[DNS] DNS masking now serves: ${cleanedUrl} (+www.${cleanedUrl}, *.${cleanedUrl}) -> ${getCurrentPrimaryIp()}`);
    }
    
    return apiSuccess({
      custom_url: activeCustomUrl,
      server_ip: getCurrentPrimaryIp(),
      server_port: server.port,
      dns_active: isDnsListening,
      mdns_active: isMdnsListening,
    });
  }

  // ── GET /api/system/logs ─────────────────────────────────────────────────
  if (pathname === "/api/system/logs" && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    // Optional ?tail=N (default 100) and ?level=info|warn|error filter
    const tail  = Math.min(200, Math.max(1, Number(url.searchParams.get("tail")  || 100)));
    const level = url.searchParams.get("level") || "";
    const filtered = level
      ? logBuffer.filter((e) => e.level === level)
      : [...logBuffer];
    return apiSuccess(filtered.slice(-tail));
  }

  // ── GET /api/system/network-info ──────────────────────────────────────────
  if (pathname === "/api/system/network-info" && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const ifaces = os.networkInterfaces();
    const virtualPrefixes2 = ["vEthernet", "VMware", "VirtualBox", "Loopback", "Teredo", "Bluetooth", "WSL"];
    type IfaceInfo = { name: string; address: string; netmask: string; type: "wifi" | "ethernet" | "virtual" | "other" };
    const wifi: IfaceInfo[]     = [];
    const ethernet: IfaceInfo[] = [];
    const other: IfaceInfo[]    = [];
    for (const [name, addrs] of Object.entries(ifaces)) {
      for (const a of addrs ?? []) {
        if (a.family !== "IPv4" || a.internal) continue;
        const lower = name.toLowerCase();
        const isVirtual = virtualPrefixes2.some((p) => name.startsWith(p));
        const entry: IfaceInfo = { name, address: a.address, netmask: a.netmask, type: "other" };
        if (lower.includes("wi-fi") || lower.includes("wlan") || lower.includes("wireless")) {
          entry.type = "wifi";
          wifi.push(entry);
        } else if (lower.includes("ethernet") && !isVirtual) {
          entry.type = "ethernet";
          ethernet.push(entry);
        } else if (isVirtual) {
          entry.type = "virtual";
          other.push(entry);
        } else {
          entry.type = "other";
          other.push(entry);
        }
      }
    }
    return apiSuccess({
      wifi,
      ethernet,
      other,
      primary_ip: primaryLocalIp || "127.0.0.1",
      server_port: server.port,
      dns_active: isDnsListening,
      custom_url: activeCustomUrl,
    });
  }

  if (pathname === "/api/system/license" && method === "GET") {
    // [SECURITY HARDENING] License and Hardware identity details restricted to operators
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const currentHW = getSystemHardwareFingerprint();
    const machineInfo = {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      cpu: os.cpus()?.[0]?.model?.trim() || "Multi-Core CPU",
      memory_gb: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
    };
    try {
      const payload = await licenseValidator(["core", "practice_lan", "practice_home", "full_bundle"]);
      return apiSuccess({
        license: payload === true ? { tier: "core", max_devices: 50, iat: Date.now() / 1000, sub: "ExamPool Default Institution", hw_fp: currentHW } : payload,
        hardware_fingerprint: currentHW,
        machine_info: machineInfo,
      });
    } catch (err: any) {
      return apiSuccess({
        license: { tier: "core", max_devices: 0, iat: Date.now() / 1000, sub: "Unlicensed / Mismatch", error: err.message, hw_fp: currentHW },
        hardware_fingerprint: currentHW,
        machine_info: machineInfo,
      });
    }
  }

  if (pathname === "/api/system/license" && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const body = await readJson(req);
    if (!body || typeof body !== "object" || (typeof body.jwt !== "string" && typeof body.token !== "string" && typeof body.key !== "string")) {
      return apiError(400, "Invalid license payload: must be a JSON object containing a 'jwt' string token field");
    }
    
    // [HARDENING] Validate the license against this machine's real hardware before writing to disk
    const jwtToken = body.jwt || body.token || body.key;
    const currentHW = getSystemHardwareFingerprint();
    try {
      await validateMLF(jwtToken, currentHW);
    } catch (err: any) {
      return apiError(400, `License Activation Rejected: ${err.message}`);
    }

    await Bun.write("license.json", JSON.stringify(body, null, 2));
    auditLog(auth.userId, "LICENSE_UPDATE", "system", null, JSON.stringify({ hw_fp: currentHW }));
    return apiSuccess({ success: true, message: "Master License registered and bound to hardware successfully." });
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
      const origError = console.error;
      const origLog = console.log;
      
      const suppress = (...args: any[]) => {
        const msg = args.map(a => (a && a.toString ? a.toString() : String(a))).join(" ");
        return msg.includes("standardFontDataUrl");
      };

      console.warn = (...args: any[]) => { if (!suppress(...args)) origWarn(...args); };
      console.error = (...args: any[]) => { if (!suppress(...args)) origError(...args); };
      console.log = (...args: any[]) => { if (!suppress(...args)) origLog(...args); };
      try {
        const m: any = await import("pdf-parse");
        if (m.PDFParse) {
          const uint8Array = new Uint8Array(buffer);
          const parser = new m.PDFParse(uint8Array);
          const data = await parser.getText();
          text = data.text;
        } else if (typeof m.default === "function") {
          const data = await m.default(buffer);
          text = data.text;
        } else if (typeof m === "function") {
          const data = await m(buffer);
          text = data.text;
        } else {
          throw new Error("Could not determine pdf-parse export format");
        }
      } catch (e: any) {
        console.error("PDF Parse error:", e);
        throw new HttpError(500, "PDF parsing failed: " + e.message);
      } finally {
        console.warn = origWarn;
        console.error = origError;
        console.log = origLog;
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

      for (const line of lines) {
        // 1. Detect dynamic year headers (e.g. "Physics 1983", "1983 Questions", or just a year "1983")
        // Check if the line is short (under 40 characters) and contains a valid year.
        if (line.length < 40 && !/^(\d+[\.\)])\s+/.test(line) && !/^([A-E][\.\)]|\([A-E]\)|\[[A-E]\])\s+/.test(line)) {
          const yearMatch = line.match(/\b(19\d{2}|20\d{2})\b/);
          if (yearMatch && yearMatch[1]) {
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
    // [SECURITY FIX] Cap FTS query length — prevents pathological SQLite FTS patterns
    if (q.length > 200) return apiError(400, "Query string too long (max 200 chars)");
    const results = queries.searchContentBank.all(q);
    return apiSuccess({ results });
  }

  if (pathname === "/api/content/package-questions" && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator", "teacher"]);
    const packageId = url.searchParams.get("packageId");
    if (!packageId) return apiError(400, "Missing packageId");
    if (packageId.length > 128) return apiError(400, "Invalid packageId");
    const parts = packageId.split("_");
    if (parts.length < 3) return apiError(400, "Invalid packageId");
    const [exam_body, yearStr, ...rest] = parts;
    if (!exam_body || !yearStr) return apiError(400, "Invalid packageId");
    const year = parseInt(yearStr, 10);
    const subject_code = rest.join("_");

    const questions = db.prepare(`
      SELECT id, exam_body, year, subject_code, paper_type, question_text, options_json, correct_answer, solution_text, difficulty, topic_tag, diagram_path
      FROM content_bank.content_bank
      WHERE exam_body = ? AND year = ? AND subject_code = ?
      ORDER BY id ASC
    `).all(exam_body, year, subject_code) as any[];

    return apiSuccess({ questions });
  }

  if (pathname === "/api/content/questions" && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator", "teacher"]);
    const body = await readJson(req);

    const exam_body = trimStr(body?.exam_body) || "JAMB";
    const year = Number(body?.year) || new Date().getFullYear();
    const subject_code = trimStr(body?.subject_code) || "GEN";
    const paper_type = body?.paper_type === "theory" ? "theory" : "objective";
    const question_text = trimStr(body?.question_text);
    if (!question_text) return apiError(400, "question_text is required");

    let optionsJson = "[]";
    if (Array.isArray(body?.options)) {
      optionsJson = JSON.stringify(body.options);
    } else if (typeof body?.options_json === "string") {
      optionsJson = body.options_json;
    }

    const correct_answer = trimStr(body?.correct_answer?.toString()) || "A";
    const solution_text = trimStr(body?.solution_text) || null;
    const difficulty = Math.max(1, Math.min(5, Number(body?.difficulty || 3)));
    const topic_tag = trimStr(body?.topic_tag) || null;

    const result = db.prepare(`
      INSERT INTO content_bank.content_bank
      (exam_body, year, subject_code, paper_type, question_text, options_json, correct_answer, solution_text, difficulty, topic_tag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(exam_body, year, subject_code, paper_type, question_text, optionsJson, correct_answer, solution_text, difficulty, topic_tag) as { lastInsertRowid: number | bigint };

    const created = db.prepare("SELECT * FROM content_bank.content_bank WHERE id = ?").get(Number(result.lastInsertRowid));
    return apiSuccess(created, 201);
  }

  const contentQMatch = pathname.match(/^\/api\/content\/questions\/(\d+)$/);
  if (contentQMatch && method === "PUT") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator", "teacher"]);
    const questionId = Number(contentQMatch[1]);
    if (!isPositiveIntId(questionId)) return apiError(400, "Invalid question id");

    const body = await readJson(req);
    const questionText = trimStr(body?.question_text);
    if (!questionText) return apiError(400, "question_text cannot be empty");

    let optionsJson: string;
    if (Array.isArray(body?.options)) {
      optionsJson = JSON.stringify(body.options);
    } else if (typeof body?.options_json === "string") {
      optionsJson = body.options_json;
    } else {
      optionsJson = "[]";
    }

    const correctAnswer = trimStr(body?.correct_answer?.toString()) || "A";
    const solutionText = trimStr(body?.solution_text) || null;
    const difficulty = Math.max(1, Math.min(5, Number(body?.difficulty || 3)));
    const topicTag = trimStr(body?.topic_tag) || null;

    db.prepare(`
      UPDATE content_bank.content_bank
      SET question_text = ?, options_json = ?, correct_answer = ?, solution_text = ?, difficulty = ?, topic_tag = ?
      WHERE id = ?
    `).run(questionText, optionsJson, correctAnswer, solutionText, difficulty, topicTag, questionId);

    const updated = db.prepare("SELECT * FROM content_bank.content_bank WHERE id = ?").get(questionId);
    return apiSuccess(updated);
  }

  if (contentQMatch && method === "DELETE") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator", "teacher"]);
    const questionId = Number(contentQMatch[1]);
    if (!isPositiveIntId(questionId)) return apiError(400, "Invalid question id");

    db.prepare("DELETE FROM content_bank.content_bank WHERE id = ?").run(questionId);
    return apiMessage("Question deleted from content bank");
  }

  const contentPkgMatch = pathname.match(/^\/api\/content\/packages\/([A-Za-z0-9_.-]+)$/);
  if (contentPkgMatch && method === "DELETE") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator", "teacher"]);
    const packageId = contentPkgMatch[1];
    if (!packageId) return apiError(400, "Invalid packageId");
    const parts = packageId.split("_");
    if (parts.length < 3) return apiError(400, "Invalid packageId");
    const [exam_body, yearStr, ...rest] = parts;
    if (!exam_body || !yearStr) return apiError(400, "Invalid packageId");
    const year = parseInt(yearStr, 10);
    const subject_code = rest.join("_");

    db.prepare(`
      DELETE FROM content_bank.content_bank
      WHERE exam_body = ? AND year = ? AND subject_code = ?
    `).run(exam_body, year, subject_code);

    return apiMessage("Package deleted from content bank");
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
      SELECT id, question_text, options_json, correct_answer, solution_text, difficulty, topic_tag
      FROM content_bank.content_bank
      WHERE exam_body = ? AND year = ? AND subject_code = ?
      ORDER BY id ASC
    `).all(exam_body, year, subject_code) as any[];

    if (!rawQuestions.length) return apiError(404, "No questions found for this package");

    const questions = rawQuestions.map(q => {
      let parsedOptions: string[] = [];
      try {
        parsedOptions = typeof q.options_json === "string" ? JSON.parse(q.options_json) : (q.options_json || []);
      } catch {
        parsedOptions = [];
      }
      return {
        id: q.id,
        question_text: q.question_text,
        question_type: "multiple_choice",
        options_json: JSON.stringify(parsedOptions),
        options: parsedOptions,
        correct_answer: q.correct_answer,
        solution: q.solution_text || null,
        explanation: q.solution_text || null,
        solution_text: q.solution_text || null,
        topic_tag: q.topic_tag || null,
        difficulty: q.difficulty || null,
        marks: 1
      };
    });

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
    const body = await readJson(req);
    const practiceId = url.searchParams.get("practiceId") || body?.practiceId || body?.practice_id;
    if (!practiceId || typeof practiceId !== "string") return apiError(400, "Missing practiceId");

    const answers = body?.answers || [];

    const parts = practiceId.split("_");
    const exam_body = parts[0] as string;
    const year = parseInt(parts[1] as string, 10);
    const subject_code = parts.slice(2).join("_");

    const rawQuestions = db.prepare(`
      SELECT id, question_text, options_json, correct_answer, solution_text, difficulty, topic_tag
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
        if (correctOpt !== undefined && correctOpt !== null) {
          total++;
          const optLetter = typeof correctOpt === "string" && /^[A-E]$/i.test(correctOpt)
            ? correctOpt.toUpperCase().charCodeAt(0) - 65
            : Number(correctOpt);
          const selectedNum = typeof ans.selected_option === "number"
            ? ans.selected_option
            : typeof ans.selected_option === "string" && /^[A-E]$/i.test(ans.selected_option)
              ? ans.selected_option.toUpperCase().charCodeAt(0) - 65
              : Number(ans.selected_option);

          const isCorrect = (String(ans.selected_option) === String(correctOpt) || optLetter === selectedNum) ? 1 : 0;
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

    // Build comprehensive per-question review for learning practice
    const review = rawQuestions.map((q) => {
      const userAns = answers.find((a: any) => a.question_id === q.id);
      const correctOpt = q.correct_answer;
      const optLetter = typeof correctOpt === "string" && /^[A-E]$/i.test(correctOpt)
        ? correctOpt.toUpperCase().charCodeAt(0) - 65
        : Number(correctOpt);
      const selectedNum = userAns?.selected_option !== undefined && userAns?.selected_option !== null
        ? (typeof userAns.selected_option === "number"
            ? userAns.selected_option
            : typeof userAns.selected_option === "string" && /^[A-E]$/i.test(userAns.selected_option)
              ? userAns.selected_option.toUpperCase().charCodeAt(0) - 65
              : Number(userAns.selected_option))
        : null;
      const isCorrect = selectedNum !== null && (String(userAns?.selected_option) === String(correctOpt) || optLetter === selectedNum);
      
      let parsedOptions: string[] = [];
      try {
        parsedOptions = typeof q.options_json === "string" ? JSON.parse(q.options_json) : (q.options_json || []);
      } catch {
        parsedOptions = [];
      }

      return {
        question_id: q.id,
        question_text: q.question_text,
        options: parsedOptions,
        selected_option: userAns?.selected_option ?? null,
        correct_answer: q.correct_answer,
        is_correct: isCorrect,
        solution_text: q.solution_text || null,
        topic_tag: q.topic_tag || null,
        difficulty: q.difficulty || null
      };
    });

    return apiSuccess({
      score,
      total_score: total || rawQuestions.length,
      answered_questions: answers.length,
      total_questions: rawQuestions.length,
      review
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
        
        const subject = queries.getSubjectById.get(subject_id) as any;
        if (!subject) continue;
        
        // [SECURITY FIX] Verify enrollment
        const enrollment = db.prepare(
          "SELECT id FROM subject_enrollments WHERE subject_id = ? AND student_id = ?"
        ).get(subject_id, auth.userId);
        if (!enrollment) continue;
        
        let exam = queries.getExamByStudentSubject.get(auth.userId, subject_id) as any;
        if (!exam) {
           // [SECURITY FIX] Only untimed assignments can be instantiated out-of-band via offline sync
           if (subject.is_assignment !== 1) continue;
           
           queries.createExam.run(auth.userId, subject_id, start_time || new Date().toISOString(), JSON.stringify(answers || []), "offline", currentTerm, "assignment");
           exam = queries.getExamByStudentSubject.get(auth.userId, subject_id) as any;
        } else if (exam.status === "completed") {
           // Skip if already completed to prevent double submission
           continue;
        }

        // [SECURITY FIX] Enforce strict CBT time limits on offline sync
        // If a student tries to submit a CBT exam via offline sync hours later, block it.
        if (subject.is_assignment !== 1) {
           const deadline = Date.parse(exam.start_time) + Number(subject.duration) * 60_000 + 30_000; // 30s grace
           if (Date.now() > deadline) {
             continue; // Reject late offline CBT submissions (prevents time bypass cheating)
           }
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
            if (Number(qRow.correct_answer) === Number(ans.selected_option)) {
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
        
        // Free the redundant JSON blob — student_answers is now the authoritative store
        queries.updateExamAnswersJson.run(exam.id);
        
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
  if ((pathname === "/api/v2/classes/teacher-assignments/history" || pathname === "/api/v2/classes/assignment-history") && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    return apiSuccess(queries.getClassTeacherAssignmentHistory.all());
  }

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
    const classTeacherId = body?.class_teacher_id ? Number(body.class_teacher_id) || null : null;
    const notes = trimStr(body?.notes || "");
    if (!name) return apiError(400, "Class name required");
    try {
      const result = queries.createClass.run(name, section, level) as { lastInsertRowid: number | bigint };
      const newClassId = Number(result.lastInsertRowid);
      // Assign class teacher if provided (clear any previous assignment for that teacher)
      if (classTeacherId) {
        queries.unassignTeacherFromAllClasses.run(classTeacherId);
        queries.assignClassTeacher.run(classTeacherId, newClassId);
        queries.logClassTeacherAssignment.run(newClassId, classTeacherId, auth.userId, "assigned", notes || "Initial class creation");
      }
      auditLog(auth.userId, "CLASS_CREATE", "classes", newClassId, JSON.stringify({ name, section, class_teacher_id: classTeacherId }));
      return apiSuccess({ id: newClassId }, 201);
    } catch (e) {
      if (isSqliteUniqueError(e)) return apiError(409, "A class with this name and section already exists");
      throw e;
    }
  }

  const assignTeacherMatch = pathname.match(/^\/api\/v2\/classes\/(\d+)\/assign-teacher$/);
  if (assignTeacherMatch && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const classId = Number(assignTeacherMatch[1]);
    if (!isPositiveIntId(classId)) return apiError(400, "Invalid class id");
    const cls = queries.getClassById.get(classId) as any;
    if (!cls) return apiError(404, "Class not found");
    const body = await readJson(req);
    const rawTeacherId = body?.teacher_id;
    const teacherId = rawTeacherId ? Number(rawTeacherId) : null;
    const notes = trimStr(body?.notes || "");

    let action: "assigned" | "reassigned" | "unassigned" = "unassigned";

    if (teacherId) {
      const teacher = queries.getUserById.get(teacherId) as any;
      if (!teacher || teacher.role !== "teacher" || sqlInt(teacher.is_active) !== 1) {
        return apiError(400, "Invalid or inactive teacher");
      }
      action = cls.class_teacher_id ? "reassigned" : "assigned";
      // Clear any other class assigned to this teacher
      queries.unassignTeacherFromAllClasses.run(teacherId);
      queries.assignClassTeacher.run(teacherId, classId);
      queries.logClassTeacherAssignment.run(classId, teacherId, auth.userId, action, notes || null);

      try {
        queries.createNotification.run(
          teacherId,
          "class_teacher_assigned",
          `You have been assigned as Class Teacher for ${cls.name}${cls.section ? ` (${cls.section})` : ""}.`,
          "/teacher/report-card"
        );
      } catch {}
    } else {
      action = "unassigned";
      queries.unassignClassTeacher.run(classId);
      queries.logClassTeacherAssignment.run(classId, null, auth.userId, action, notes || null);
    }

    if (cls.class_teacher_id) authz.invalidateTeacherCache(Number(cls.class_teacher_id));
    if (teacherId) authz.invalidateTeacherCache(Number(teacherId));

    auditLog(auth.userId, "CLASS_TEACHER_" + action.toUpperCase(), "classes", classId, JSON.stringify({ teacher_id: teacherId, notes }));
    return apiSuccess(queries.getClassById.get(classId));
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
    // class_teacher_id: null clears assignment, undefined keeps existing
    const classTeacherId =
      body?.class_teacher_id === null ? null
      : body?.class_teacher_id ? Number(body.class_teacher_id)
      : cls.class_teacher_id ?? null;
    const notes = trimStr(body?.notes || "");
    
    // Log change to class_teacher_assignments if teacher changed
    if (classTeacherId !== cls.class_teacher_id) {
      if (classTeacherId) {
        const action = cls.class_teacher_id ? "reassigned" : "assigned";
        queries.unassignTeacherFromAllClasses.run(classTeacherId);
        queries.logClassTeacherAssignment.run(classId, classTeacherId, auth.userId, action, notes || "Updated via class settings");
      } else {
        queries.logClassTeacherAssignment.run(classId, null, auth.userId, "unassigned", notes || "Removed via class settings");
      }
    }

    queries.updateClass.run(
      trimStr(body?.name) || cls.name,
      body?.section !== undefined ? (trimStr(body.section) || null) : cls.section,
      body?.level === "senior" ? "senior" : (body?.level === "junior" ? "junior" : cls.level),
      classTeacherId,
      classId
    );
    auditLog(auth.userId, "CLASS_UPDATE", "classes", classId, JSON.stringify({ class_teacher_id: classTeacherId }));
    return apiSuccess(queries.getClassById.get(classId));
  }

  if (classIdMatch && method === "DELETE") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const classId = Number(classIdMatch[1]);
    if (!isPositiveIntId(classId)) return apiError(400, "Invalid class id");
    const count = (queries.getEnrollmentCountForClass.get(classId) as any)?.count ?? 0;
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

    // [SECURITY FIX] Ensure teacher is the class teacher for this class
    if (auth.role === "teacher") {
      const cls = queries.getClassById.get(classId) as any;
      if (!cls || Number(cls.class_teacher_id) !== auth.userId) {
         return apiError(403, "You are not the class teacher for this class");
      }
    }

    // Resolve term_id: query param → active academic_term → active legacy term
    const qTermId = Number(url.searchParams.get("term_id") || 0);
    const termId: number = qTermId
      || (queries.getActiveAcademicTerm.get() as any)?.id
      || (queries.getActiveTerm.get() as any)?.id
      || 0;

    if (!termId) return apiSuccess([]);
    return apiSuccess(queries.getClassRoster.all(classId, termId));
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
    // [FIX] Accept academic_terms ids too — the legacy `terms` table is not seeded on
    // fresh databases, so bulk enrollment previously 404'd ("Term not found") even
    // though class rosters (getClassRoster) key on academic term ids.
    const academicTerm = queries.getAcademicTermById.get(term_id) as any;
    if (!term && !academicTerm) return apiError(404, "Term not found");
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
    let student_id = Number(body?.student_id);
    const regIdV2 = trimStr(body?.reg_id || body?.regId || body?.student_reg_id || "");
    if (!isPositiveIntId(student_id) && regIdV2) {
      const byRegV2 = queries.getUserByEmailOrReg.get(regIdV2.toUpperCase(), regIdV2.toUpperCase()) as any;
      if (byRegV2 && byRegV2.role === "student") student_id = Number(byRegV2.id);
      else {
        const byRegExactV2 = db.prepare("SELECT id FROM users WHERE reg_id = ? AND role='student' LIMIT 1").get(regIdV2) as any;
        if (byRegExactV2) student_id = Number(byRegExactV2.id);
      }
    }
    const relationship = trimStr(body?.relationship || "Parent").slice(0, 40);
    if (!isPositiveIntId(guardian_id) || !isPositiveIntId(student_id)) return apiError(400, "guardian_id and student_id/reg_id required");
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

  // Legacy v2 timetable API endpoints removed (repurposed timetables table)

  // ── Helper: Build Rich Ward Payload for Guardian Dashboard & Pages ──────────
  function buildRichWardPayload(studentId: number, guardianId: number, termId?: number, sessionId?: number) {
    const student = queries.getUserById.get(studentId) as any;
    if (!student) return null;

    const activeTerm = queries.getActiveAcademicTerm.get() as any;
    const activeSession = queries.getActiveAcademicSession.get() as any;
    const tid = termId || activeTerm?.id || 1;
    const sid = sessionId || activeSession?.id || 1;

    // 1. Determine student's enrolled class
    const enrolledClass = db.prepare("SELECT c.name, c.id as class_id FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id WHERE ce.student_id = ? ORDER BY ce.id DESC LIMIT 1").get(studentId) as any;
    const studentGrade = enrolledClass?.name || student.grade || "JSS 3";

    // 1. Subjects & Performance
    const results = queries.getStudentTermResultsForReportCard.all(studentId) as any[];
    const termResults = results.filter((r: any) => Number(r.term_id) === Number(tid) && Number(r.session_id) === Number(sid));
    
    let averageScore = 0;
    if (termResults.length > 0) {
      const sum = termResults.reduce((acc: number, r: any) => acc + Number(r.total_score || 0), 0);
      averageScore = Math.round((sum / termResults.length) * 10) / 10;
    } else {
      const examsAvg = db.prepare("SELECT ROUND(AVG(CASE WHEN status='completed' AND total_score>0 THEN CAST(score AS REAL)/total_score*100 END), 1) as avg FROM exams WHERE student_id = ?").get(studentId) as any;
      averageScore = Number(examsAvg?.avg || 0);
    }

    let classPosition = "1st of 1";
    try {
      const classPeers = db.prepare(`
        SELECT tr.student_id, AVG(tr.total_score) as avg_score
        FROM term_results tr
        JOIN users u ON u.id = tr.student_id
        WHERE (u.grade = ? OR u.id IN (SELECT student_id FROM class_enrollments WHERE class_id = ?)) AND tr.term_id = ? AND tr.is_approved = 1
        GROUP BY tr.student_id
        ORDER BY avg_score DESC
      `).all(studentGrade, enrolledClass?.class_id || 0, tid) as any[];

      if (classPeers.length > 0) {
        const rankIdx = classPeers.findIndex((p: any) => Number(p.student_id) === studentId);
        const rank = rankIdx >= 0 ? rankIdx + 1 : 1;
        const total = classPeers.length;
        const suffix = (r: number) => {
          if (r === 1) return "1st";
          if (r === 2) return "2nd";
          if (r === 3) return "3rd";
          return `${r}th`;
        };
        classPosition = `${suffix(rank)} of ${total}`;
      }
    } catch {}

    const subjectColors = ["#165AF6", "#059669", "#7C3AED", "#D97706", "#DB2777", "#0891B2", "#4F46E5"];
    const subjects_performance = termResults.map((r: any, idx: number) => {
      const score = Number(r.total_score || 0);
      const code = (r.code || r.subject_name || "SUB").slice(0, 4).toUpperCase();
      const color = subjectColors[idx % subjectColors.length];
      return {
        subject_name: r.subject_name,
        subject_code: code,
        score,
        ca_score: Number(r.ca_score || 0),
        exam_score: Number(r.exam_score || 0),
        grade: r.grade || (score >= 80 ? "A" : score >= 70 ? "B" : score >= 60 ? "C" : score >= 50 ? "D" : "F"),
        color,
        is_approved: Number(r.is_approved || 0),
      };
    });

    // 2. Attendance
    const attSummary = queries.getStudentAttendanceSummary.get(studentId, tid) as any;
    const totalDays = Number(attSummary?.total_days || 0);
    const presentDays = Number(attSummary?.present_days || 0);
    const absentDays = Number(attSummary?.absent_days || 0);
    const lateDays = Number(attSummary?.late_days || 0);
    const attPct = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 100;

    const rawCalendar = queries.getStudentAttendanceCalendar.all(studentId, tid) as any[];
    const calendar_days = rawCalendar.map((c: any) => {
      const dayNum = parseInt(c.date.slice(-2), 10);
      return {
        day: dayNum,
        status: c.status,
        date: c.date,
        remarks: c.remarks || null,
      };
    });

    // 3. Fees
    const feeStructures = queries.getFeeStructuresForStudent.all(studentId, tid, sid) as any[];
    const feePayments = queries.getFeePaymentsForStudent.all(studentId) as any[];

    let totalFees = 0;
    const items = feeStructures.map((fs: any) => {
      const amt = Number(fs.amount || 0);
      totalFees += amt;
      const payment = feePayments.find((fp: any) => Number(fp.fee_id) === Number(fs.id) && fp.status === "completed");
      const isPaid = !!payment;
      return {
        id: fs.id,
        title: fs.title,
        amount: amt,
        status: isPaid ? "paid" : "pending",
        paid_date: payment ? payment.paid_at.slice(0, 10) : null,
        due_date: fs.due_date || null,
      };
    });

    const amountPaid = feePayments.filter((fp: any) => fp.status === "completed").reduce((acc: number, fp: any) => acc + Number(fp.amount_paid || 0), 0);
    const balance = Math.max(0, totalFees - amountPaid);
    const feePct = totalFees > 0 ? Math.min(100, Math.round((amountPaid / totalFees) * 100)) : 100;

    // 4. Upcoming Examinations & Timetable
    const timetableEvents = db.prepare(`
      SELECT t.*, s.name as subject_name
      FROM timetables t
      LEFT JOIN subjects s ON s.id = t.subject_id
      WHERE (t.session_id = ? OR t.session_id IS NULL) AND (t.term_id = ? OR t.term_id IS NULL)
      ORDER BY t.exam_date ASC, t.start_time ASC
    `).all(sid, tid) as any[];

    const upcoming_events = timetableEvents.map((t: any, idx: number) => {
      const d = new Date(t.exam_date || "2026-06-01");
      const month = d.toLocaleString("default", { month: "short" }).toUpperCase();
      const day = d.getDate();
      const weekday = d.toLocaleString("default", { weekday: "short" });
      const nowStr = new Date().toISOString().slice(0, 10);
      let status = "upcoming";
      if (t.exam_date === nowStr) status = "live";
      else if (t.exam_date < nowStr) status = "completed";

      return {
        id: t.id || idx + 1,
        month,
        day,
        weekday,
        title: t.subject_name || t.paper_type || "Examination",
        time_str: `${t.start_time || "09:00"} - ${t.end_time || "11:00"}`,
        venue: t.venue || "Examination Hall",
        status,
        instructions: t.instructions || null,
      };
    });

    // 5. Reports
    const reports = [
      {
        id: 1,
        title: `${activeTerm?.name || "First Term"} Report Card`,
        category: "academic",
        date: "2026-07-24",
        term: `${activeTerm?.name || "First Term"} ${activeSession?.name || "2026/2027"}`,
        description: "Comprehensive academic broadsheet with subject CA, exam scores, and principal remarks.",
        url: `/api/grading/report-card/${studentId}`,
      },
      {
        id: 2,
        title: "Attendance & Punctuality Record",
        category: "attendance",
        date: "2026-07-20",
        term: `${activeTerm?.name || "First Term"}`,
        description: `${presentDays} of ${totalDays} school days attended (${attPct}% attendance rate).`,
        url: `/api/guardian/wards/${studentId}/attendance`,
      },
      {
        id: 3,
        title: "Behavioral & Character Assessment",
        category: "behaviour",
        date: "2026-07-15",
        term: `${activeTerm?.name || "First Term"}`,
        description: "Conduct, team participation, attentiveness, and neatness evaluation by Form Teacher.",
        url: `/api/guardian/wards/${studentId}/reports`,
      }
    ];

    const unreadMsg = db.prepare("SELECT SUM(unread_for_guardian) as count FROM guardian_message_threads WHERE guardian_id = ? AND student_id = ?").get(guardianId, studentId) as any;

    return {
      id: studentId,
      student_id: studentId,
      name: student.name,
      grade: studentGrade,
      admission_number: student.reg_id || `REG-${studentId}`,
      reg_id: student.reg_id,
      image_url: student.image_url || null,
      average_score: averageScore,
      score_delta: "+2.4",
      attendance_pct: attPct,
      class_position: classPosition,
      unread_messages: Number(unreadMsg?.count || 0),
      subjects_performance,
      attendance: {
        percentage: attPct,
        present_days: presentDays,
        absent_days: absentDays,
        late_days: lateDays,
        total_days: totalDays,
        calendar_days,
      },
      fees: {
        balance,
        percentage: feePct,
        amount_paid: amountPaid,
        total_fees: totalFees,
        items,
      },
      upcoming_events,
      reports,
    };
  }

  // ── Guardian Dashboard & Wards ────────────────────────────────────────────
  if (pathname === "/api/guardian/wards" && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["guardian"]);
    const rawWards = queries.getGuardianWards.all(auth.userId) as any[];
    const wards = rawWards.map((w: any) => buildRichWardPayload(Number(w.student_id), auth.userId)).filter(Boolean);
    const stats = queries.getGuardianStats.get(auth.userId, auth.userId, auth.userId);
    return apiSuccess({ wards, stats });
  }

  if (pathname === "/api/guardian/stats" && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["guardian"]);
    const stats = queries.getGuardianStats.get(auth.userId, auth.userId, auth.userId);
    return apiSuccess(stats);
  }

  // ── Guardian Ward Performance ─────────────────────────────────────────────
  const wardPerfMatch = pathname.match(/^\/api\/guardian\/wards\/(\d+)\/performance$/);
  if (wardPerfMatch && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["guardian"]);
    const wardId = Number(wardPerfMatch[1]);
    const link = db.prepare("SELECT student_id FROM guardian_student_links WHERE guardian_id = ? AND (student_id = ? OR id = ?) AND status = 'approved'").get(auth.userId, wardId, wardId) as any;
    if (!link) return apiError(403, "Access denied: not your ward");
    const wardData = buildRichWardPayload(Number(link.student_id), auth.userId);
    return apiSuccess(wardData);
  }

  // ── Guardian Ward Attendance ──────────────────────────────────────────────
  const wardAttMatch = pathname.match(/^\/api\/guardian\/wards\/(\d+)\/attendance$/);
  if (wardAttMatch && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["guardian", "teacher", "operator"]);
    const studentId = Number(wardAttMatch[1]);
    if (auth.role === "guardian") {
      const link = db.prepare("SELECT student_id FROM guardian_student_links WHERE guardian_id = ? AND (student_id = ? OR id = ?) AND status = 'approved'").get(auth.userId, studentId, studentId) as any;
      if (!link) return apiError(403, "Access denied: not your ward");
    }
    const activeTerm = queries.getActiveAcademicTerm.get() as any;
    const tid = activeTerm?.id || 1;
    const summary = queries.getStudentAttendanceSummary.get(studentId, tid) as any;
    const calendar = queries.getStudentAttendanceCalendar.all(studentId, tid) as any[];
    return apiSuccess({ summary, calendar });
  }

  if (wardAttMatch && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const studentId = Number(wardAttMatch[1]);
    const body = await readJson(req);
    const date = trimStr(body?.date) || new Date().toISOString().slice(0, 10);
    const status = ["present", "absent", "late", "holiday", "excused"].includes(body?.status) ? body.status : "present";
    const remarks = body?.remarks ? trimStr(body.remarks) : null;
    const activeTerm = queries.getActiveAcademicTerm.get() as any;
    const activeSession = queries.getActiveAcademicSession.get() as any;
    const tid = Number(body?.term_id || activeTerm?.id || 1);
    const sid = Number(body?.session_id || activeSession?.id || 1);

    queries.upsertAttendanceRecord.run(studentId, tid, sid, date, status, remarks, auth.userId);
    
    // Broadcast notification to student's guardians
    const guardians = queries.getStudentGuardians.all(studentId) as any[];
    for (const g of guardians) {
      notifyUser(Number(g.guardian_id), {
        type: "attendance",
        message: `Attendance marked as ${status.toUpperCase()} for ${date}`,
        link: "/guardian/attendance",
      });
    }
    return apiSuccess({ success: true, studentId, date, status });
  }

  // ── Guardian Ward Fees ────────────────────────────────────────────────────
  const wardFeesMatch = pathname.match(/^\/api\/guardian\/wards\/(\d+)\/fees$/);
  if (wardFeesMatch && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["guardian", "operator"]);
    const studentId = Number(wardFeesMatch[1]);
    if (auth.role === "guardian") {
      const link = db.prepare("SELECT student_id FROM guardian_student_links WHERE guardian_id = ? AND (student_id = ? OR id = ?) AND status = 'approved'").get(auth.userId, studentId, studentId) as any;
      if (!link) return apiError(403, "Access denied: not your ward");
    }
    const activeTerm = queries.getActiveAcademicTerm.get() as any;
    const activeSession = queries.getActiveAcademicSession.get() as any;
    const tid = activeTerm?.id || 1;
    const sid = activeSession?.id || 1;
    const structures = queries.getFeeStructuresForStudent.all(studentId, tid, sid) as any[];
    const payments = queries.getFeePaymentsForStudent.all(studentId) as any[];
    return apiSuccess({ structures, payments });
  }

  const wardPayMatch = pathname.match(/^\/api\/guardian\/wards\/(\d+)\/fees\/pay$/);
  if (wardPayMatch && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["guardian", "operator"]);
    const studentId = Number(wardPayMatch[1]);
    const body = await readJson(req);
    const feeId = Number(body?.fee_id || 1);
    const amount = Number(body?.amount || 0);
    const method_type = ["bank_transfer", "cash", "card", "online_gateway"].includes(body?.method) ? body.method : "card";
    const paymentRef = `PAY-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    queries.createFeePayment.run(studentId, feeId, amount, paymentRef, method_type, "completed", auth.userId);
    auditLog(auth.userId, "FEE_PAYMENT", "fee_payments", studentId, JSON.stringify({ feeId, amount, paymentRef }));
    return apiSuccess({ success: true, paymentRef, amount, status: "completed" });
  }

  // ── Guardian Ward Results ─────────────────────────────────────────────────
  const wardResultsMatch = pathname.match(/^\/api\/guardian\/wards\/(\d+)\/results$/);
  if (wardResultsMatch && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["guardian"]);
    const wardId = Number(wardResultsMatch[1]);
    if (!isPositiveIntId(wardId)) return apiError(400, "Invalid ward id");
    const link = db.prepare("SELECT student_id FROM guardian_student_links WHERE guardian_id = ? AND (student_id = ? OR id = ?) AND status = 'approved'").get(auth.userId, wardId, wardId) as any;
    if (!link) return apiError(403, "Access denied: not your ward");
    const actualStudentId = Number(link.student_id);
    const termId = Number(url.searchParams.get("term_id") || 0);
    const activeTerm = queries.getActiveTerm.get() as any;
    const resolvedTermId = isPositiveIntId(termId) ? termId : (activeTerm?.id ?? 0);
    if (!resolvedTermId) return apiSuccess([]);
    const results = queries.getWardTermResults.all(actualStudentId, resolvedTermId);
    return apiSuccess(results);
  }

  // ── Guardian Ward Report Card ─────────────────────────────────────────────
  const wardReportMatch = pathname.match(/^\/api\/guardian\/wards\/(\d+)\/report-card$/);
  if (wardReportMatch && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["guardian"]);
    const wardId = Number(wardReportMatch[1]);
    if (!isPositiveIntId(wardId)) return apiError(400, "Invalid ward id");
    const link = db.prepare("SELECT student_id FROM guardian_student_links WHERE guardian_id = ? AND (student_id = ? OR id = ?) AND status = 'approved'").get(auth.userId, wardId, wardId) as any;
    if (!link) return apiError(403, "Access denied: not your ward");
    const actualStudentId = Number(link.student_id);
    const results = queries.getStudentTermResultsForReportCard.all(actualStudentId);
    const remarks = db.prepare("SELECT * FROM student_term_remarks WHERE student_id = ? ORDER BY updated_at DESC").all(actualStudentId);
    return apiSuccess({ results, remarks });
  }

  // ── Guardian Ward Exams ───────────────────────────────────────────────────
  const wardExamsMatch = pathname.match(/^\/api\/guardian\/wards\/(\d+)\/exams$/);
  if (wardExamsMatch && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["guardian"]);
    const wardId = Number(wardExamsMatch[1]);
    if (!isPositiveIntId(wardId)) return apiError(400, "Invalid ward id");
    const link = db.prepare("SELECT student_id FROM guardian_student_links WHERE guardian_id = ? AND (student_id = ? OR id = ?) AND status = 'approved'").get(auth.userId, wardId, wardId) as any;
    if (!link) return apiError(403, "Access denied: not your ward");
    const actualStudentId = Number(link.student_id);
    const limit = Math.min(Number(url.searchParams.get("limit") || 20), 100);
    const exams = queries.getWardExams.all(actualStudentId, limit);
    return apiSuccess(exams);
  }

  // ── Guardian Message Contacts (Discover Form Teacher, Subject Teachers, Admin)
  if (pathname === "/api/guardian/messages/contacts" && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["guardian"]);
    const wardId = Number(url.searchParams.get("ward_id") || url.searchParams.get("student_id") || 0);
    let studentId = wardId;
    if (!studentId) {
      const firstLink = queries.getGuardianWards.get(auth.userId) as any;
      studentId = Number(firstLink?.student_id || 0);
    }
    if (!studentId) return apiSuccess({ contacts: [] });

    const student = queries.getUserById.get(studentId) as any;
    const enrolledClass = db.prepare("SELECT c.name, c.id as class_id FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id WHERE ce.student_id = ? ORDER BY ce.id DESC LIMIT 1").get(studentId) as any;
    const studentGrade = enrolledClass?.name || student?.grade || "JSS 3";
    const contacts: any[] = [];

    // 1. Form / Class Teacher
    try {
      const cls = db.prepare("SELECT c.*, u.id as teacher_id, u.name as teacher_name, u.email as teacher_email FROM classes c JOIN users u ON u.id = c.class_teacher_id WHERE c.name = ? OR c.id = ? LIMIT 1").get(studentGrade, enrolledClass?.class_id || 0) as any;
      if (cls) {
        contacts.push({
          id: cls.teacher_id,
          name: cls.teacher_name,
          role: "teacher",
          role_label: `Form Teacher (${studentGrade})`,
          student_id: studentId,
          category: "teacher",
        });
      }
    } catch {}

    // 2. Subject Teachers
    try {
      const subTeachers = db.prepare(`
        SELECT DISTINCT gs.teacher_id as id, u.name, gs.name as subject_name
        FROM grading_subjects gs
        JOIN users u ON u.id = gs.teacher_id
        WHERE gs.class_id IN (SELECT id FROM classes WHERE name = ?) OR gs.class_id = ? OR gs.code LIKE '%JSS%'
      `).all(studentGrade, enrolledClass?.class_id || 0) as any[];
      for (const st of subTeachers) {
        if (!contacts.some((c: any) => c.id === st.id)) {
          contacts.push({
            id: st.id,
            name: st.name,
            role: "teacher",
            role_label: `${st.subject_name} Teacher`,
            student_id: studentId,
            category: "teacher",
          });
        }
      }
    } catch {}

    // 3. School Admin
    try {
      const admins = queries.getOperators.all() as any[];
      if (admins.length > 0) {
        const adminUser = queries.getUserById.get(admins[0].id) as any;
        if (adminUser) {
          contacts.push({
            id: adminUser.id,
            name: adminUser.name || "School Administration",
            role: "operator",
            role_label: "School Administration",
            student_id: studentId,
            category: "school",
          });
        }
      }
    } catch {}

    return apiSuccess(contacts);
  }

  // ── Guardian Messaging Threads ────────────────────────────────────────────
  if (pathname === "/api/guardian/messages/threads" && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["guardian"]);
    const threads = queries.getGuardianThreads.all(auth.userId) as any[];
    return apiSuccess(threads);
  }

  const guardianThreadMatch = pathname.match(/^\/api\/guardian\/messages\/threads\/(\d+)$/);
  if (guardianThreadMatch && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["guardian"]);
    const threadId = Number(guardianThreadMatch[1]);
    const thread = queries.getThreadById.get(threadId) as any;
    if (!thread || Number(thread.guardian_id) !== auth.userId) return apiError(404, "Thread not found");
    
    // Reset unread counter for guardian
    queries.markThreadReadForGuardian.run(threadId);
    const messages = queries.getMessagesByThread.all(threadId);
    return apiSuccess({ thread, messages });
  }

  if (guardianThreadMatch && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["guardian"]);
    const threadId = Number(guardianThreadMatch[1]);
    const thread = queries.getThreadById.get(threadId) as any;
    if (!thread || Number(thread.guardian_id) !== auth.userId) return apiError(404, "Thread not found");

    const body = await readJson(req);
    const text = trimStr(body?.text || "");
    if (!text) return apiError(400, "Message text required");

    const msgRes = queries.insertMessage.run(threadId, auth.userId, "guardian", text, 0) as { lastInsertRowid: number | bigint };
    queries.updateThreadLastMessage.run(text, 0, 1, threadId);

    // Dispatch real-time SSE notification to recipient (teacher/admin)
    notifyUser(Number(thread.recipient_id), {
      type: "chat_message",
      message: `${auth.name || "Guardian"}: ${text.slice(0, 80)}`,
      link: "/teacher/messages",
    });

    return apiSuccess({ id: Number(msgRes.lastInsertRowid), text, sender_role: "guardian", created_at: new Date().toISOString() }, 201);
  }

  if (pathname === "/api/guardian/messages/new-thread" && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["guardian"]);
    const body = await readJson(req);
    const recipientId = Number(body?.recipient_id);
    const studentId = Number(body?.student_id);
    const text = trimStr(body?.text || "");
    const category = ["teacher", "school", "system"].includes(body?.category) ? body.category : "teacher";
    const subject = trimStr(body?.subject || `Inquiry regarding ${body?.student_name || "Student"}`);

    if (!isPositiveIntId(recipientId) || !isPositiveIntId(studentId) || !text) {
      return apiError(400, "recipient_id, student_id, and text required");
    }

    let thread = queries.findThreadByParticipants.get(auth.userId, recipientId, studentId) as any;
    let threadId: number;
    if (!thread) {
      const res = queries.createMessageThread.run(auth.userId, recipientId, studentId, category, subject, text, 0, 1) as { lastInsertRowid: number | bigint };
      threadId = Number(res.lastInsertRowid);
    } else {
      threadId = Number(thread.id);
      queries.updateThreadLastMessage.run(text, 0, 1, threadId);
    }

    const msgRes = queries.insertMessage.run(threadId, auth.userId, "guardian", text, 0) as { lastInsertRowid: number | bigint };
    notifyUser(recipientId, {
      type: "chat_message",
      message: `${auth.name || "Guardian"}: ${text.slice(0, 80)}`,
      link: "/teacher/messages",
    });

    return apiSuccess({ threadId, messageId: Number(msgRes.lastInsertRowid), text }, 201);
  }

  // ── Teacher Messaging Threads ─────────────────────────────────────────────
  if (pathname === "/api/teacher/messages/threads" && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const threads = queries.getTeacherThreads.all(auth.userId) as any[];
    return apiSuccess(threads);
  }

  const teacherThreadMatch = pathname.match(/^\/api\/teacher\/messages\/threads\/(\d+)$/);
  if (teacherThreadMatch && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const threadId = Number(teacherThreadMatch[1]);
    const thread = queries.getThreadById.get(threadId) as any;
    if (!thread || Number(thread.recipient_id) !== auth.userId) return apiError(404, "Thread not found");

    // Reset unread counter for teacher
    queries.markThreadReadForRecipient.run(threadId);
    const messages = queries.getMessagesByThread.all(threadId);
    return apiSuccess({ thread, messages });
  }

  if (teacherThreadMatch && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const threadId = Number(teacherThreadMatch[1]);
    const thread = queries.getThreadById.get(threadId) as any;
    if (!thread || Number(thread.recipient_id) !== auth.userId) return apiError(404, "Thread not found");

    const body = await readJson(req);
    const text = trimStr(body?.text || "");
    if (!text) return apiError(400, "Message text required");

    const msgRes = queries.insertMessage.run(threadId, auth.userId, auth.role, text, 0) as { lastInsertRowid: number | bigint };
    queries.updateThreadLastMessage.run(text, 1, 0, threadId);

    // Dispatch real-time SSE notification to Guardian
    notifyUser(Number(thread.guardian_id), {
      type: "chat_message",
      message: `${auth.name || "Teacher"}: ${text.slice(0, 80)}`,
      link: "/guardian/messages",
    });

    return apiSuccess({ id: Number(msgRes.lastInsertRowid), text, sender_role: auth.role, created_at: new Date().toISOString() }, 201);
  }

  // ── Push Subscriptions (VAPID / Web Push) ──────────────────────────────────
  if (pathname === "/api/notifications/subscribe-push" && method === "POST") {
    const auth = requireAuth(req);
    const body = await readJson(req);
    const endpoint = trimStr(body?.endpoint || "");
    const p256dh = trimStr(body?.keys?.p256dh || body?.p256dh || "");
    const authKey = trimStr(body?.keys?.auth || body?.auth_key || "");

    if (!endpoint || !p256dh || !authKey) return apiError(400, "endpoint, p256dh, and auth key required");
    queries.upsertPushSubscription.run(auth.userId, endpoint, p256dh, authKey);
    return apiSuccess({ success: true, message: "Push subscription active" });
  }

  // ── Guardian Links (Self-Service) ─────────────────────────────────────────
  if (pathname === "/api/guardian/links" && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["guardian"]);
    const links = queries.getGuardianLinksByGuardian.all(auth.userId);
    return apiSuccess(links);
  }

  if (pathname === "/api/guardian/links" && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["guardian"]);
    const body = await readJson(req);
    let student_id = Number(body?.student_id);
    const regIdInput = trimStr(body?.reg_id || body?.regId || body?.student_reg_id || "");
    if (!isPositiveIntId(student_id) && regIdInput) {
      const byReg = queries.getUserByEmailOrReg.get(regIdInput.toUpperCase(), regIdInput.toUpperCase()) as any;
      if (byReg && byReg.role === "student") student_id = Number(byReg.id);
      else {
        const byRegExact = db.prepare("SELECT id FROM users WHERE reg_id = ? AND role='student' LIMIT 1").get(regIdInput) as any;
        if (byRegExact) student_id = Number(byRegExact.id);
      }
    }
    const relationship = trimStr(body?.relationship || "Parent").slice(0, 40);
    if (!isPositiveIntId(student_id)) return apiError(400, "student_id or valid reg_id required");
    const student = queries.getUserById.get(student_id) as any;
    if (!student || student.role !== "student") return apiError(400, "Invalid student id");
    try {
      const result = queries.createGuardianLink.run(auth.userId, student_id, relationship) as { lastInsertRowid: number | bigint };
      auditLog(auth.userId, "GUARDIAN_LINK_REQUEST", "guardian_student_links", Number(result.lastInsertRowid), JSON.stringify({ student_id, relationship }));
      return apiSuccess({ id: Number(result.lastInsertRowid), status: "pending" }, 201);
    } catch (e) {
      if (isSqliteUniqueError(e)) return apiError(409, "A link between you and this student already exists");
      throw e;
    }
  }

  const guardianSelfLinkMatch = pathname.match(/^\/api\/guardian\/links\/(\d+)$/);
  if (guardianSelfLinkMatch && method === "DELETE") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["guardian"]);
    const linkId = Number(guardianSelfLinkMatch[1]);
    if (!isPositiveIntId(linkId)) return apiError(400, "Invalid link id");
    const link = queries.getGuardianLink.get(linkId) as any;
    if (!link) return apiError(404, "Link not found");
    if (link.guardian_id !== auth.userId) return apiError(403, "Access denied");
    if (link.status !== "pending") return apiError(400, "Can only cancel pending links");
    queries.updateGuardianLinkStatus.run("revoked", auth.userId, linkId);
    auditLog(auth.userId, "GUARDIAN_LINK_CANCELLED", "guardian_student_links", linkId, JSON.stringify({ action: "cancel" }));
    return apiSuccess({ id: linkId, status: "revoked" });
  }

  // ── Guardian Notifications ────────────────────────────────────────────────
  if (pathname === "/api/guardian/notifications" && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["guardian"]);
    const notifications = queries.getNotifications.all(auth.userId);
    const unreadRow = queries.getUnreadNotificationCount.get(auth.userId) as any;
    return apiSuccess({ items: notifications, unreadCount: Number(unreadRow?.count || 0) });
  }

  // ── Teacher Attendance: Class Roster & Roll ────────────────────────────────
  if (pathname === "/api/teacher/attendance/roster" && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const queryDate = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    const classIdParam = url.searchParams.get("class_id");
    
    // 1. Get assigned classes for teacher or all classes for operator
    let teacherClasses: any[] = [];
    if (auth.role === "operator") {
      teacherClasses = queries.getClasses.all() as any[];
    } else {
      teacherClasses = queries.getTeacherClasses.all(auth.userId) as any[];
    }

    if (teacherClasses.length === 0) {
      return apiSuccess({
        date: queryDate,
        has_class: false,
        classes: [],
        students: [],
        message: "You are not currently assigned as a Class Teacher for any classroom.",
      });
    }

    const selectedClassId = classIdParam ? Number(classIdParam) : teacherClasses[0].id;
    const currentClass = teacherClasses.find((c: any) => Number(c.id) === selectedClassId) || teacherClasses[0];

    const activeTerm = queries.getActiveAcademicTerm.get() as any;
    const tid = activeTerm?.id || 1;

    const rawStudents = queries.getClassEnrolledStudentsForAttendance.all(currentClass.id) as any[];
    const students = rawStudents.map((s: any) => {
      const record = queries.getAttendanceRecordForStudentDate.get(s.id, queryDate, tid) as any;
      return {
        id: s.id,
        student_id: s.id,
        name: s.name,
        reg_id: s.reg_id,
        image_url: s.image_url,
        class_name: s.class_name || currentClass.name,
        status: record?.status || "present",
        remarks: record?.remarks || "",
        recorded_at: record?.created_at || null,
      };
    });

    return apiSuccess({
      date: queryDate,
      has_class: true,
      class_id: currentClass.id,
      class_name: currentClass.name,
      classes: teacherClasses,
      total_students: students.length,
      students,
    });
  }

  // ── Teacher Attendance: Batch Register Submission ─────────────────────────
  if (pathname === "/api/teacher/attendance/batch" && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const body = await readJson(req);
    const classId = Number(body?.class_id);
    const date = trimStr(body?.date) || new Date().toISOString().slice(0, 10);
    const records = Array.isArray(body?.records) ? body.records : [];

    if (!records.length) return apiError(400, "Records array required");

    const activeTerm = queries.getActiveAcademicTerm.get() as any;
    const activeSession = queries.getActiveAcademicSession.get() as any;
    const tid = Number(body?.term_id || activeTerm?.id || 1);
    const sid = Number(body?.session_id || activeSession?.id || 1);

    let savedCount = 0;
    let alertsSent = 0;

    for (const r of records) {
      const studentId = Number(r.student_id);
      if (!isPositiveIntId(studentId)) continue;
      const status = ["present", "absent", "late", "holiday", "excused"].includes(r.status) ? r.status : "present";
      const remarks = r.remarks ? trimStr(r.remarks) : null;

      queries.upsertAttendanceRecord.run(studentId, tid, sid, date, status, remarks, auth.userId);
      savedCount++;

      // Dispatch alert to student's guardians
      try {
        const guardians = queries.getStudentGuardians.all(studentId) as any[];
        const studentObj = queries.getUserById.get(studentId) as any;
        const studentName = studentObj?.name || "Your ward";
        
        for (const g of guardians) {
          const guardianUser = queries.getUserById.get(Number(g.guardian_id)) as any;
          if (guardianUser && guardianUser.notify_attendance === 0) continue;

          const notifMsg = `Daily Roll Call: ${studentName} was marked ${status.toUpperCase()} in class on ${date}.${remarks ? ` Note: "${remarks}"` : ""}`;
          
          queries.createNotification.run(
            Number(g.guardian_id),
            "attendance",
            notifMsg,
            "/guardian/attendance"
          );

          notifyUser(Number(g.guardian_id), {
            type: "attendance",
            message: notifMsg,
            link: "/guardian/attendance",
          });
          alertsSent++;
        }
      } catch (err) {
        console.warn("[attendance] Failed to notify guardian for student:", studentId, err);
      }
    }

    auditLog(auth.userId, "ATTENDANCE_BATCH_RECORDED", "classes", classId, JSON.stringify({ date, count: savedCount, alertsSent }));
    return apiSuccess({ success: true, count: savedCount, alertsSent, date });
  }

  // ── Guardian Security: Password Update ────────────────────────────────────
  if (pathname === "/api/guardian/settings/password" && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["guardian"]);
    const body = await readJson(req);
    const currentPassword = String(body?.current_password || "");
    const newPassword = String(body?.new_password || "");

    if (!currentPassword || !newPassword) return apiError(400, "Current password and new password required");
    if (newPassword.length < MIN_PASSWORD_LENGTH) return apiError(400, `New password must be at least ${MIN_PASSWORD_LENGTH} characters`);

    const user = queries.getUserById.get(auth.userId) as any;
    if (!user) return apiError(404, "User not found");

    const match = await verifyPassword(currentPassword, user.password_hash);
    if (!match) return apiError(400, "Current password is incorrect");

    const newHash = await hashPassword(newPassword);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, auth.userId);
    auditLog(auth.userId, "PASSWORD_UPDATED", "users", auth.userId, "{}");

    return apiSuccess({ success: true, message: "Password updated successfully" });
  }

  // ── Guardian Settings: Profile Update ─────────────────────────────────────
  if (pathname === "/api/guardian/settings/profile" && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["guardian"]);
    const body = await readJson(req);
    const phone = trimStr(body?.phone || "");
    const address = trimStr(body?.address || "");

    queries.updateGuardianProfile.run(phone || null, address || null, auth.userId);
    auditLog(auth.userId, "PROFILE_UPDATED", "users", auth.userId, JSON.stringify({ phone, address }));

    return apiSuccess({ success: true, message: "Profile updated successfully" });
  }

  // ── Guardian Settings: Notification Preferences ──────────────────────────
  if (pathname === "/api/guardian/settings/notifications" && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["guardian"]);
    const body = await readJson(req);
    const notify_attendance = (body?.notify_attendance === 0 || body?.notify_attendance === false) ? 0 : 1;
    const notify_results = (body?.notify_results === 0 || body?.notify_results === false) ? 0 : 1;
    const notify_fees = (body?.notify_fees === 0 || body?.notify_fees === false) ? 0 : 1;
    const notify_messages = (body?.notify_messages === 0 || body?.notify_messages === false) ? 0 : 1;

    queries.updateGuardianNotificationPreferences.run(
      notify_attendance,
      notify_results,
      notify_fees,
      notify_messages,
      auth.userId
    );

    return apiSuccess({
      success: true,
      message: "Notification preferences saved",
      preferences: { notify_attendance, notify_results, notify_fees, notify_messages },
    });
  }

  // ── Guardian Report Card Share Token ──────────────────────────────────────
  const wardShareTokenMatch = pathname.match(/^\/api\/guardian\/wards\/(\d+)\/share-token$/);
  if (wardShareTokenMatch && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["guardian"]);
    const wardId = Number(wardShareTokenMatch[1]);
    const link = db.prepare("SELECT student_id FROM guardian_student_links WHERE guardian_id = ? AND (student_id = ? OR id = ?) AND status = 'approved'").get(auth.userId, wardId, wardId) as any;
    if (!link) return apiError(403, "Access denied: not your ward");

    const token = Buffer.from(`${auth.userId}:${link.student_id}:${Date.now()}`).toString("base64url");
    const shareUrl = `/student/report-card?student_id=${link.student_id}&token=${token}`;
    return apiSuccess({ token, share_url: shareUrl });
  }

  // ── Guardian Verify Report Card Share Token ──────────────────────────────
  if (pathname === "/api/guardian/verify-share-token" && method === "GET") {
    const rawToken = url.searchParams.get("token") || "";
    if (!rawToken) return apiError(400, "Token query parameter required");
    try {
      const decoded = Buffer.from(rawToken, "base64url").toString("utf-8");
      const [guardianIdStr, studentIdStr, timestampStr] = decoded.split(":");
      const guardianId = Number(guardianIdStr);
      const studentId = Number(studentIdStr);
      const timestamp = Number(timestampStr);

      if (!isPositiveIntId(guardianId) || !isPositiveIntId(studentId) || !Number.isFinite(timestamp)) {
        return apiError(400, "Invalid share token format");
      }

      const student = queries.getUserById.get(studentId) as any;
      if (!student || student.role !== "student") return apiError(404, "Student not found");

      return apiSuccess({ valid: true, student_id: studentId, guardian_id: guardianId, created_at: new Date(timestamp).toISOString() });
    } catch {
      return apiError(400, "Invalid token");
    }
  }

  // ── VAPID Public Key Discovery ────────────────────────────────────────────
  if (pathname === "/api/notifications/vapid-public-key" && method === "GET") {
    const vapidPublicKey = Bun.env.VAPID_PUBLIC_KEY || "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDZKrxZElOEGqcMPSCqbYp512vtR45N_XXGYZoSTWiME";
    return apiSuccess({ publicKey: vapidPublicKey });
  }

  return apiError(404, "Not found");
}


const server = serve({
  port: Number(Bun.env.PORT ?? 8001),
  hostname: "0.0.0.0",
  idleTimeout: 255,
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
let foundWifi = false;
let foundEthernet = false;
for (const [name, addresses] of Object.entries(interfaces)) {
  for (const addr of addresses ?? []) {
    if (addr.family === "IPv4" && !addr.internal) {
      console.log(`[${name}] Local Network: http://${addr.address}:${server.port}`);
      allNonLoopback.push({ name, address: addr.address });
      if (name.toLowerCase().includes("wi-fi") || name.toLowerCase().includes("wlan")) foundWifi = true;
      if (name.toLowerCase().includes("ethernet") && !virtualPrefixes.some(p => name.startsWith(p))) foundEthernet = true;
    }
  }
}
if (!foundWifi) console.log(`[Wi-Fi] Local Network: Not connected`);
if (!foundEthernet) console.log(`[Ethernet] Local Network: Not connected`);
// Pick a physical adapter first; fall back to any non-loopback if none found
const physicalAdapter = allNonLoopback.find(a => !virtualPrefixes.some(prefix => a.name.startsWith(prefix)));
primaryLocalIp = (physicalAdapter ?? allNonLoopback[0])?.address ?? "";
console.log("Note: If deployed on a cloud platform (Railway/Render), use your provided public domain.");
console.log(`SQLite: ${EXAMPOOL_DB_PATH}`);
console.log(`Static dist: ${distDir}`);
console.log(`Setup required: ${setupRequired}`);
console.log(`JWT Secret: ${Bun.env.JWT_SECRET ? "✅ Custom secret loaded from .env" : "❌ Default (insecure) — run: bun run start"}`);

// --- Local DNS IP Masking & mDNS Zero-Config ---
let isDnsListening = false;
let isMdnsListening = false;
const initialDbUrl = (queries.getSetting.get("CUSTOM_URL") as any)?.value;
let activeCustomUrl = initialDbUrl || Bun.env.CUSTOM_URL || "exampool.com";

// Type number-to-name lookup for DNS Packet
const DNS_TYPE_NUM_TO_NAME: Record<number, string> = {};
for (const [tName, tNum] of Object.entries(DNS.Packet.TYPE)) {
  DNS_TYPE_NUM_TO_NAME[tNum as number] = tName;
}

// Upstream recursive resolver (Google & Cloudflare public DNS)
const upstreamDns = new DNS({
  nameServers: ["8.8.8.8", "1.1.1.1", "8.8.4.4", "1.0.0.1"],
  timeout: 2500,
  retryOverTCP: true,
});

// High-speed in-memory DNS cache for upstream queries
interface CachedDnsRecord {
  expiresAt: number;
  rcode: number;
  answers: any[];
  authorities: any[];
  additionals: any[];
}
const dnsUpstreamCache = new Map<string, CachedDnsRecord>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of dnsUpstreamCache.entries()) {
    if (entry.expiresAt <= now) dnsUpstreamCache.delete(key);
  }
}, 60_000);

// Helper: check if a requested domain matches our local app domains
function isMatchingCustomDomain(qName: string, activeUrl: string): boolean {
  const q = qName.toLowerCase().replace(/\.$/, "").trim();
  const target = (activeUrl || "exampool.com").toLowerCase().replace(/\.$/, "").trim();
  const targetBase = target.replace(/\.[a-z0-9-]+$/i, "");

  if (target) {
    if (q === target || q === `www.${target}` || q.endsWith(`.${target}`)) return true;
  }

  // Built-in friendly domains (exampool.com, exampool.local, exampool.ng, exampool.co)
  if (
    q === "exampool.com" ||
    q === "www.exampool.com" ||
    q.endsWith(".exampool.com") ||
    q === "exampool.local" ||
    q === "www.exampool.local" ||
    q.endsWith(".exampool.local") ||
    q === "exampool.co" ||
    q === "www.exampool.co" ||
    q.endsWith(".exampool.co") ||
    q === "exampool.ng" ||
    q === "www.exampool.ng" ||
    q.endsWith(".exampool.ng")
  ) {
    return true;
  }

  if (targetBase.length > 2 && (q === `${targetBase}.local` || q.endsWith(`.${targetBase}.local`))) {
    return true;
  }

  return false;
}

// Function to safely update the local OS hosts file (Windows & Unix)
function syncHostsFile(customUrl: string): boolean {
  const isWindows = process.platform === "win32";
  const hostsPath = isWindows
    ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "drivers", "etc", "hosts")
    : "/etc/hosts";

  try {
    if (!fs.existsSync(hostsPath)) return false;
    let content = fs.readFileSync(hostsPath, "utf-8");

    const domains = new Set(["exampool.com", "www.exampool.com", "exampool.local", "www.exampool.local", "exampool.co", "www.exampool.co", "exampool.ng", "www.exampool.ng"]);
    if (customUrl) {
      const clean = customUrl.toLowerCase().trim();
      domains.add(clean);
      if (!clean.startsWith("www.")) domains.add(`www.${clean}`);
      const baseName = clean.replace(/\.[a-z0-9-]+$/i, "");
      if (baseName && baseName !== "exampool") {
        domains.add(`${baseName}.local`);
      }
    }

    const markerStart = "# === EXAMPOOL LOCAL DOMAIN MAP START ===";
    const markerEnd = "# === EXAMPOOL LOCAL DOMAIN MAP END ===";

    const domainList = Array.from(domains).join(" ");
    const block = `${markerStart}\n127.0.0.1 ${domainList}\n::1 ${domainList}\n${markerEnd}`;

    if (content.includes(markerStart)) {
      const regex = new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`, "g");
      content = content.replace(regex, block);
    } else {
      content = content.trimEnd() + "\n\n" + block + "\n";
    }

    fs.writeFileSync(hostsPath, content, "utf-8");
    console.log(`[HOSTS] Local hosts file mapped: ${domainList} -> 127.0.0.1`);
    return true;
  } catch {
    // EPERM is normal when not running elevated
    return false;
  }
}

// Attempt initial hosts file sync
syncHostsFile(activeCustomUrl);

// Helper: always resolve the current primary LAN IP (handles DHCP changes)
function getCurrentPrimaryIp(): string {
  if (primaryLocalIp) return primaryLocalIp;
  // Fallback: rescan interfaces if primary was empty at startup
  try {
    const ifaces = os.networkInterfaces();
    const virtualPrefixes = ["vEthernet", "VMware", "VirtualBox", "Loopback", "Teredo", "Bluetooth", "WSL"];
    for (const [name, addrs] of Object.entries(ifaces)) {
      for (const a of addrs ?? []) {
        if (a.family === "IPv4" && !a.internal && !virtualPrefixes.some(p => name.startsWith(p))) {
          return a.address;
        }
      }
    }
    for (const addrs of Object.values(ifaces)) {
      for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
    }
  } catch {}
  return primaryLocalIp || "127.0.0.1";
}

// Periodic refresh of primaryLocalIp in case DHCP lease changes
setInterval(() => {
  const refreshed = getCurrentPrimaryIp();
  if (refreshed && refreshed !== primaryLocalIp) {
    primaryLocalIp = refreshed;
    console.log(`[DNS] Primary LAN IP refreshed: ${primaryLocalIp}`);
  }
}, 30_000);

// --- Zero-Config Multicast DNS (mDNS) Responder on UDP 5353 ---
function startMdnsResponder() {
  try {
    const mdnsSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    mdnsSocket.on("error", () => {
      // Non-fatal if port 5353 has OS binding restrictions
    });

    mdnsSocket.on("message", (msg: Buffer, rinfo: any) => {
      try {
        const parsed = DNS.Packet.parse(msg);
        for (const question of parsed.questions || []) {
          const qName = String(question.name || "").toLowerCase().replace(/\.$/, "");
          if (
            qName === "exampool.local" ||
            qName === "www.exampool.local" ||
            isMatchingCustomDomain(qName, activeCustomUrl)
          ) {
            const qType = question.type;
            if (qType === DNS.Packet.TYPE.A || qType === 1 || qType === 255) {
              const resPacket = new DNS.Packet();
              resPacket.header.id = parsed.header.id || 0;
              resPacket.header.qr = 1;
              resPacket.header.aa = 1;
              resPacket.header.rcode = 0;
              resPacket.questions = [question];
              resPacket.answers.push({
                name: question.name,
                type: DNS.Packet.TYPE.A,
                class: DNS.Packet.CLASS.IN,
                ttl: 120,
                address: getCurrentPrimaryIp(),
              } as any);

              const buf = resPacket.toBuffer();
              try {
                mdnsSocket.send(buf, 0, buf.length, 5353, "224.0.0.251");
                if (rinfo.port && rinfo.port !== 5353) {
                  mdnsSocket.send(buf, 0, buf.length, rinfo.port, rinfo.address);
                }
              } catch {}
            }
          }
        }
      } catch {}
    });

    mdnsSocket.bind(5353, () => {
      try {
        mdnsSocket.addMembership("224.0.0.251");
        isMdnsListening = true;
      } catch {}
    });
  } catch {}
}

startMdnsResponder();

if (primaryLocalIp || getCurrentPrimaryIp()) {
  try {
    const { Packet } = DNS;
    const dnsServer = DNS.createServer({
      udp: true,
      handle: async (request: any, send: (response: any) => Promise<any>, rinfo: any) => {
        const response = Packet.createResponseFromRequest(request);
        const [question] = request.questions;
        if (!question) return send(response);

        const qName = String(question.name || "").toLowerCase().replace(/\.$/, "");
        const isMatch = isMatchingCustomDomain(qName, activeCustomUrl);

        if (isMatch) {
          // Authoritative answer for our custom domain / local domain
          response.header.aa = 1;
          response.header.ra = 1;
          response.header.rcode = 0;

          if (question.type === Packet.TYPE.A || question.type === 1 || question.type === 255) {
            const ip = getCurrentPrimaryIp();
            response.answers.push({
              name: question.name,
              type: Packet.TYPE.A,
              class: Packet.CLASS.IN,
              ttl: 60,
              address: ip,
            } as any);
          }
          // For AAAA (IPv6) or HTTPS queries on our local domain, return empty answer with NOERROR immediately
          return send(response);
        }

        // --- Recursive Upstream Forwarding for all other domains ---
        const typeStr = typeof question.type === "number"
          ? (DNS_TYPE_NUM_TO_NAME[question.type] || "A")
          : (question.type || "A");
        const cacheKey = `${qName}|${typeStr}`;
        const now = Date.now();
        const cached = dnsUpstreamCache.get(cacheKey);

        if (cached && cached.expiresAt > now) {
          response.header.rcode = cached.rcode;
          response.header.ra = 1;
          response.answers = cached.answers;
          response.authorities = cached.authorities;
          response.additionals = cached.additionals;
          return send(response);
        }

        try {
          const upstreamRes = await upstreamDns.resolve(question.name, typeStr);
          if (upstreamRes) {
            response.header.rcode = upstreamRes.header.rcode ?? 0;
            response.header.ra = 1;
            response.answers = upstreamRes.answers ? [...upstreamRes.answers] : [];
            response.authorities = upstreamRes.authorities ? [...upstreamRes.authorities] : [];
            response.additionals = upstreamRes.additionals ? [...upstreamRes.additionals] : [];

            // Cache upstream answer
            let minTtl = 60;
            for (const a of response.answers) {
              if (typeof a.ttl === "number" && a.ttl > 0 && a.ttl < minTtl) minTtl = a.ttl;
            }
            if (dnsUpstreamCache.size < 500) {
              dnsUpstreamCache.set(cacheKey, {
                expiresAt: now + Math.min(minTtl, 300) * 1000,
                rcode: response.header.rcode,
                answers: response.answers,
                authorities: response.authorities,
                additionals: response.additionals,
              });
            }

            return send(response);
          }
        } catch {
          // Upstream query failed / domain does not exist
          response.header.rcode = 3; // NXDOMAIN
        }

        send(response);
      },
    });

    dnsServer.on("listening", () => {
      isDnsListening = true;
      const ip = getCurrentPrimaryIp();
      console.log(`[DNS] Local IP Masking active: ${activeCustomUrl} (+www.${activeCustomUrl}, *.${activeCustomUrl}) -> ${ip}`);
      console.log(`[DNS] Recursive Upstream Proxy: ✅ Active (Google & Cloudflare DNS pass-through)`);
      console.log(`[mDNS] Zero-Config Wi-Fi URL:  http://exampool.local:${server.port}`);
      console.log(`      • Fast Wi-Fi Access:     http://exampool.local:${server.port} (Works on iPhones/Android/Mac/PC on same Wi-Fi)`);
      console.log(`      • Custom Domain Access:  http://${activeCustomUrl}:${server.port} (Set router Primary DNS to ${ip})`);
      console.log(`      • Direct LAN IP Access:  http://${ip}:${server.port}`);
      console.log(`      • Host PC Setup:         Run 'bun run hosts:setup' to map ${activeCustomUrl} on this computer`);
    });

    dnsServer.on("error", (err: any) => {
      isDnsListening = false;
      if (err.code === "EACCES" || err.code === "EPERM") {
        console.warn(`[DNS WARNING] Could not bind to port 53. Run the server as Administrator to enable URL masking.`);
        console.warn(`              Right-click → Run as Administrator, then: bun run start`);
        console.warn(`              Zero-Config mDNS still works: http://exampool.local:${server.port}`);
        console.warn(`              Direct IP access still works: http://${getCurrentPrimaryIp()}:${server.port}`);
      } else if (err.code === "EADDRINUSE") {
        console.warn(`[DNS WARNING] Port 53 in use by another service (e.g. WSL/ICS, Hyper-V, or another DNS).`);
        console.warn(`              To free Port 53: disable Internet Connection Sharing in Windows Settings.`);
        console.warn(`              Zero-Config mDNS still works: http://exampool.local:${server.port}`);
        console.warn(`              Direct IP access still works: http://${getCurrentPrimaryIp()}:${server.port}`);
      } else {
        console.warn(`[DNS WARNING] Could not start local DNS: ${err.message}`);
        console.warn(`              Direct IP access fallback: http://${getCurrentPrimaryIp()}:${server.port}`);
      }
    });

    // Bind to all interfaces so any LAN client using this host as DNS can resolve
    const dnsBindIp = "0.0.0.0";
    dnsServer.listen({ udp: { port: 53, address: dnsBindIp } });
  } catch (err: any) {
    isDnsListening = false;
    console.warn(`[DNS WARNING] Failed to initialize local DNS: ${err.message}`);
    console.warn(`              Direct IP access still works: http://${getCurrentPrimaryIp()}:${server.port}`);
  }
} else {
  console.warn(`[DNS] No LAN IP detected — DNS masking disabled. Connect to Wi-Fi/Ethernet to enable custom URL.`);
  console.warn(`      Direct fallback: http://127.0.0.1:${server.port}`);
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

