import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";
import { log } from "../logging";

const register = new Registry();

register.setDefaultLabels({
  app: "exampool",
});

collectDefaultMetrics({ register, prefix: "exampool_" });

export const httpRequestsTotal = new Counter({
  name: "exampool_http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "path", "status"],
  registers: [register],
});

export const httpRequestDuration = new Histogram({
  name: "exampool_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "path"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const httpRequestSize = new Histogram({
  name: "exampool_http_request_size_bytes",
  help: "HTTP request size in bytes",
  labelNames: ["method", "path"],
  buckets: [100, 1000, 10000, 100000, 1000000],
  registers: [register],
});

export const httpResponseSize = new Histogram({
  name: "exampool_http_response_size_bytes",
  help: "HTTP response size in bytes",
  labelNames: ["method", "path"],
  buckets: [100, 1000, 10000, 100000, 1000000],
  registers: [register],
});

export const activeSSEConnections = new Gauge({
  name: "exampool_sse_connections_active",
  help: "Number of active SSE connections",
  labelNames: ["type"],
  registers: [register],
});

export const activeUsers = new Gauge({
  name: "exampool_users_active",
  help: "Number of active users",
  registers: [register],
});

export const rateLimitExceeded = new Counter({
  name: "exampool_rate_limit_exceeded_total",
  help: "Total number of rate limit exceeded events",
  labelNames: ["endpoint", "identifier"],
  registers: [register],
});

export const authEvents = new Counter({
  name: "exampool_auth_events_total",
  help: "Total number of auth events",
  labelNames: ["event", "success"],
  registers: [register],
});

export const examEvents = new Counter({
  name: "exampool_exam_events_total",
  help: "Total number of exam events",
  labelNames: ["event", "status"],
  registers: [register],
});

export const examDuration = new Histogram({
  name: "exampool_exam_duration_seconds",
  help: "Exam duration in seconds",
  labelNames: ["subject_id", "status"],
  buckets: [60, 300, 600, 1800, 3600, 7200],
  registers: [register],
});

export const databaseQueries = new Histogram({
  name: "exampool_database_query_duration_seconds",
  help: "Database query duration in seconds",
  labelNames: ["operation", "table"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

export const databaseErrors = new Counter({
  name: "exampool_database_errors_total",
  help: "Total number of database errors",
  labelNames: ["operation", "table", "error"],
  registers: [register],
});

export const cacheHits = new Counter({
  name: "exampool_cache_hits_total",
  help: "Total number of cache hits",
  labelNames: ["cache_type"],
  registers: [register],
});

export const cacheMisses = new Counter({
  name: "exampool_cache_misses_total",
  help: "Total number of cache misses",
  labelNames: ["cache_type"],
  registers: [register],
});

export const gradingOperations = new Counter({
  name: "exampool_grading_operations_total",
  help: "Total number of grading operations",
  labelNames: ["operation", "status"],
  registers: [register],
});

export const notificationSent = new Counter({
  name: "exampool_notifications_sent_total",
  help: "Total number of notifications sent",
  labelNames: ["type", "channel"],
  registers: [register],
});

export const backgroundJobDuration = new Histogram({
  name: "exampool_background_job_duration_seconds",
  help: "Background job duration in seconds",
  labelNames: ["job", "status"],
  buckets: [1, 5, 10, 30, 60, 300, 600, 1800, 3600],
  registers: [register],
});

export function recordHttpRequest(
  method: string,
  path: string,
  status: number,
  durationMs: number,
  requestSize?: number,
  responseSize?: number
): void {
  const normalizedPath = normalizePath(path);
  
  httpRequestsTotal.inc({ method, path: normalizedPath, status: String(status) });
  httpRequestDuration.observe({ method, path: normalizedPath }, durationMs / 1000);
  
  if (requestSize) {
    httpRequestSize.observe({ method, path: normalizedPath }, requestSize);
  }
  if (responseSize) {
    httpResponseSize.observe({ method, path: normalizedPath }, responseSize);
  }
}

function normalizePath(path: string): string {
  return path
    .replace(/\/api\/exams\/\d+/g, "/api/exams/:id")
    .replace(/\/api\/subjects\/\d+/g, "/api/subjects/:id")
    .replace(/\/api\/users\/\d+/g, "/api/users/:id")
    .replace(/\/api\/grading\/\w+\/\d+/g, "/api/grading/:type/:id")
    .replace(/\?.*$/, "");
}

export function recordSSEConnection(type: "user" | "operator" | "total", count: number): void {
  activeSSEConnections.set({ type }, count);
}

export function recordRateLimitExceeded(endpoint: string, identifier: string): void {
  rateLimitExceeded.inc({ endpoint, identifier: hashIdentifier(identifier) });
}

function hashIdentifier(identifier: string): string {
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    hash = ((hash << 5) - hash) + identifier.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function recordAuthEvent(event: string, success: boolean): void {
  authEvents.inc({ event, success: String(success) });
}

export function recordExamEvent(event: string, status: string): void {
  examEvents.inc({ event, status });
}

export function recordExamDuration(subjectId: number, status: string, durationMs: number): void {
  examDuration.observe({ subject_id: String(subjectId), status }, durationMs / 1000);
}

export function recordDatabaseQuery(operation: string, table: string, durationMs: number): void {
  databaseQueries.observe({ operation, table }, durationMs / 1000);
}

export function recordDatabaseError(operation: string, table: string, error: string): void {
  databaseErrors.inc({ operation, table, error: error.substring(0, 50) });
}

export function recordCacheHit(cacheType: string): void {
  cacheHits.inc({ cache_type: cacheType });
}

export function recordCacheMiss(cacheType: string): void {
  cacheMisses.inc({ cache_type: cacheType });
}

export function recordGradingOperation(operation: string, status: string): void {
  gradingOperations.inc({ operation, status });
}

export function recordNotificationSent(type: string, channel: "sse" | "db"): void {
  notificationSent.inc({ type, channel });
}

export function recordBackgroundJob(job: string, status: "success" | "failure", durationMs: number): void {
  backgroundJobDuration.observe({ job, status }, durationMs / 1000);
}

export function getMetrics(): Promise<string> {
  return register.metrics();
}

export function getMetricsContentType(): string {
  return register.contentType;
}

export function getMetricsAsJSON(): Promise<any> {
  return register.getMetricsAsJSON();
}

export const metricsRegistry = register;