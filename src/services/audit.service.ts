import { Database } from "bun:sqlite";
import { AuditRepository } from "../repositories/notification.repository";
import type { AuditLog } from "../types";

export class AuditService {
  private auditRepo: AuditRepository;
  private logBuffer: Array<{ ts: string; level: "info" | "warn" | "error"; msg: string }> = [];
  private readonly LOG_BUFFER_MAX = 200;

  constructor(db: Database) {
    this.auditRepo = new AuditRepository(db);
    this.setupConsoleIntercept();
  }

  private setupConsoleIntercept(): void {
    const originalLog = console.log.bind(console);
    const originalWarn = console.warn.bind(console);
    const originalError = console.error.bind(console);

    console.log = (...args: any[]) => {
      originalLog(...args);
      this.pushLog("info", args);
    };
    console.warn = (...args: any[]) => {
      originalWarn(...args);
      this.pushLog("warn", args);
    };
    console.error = (...args: any[]) => {
      originalError(...args);
      this.pushLog("error", args);
    };
  }

  private pushLog(level: "info" | "warn" | "error", args: any[]): void {
    const msg = args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    this.logBuffer.push({ ts: new Date().toISOString(), level, msg });
    if (this.logBuffer.length > this.LOG_BUFFER_MAX) this.logBuffer.shift();
  }

  log(actorId: number, action: string, resource: string, resourceId: number | null, details: string): void {
    const aid = typeof actorId === "bigint" ? Number(actorId) : actorId;
    const rid = resourceId == null ? null : (typeof resourceId === "bigint" ? Number(resourceId) : resourceId);

    if (!Number.isFinite(aid)) {
      console.warn("[audit] Invalid actor_id", actorId);
      return;
    }
    if (resourceId != null && !Number.isFinite(rid as number)) {
      console.warn("[audit] Invalid resource_id", resourceId);
      return;
    }

    try {
      this.auditRepo.log(aid, action, resource, rid, details);
    } catch (e) {
      console.error("[audit] Failed to write audit log:", action, e);
    }
  }

  getLogs(tail = 100, level?: string): Array<{ ts: string; level: "info" | "warn" | "error"; msg: string }> {
    let logs = [...this.logBuffer].slice(-tail);
    if (level) {
      logs = logs.filter(l => l.level === level);
    }
    return logs;
  }

  getAuditLogs(actorId?: number, resource?: string, resourceId?: number, limit = 100): AuditLog[] {
    if (actorId) return this.auditRepo.findByActor(actorId, limit);
    if (resource && resourceId) return this.auditRepo.findByResource(resource, resourceId, limit);
    return this.auditRepo.findRecent(limit);
  }
}

export const auditService = new AuditService(null as any);