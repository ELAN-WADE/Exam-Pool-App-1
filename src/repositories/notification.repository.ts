import { Database } from "bun:sqlite";
import { BaseRepository } from "./base.repository";
import type { Notification, StudentTermRemark, AuditLog, Settings, Config } from "../types";

export class NotificationRepository extends BaseRepository<Notification, Partial<Notification>, Partial<Notification>> {
  constructor(db: Database) {
    super(db, "notifications", ["id", "user_id", "type", "message", "link", "is_read", "created_at"]);
  }

  findByUser(userId: number, limit = 50): Notification[] {
    const rows = this.db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, limit) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findUnreadCount(userId: number): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0").get(userId) as { count: number };
    return row.count;
  }

  markAllRead(userId: number): void {
    this.db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?").run(userId);
  }

  createForUser(userId: number, type: string, message: string, link?: string): Notification {
    const now = new Date().toISOString();
    const result = this.db.prepare("INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?)").run(userId, type, message, link || null, now);
    const created = this.findById(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to create notification");
    return created;
  }

  createForOperators(type: string, message: string, link?: string): void {
    const operators = this.db.prepare("SELECT id FROM users WHERE role = 'operator'").all() as Array<{ id: number }>;
    const now = new Date().toISOString();
    const stmt = this.db.prepare("INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?)");
    const tx = this.db.transaction((ops: typeof operators) => {
      for (const op of ops) {
        stmt.run(op.id, type, message, link || null, now);
      }
    });
    tx(operators);
  }
}

export class StudentTermRemarkRepository extends BaseRepository<StudentTermRemark, Partial<StudentTermRemark>, Partial<StudentTermRemark>> {
  constructor(db: Database) {
    super(db, "student_term_remarks", ["id", "student_id", "term", "teacher_remark", "principal_remark", "updated_at", "session_id", "term_id"]);
  }

  findByStudentTerm(studentId: number, sessionId: number, termId: number): StudentTermRemark | null {
    const row = this.db.prepare("SELECT * FROM student_term_remarks WHERE student_id = ? AND session_id = ? AND term_id = ?").get(studentId, sessionId, termId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByStudent(studentId: number): StudentTermRemark[] {
    const rows = this.db.prepare("SELECT * FROM student_term_remarks WHERE student_id = ? ORDER BY updated_at DESC").all(studentId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  upsertTeacherRemark(studentId: number, sessionId: number, termId: number, remark: string | null): void {
    const now = new Date().toISOString();
    const uniqueTermStr = `${sessionId}-${termId}`;
    this.db.prepare(`
      INSERT INTO student_term_remarks (student_id, term, teacher_remark, updated_at, session_id, term_id)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(student_id, session_id, term_id) DO UPDATE SET
        teacher_remark = excluded.teacher_remark,
        updated_at = excluded.updated_at
    `).run(studentId, uniqueTermStr, remark, now, sessionId, termId);
  }

  upsertPrincipalRemark(studentId: number, sessionId: number, termId: number, remark: string | null): void {
    const now = new Date().toISOString();
    const uniqueTermStr = `${sessionId}-${termId}`;
    this.db.prepare(`
      INSERT INTO student_term_remarks (student_id, term, principal_remark, updated_at, session_id, term_id)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(student_id, session_id, term_id) DO UPDATE SET
        principal_remark = excluded.principal_remark,
        updated_at = excluded.updated_at
    `).run(studentId, uniqueTermStr, remark, now, sessionId, termId);
  }
}

export class AuditRepository {
  constructor(private db: Database) {}

  log(actorId: number, action: string, resource: string, resourceId: number | null, details: string): void {
    const now = new Date().toISOString();
    try {
      this.db.prepare("INSERT INTO audit_logs (actor_id, action, resource, resource_id, details, timestamp) VALUES (?, ?, ?, ?, ?, ?)")
        .run(actorId, action, resource, resourceId, details, now);
    } catch (e) {
      console.error("[Audit] Failed to write audit log:", e);
    }
  }

  findByActor(actorId: number, limit = 100): AuditLog[] {
    const rows = this.db.prepare("SELECT * FROM audit_logs WHERE actor_id = ? ORDER BY timestamp DESC LIMIT ?").all(actorId, limit) as Record<string, unknown>[];
    return rows.map(r => ({
      id: Number(r.id),
      timestamp: String(r.timestamp),
      actor_id: Number(r.actor_id),
      action: String(r.action),
      resource: String(r.resource),
      resource_id: r.resource_id ? Number(r.resource_id) : null,
      details: String(r.details)
    }));
  }

  findByResource(resource: string, resourceId: number, limit = 50): AuditLog[] {
    const rows = this.db.prepare("SELECT * FROM audit_logs WHERE resource = ? AND resource_id = ? ORDER BY timestamp DESC LIMIT ?").all(resource, resourceId, limit) as Record<string, unknown>[];
    return rows.map(r => ({
      id: Number(r.id),
      timestamp: String(r.timestamp),
      actor_id: Number(r.actor_id),
      action: String(r.action),
      resource: String(r.resource),
      resource_id: r.resource_id ? Number(r.resource_id) : null,
      details: String(r.details)
    }));
  }

  findRecent(limit = 100): AuditLog[] {
    const rows = this.db.prepare("SELECT al.*, u.name as actor_name FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_id ORDER BY al.timestamp DESC LIMIT ?").all(limit) as Record<string, unknown>[];
    return rows.map(r => ({
      id: Number(r.id),
      timestamp: String(r.timestamp),
      actor_id: Number(r.actor_id),
      action: String(r.action),
      resource: String(r.resource),
      resource_id: r.resource_id ? Number(r.resource_id) : null,
      details: String(r.details)
    }));
  }
}

export class SettingsRepository {
  constructor(private db: Database) {}

  get(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value?: string } | undefined;
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))").run(key, value);
  }

  getAll(): Settings[] {
    const rows = this.db.prepare("SELECT * FROM settings").all() as Record<string, unknown>[];
    return rows.map(r => ({
      key: String(r.key),
      value: String(r.value),
      updated_at: String(r.updated_at)
    }));
  }

  getRegistrationOpen(): boolean {
    return this.get("REGISTRATION_OPEN") === "true";
  }

  setRegistrationOpen(open: boolean): void {
    this.set("REGISTRATION_OPEN", open ? "true" : "false");
  }

  getCurrentTerm(): string {
    return this.get("CURRENT_TERM") || "2026-T1";
  }

  setCurrentTerm(term: string): void {
    this.set("CURRENT_TERM", term);
  }
}

export class ConfigRepository {
  constructor(private db: Database) {}

  get(): Config | null {
    const row = this.db.prepare("SELECT * FROM config WHERE id = 1").get() as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  private mapRow(row: Record<string, unknown>): Config {
    return {
      id: Number(row.id),
      description: row.description ? String(row.description) : null,
      favicon: row.favicon ? String(row.favicon) : null,
      admin_name: row.admin_name ? String(row.admin_name) : null,
      org_name: String(row.org_name),
      licence_key: row.licence_key ? String(row.licence_key) : null,
      licence_type: (row.licence_type as "basic" | "standard" | "premium") || "basic",
      theme_json: String(row.theme_json),
      version: String(row.version),
      admin_email: row.admin_email ? String(row.admin_email) : null,
      admin_password_hash: row.admin_password_hash ? String(row.admin_password_hash) : null,
      updated_at: String(row.updated_at),
      grading_config_json: row.grading_config_json ? String(row.grading_config_json) : null
    };
  }

  update(data: Partial<Config>): Config {
    const allowedFields = ["description", "favicon", "admin_name", "org_name", "licence_key", "licence_type", "theme_json", "version", "admin_email", "admin_password_hash", "grading_config_json"];
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const key of allowedFields) {
      if (key in data) {
        updates.push(`${key} = ?`);
        values.push((data as Record<string, unknown>)[key]);
      }
    }
    if (updates.length > 0) {
      updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')");
      values.push(1);
      this.db.prepare(`UPDATE config SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    }
    return this.get()!;
  }

  getPublic(): { org_name: string; current_term: string; admin_name: string; favicon?: string } {
    const settings = new SettingsRepository(this.db);
    return {
      org_name: this.get()?.org_name || "ExamPool School",
      current_term: settings.getCurrentTerm(),
      admin_name: this.get()?.admin_name || "Administrator",
      favicon: this.get()?.favicon
    };
  }
}