import { serve } from "bun";
import { existsSync } from "fs";
import db, { EXAMPOOL_DB_PATH, initializeDatabase, queries } from "./db";
import { buildSessionCookie, generateToken, hashPassword, verifyPassword, verifyToken } from "./auth";
import os from "os";
import path from "path";
import {
  isValidEmail,
  isValidExamDateTime,
  isExamDatetimeInFuture,
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

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true",
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Pragma": "no-cache",
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
  // Secure IP resolution: try X-Forwarded-For first (for cloud deployments)
  // Fallback to Bun's native TCP socket IP (for direct internet exposure to prevent spoofing bypasses)
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  // Fallback to native socket IP. (server is defined at the bottom of the file but accessible at request time)
  try { return server.requestIP(req)?.address || "unknown"; } catch { return "unknown"; }
}

function checkRateLimit(ip: string, limit: number, windowMs: number) {
  const now = Date.now();
  let record = rateLimits.get(ip);
  if (!record || now > record.resetAt) {
    record = { count: 0, resetAt: now + windowMs };
    rateLimits.set(ip, record);
  }
  record.count++;
  if (record.count > limit) throw new HttpError(429, "Too Many Requests");
}

// ── Server-Sent Events (SSE) Manager ───────────────────────────────────────
const sseClients = new Map<number, Set<ReadableStreamDefaultController>>();

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
  const operators = queries.getAllUsers.all() as any[];
  for (const user of operators) {
    if (user.role === "operator") {
      notifyUser(user.id, eventData);
    }
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

function stripPassword(user: any) {
  if (!user) return user;
  const { password_hash: _passwordHash, ...rest } = user;
  // bun:sqlite may return INTEGER columns as BigInt; JSON.stringify throws on BigInt (breaks login/me responses).
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
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        ...corsHeaders,
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
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        ...corsHeaders,
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
        console.warn("[Login] Failed: account inactive");
        return apiError(423, "Account deactivated");
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
    checkRateLimit(`register_${clientIp}`, 5, 60_000);
    const auth = (() => {
      try {
        return requireAuth(req);
      } catch {
        return null;
      }
    })();
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
    if (!user) return apiError(404, "Account not found");
    if (sqlInt(user.is_active) !== 1) return apiError(423, "Account deactivated");
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
    
    if (user.role === "student") {
      if (!user.dob) return apiError(400, "Date of birth not set for this account. Please contact an administrator.");
      if (user.dob !== verification) return apiError(401, "Verification failed (incorrect DOB)");
    } else {
      if (!user.phone) return apiError(400, "Phone number not set for this account. Please contact an administrator.");
      if (user.phone !== verification) return apiError(401, "Verification failed (incorrect phone number)");
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
    const remark = typeof body?.remark === "string" ? body.remark.trim() : "";
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
    
    queries.deleteStudentAnswersForExam.run(examId);
    queries.resetExam.run(examId, auth.userId);
    
    auditLog(auth.userId, "EXAM_RETAKE", "exam", examId, "{}");
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
    const remark = typeof body?.remark === "string" ? body.remark.trim() : "";
    queries.updateExamPrincipalRemark.run(remark || null, examId);
    auditLog(auth.userId, "EXAM_PRINCIPAL_REMARK", "exam", examId, JSON.stringify({ type: "principal" }));
    return apiSuccess({ exam_id: examId, principal_remark: remark || null });
  }

  // ── Term Remarks ─────────────────────────────────────────────────────────────
  const termRemarkMatch = pathname.match(/^\/api\/users\/(\d+)\/term-remarks\/(.+)$/);
  if (termRemarkMatch && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator", "student"]);
    const studentId = Number(termRemarkMatch[1]);
    const term = decodeURIComponent(termRemarkMatch[2] || "");
    if (!isPositiveIntId(studentId)) return apiError(400, "Invalid student id");
    const remark = queries.getTermRemark.get(studentId, term);
    return apiSuccess(remark || { student_id: studentId, term, teacher_remark: null, principal_remark: null });
  }

  if (termRemarkMatch && method === "PUT") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const studentId = Number(termRemarkMatch[1]);
    const term = decodeURIComponent(termRemarkMatch[2] || "");
    if (!isPositiveIntId(studentId)) return apiError(400, "Invalid student id");
    const body = await readJson(req);
    const remark = typeof body?.remark === "string" ? body.remark.trim() : "";
    
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
    const result = queries.createSubject.run(name, code, term, duration, 0, exam_datetime, 0, teacherId, auth.userId, description, cls, session, mode, instructions, 0, window_duration, can_retake) as {
      lastInsertRowid: number | bigint;
    };
    auditLog(auth.userId, "SUBJECT_CREATE", "subject", Number(result.lastInsertRowid), JSON.stringify({ code, term }));
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
    if (nextExamAt !== "" && !isValidExamDateTime(nextExamAt)) {
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
      subjectId,
    );
    
    const nextPublished = Number(body.is_published ?? subject.is_published);
    if (nextPublished === 1 && subject.is_published === 0) {
      notifyOperators({
        type: "subject_published",
        message: `A teacher has published ${trimStr(body.code) || subject.code} (Questions are ready)`,
        link: `/ADMIN/subjects`
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
        image_url
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
      queries.updateQuestion.run(nextText, optionsJson, nextCorrect, nextMarks, nextType, nextTAnswer, nextImg, questionId);
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
    let result: { exam_id: number; score: number; total_score: number; time_taken_seconds: number };
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
          // Time expired: force use the last securely saved answers from DB to prevent late cheating
          try {
            usedAnswers = JSON.parse(exam.answers_json || "[]");
          } catch {
            usedAnswers = [];
          }
        } else {
          // Within time: use client payload or fallback to DB
          try {
            usedAnswers = (answers ?? JSON.parse(exam.answers_json || "[]")) as unknown[];
          } catch {
            throw new HttpError(400, "Invalid saved answers");
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
    const grade = url.searchParams.get("grade");
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
    await Bun.write(EXAMPOOL_DB_PATH, buffer);
    // Re-assert schema constraints, indexes, and defaults on the imported file
    // This prevents a poisoned import from removing FK constraints or indexes
    try { initializeDatabase(); } catch (e) {
      console.error("[exampool] initializeDatabase after import failed:", e);
    }
    auditLog(auth.userId, "SETTINGS_IMPORT", "setting", null, "{}");
    setupRequired = rowCount(queries.countActiveOperators.get() as { count?: unknown }) === 0;
    return apiMessage("Import successful. Restart the server to reload the database file.");
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
      console.error("[exampool] API error:", error);
      return apiError(500, "Server error");
    }
  },
});

console.log("╔═══════════════════════════════════════╗");
console.log("║      EXAMPOOL SERVER RUNNING          ║");
console.log("╚═══════════════════════════════════════╝");
const interfaces = os.networkInterfaces();
for (const [name, addresses] of Object.entries(interfaces)) {
  for (const addr of addresses ?? []) {
    if (addr.family === "IPv4" && !addr.internal) {
      console.log(`[${name}] Local Network: http://${addr.address}:${server.port}`);
    }
  }
}
console.log("Note: If deployed on a cloud platform (Railway/Render), use your provided public domain.");
console.log(`SQLite: ${EXAMPOOL_DB_PATH}`);
console.log(`Static dist: ${distDir}`);
console.log(`Setup required: ${setupRequired}`);
