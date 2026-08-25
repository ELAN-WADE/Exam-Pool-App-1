import pino from "pino";
import { config } from "../config";

const env = config.env;

const logLevel = env.LOG_LEVEL || (env.NODE_ENV === "production" ? "info" : "debug");

const prettyPrint = env.NODE_ENV !== "production";

const logger = pino({
  level: logLevel,
  transport: prettyPrint ? {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname",
    },
  } : undefined,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: "exampool",
    environment: env.NODE_ENV,
  },
  redact: {
    paths: [
      "*.password",
      "*.password_hash",
      "*.token",
      "*.authorization",
      "*.cookie",
      "*.set-cookie",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
});

export const log = logger;

export function createChildLogger(bindings: Record<string, any>): pino.Logger {
  return logger.child(bindings);
}

export const auditLog = logger.child({ category: "audit" });
export const accessLog = logger.child({ category: "access" });
export const errorLog = logger.child({ category: "error" });
export const dbLog = logger.child({ category: "database" });
export const authLog = logger.child({ category: "auth" });
export const sseLog = logger.child({ category: "sse" });
export const rateLimitLog = logger.child({ category: "ratelimit" });

export function logRequest(req: Request, res: Response, startTime: number): void {
  const duration = Date.now() - startTime;
  accessLog.info({
    method: req.method,
    url: req.url,
    status: res.status,
    durationMs: duration,
    ip: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown",
    userAgent: req.headers.get("user-agent"),
  }, "HTTP Request");
}

export function logError(error: Error, context?: Record<string, any>): void {
  errorLog.error({
    err: {
      message: error.message,
      stack: error.stack,
      name: error.name,
    },
    ...context,
  }, "Application Error");
}

export function logAudit(
  actorId: number,
  action: string,
  resource: string,
  resourceId: number | null,
  details: string
): void {
  auditLog.info({
    actorId,
    action,
    resource,
    resourceId,
    details,
    timestamp: new Date().toISOString(),
  }, "Audit Event");
}

export function logAuthEvent(
  event: "login" | "logout" | "register" | "password_reset" | "token_refresh" | "failed_login",
  userId: number | null,
  success: boolean,
  details?: Record<string, any>
): void {
  authLog[success ? "info" : "warn"]({
    event,
    userId,
    success,
    ...details,
  }, `Auth Event: ${event}`);
}

export function logSSEEvent(
  event: "connect" | "disconnect" | "message" | "error",
  userId: number,
  details?: Record<string, any>
): void {
  sseLog.info({
    event,
    userId,
    ...details,
  }, `SSE Event: ${event}`);
}

export function logRateLimit(
  identifier: string,
  allowed: boolean,
  limit: number,
  remaining: number,
  windowMs: number
): void {
  rateLimitLog[allowed ? "debug" : "warn"]({
    identifier,
    allowed,
    limit,
    remaining,
    windowMs,
  }, `Rate Limit: ${allowed ? "allowed" : "exceeded"}`);
}