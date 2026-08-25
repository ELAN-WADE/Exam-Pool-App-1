import { Database } from "bun:sqlite";
import { BaseRepository } from "./base.repository";
import type { AcademicSession, AcademicTerm, Term, Class, GradeLevel, ClassEnrollment, GuardianStudentLink, ClassTeacherAssignment, AcademicCalendarEvent } from "../types";

export class AcademicSessionRepository extends BaseRepository<AcademicSession, Partial<AcademicSession>, Partial<AcademicSession>> {
  constructor(db: Database) {
    super(db, "academic_sessions", ["id", "name", "is_active", "status", "created_at"]);
  }

  findActive(): AcademicSession | null {
    const row = this.db.prepare("SELECT * FROM academic_sessions WHERE is_active = 1 LIMIT 1").get() as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  activate(sessionId: number): void {
    this.db.exec("UPDATE academic_sessions SET is_active = 0");
    this.db.prepare("UPDATE academic_sessions SET is_active = 1 WHERE id = ?").run(sessionId);
  }

  deactivateAll(): void {
    this.db.exec("UPDATE academic_sessions SET is_active = 0");
  }

  findByName(name: string): AcademicSession | null {
    const row = this.db.prepare("SELECT * FROM academic_sessions WHERE name = ?").get(name) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }
}

export class AcademicTermRepository extends BaseRepository<AcademicTerm, Partial<AcademicTerm>, Partial<AcademicTerm>> {
  constructor(db: Database) {
    super(db, "academic_terms", ["id", "session_id", "name", "start_date", "end_date", "is_active", "status", "registration_open", "created_at"]);
  }

  findBySession(sessionId: number): AcademicTerm[] {
    const rows = this.db.prepare("SELECT * FROM academic_terms WHERE session_id = ? ORDER BY id").all(sessionId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findActive(): AcademicTerm | null {
    const row = this.db.prepare("SELECT * FROM academic_terms WHERE is_active = 1 LIMIT 1").get() as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  activate(termId: number): void {
    this.db.exec("UPDATE academic_terms SET is_active = 0");
    this.db.prepare("UPDATE academic_terms SET is_active = 1 WHERE id = ?").run(termId);
  }

  deactivateAll(): void {
    this.db.exec("UPDATE academic_terms SET is_active = 0");
  }

  endActiveTerm(): void {
    this.db.exec("UPDATE academic_terms SET is_active = 0, status = 'archived' WHERE is_active = 1");
  }

  findByNameAndSession(name: string, sessionId: number): AcademicTerm | null {
    const row = this.db.prepare("SELECT * FROM academic_terms WHERE name = ? AND session_id = ?").get(name, sessionId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }
}

export class TermRepository extends BaseRepository<Term, Partial<Term>, Partial<Term>> {
  constructor(db: Database) {
    super(db, "terms", ["id", "session", "name", "start_date", "end_date", "is_active", "registration_open", "created_at"]);
  }

  findActive(): Term | null {
    const row = this.db.prepare("SELECT * FROM terms WHERE is_active = 1 LIMIT 1").get() as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findBySession(session: string): Term[] {
    const rows = this.db.prepare("SELECT * FROM terms WHERE session = ? ORDER BY start_date").all(session) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }
}

export class ClassRepository extends BaseRepository<Class, Partial<Class>, Partial<Class>> {
  constructor(db: Database) {
    super(db, "classes", ["id", "name", "section", "level", "created_at", "class_teacher_id"]);
  }

  findByNameAndSection(name: string, section: string | null): Class | null {
    const row = this.db.prepare("SELECT * FROM classes WHERE name = ? AND (section = ? OR (section IS NULL AND ? IS NULL))").get(name, section, section) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByLevel(level: "junior" | "senior"): Class[] {
    const rows = this.db.prepare("SELECT * FROM classes WHERE level = ? ORDER BY name").all(level) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findWithTeacher(): (Class & { teacher_name?: string })[] {
    const rows = this.db.prepare(`
      SELECT c.*, u.name as teacher_name
      FROM classes c
      LEFT JOIN users u ON u.id = c.class_teacher_id
    `).all() as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  assignTeacher(classId: number, teacherId: number | null, assignedBy: number, action: "assigned" | "reassigned" | "unassigned", notes?: string): void {
    this.db.prepare("UPDATE classes SET class_teacher_id = ? WHERE id = ?").run(teacherId, classId);
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO class_teacher_assignments (class_id, teacher_id, assigned_by, action, assigned_at, notes) VALUES (?, ?, ?, ?, ?, ?)")
      .run(classId, teacherId, assignedBy, action, now, notes || null);
  }

  getTeacherAssignments(classId: number): ClassTeacherAssignment[] {
    const rows = this.db.prepare(`
      SELECT cta.*, u.name as teacher_name, au.name as assigned_by_name
      FROM class_teacher_assignments cta
      LEFT JOIN users u ON u.id = cta.teacher_id
      LEFT JOIN users au ON au.id = cta.assigned_by
      WHERE cta.class_id = ?
      ORDER BY cta.assigned_at DESC
    `).all(classId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }
}

export class GradeLevelRepository extends BaseRepository<GradeLevel, Partial<GradeLevel>, Partial<GradeLevel>> {
  constructor(db: Database) {
    super(db, "grade_levels", ["id", "name", "category", "sort_order", "is_active", "created_at"]);
  }

  findActive(): GradeLevel[] {
    const rows = this.db.prepare("SELECT * FROM grade_levels WHERE is_active = 1 ORDER BY sort_order").all() as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findByCategory(category: string): GradeLevel[] {
    const rows = this.db.prepare("SELECT * FROM grade_levels WHERE category = ? ORDER BY sort_order").all(category) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findByName(name: string): GradeLevel | null {
    const row = this.db.prepare("SELECT * FROM grade_levels WHERE name COLLATE NOCASE = ?").get(name) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findNext(sortOrder: number): GradeLevel | null {
    const row = this.db.prepare("SELECT * FROM grade_levels WHERE sort_order > ? ORDER BY sort_order ASC LIMIT 1").get(sortOrder) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  getByUserId(userId: number): GradeLevel | null {
    const row = this.db.prepare(`
      SELECT gl.* FROM grade_levels gl
      JOIN users u ON u.grade_level_id = gl.id
      WHERE u.id = ?
    `).get(userId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }
}

export class ClassEnrollmentRepository extends BaseRepository<ClassEnrollment, Partial<ClassEnrollment>, Partial<ClassEnrollment>> {
  constructor(db: Database) {
    super(db, "class_enrollments", ["id", "student_id", "class_id", "term_id", "enrollment_date"]);
  }

  findByStudent(studentId: number): ClassEnrollment[] {
    const rows = this.db.prepare("SELECT * FROM class_enrollments WHERE student_id = ?").all(studentId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findByClassAndTerm(classId: number, termId: number): ClassEnrollment[] {
    const rows = this.db.prepare("SELECT * FROM class_enrollments WHERE class_id = ? AND term_id = ?").all(classId, termId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findCurrentForStudent(studentId: number, termId: number): ClassEnrollment | null {
    const row = this.db.prepare("SELECT * FROM class_enrollments WHERE student_id = ? AND term_id = ? LIMIT 1").get(studentId, termId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  enroll(studentId: number, classId: number, termId: number): ClassEnrollment {
    const now = new Date().toISOString();
    const result = this.db.prepare("INSERT OR REPLACE INTO class_enrollments (student_id, class_id, term_id, enrollment_date) VALUES (?, ?, ?, ?)").run(studentId, classId, termId, now);
    const created = this.findById(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to enroll student in class");
    return created;
  }

  bulkEnroll(studentIds: number[], classId: number, termId: number): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare("INSERT OR REPLACE INTO class_enrollments (student_id, class_id, term_id, enrollment_date) VALUES (?, ?, ?, ?)");
    const tx = this.db.transaction((ids: number[]) => {
      for (const studentId of ids) {
        stmt.run(studentId, classId, termId, now);
      }
    });
    tx(studentIds);
  }
}

export class GuardianStudentLinkRepository extends BaseRepository<GuardianStudentLink, Partial<GuardianStudentLink>, Partial<GuardianStudentLink>> {
  constructor(db: Database) {
    super(db, "guardian_student_links", ["id", "guardian_id", "student_id", "relationship", "status", "verification_method", "verified_by_data", "verified_by", "verified_at", "created_at"]);
  }

  findByGuardian(guardianId: number): GuardianStudentLink[] {
    const rows = this.db.prepare("SELECT * FROM guardian_student_links WHERE guardian_id = ?").all(guardianId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findByStudent(studentId: number): GuardianStudentLink[] {
    const rows = this.db.prepare("SELECT * FROM guardian_student_links WHERE student_id = ?").all(studentId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findPendingByGuardian(guardianId: number): GuardianStudentLink[] {
    const rows = this.db.prepare("SELECT * FROM guardian_student_links WHERE guardian_id = ? AND status = 'pending'").all(guardianId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  approve(linkId: number, verifiedBy: number, method: "manual_admin" | "dob_match" | "pin_match", data?: string): GuardianStudentLink | null {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE guardian_student_links SET status = 'approved', verification_method = ?, verified_by = ?, verified_by_data = ?, verified_at = ? WHERE id = ?")
      .run(method, verifiedBy, data || null, now, linkId);
    return this.findById(linkId);
  }

  reject(linkId: number): GuardianStudentLink | null {
    this.db.prepare("UPDATE guardian_student_links SET status = 'rejected' WHERE id = ?").run(linkId);
    return this.findById(linkId);
  }
}

export class ClassTeacherAssignmentRepository extends BaseRepository<ClassTeacherAssignment, Partial<ClassTeacherAssignment>, Partial<ClassTeacherAssignment>> {
  constructor(db: Database) {
    super(db, "class_teacher_assignments", ["id", "class_id", "teacher_id", "assigned_by", "action", "assigned_at", "notes"]);
  }

  findAll(): ClassTeacherAssignment[] {
    const rows = this.db.prepare(`
      SELECT cta.*, c.name as class_name, c.section as class_section, u.name as teacher_name, au.name as assigned_by_name
      FROM class_teacher_assignments cta
      JOIN classes c ON c.id = cta.class_id
      LEFT JOIN users u ON u.id = cta.teacher_id
      LEFT JOIN users au ON au.id = cta.assigned_by
      ORDER BY cta.assigned_at DESC
    `).all() as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }
}

export class AcademicCalendarEventRepository extends BaseRepository<AcademicCalendarEvent, Partial<AcademicCalendarEvent>, Partial<AcademicCalendarEvent>> {
  constructor(db: Database) {
    super(db, "academic_calendar_events", ["id", "term_id", "title", "description", "start_date", "end_date", "type", "created_by", "created_at"]);
  }

  findByTerm(termId: number): AcademicCalendarEvent[] {
    const rows = this.db.prepare("SELECT * FROM academic_calendar_events WHERE term_id = ? ORDER BY start_date").all(termId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findUpcoming(termId: number, limit = 10): AcademicCalendarEvent[] {
    const rows = this.db.prepare("SELECT * FROM academic_calendar_events WHERE term_id = ? AND start_date >= date('now') ORDER BY start_date LIMIT ?").all(termId, limit) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }
}