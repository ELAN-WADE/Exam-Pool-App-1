import { serve } from "bun";
import path from "path";
import db from "./db";
import { getServices, initializeServices } from "./services";
import { config } from "./config";
import { AuditService } from "./services/audit.service";
import type { Database } from "bun:sqlite";

// Initialize services
const services = initializeServices(db as Database);
const auditService = services.audit;
const userService = services.user;
const subjectService = services.subject;
const examService = services.exam;
const gradingService = services.grading;
const academicService = services.academic;
const notificationService = services.notification;

const ALLOWED_ORIGIN = config.env.ALLOWED_ORIGIN || "http://localhost:3000";

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

function checkRateLimit(key: string, limit: number, windowMs: number): void {
  services.notification.checkRateLimit(key, limit, windowMs);
}

function getClientIp(req: Request): string {
  if (config.env.TRUST_PROXY === "true") {
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  try { return req.header("x-real-ip") || req.header("cf-connecting-ip") || "unknown"; } catch { return "unknown"; }
}

function handleApiError(status: number, error: string, extra?: Record<string, unknown>) {
  return new Response(JSON.stringify({ error, ...extra }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Credentials": "true",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
    },
  });
}

function apiSuccess(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

function apiMessage(message: string, status = 200) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function requireAuth(req: Request): { userId: number; role: string; token: string } {
  const cookies = req.headers.get("cookie");
  if (!cookies) throw new HttpError(401, "Not authenticated");

  const cookieToken = cookies.match(/__exampool_session=([^;]+)/)?.[1];
  const authHeader = req.headers.get("authorization");
  const headerToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const token = cookieToken || headerToken;

  if (!token) throw new HttpError(401, "Not authenticated");

  const decoded = services.auth.verifyToken(token);
  if (!decoded) throw new HttpError(401, "Not authenticated");

  const user = userService.findById(decoded.userId);
  if (!user || user.is_active !== 1 || user.role !== decoded.role) {
    throw new HttpError(401, "Session invalidated or user suspended");
  }

  return { ...decoded, token: token || "" };
}

function requireRole(role: string, allowed: string[]): void {
  if (!allowed.includes(role)) throw new HttpError(403, "Forbidden");
}

// Static file serving
function serveStatic(urlPath: string): Response {
  const pathname = urlPath.split("?")[0] ?? "/";

  const lowerPath = pathname.toLowerCase();

  // Route to Bun server from Next.js static export
  // This handles the Next.js SPA fallback
  
  // Try to serve from dist
  const distDir = path.join(import.meta.dir, "..", "exampool", "dist");
  
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

  // Path traversal guard
  const resolvedDistDir = path.resolve(distDir);
  
  for (const filePath of candidates) {
    const resolvedFilePath = path.resolve(filePath);
    if (!resolvedFilePath.startsWith(resolvedDistDir + path.sep) && resolvedFilePath !== resolvedDistDir) {
      return handleApiError(403, "Forbidden");
    }
    try {
      const file = Bun.file(resolvedFilePath);
      if (await file.exists()) {
        const isSvg = resolvedFilePath.toLowerCase().endsWith(".svg");
        return new Response(file, {
          headers: {
            "Content-Type": isSvg ? "image/svg+xml" : "text/html; charset=utf-8",
            "Cache-Control": isSvg 
              ? "public, max-age=31536000, immutable"
              : "public, max-age=3600, must-revalidate",
          },
        });
      }
    } catch {}
  }
  
  // Fallback: serve the Next.js SPA
  const indexFile = Bun.file(path.join(distDir, "index.html"));
  if (await indexFile.exists()) {
    return new Response(indexFile, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  }

  return handleApiError(404, "Not found");
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}

// API routes
async function handleApi(req: Request): Promise<Response> {
  const method = req.method.toUpperCase();
  const url = new URL(req.url);

  // ── Health check ──
  if (method === "GET" && url.pathname === "/api/health") {
    return apiSuccess({ status: "ok", timestamp: new Date().toISOString() });
  }

  // ── Auth: Setup ──
  if (method === "POST" && url.pathname === "/api/setup") {
    const body = await req.json();
    const name = trimStr(body?.name);
    const email = normalizeEmail(trimStr(body?.email));
    const password = body?.password;
    const schoolName = trimStr(body?.schoolName);
    const currentTerm = trimStr(body?.currentTerm);

    if (!name) return handleApiError(400, "name is required");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email))) return handleApiError(400, "A valid email is required");
    if (!isValidPassword(password)) {
      return handleApiError(400, `password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    const hash = await services.auth.hashPassword(password);
    const prefix = "OP";
    const regId = `${prefix}-${Date.now().toString(36).toUpperCase()}`;
    const finalEmail = email || `${regId.toLowerCase()}@exampool.local`;

    try {
      const user = await userService.register({
        name,
        email: finalEmail,
        role: "operator",
        password,
        actorId: 0,
        registrationOpen: false
      });

      services.auditService.log(user.id, "USER_CREATE", "user", user.id, JSON.stringify({ role: "operator" }));

      const token = services.auth.generateToken(user.id, "operator");
      return apiSuccess(
        { user: { id: user.id, name, email: user.email, role: "operator", grade: null } },
        201,
        { "Set-Cookie": services.auth.buildSessionCookie(token) }
      );
    } catch (e: any) {
      if (e.message?.includes("already registered")) return handleApiError(409, "Email already registered");
      throw e;
    }
  }

  // ── Auth: Login ──
  if (method === "POST" && url.pathname === "/api/auth/login") {
    const clientIp = getClientIp(req);
    checkRateLimit(`login_${clientIp}`, 10, 60_000);

    const body = await req.json();
    const identifier = trimStr(body?.email || body?.identifier);
    const password = body?.password;

    if (!identifier || !password) return handleApiError(400, "Email/Reg ID and password required");

    const normalizedIdentifier = identifier.includes("@") ? normalizeEmail(identifier) : identifier.toUpperCase();
    const user = userService.findByEmailOrReg(normalizedIdentifier);

    if (!user) {
      console.warn("[Login] Failed: user not found");
      return handleApiError(401, "Invalid credentials");
    }

    if (sqlInt(user.is_active) !== 1) {
      console.warn("[Login] Failed: account inactive");
      return handleApiError(401, "Invalid credentials");
    }

    const hash = user.password_hash;
    if (!hash) {
      console.warn("[Login] Failed: missing password hash");
      return handleApiError(401, "Invalid credentials");
    }

    let ok = false;
    try {
      ok = await services.auth.verifyPassword(password, hash);
    } catch (e) {
      console.error("[Login] verifyPassword error:", e);
      ok = false;
    }

    if (!ok) {
      console.warn("[Login] Failed: incorrect password");
      return handleApiError(401, "Invalid credentials");
    }

    const userId = Number(user.id);
    const role = typeof user.role === "string" ? user.role : "";

    if (!Number.isFinite(userId) || !role) {
      console.warn("[Login] Failed: invalid user record");
      return handleApiError(401, "Invalid credentials");
    }

    const token = services.auth.generateToken(userId, role);
    const safeUser = { ...user };
    delete (safeUser as any).password_hash;
    delete (safeUser as any).dob;
    delete (safeUser as any).phone;

    services.auditService.log(userId, "LOGIN", "user", userId, JSON.stringify({ email: user.email }));

    return apiSuccess({ user: safeUser }, 200, { "Set-Cookie": services.auth.buildSessionCookie(token) });
  }

  // ── Auth: Me ──
  if (method === "GET" && url.pathname === "/api/auth/me") {
    try {
      const auth = requireAuth(req);
      const user = userService.getForAuth(auth.userId);
      if (!user) return handleApiError(401, "Not authenticated");

      return apiSuccess({ user });
    } catch (e: any) {
      if (isHttpError(e)) return handleApiError(e.status, e.message);
      throw e;
    }
  }

  // ── Auth: Logout ──
  if (method === "POST" && url.pathname === "/api/auth/logout") {
    try {
      const auth = requireAuth(req);
      services.auditService.log(auth.userId, "LOGOUT", "user", auth.userId, "{}");
      return apiMessage("Logged out", 200);
    } catch (e: any) {
      if (isHttpError(e)) return handleApiError(e.status, e.message);
      throw e;
    }
  }

  // ── Auth: Reset Password (verify email) ──
  if (method === "POST" && url.pathname === "/api/auth/reset-password/verify-email") {
    const clientIp = getClientIp(req);
    checkRateLimit(`pwreset_verify_${clientIp}`, 5, 60_000);

    const body = await req.json();
    const identifier = trimStr(body?.email || body?.identifier);

    if (!identifier) return handleApiError(400, "Identifier required");

    const normalizedIdentifier = identifier.includes("@") ? normalizeEmail(identifier) : identifier.toUpperCase();
    const user = userService.findByEmailOrReg(normalizedIdentifier);

    if (!user || sqlInt(user.is_active) !== 1) return apiSuccess({ found: true });
    return apiSuccess({ found: true });
  }

  // ── Auth: Reset Password ──
  if (method === "POST" && url.pathname === "/api/auth/reset-password") {
    const clientIp = getClientIp(req);
    checkRateLimit(`pwreset_${clientIp}`, 5, 60_000);

    const body = await req.json();
    const identifier = trimStr(body?.email || body?.identifier);
    const verification = trimStr(body?.verification);
    const newPassword = body?.new_password;

    if (!identifier || !verification || !newPassword) return handleApiError(400, "Missing required fields");
    if (!isValidPassword(newPassword)) return handleApiError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);

    const normalizedIdentifier = identifier.includes("@") ? normalizeEmail(identifier) : identifier.toUpperCase();
    const user = userService.findByEmailOrReg(normalizedIdentifier);

    if (!user) return handleApiError(404, "User not found");
    if (sqlInt(user.is_active) !== 1) return handleApiError(423, "Account deactivated");

    // Apply timing-safe comparison
    if (user.role === "student") {
      if (!user.dob) return handleApiError(400, "Date of birth not set for this account");
      const dobBuf = Buffer.from(String(user.dob).padEnd(32, "\0"), "utf8");
      const verBuf = Buffer.from(verification.padEnd(32, "\0"), "utf8");
      if (dobBuf.length !== verBuf.length || !crypto.timingSafeEqual(dobBuf, verBuf)) return handleApiError(401, "Verification failed (incorrect DOB)");
    } else {
      if (!user.phone) return handleApiError(400, "Phone number not set for this account");
      const phoneBuf = Buffer.from(String(user.phone).padEnd(32, "\0"), "utf8");
      const verBuf2 = Buffer.from(verification.padEnd(32, "\0"), "utf8");
      if (phoneBuf.length !== verBuf2.length || !crypto.timingSafeEqual(phoneBuf, verBuf2)) return handleApiError(401, "Verification failed (incorrect phone number)");
    }

    const hash = await services.auth.hashPassword(newPassword);
    await userService.resetPassword(user.id, newPassword, auth.userId);

    return apiMessage("Password reset successfully");
  }

  // ── Academic: Sessions ──
  if (method === "GET" && url.pathname === "/api/academic/active") {
    const active = academicService.getActiveSession();
    const activeTerm = academicService.getActiveTerm();
    return apiSuccess({
      activeSession: active || { id: 1, name: "2026/2027", is_active: 1, status: "active" },
      activeTerm: activeTerm || { id: 1, name: "First Term", is_active: 1, status: "active", registration_open: 1 }
    });
  }

  if (method === "GET" && url.pathname === "/api/academic/sessions") {
    try {
      const auth = requireAuth(req);
      requireRole(auth.role, ["operator", "teacher"]);
      const sessions = academicService.getAllSessions();
      const terms = academicService.getTermsBySession(1); // Would need proper session lookup
      return apiSuccess({ sessions, terms });
    } catch (e: any) {
      if (isHttpError(e)) return handleApiError(e.status, e.message);
      throw e;
    }
  }

  if (method === "POST" && url.pathname === "/api/academic/sessions") {
    try {
      const auth = requireAuth(req);
      requireRole(auth.role, ["operator"]);
      const body = await req.json;
      const name = trimStr(body?.name);
      if (!name) return handleApiError(400, "Session name is required");

      const session = await academicService.createSession(name, auth.userId);
      return apiSuccess({ success: true, message: `Academic Session ${name} created` });
    } catch (e: any) {
      if (isHttpError(e)) return handleApiError(e.status, e.message);
      throw e;
    }
  }

  // ── ... More routes would follow the same pattern ... ──

  // Default: serve static
  return serveStatic(urlPath);
}

// Start server
const server = serve({
  port: config.env.PORT || 8001,
  async fetch(req, server) {
    try {
      return await handleApi(req);
    } catch (e: any) {
      if (isHttpError(e)) {
        return handleApiError(e.status, e.message);
      }
      console.error("[Server] Unexpected error:", e);
      return handleApiError(500, "Internal server error");
    }
  },
});

console.log(`ExamPool server running on port ${config.env.PORT || 8001}`);