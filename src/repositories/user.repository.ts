import { Database } from "bun:sqlite";
import { BaseRepository } from "./base.repository";
import type { User, SafeUser, Role } from "../types";

export class UserRepository extends BaseRepository<User, Partial<User>, Partial<User>> {
  constructor(db: Database) {
    super(db, "users", [
      "id", "name", "email", "role", "password_hash", "grade", "reg_id",
      "first_name", "last_name", "address", "phone", "dob", "image_url",
      "avatar_url", "is_active", "session_id", "term_id", "grade_level_id", "created_at"
    ]);
  }

  findByEmail(email: string): User | null {
    const row = this.db.prepare("SELECT u.*, gl.name as grade_level_name FROM users u LEFT JOIN grade_levels gl ON u.grade_level_id = gl.id WHERE u.email = ?").get(email) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByEmailOrReg(identifier: string): User | null {
    const row = this.db.prepare("SELECT u.*, gl.name as grade_level_name FROM users u LEFT JOIN grade_levels gl ON u.grade_level_id = gl.id WHERE u.email = ? OR u.reg_id = ?").get(identifier, identifier) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByRegId(regId: string): User | null {
    const row = this.db.prepare("SELECT u.*, gl.name as grade_level_name FROM users u LEFT JOIN grade_levels gl ON u.grade_level_id = gl.id WHERE u.reg_id = ?").get(regId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByRole(role: Role): User[] {
    const rows = this.db.prepare("SELECT u.*, gl.name as grade_level_name FROM users u LEFT JOIN grade_levels gl ON u.grade_level_id = gl.id WHERE u.role = ?").all(role) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findActiveByRole(role: Role): User[] {
    const rows = this.db.prepare("SELECT u.*, gl.name as grade_level_name FROM users u LEFT JOIN grade_levels gl ON u.grade_level_id = gl.id WHERE u.role = ? AND u.is_active = 1").all(role) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findStudentsByGradeLevel(gradeLevelId: number): User[] {
    const rows = this.db.prepare("SELECT u.*, gl.name as grade_level_name FROM users u LEFT JOIN grade_levels gl ON u.grade_level_id = gl.id WHERE u.role = 'student' AND u.grade_level_id = ? AND u.is_active = 1").all(gradeLevelId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findStudentsByClass(classId: number, termId: number): User[] {
    const rows = this.db.prepare(`
      SELECT u.*, gl.name as grade_level_name
      FROM users u
      LEFT JOIN grade_levels gl ON u.grade_level_id = gl.id
      JOIN class_enrollments ce ON ce.student_id = u.id
      WHERE ce.class_id = ? AND ce.term_id = ? AND u.is_active = 1
    `).all(classId, termId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findClassTeacher(classId: number): User | null {
    const row = this.db.prepare(`
      SELECT u.*, gl.name as grade_level_name
      FROM users u
      LEFT JOIN grade_levels gl ON u.grade_level_id = gl.id
      JOIN classes c ON c.class_teacher_id = u.id
      WHERE c.id = ? AND u.role = 'teacher' AND u.is_active = 1
    `).get(classId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  getUserForAuth(userId: number): SafeUser | null {
    const row = this.db.prepare(`
      SELECT u.*, gl.name as grade_level_name,
             CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END as is_class_teacher,
             c.id as assigned_class_id,
             c.name as assigned_class_name,
             c.section as assigned_class_section
      FROM users u
      LEFT JOIN grade_levels gl ON u.grade_level_id = gl.id
      LEFT JOIN classes c ON c.class_teacher_id = u.id
      WHERE u.id = ? AND u.is_active = 1
    `).get(userId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const { password_hash, dob, phone, ...safe } = row;
    return safe as SafeUser;
  }

  updatePassword(userId: number, passwordHash: string): boolean {
    const result = this.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
    return result.changes > 0;
  }

  updateProfile(userId: number, data: Partial<User>): User | null {
    const allowedFields = ["name", "email", "first_name", "last_name", "address", "phone", "dob", "image_url", "avatar_url", "grade", "grade_level_id"];
    const filtered: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (key in data) filtered[key] = (data as Record<string, unknown>)[key];
    }
    if (Object.keys(filtered).length === 0) return this.findById(userId);
    const setClause = Object.keys(filtered).map(k => `${k} = ?`).join(", ");
    const values = [...Object.values(filtered), userId];
    this.db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).run(...values);
    return this.findById(userId);
  }

  activate(userId: number): boolean {
    const result = this.db.prepare("UPDATE users SET is_active = 1 WHERE id = ?").run(userId);
    return result.changes > 0;
  }

  deactivate(userId: number): boolean {
    const result = this.db.prepare("UPDATE users SET is_active = 0 WHERE id = ?").run(userId);
    return result.changes > 0;
  }

  updateGradeLevel(userId: number, gradeLevelId: number): boolean {
    const result = this.db.prepare("UPDATE users SET grade_level_id = ? WHERE id = ?").run(gradeLevelId, userId);
    return result.changes > 0;
  }

  countByRole(role: Role): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM users WHERE role = ? AND is_active = 1").get(role) as { count: number };
    return row.count;
  }
}