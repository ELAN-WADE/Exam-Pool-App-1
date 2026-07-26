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
  const nestedFrontend = path.join(import.meta.dir, "frontend", "dist");
  if (existsSync(path.join(siblingDist, "index.html"))) return siblingDist;
  if (existsSync(path.join(nestedFrontend, "index.html"))) return nestedFrontend;
  return siblingDist;
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

let setupRequired = rowCount(queries.countUsers.get() as { count?: unknown }) === 0;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
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

/** bun:sqlite returns INTEGER as BigInt; JSON.stringify throws → 500 on many endpoints after any DB read. */
function jsonSafeStringify(payload: unknown): string {
  return JSON.stringify(payload, (_key, value) => (typeof value === "bigint" ? Number(value) : value));
}

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

async function readJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Bad request");
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
  // HTML pages must NEVER be cached so the browser always picks up new builds
  if (filePath.endsWith(".html")) {
    return "no-store, no-cache, must-revalidate";
  }
  // Everything else — short revalidation
  return "public, max-age=60, must-revalidate";
}

/** Normalize URL path for static lookup (supports Next `trailingSlash: true` → `/setup/` → `setup/index.html`). */
async function serveStatic(urlPath: string): Promise<Response> {
  const currentDistDir = resolveStaticDistDir();
  const pathname = urlPath.split("?")[0] ?? urlPath;
  const rel = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  const candidates: string[] = [];

  if (!rel) {
    candidates.push(path.join(currentDistDir, "index.html"));
  } else if (path.extname(rel) !== "") {
    candidates.push(path.join(currentDistDir, rel));
  } else {
    candidates.push(path.join(currentDistDir, rel, "index.html"));
    candidates.push(path.join(currentDistDir, `${rel}.html`));
    candidates.push(path.join(currentDistDir, rel));
  }

  const resolvedDistDir = path.resolve(currentDistDir);

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
          "Pragma": filePath.endsWith(".html") ? "no-cache" : "",
        },
      });
    }
  }
  // Fallback SPA shell — also no-cache
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

  if (setupRequired && !isApiExemptWhileSetup(pathname, method)) {
    return apiSetupRequired();
  }

  if (method === "GET" && pathname === "/api/server-info") {
    const interfaces = os.networkInterfaces();
    const ips: string[] = [];
    for (const addresses of Object.values(interfaces)) {
      for (const a of addresses || []) if (a.family === "IPv4" && !a.internal) ips.push(a.address);
    }
    return apiSuccess({ ip: ips[0] || "127.0.0.1", port: Number(Bun.env.PORT ?? 8000) });
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
    queries.upsertSetting.run("REGISTRATION_OPEN", "false");
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
    try {
      const body = await readJson(req);
      const email = normalizeEmail(trimStr(body?.email));
      const password = body?.password;
      if (!email || typeof password !== "string" || !password) return apiError(400, "Email and password required");
      const user = queries.getUserByEmail.get(email) as Record<string, unknown> | undefined;
      if (!user) return apiError(401, "Invalid credentials");
      if (sqlInt(user.is_active) !== 1) return apiError(423, "Account deactivated");
      const hash = user.password_hash;
      if (typeof hash !== "string" || !hash) return apiError(401, "Invalid credentials");
      let ok = false;
      try {
        ok = await verifyPassword(password, hash);
      } catch {
        ok = false;
      }
      if (!ok) return apiError(401, "Invalid credentials");
      const userId = Number(user.id);
      const role = typeof user.role === "string" ? user.role : "";
      if (!Number.isFinite(userId) || !role) return apiError(401, "Invalid credentials");
      const token = generateToken(userId, role);
      auditLog(userId, "LOGIN", "user", userId, JSON.stringify({ email: user.email }));
      return apiSuccess({ user: stripPassword(user) }, 200, { "Set-Cookie": buildSessionCookie(token) });
    } catch (error) {
      console.error("[Login Debug]", error);
      return apiError(500, "Server error");
    }
  }

  if (method === "POST" && pathname === "/api/auth/register") {
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
    const email = normalizeEmail(trimStr(body?.email));
    const password = body?.password;
    const role = body?.role;
    const grade = trimStr(body?.grade);
    if (!name || !email || !role) return apiError(400, "Missing required fields");
    if (!isValidEmail(email)) return apiError(400, "A valid email is required");
    if (!isValidPassword(password)) {
      return apiError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    if (role !== "student" && role !== "teacher") return apiError(403, "operator cannot self-register");
    if (role === "student" && !grade) return apiError(400, "Grade is required for student accounts");
    if (queries.getUserByEmail.get(email)) return apiError(400, "Email already registered");
    const hash = await hashPassword(password);
    let result: { lastInsertRowid: number | bigint };
    try {
      const regId = `REG-${Date.now().toString(36).toUpperCase()}`;
      result = queries.createUser.run(name, email, role, hash, role === "student" ? grade : null, regId, null, null, null, null, null) as {
        lastInsertRowid: number | bigint;
      };
    } catch (e) {
      if (isSqliteUniqueError(e)) return apiError(409, "Email already registered");
      throw e;
    }
    const newUserId = Number(result.lastInsertRowid);
    const actorId = auth != null ? Number(auth.userId) : newUserId;
    auditLog(actorId, "USER_CREATE", "user", newUserId, JSON.stringify({ role }));
    return apiSuccess({ user: { id: newUserId, name, email, role, grade: role === "student" ? grade : null } }, 201);
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
    return apiMessage("Logged out", 200, { "Set-Cookie": "__exampool_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
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
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, userId);
    
    auditLog(auth.userId, "USER_UPDATE", "user", userId, JSON.stringify({ action: "reset_password" }));
    return apiMessage("Password reset successfully");
  }

  const studentExamsMatch = pathname.match(/^\/api\/users\/(\d+)\/exams$/);
  if (studentExamsMatch && method === "GET") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const studentId = Number(studentExamsMatch[1]);
    
    const exams = db.prepare(`
      SELECT e.id as exam_id, e.score, e.total_score, e.end_time,
             e.teacher_remark, e.principal_remark,
             s.name as subject_name, s.code, s.term
      FROM exams e
      JOIN subjects s ON e.subject_id = s.id
      WHERE e.student_id = ? AND e.status = 'completed'
      ORDER BY e.end_time DESC
    `).all(studentId);
    
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
    db.prepare("UPDATE exams SET teacher_remark = ? WHERE id = ?").run(remark || null, examId);
    auditLog(auth.userId, "EXAM_REMARK", "exam", examId, JSON.stringify({ type: "teacher" }));
    return apiSuccess({ exam_id: examId, teacher_remark: remark || null });
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
    db.prepare("UPDATE exams SET principal_remark = ? WHERE id = ?").run(remark || null, examId);
    auditLog(auth.userId, "EXAM_PRINCIPAL_REMARK", "exam", examId, JSON.stringify({ type: "principal" }));
    return apiSuccess({ exam_id: examId, principal_remark: remark || null });
  }

  if (method === "GET" && pathname === "/api/subjects") {
    const auth = requireAuth(req);
    if (auth.role === "student") {
      // Students only see subjects they are enrolled in AND published.
      return apiSuccess(
        db.prepare(`
          SELECT s.* FROM subjects s
          INNER JOIN subject_enrollments se ON se.subject_id = s.id AND se.student_id = ?
          WHERE s.is_published = 1
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
    if (!name || !code || !term || !exam_datetime) return apiError(400, "Invalid subject payload");
    if (!isValidSubjectDuration(duration)) return apiError(400, "duration must be an integer from 1 to 360 (minutes)");
    if (!isValidExamDateTime(exam_datetime)) return apiError(400, "exam_datetime must be a valid date/time");
    if (!isExamDatetimeInFuture(exam_datetime)) return apiError(400, "exam_datetime must be in the future");
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
    const result = queries.createSubject.run(name, code, term, duration, 0, exam_datetime, 0, teacherId, auth.userId, description, cls, session, mode) as {
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
    const nextExamAt = trimStr(body.exam_datetime) || subject.exam_datetime;
    if (body.duration !== undefined && !isValidSubjectDuration(nextDuration)) {
      return apiError(400, "duration must be an integer from 1 to 360 (minutes)");
    }
    if (body.exam_datetime !== undefined && !isValidExamDateTime(nextExamAt)) {
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
      subjectId,
    );
    return apiSuccess(queries.getSubjectById.get(subjectId));
  }

  if (subjectMatch && method === "DELETE") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const subjectId = Number(subjectMatch[1]);
    if (!isPositiveIntId(subjectId)) return apiError(400, "Invalid subject id");
    const examRow = db.prepare("SELECT id FROM exams WHERE subject_id = ? LIMIT 1").get(subjectId);
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
        // No exam yet — only allow if window is open
        const now   = Date.now();
        const start = Date.parse(subject.exam_datetime);
        const end   = start + Number(subject.duration) * 60_000;
        if (!Number.isFinite(start) || now < start) return apiError(403, "Exam window not open yet");
        if (now >= end)                              return apiError(403, "Exam window has closed");
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
    return apiSuccess(queries.getEnrollmentsBySubject.all(subjectId));
  }

  if (subjectStudentsMatch && method === "POST") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    const subjectId = Number(subjectStudentsMatch[1]);
    if (!isPositiveIntId(subjectId)) return apiError(400, "Invalid subject id");
    const subject = queries.getSubjectById.get(subjectId) as any;
    if (!subject) return apiError(404, "Subject not found");
    const body = await readJson(req);
    const studentId = Number(body?.student_id);
    if (!isPositiveIntId(studentId)) return apiError(400, "student_id is required");
    const student = queries.getUserById.get(studentId) as any;
    if (!student || student.role !== "student") return apiError(400, "Invalid student");
    if (sqlInt(student.is_active) !== 1) return apiError(400, "Student account is inactive");
    queries.enrollStudent.run(subjectId, studentId, auth.userId);
    auditLog(auth.userId, "STUDENT_ENROLL", "subject_enrollment", subjectId, JSON.stringify({ student_id: studentId }));
    return apiSuccess({ enrolled: true, subject_id: subjectId, student_id: studentId }, 201);
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
    // true_false needs exactly 2 options; objective/essay needs exactly 4
    const expectedOptionsLen = isTrueFalse ? 2 : 4;
    if (!Array.isArray(options) || options.length !== expectedOptionsLen || !options.every((o) => typeof o === "string")) {
      return apiError(400, `options must be an array of exactly ${expectedOptionsLen} strings for ${question_type} questions`);
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
      db.prepare("UPDATE subjects SET total_score = (SELECT COALESCE(SUM(marks),0) FROM questions WHERE subject_id = ?) WHERE id = ?").run(Number(subject_id), Number(subject_id));
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
    const question = db.prepare("SELECT * FROM questions WHERE id = ?").get(questionId) as any;
    if (!question) return apiError(404, "Question not found");
    const subject = queries.getSubjectById.get(question.subject_id) as any;
    if (!subject) return apiError(404, "Subject not found");
    if (auth.role === "teacher" && !sameUserId(subject.teacher_id, auth.userId)) return apiError(403, "You do not own the parent subject");
    if (subject.is_published) return apiError(409, "Cannot edit questions for a published subject");
    if (method === "DELETE") {
      db.transaction(() => {
        queries.deleteQuestion.run(questionId);
        // Recompute total_score from source of truth
        db.prepare("UPDATE subjects SET total_score = (SELECT COALESCE(SUM(marks),0) FROM questions WHERE subject_id = ?) WHERE id = ?").run(Number(question.subject_id), Number(question.subject_id));
      })();
      auditLog(auth.userId, "QUESTION_DELETE", "question", questionId, "{}");
      return apiMessage("Question deleted");
    }
    const body = await readJson(req);
    let optionsJson: string;
    if (body.options !== undefined) {
      const qTypeForValidation = body.question_type ?? question.question_type ?? "objective";
      const isTF = qTypeForValidation === "true_false";
      const expectedLen = isTF ? 2 : 4;
      if (!Array.isArray(body.options) || body.options.length !== expectedLen || !body.options.every((o: unknown) => typeof o === "string")) {
        return apiError(400, `options must be an array of exactly ${expectedLen} strings`);
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
    if (body.correct_answer !== undefined && (!Number.isInteger(nextCorrect) || nextCorrect < 0 || nextCorrect > 3)) {
      return apiError(400, "correct_answer must be an integer 0–3");
    }
    if (body.marks !== undefined && (!Number.isInteger(nextMarks) || nextMarks < 1)) {
      return apiError(400, "marks must be a positive integer");
    }
    const nextType = ["objective", "essay", "true_false"].includes(body?.question_type) ? body.question_type : (question.question_type || "objective");
    const nextTAnswer = body.teacher_answer !== undefined ? (trimStr(body.teacher_answer) || null) : (question.teacher_answer || null);
    const nextImg = body.image_url !== undefined ? (trimStr(body.image_url) || null) : (question.image_url || null);
    db.transaction(() => {
      queries.updateQuestion.run(nextText, optionsJson, nextCorrect, nextMarks, nextType, nextTAnswer, nextImg, questionId);
      // Recompute total_score since marks may have changed
      db.prepare("UPDATE subjects SET total_score = (SELECT COALESCE(SUM(marks),0) FROM questions WHERE subject_id = ?) WHERE id = ?").run(Number(question.subject_id), Number(question.subject_id));
    })();
    auditLog(auth.userId, "QUESTION_EDIT", "question", questionId, "{}");
    return apiSuccess(db.prepare("SELECT * FROM questions WHERE id = ?").get(questionId));
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
    const question = db.prepare("SELECT * FROM questions WHERE id = ? AND subject_id = ?").get(questionId, exam.subject_id) as any;
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
    return apiSuccess(
      db.prepare(
        "SELECT e.*, s.name as subject_name, s.duration FROM exams e JOIN subjects s ON s.id = e.subject_id WHERE e.student_id = ? AND e.status = 'in-progress'",
      ).all(auth.userId),
    );
  }

  if (method === "POST" && pathname === "/api/exams/start") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["student"]);
    const body = await readJson(req);
    const subjectId = Number(body?.subject_id);
    if (!isPositiveIntId(subjectId)) return apiError(400, "Invalid subject_id");
    const subject = queries.getSubjectById.get(subjectId) as any;
    if (!subject || !subject.is_published) return apiError(403, "Exam is not available");
    // Must be enrolled
    const enrollment = db.prepare(
      "SELECT id FROM subject_enrollments WHERE subject_id = ? AND student_id = ?"
    ).get(subjectId, auth.userId);
    if (!enrollment) return apiError(403, "You are not enrolled in this subject");
    const now = Date.now();
    const start = Date.parse(subject.exam_datetime);
    if (!Number.isFinite(start)) return apiError(500, "Invalid subject schedule");
    const end = start + Number(subject.duration) * 60_000;
    if (now < start) return apiError(403, "Exam window not open yet");
    if (now >= end) return apiError(403, "Exam window has closed");
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
    const examId = Number(examSaveMatch[1]);
    if (!isPositiveIntId(examId)) return apiError(400, "Invalid exam id");
    const body = await readJson(req);
    const answers = body?.answers;
    if (!Array.isArray(answers)) return apiError(400, "answers must be array");
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
        if (Date.now() > deadline) throw new HttpError(409, "Exam time has expired");

        let usedAnswers: unknown[];
        try {
          usedAnswers = (answers ?? JSON.parse(exam.answers_json || "[]")) as unknown[];
        } catch {
          throw new HttpError(400, "Invalid saved answers");
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
        for (const q of questions) {
          total += Number(q.marks);
          if (answerMap.get(Number(q.id)) === Number(q.correct_answer)) score += Number(q.marks);
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
        for (const q of questions) {
          const qid        = Number(q.id);
          const studentSel = answerMap.get(qid) ?? null;
          const essayResp  = q.question_type === "essay" ? (essayMap.get(qid) ?? null) : null;
          const isCorrect  = q.question_type !== "essay" && studentSel !== null && studentSel === Number(q.correct_answer) ? 1 : 0;
          const marksAwarded = isCorrect ? Number(q.marks) : 0;
          queries.insertStudentAnswer.run(
            examId, qid, auth.userId, exam.subject_id,
            q.question_type !== "essay" ? studentSel : null,
            essayResp, isCorrect, marksAwarded,
          );
        }

        return {
          exam_id: examId, score, total_score: total,
          time_taken_seconds: Math.max(0, Math.floor((Date.now() - Date.parse(exam.start_time)) / 1000)),
        };
      });

      result = submitTx();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(500, "Server error during exam submission");
    }

    auditLog(auth.userId, "EXAM_SUBMIT", "exam", result.exam_id, JSON.stringify({ score: result.score, total: result.total_score }));
    return apiSuccess(result);
  }

  if (method === "GET" && pathname === "/api/exams/results") {
    const auth = requireAuth(req);
    if (auth.role === "student") {
      return apiSuccess(
        db.prepare("SELECT e.*, s.name as subject_name, s.total_score FROM exams e JOIN subjects s ON s.id = e.subject_id WHERE e.student_id = ? AND e.status = 'completed'").all(auth.userId)
      );
    }
    if (auth.role === "teacher") {
      return apiSuccess(
        db.prepare(
          "SELECT e.*, s.name as subject_name, s.total_score, u.name as student_name, u.grade, u.reg_id, u.id as student_user_id FROM exams e JOIN subjects s ON s.id = e.subject_id JOIN users u ON u.id = e.student_id WHERE e.status = 'completed' AND s.teacher_id = ? ORDER BY e.end_time DESC",
        ).all(auth.userId),
      );
    }
    return apiSuccess(
      db.prepare(
        "SELECT e.*, s.name as subject_name, s.total_score, u.name as student_name, u.grade, u.reg_id, u.id as student_user_id FROM exams e JOIN subjects s ON s.id = e.subject_id JOIN users u ON u.id = e.student_id WHERE e.status = 'completed' ORDER BY e.end_time DESC",
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
    // Students can only view their own exam
    if (auth.role === "student" && !sameUserId(exam.student_id, auth.userId)) return apiError(403, "Forbidden");
    // Teachers can only view exams for their subjects
    if (auth.role === "teacher") {
      const subject = queries.getSubjectById.get(exam.subject_id) as any;
      if (!subject || !sameUserId(subject.teacher_id, auth.userId)) return apiError(403, "Forbidden");
    }
    const answers = queries.getStudentAnswersByExam.all(examId);
    const student = queries.getUserById.get(exam.student_id) as any;
    return apiSuccess({ exam, answers, student: student ? stripPassword(student) : null });
  }

  // ── Results PDF export (teacher + operator) ───────────────────────────────
  if (method === "GET" && pathname === "/api/exams/results/export") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["teacher", "operator"]);
    const rows: any[] = auth.role === "teacher"
      ? db.prepare("SELECT e.*, s.name as subject_name, s.code as subject_code, s.total_score, u.name as student_name, u.grade, u.reg_id FROM exams e JOIN subjects s ON s.id = e.subject_id JOIN users u ON u.id = e.student_id WHERE e.status = 'completed' AND s.teacher_id = ? ORDER BY s.name, u.grade, u.name").all(auth.userId)
      : db.prepare("SELECT e.*, s.name as subject_name, s.code as subject_code, s.total_score, u.name as student_name, u.grade, u.reg_id FROM exams e JOIN subjects s ON s.id = e.subject_id JOIN users u ON u.id = e.student_id WHERE e.status = 'completed' ORDER BY s.name, u.grade, u.name").all();
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
    const enrolledSubjects = db.prepare(`
      SELECT s.id, s.name, s.code, s.term, s.duration, s.total_score,
             s.exam_datetime, s.is_published, s.mode,
             e.status as exam_status, e.score, e.end_time
      FROM subject_enrollments se
      JOIN subjects s ON s.id = se.subject_id
      LEFT JOIN exams e ON e.student_id = se.student_id AND e.subject_id = se.subject_id
      WHERE se.student_id = ?
      ORDER BY s.name
    `).all(auth.userId);

    // Exam stats
    const examStats = db.prepare(`
      SELECT
        COUNT(*) as total_exams,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        ROUND(AVG(CASE WHEN status = 'completed' AND total_score > 0 THEN CAST(score AS REAL)/total_score*100 END), 1) as avg_pct
      FROM exams WHERE student_id = ?
    `).get(auth.userId) as any;

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
    const students = db.prepare(
      "SELECT id FROM users WHERE role = 'student' AND grade = ? AND is_active = 1"
    ).all(grade) as Array<{ id: number }>;

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
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, auth.userId);
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
      if (grade) return apiSuccess(db.prepare("SELECT id, name, email, role, grade, reg_id, is_active, created_at FROM users WHERE role = 'student' AND grade = ?").all(grade));
      return apiSuccess(db.prepare("SELECT id, name, email, role, grade, reg_id, is_active, created_at FROM users WHERE role = 'student'").all());
    }
    requireRole(auth.role, ["operator"]);
    if (role && !isValidRoleParam(role)) return apiError(400, "Invalid role filter");
    if (role && grade) return apiSuccess(db.prepare("SELECT id, name, email, role, grade, is_active, created_at FROM users WHERE role = ? AND grade = ?").all(role, grade));
    if (role) return apiSuccess(db.prepare("SELECT id, name, email, role, grade, is_active, created_at FROM users WHERE role = ?").all(role));
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

  // ── Config ────────────────────────────────────────────────────────────────
  if (method === "GET" && pathname === "/api/config") {
    const auth = requireAuth(req);
    requireRole(auth.role, ["operator"]);
    return apiSuccess(queries.getConfig.get() ?? {});
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
      typeof body?.theme_json === "object" ? JSON.stringify(body.theme_json) : (current.theme_json || "{}"),
      trimStr(body?.version) || current.version || "1.0.0",
      trimStr(body?.admin_email) || current.admin_email || null,
    );
    queries.upsertSetting.run("SCHOOL_NAME", orgName);
    auditLog(auth.userId, "CONFIG_UPDATE", "config", 1, "{}");
    return apiSuccess(queries.getConfig.get());
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
    const hasExam = db.prepare("SELECT id FROM exams WHERE student_id = ? LIMIT 1").get(userId);
    if (hasExam) return apiError(409, "Cannot delete user with exam records");
    queries.deactivateUser.run(userId);
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
    auditLog(auth.userId, "SETTINGS_IMPORT", "setting", null, "{}");
    setupRequired = rowCount(queries.countUsers.get() as { count?: unknown }) === 0;
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
  port: Number(Bun.env.PORT ?? 8000),
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(req, url);
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
      console.log(`[${name}] Students should open: http://${addr.address}:${server.port}`);
    }
  }
}
console.log(`SQLite: ${EXAMPOOL_DB_PATH}`);
console.log(`Static dist: ${distDir}`);
console.log(`Setup required: ${setupRequired}`);
