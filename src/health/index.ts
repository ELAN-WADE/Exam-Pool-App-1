import { Database } from "bun:sqlite";
import { checkRedisHealth, isRedisConnected } from "../redis/client";
import { log } from "../logging";
import { config } from "../config";

export interface HealthCheckResult {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime: number;
  version: string;
  checks: Record<string, HealthCheckDetail>;
}

export interface HealthCheckDetail {
  status: "healthy" | "degraded" | "unhealthy";
  latency?: number;
  details?: string;
  critical?: boolean;
}

let startTime = Date.now();
let dbInstance: Database | null = null;

export function setDatabase(db: Database): void {
  dbInstance = db;
}

export function getUptime(): number {
  return Date.now() - startTime;
}

export async function checkDatabaseHealth(): Promise<HealthCheckDetail> {
  if (!dbInstance) {
    return {
      status: "unhealthy",
      details: "Database not initialized",
      critical: true,
    };
  }

  const start = Date.now();
  try {
    dbInstance.prepare("SELECT 1").get();
    const latency = Date.now() - start;
    
    if (latency > 50) {
      return {
        status: "degraded",
        latency,
        details: `Database query took ${latency}ms`,
        critical: true,
      };
    }
    
    return {
      status: "healthy",
      latency,
      details: "Database responding normally",
      critical: true,
    };
  } catch (error) {
    return {
      status: "unhealthy",
      details: `Database error: ${error instanceof Error ? error.message : "unknown"}`,
      critical: true,
    };
  }
}

export async function checkRedisHealthWrapper(): Promise<HealthCheckDetail> {
  if (!config.env.REDIS_HOST && !process.env.REDIS_HOST) {
    return {
      status: "healthy",
      details: "Redis not configured (optional)",
      critical: false,
    };
  }

  const result = await checkRedisHealth();
  
  return {
    status: result.status,
    latency: result.latency,
    details: result.details,
    critical: false,
  };
}

export async function checkMemoryHealth(): Promise<HealthCheckDetail> {
  const used = process.memoryUsage();
  const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
  const rssMB = Math.round(used.rss / 1024 / 1024);
  
  const heapUsagePercent = (used.heapUsed / used.heapTotal) * 100;
  
  let status: "healthy" | "degraded" | "unhealthy" = "healthy";
  if (heapUsagePercent > 90) status = "unhealthy";
  else if (heapUsagePercent > 75) status = "degraded";

  return {
    status,
    details: `Heap: ${heapUsedMB}MB/${heapTotalMB}MB (${heapUsagePercent.toFixed(1)}%), RSS: ${rssMB}MB`,
    critical: false,
  };
}

export async function checkDiskHealth(): Promise<HealthCheckDetail> {
  try {
    const dbPath = config.env.EXAMPOOL_DB || "exampool.db";
    const file = Bun.file(dbPath);
    const exists = await file.exists();
    
    if (!exists) {
      return {
        status: "unhealthy",
        details: "Database file not found",
        critical: true,
      };
    }
    
    const stats = await file.stat();
    const sizeMB = Math.round(stats.size / 1024 / 1024);
    
    return {
      status: "healthy",
      details: `Database file: ${sizeMB}MB`,
      critical: true,
    };
  } catch (error) {
    return {
      status: "degraded",
      details: `Disk check failed: ${error instanceof Error ? error.message : "unknown"}`,
      critical: true,
    };
  }
}

export async function getHealthStatus(ready = false): Promise<HealthCheckResult> {
  const checks = await Promise.allSettled([
    checkDatabaseHealth(),
    checkRedisHealthWrapper(),
    checkMemoryHealth(),
    ready ? checkDiskHealth() : Promise.resolve({ status: "healthy" as const, details: "Skipped for liveness", critical: false }),
  ]);

  const checkResults: Record<string, HealthCheckDetail> = {
    database: checks[0].status === "fulfilled" ? checks[0].value : { status: "unhealthy", details: "Check failed" },
    redis: checks[1].status === "fulfilled" ? checks[1].value : { status: "unhealthy", details: "Check failed" },
    memory: checks[2].status === "fulfilled" ? checks[2].value : { status: "unhealthy", details: "Check failed" },
    disk: checks[3].status === "fulfilled" ? checks[3].value : { status: "healthy", details: "Skipped" },
  };

  const criticalFailures = Object.values(checkResults).filter(c => c.critical && c.status === "unhealthy").length;
  const degradedCount = Object.values(checkResults).filter(c => c.status === "degraded").length;

  let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";
  if (criticalFailures > 0) overallStatus = "unhealthy";
  else if (degradedCount > 0) overallStatus = "degraded";

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: getUptime(),
    version: config.env.npm_package_version || "1.0.0",
    checks: checkResults,
  };
}

export async function getLivenessStatus(): Promise<HealthCheckResult> {
  return getHealthStatus(false);
}

export async function getReadinessStatus(): Promise<HealthCheckResult> {
  return getHealthStatus(true);
}