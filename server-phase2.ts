import { serve } from "bun";
import { existsSync } from "fs";
import fs from "fs";
import path from "path";
import { config } from "./src/config";
import { initializeServices, getServices } from "./src/services";
import { 
  getHealthStatus, 
  getLivenessStatus, 
  getReadinessStatus,
  setDatabase 
} from "./src/health";
import { 
  getMetrics, 
  getMetricsContentType,
  recordHttpRequest,
  recordSSEConnection 
} from "./src/metrics";
import { connectRedis, disconnectRedis, isRedisConnected } from "./src/redis/client";
import { initializeSSEPubSub, shutdownSSEPubSub } from "./src/redis/sse-pubsub";
import { log, logRequest, logError } from "./src/logging";
import { auditService } from "./src/services/audit.service";
import { notificationService } from "./src/services/notification.service";
import { AuthService } from "./src/services/auth.service";
import { HttpError } from "./src/utils/http-error";

const ALLOWED_ORIGIN = config.env.ALLOWED_ORIGIN || "http://localhost:3000";

function sqlInt(value: unknown): number {
  if (value == null || value === "") return 0;
  return typeof value === "bigint" ? Number(value) : Number(value);
}

function rowCount(row: { count?: unknown } | null | undefined): number {
  return sqlInt(row?.count ?? 0);
}

function apiSuccess(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

function apiMessage(message: string, status = 200): Response {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function apiError(status: number, error: string, extra?: Record<string, unknown>): Response {
  if (status >= 500) {
    logError(new Error(error), { status, ...extra });
  }
  return new Response(JSON.stringify({ error, ...extra }), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function getCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self' ws: wss:;",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}

function requireAuth(req: Request): { userId: number; role: string; token: string } {
  const cookies = req.headers.get("cookie");
  if (!cookies) throw new HttpError(401, "Not authenticated");

  const cookieToken = cookies.match(/__exampool_session=([^;]+)/)?.[1];
  const authHeader = req.headers.get("authorization");
  const headerToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const token = cookieToken || headerToken;

  if (!token) throw new HttpError(401, "Not authenticated");

  const authService = new AuthService();
  const decoded = authService.verifyToken(token);
  if (!decoded) throw new HttpError(401, "Not authenticated");

  return { ...decoded, token: token || "" };
}

function requireRole(role: string, allowed: string[]): void {
  if (!allowed.includes(role)) throw new HttpError(403, "Forbidden");
}

async function handleHealth(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const isReady = url.pathname === "/health/ready";
  
  const health = isReady ? await getReadinessStatus() : await getLivenessStatus();
  const statusCode = health.status === "healthy" ? 200 : health.status === "degraded" ? 200 : 503;
  
  return new Response(JSON.stringify(health), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(),
    },
  });
}

async function handleMetrics(): Promise<Response> {
  const metrics = await getMetrics();
  return new Response(metrics, {
    status: 200,
    headers: {
      "Content-Type": getMetricsContentType(),
      ...getCorsHeaders(),
    },
  });
}

async function handleApi(req: Request): Promise<Response> {
  const startTime = Date.now();
  const method = req.method.toUpperCase();
  const url = new URL(req.url);
  const pathname = url.pathname;

  try {
    if (pathname === "/health/live" || pathname === "/health/ready") {
      return handleHealth(req);
    }

    if (pathname === "/metrics") {
      return handleMetrics();
    }

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: getCorsHeaders() });
    }

    if (method === "GET" && pathname === "/api/health") {
      const health = await getLivenessStatus();
      return apiSuccess(health);
    }

    if (method === "GET" && pathname === "/api/redis/status") {
      return apiSuccess({
        connected: isRedisConnected(),
        status: isRedisConnected() ? "connected" : "disconnected",
      });
    }

    if (method === "GET" && pathname === "/api/sse/stats") {
      const auth = requireAuth(req);
      requireRole(auth.role, ["operator"]);
      const stats = await notificationService.getSSEStats();
      return apiSuccess(stats);
    }

    const services = getServices();
    
    if (method === "POST" && pathname === "/api/auth/login") {
      await services.notification.checkRateLimitConfig("login", req.headers.get("x-forwarded-for") || "unknown");
      
      const body = await req.json();
      const identifier = body?.email || body?.identifier;
      const password = body?.password;

      if (!identifier || !password) return apiError(400, "Email/Reg ID and password required");

      const normalizedIdentifier = identifier.includes("@") 
        ? identifier.toLowerCase().trim() 
        : identifier.toUpperCase().trim();
      
      const user = services.user.findByEmailOrReg(normalizedIdentifier);

      if (!user || sqlInt(user.is_active) !== 1) {
        return apiError(401, "Invalid credentials");
      }

      const ok = await services.auth.verifyPassword(password, user.password_hash);
      if (!ok) return apiError(401, "Invalid credentials");

      const token = services.auth.generateToken(Number(user.id), user.role);
      const safeUser = { ...user };
      delete (safeUser as any).password_hash;
      delete (safeUser as any).dob;
      delete (safeUser as any).phone;

      auditService.log(Number(user.id), "LOGIN", "user", Number(user.id), JSON.stringify({ email: user.email }));

      return apiSuccess({ user: safeUser }, 200, { "Set-Cookie": services.auth.buildSessionCookie(token) });
    }

    if (method === "GET" && pathname === "/api/auth/me") {
      const auth = requireAuth(req);
      const user = services.user.getForAuth(auth.userId);
      if (!user) return apiError(401, "Not authenticated");
      return apiSuccess({ user });
    }

    if (method === "POST" && pathname === "/api/auth/logout") {
      const auth = requireAuth(req);
      auditService.log(auth.userId, "LOGOUT", "user", auth.userId, "{}");
      return apiMessage("Logged out", 200);
    }

    const response = new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...getCorsHeaders() },
    });

    const duration = Date.now() - startTime;
    recordHttpRequest(method, pathname, response.status, duration);
    
    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    
    if (error instanceof HttpError) {
      const response = apiError(error.status, error.message);
      recordHttpRequest(method, pathname, error.status, duration);
      return response;
    }
    
    logError(error as Error, { method, pathname });
    const response = apiError(500, "Internal server error");
    recordHttpRequest(method, pathname, 500, duration);
    return response;
  }
}

function resolveStaticDistDir(): string {
  const candidates = [
    path.join(import.meta.dir, "..", "exampool", "dist"),
    path.join(import.meta.dir, "..", "exampool", "out"),
    path.join(import.meta.dir, "..", "dist"),
    path.join(import.meta.dir, "..", "out"),
  ];

  for (const dir of candidates) {
    if (existsSync(path.join(dir, "index.html"))) return dir;
  }
  return candidates[0];
}

const distDir = resolveStaticDistDir();

async function serveStatic(urlPath: string): Promise<Response> {
  const pathname = urlPath.split("?")[0] ?? "/";
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

  const resolvedDistDir = path.resolve(distDir);
  
  for (const filePath of candidates) {
    const resolvedFilePath = path.resolve(filePath);
    if (!resolvedFilePath.startsWith(resolvedDistDir + path.sep) && resolvedFilePath !== resolvedDistDir) {
      return apiError(403, "Forbidden");
    }
    try {
      const file = Bun.file(resolvedFilePath);
      if (await file.exists()) {
        return new Response(file, {
          headers: {
            "Content-Type": getMimeType(filePath),
            "Cache-Control": getCacheControl(filePath),
          },
        });
      }
    } catch {}
  }
  
  const indexFile = Bun.file(path.join(distDir, "index.html"));
  if (await indexFile.exists()) {
    return new Response(indexFile, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  }

  return apiError(404, "Not found");
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

function getCacheControl(filePath: string): string {
  if (filePath.includes("/_next/static/") || filePath.includes("\\_next\\static\\")) {
    return "public, max-age=31536000, immutable";
  }
  if (filePath.endsWith(".html") || filePath.endsWith(".txt") || filePath.endsWith(".rsc") || filePath.endsWith(".meta")) {
    return "no-store, no-cache, must-revalidate";
  }
  return "public, max-age=60, must-revalidate";
}

async function initializeApp(): Promise<void> {
  config.validate();
  
  const db = await import("./db").then(m => m.db);
  setDatabase(db);
  
  initializeServices(db);
  
  await connectRedis();
  await initializeSSEPubSub();
  await notificationService.initialize();
  
  auditService.log(0, "APP_START", "system", null, JSON.stringify({ version: config.env.npm_package_version || "1.0.0" }));
  
  log.info("Application initialized successfully");
}

async function shutdownApp(): Promise<void> {
  log.info("Shutting down...");
  await shutdownSSEPubSub();
  await disconnectRedis();
  log.info("Shutdown complete");
}

const server = serve({
  port: config.env.PORT || 8001,
  async fetch(req) {
    try {
      return await handleApi(req);
    } catch (error) {
      logError(error as Error, { url: req.url });
      return apiError(500, "Internal server error");
    }
  },
});

log.info(`Server running on port ${config.env.PORT || 8001}`);
log.info(`Health checks: http://localhost:${config.env.PORT || 8001}/health/live | /health/ready`);
log.info(`Metrics: http://localhost:${config.env.PORT || 8001}/metrics`);

await initializeApp();

process.on("SIGTERM", async () => {
  await shutdownApp();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await shutdownApp();
  process.exit(0);
});