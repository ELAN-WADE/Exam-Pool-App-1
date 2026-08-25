import { Database } from "bun:sqlite";
import { BaseRepository } from "./base.repository";
import type { GradingSubject, GradingPolicy, GradingManualScore, TermResult, AnnualResult, GradingConfig } from "../types";

export class GradingSubjectRepository extends BaseRepository<GradingSubject, Partial<GradingSubject>, Partial<GradingSubject>> {
  constructor(db: Database) {
    super(db, "grading_subjects", ["id", "name", "code", "class_id", "term_id", "session_id", "teacher_id", "created_at", "mode", "source_cbt_subject_id", "pass_mark"]);
  }

  findByTeacher(teacherId: number, termId?: number): GradingSubject[] {
    let query = "SELECT * FROM grading_subjects WHERE teacher_id = ?";
    const params: (number | string)[] = [teacherId];
    if (termId) {
      query += " AND term_id = ?";
      params.push(termId);
    }
    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findByTerm(termId: number): GradingSubject[] {
    const rows = this.db.prepare("SELECT * FROM grading_subjects WHERE term_id = ?").all(termId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findBySourceCbtSubject(sourceCbtSubjectId: number, termId: number): GradingSubject | null {
    const row = this.db.prepare("SELECT * FROM grading_subjects WHERE source_cbt_subject_id = ? AND term_id = ?").get(sourceCbtSubjectId, termId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByTeacherCodeTerm(teacherId: number, code: string, termId: number): GradingSubject | null {
    const row = this.db.prepare("SELECT * FROM grading_subjects WHERE teacher_id = ? AND code = ? AND term_id = ?").get(teacherId, code, termId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findAllWithDetails(termId: number): (GradingSubject & { teacher_name?: string; class_name?: string; session_name?: string; term_name?: string })[] {
    const rows = this.db.prepare(`
      SELECT gs.*, u.name as teacher_name, c.name as class_name, acs.name as session_name, at.name as term_name
      FROM grading_subjects gs
      LEFT JOIN users u ON u.id = gs.teacher_id
      LEFT JOIN classes c ON c.id = gs.class_id
      LEFT JOIN academic_sessions acs ON acs.id = gs.session_id
      LEFT JOIN academic_terms at ON at.id = gs.term_id
      WHERE gs.term_id = ?
      ORDER BY gs.id
    `).all(termId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  updateMeta(id: number, mode: string, sourceCbtSubjectId: number | null): GradingSubject | null {
    this.db.prepare("UPDATE grading_subjects SET mode = ?, source_cbt_subject_id = ? WHERE id = ?").run(mode, sourceCbtSubjectId, id);
    return this.findById(id);
  }
}

export class GradingPolicyRepository extends BaseRepository<GradingPolicy, Partial<GradingPolicy>, Partial<GradingPolicy>> {
  constructor(db: Database) {
    super(db, "grading_policies", ["id", "grading_subject_id", "name", "type", "mapped_cbt_subject_id", "max_marks", "is_exam", "created_at"]);
  }

  findBySubject(subjectId: number): GradingPolicy[] {
    const rows = this.db.prepare("SELECT * FROM grading_policies WHERE grading_subject_id = ?").all(subjectId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findExamPolicy(subjectId: number): GradingPolicy | null {
    const row = this.db.prepare("SELECT * FROM grading_policies WHERE grading_subject_id = ? AND is_exam = 1 LIMIT 1").get(subjectId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findCaPolicies(subjectId: number): GradingPolicy[] {
    const rows = this.db.prepare("SELECT * FROM grading_policies WHERE grading_subject_id = ? AND is_exam = 0").all(subjectId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  deletePoliciesNotInList(subjectId: number, keepIds: number[]): void {
    if (keepIds.length === 0) {
      this.db.prepare("DELETE FROM grading_policies WHERE grading_subject_id = ?").run(subjectId);
    } else {
      const placeholders = keepIds.map(() => "?").join(",");
      this.db.prepare(`DELETE FROM grading_policies WHERE grading_subject_id = ? AND id NOT IN (${placeholders})`).run(subjectId, ...keepIds);
    }
  }

  updatePassMark(subjectId: number, passMark: number | null): void {
    this.db.prepare("UPDATE grading_subjects SET pass_mark = ? WHERE id = ?").run(passMark, subjectId);
  }
}

export class GradingManualScoreRepository extends BaseRepository<GradingManualScore, Partial<GradingManualScore>, Partial<GradingManualScore>> {
  constructor(db: Database) {
    super(db, "grading_manual_scores", ["id", "grading_policy_id", "student_id", "score", "entered_by", "updated_at"]);
  }

  findBySubject(subjectId: number): GradingManualScore[] {
    const rows = this.db.prepare(`
      SELECT gms.* FROM grading_manual_scores gms
      JOIN grading_policies gp ON gp.id = gms.grading_policy_id
      WHERE gp.grading_subject_id = ?
    `).all(subjectId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findByPolicy(policyId: number): Record<number, number> {
    const rows = this.db.prepare("SELECT student_id, score FROM grading_manual_scores WHERE grading_policy_id = ?").all(policyId) as Record<string, unknown>[];
    const map: Record<number, number> = {};
    for (const row of rows) {
      map[Number(row.student_id)] = Number(row.score);
    }
    return map;
  }

  upsert(policyId: number, studentId: number, score: number, enteredBy: number): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO grading_manual_scores (grading_policy_id, student_id, score, entered_by, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(grading_policy_id, student_id) DO UPDATE SET score = excluded.score, entered_by = excluded.entered_by, updated_at = excluded.updated_at
    `).run(policyId, studentId, score, enteredBy, now);
  }

  bulkUpsert(entries: Array<{ policyId: number; studentId: number; score: number; enteredBy: number }>): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO grading_manual_scores (grading_policy_id, student_id, score, entered_by, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(grading_policy_id, student_id) DO UPDATE SET score = excluded.score, entered_by = excluded.entered_by, updated_at = excluded.updated_at
    `);
    const tx = this.db.transaction((items: typeof entries) => {
      for (const entry of items) {
        stmt.run(entry.policyId, entry.studentId, entry.score, entry.enteredBy, now);
      }
    });
    tx(entries);
  }
}

export class TermResultRepository extends BaseRepository<TermResult, Partial<TermResult>, Partial<TermResult>> {
  constructor(db: Database) {
    super(db, "term_results", ["id", "student_id", "grading_subject_id", "ca_score", "exam_score", "total_score", "grade", "remark", "is_approved", "term_id", "session_id", "updated_at"]);
  }

  findBySubject(subjectId: number): TermResult[] {
    const rows = this.db.prepare("SELECT * FROM term_results WHERE grading_subject_id = ?").all(subjectId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findByStudentAndSubject(studentId: number, subjectId: number): TermResult | null {
    const row = this.db.prepare("SELECT * FROM term_results WHERE student_id = ? AND grading_subject_id = ?").get(studentId, subjectId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByStudent(studentId: number): TermResult[] {
    const rows = this.db.prepare("SELECT * FROM term_results WHERE student_id = ?").all(studentId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findApprovedBySubject(subjectId: number): TermResult[] {
    const rows = this.db.prepare("SELECT * FROM term_results WHERE grading_subject_id = ? AND is_approved = 1").all(subjectId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findDraftBySubject(subjectId: number): TermResult[] {
    const rows = this.db.prepare("SELECT * FROM term_results WHERE grading_subject_id = ? AND is_approved = 0").all(subjectId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  upsert(result: TermResult): void {
    this.db.prepare(`
      INSERT INTO term_results (student_id, grading_subject_id, ca_score, exam_score, total_score, grade, remark, is_approved, term_id, session_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(student_id, grading_subject_id, term_id) DO UPDATE SET
        ca_score = excluded.ca_score,
        exam_score = excluded.exam_score,
        total_score = excluded.total_score,
        grade = excluded.grade,
        remark = excluded.remark,
        is_approved = excluded.is_approved,
        updated_at = excluded.updated_at
    `).run(
      result.student_id, result.grading_subject_id, result.ca_score, result.exam_score,
      result.total_score, result.grade, result.remark, result.is_approved,
      result.term_id, result.session_id, result.updated_at
    );
  }

  approveAll(subjectId: number): void {
    this.db.prepare("UPDATE term_results SET is_approved = 1 WHERE grading_subject_id = ?").run(subjectId);
  }

  unapproveAll(subjectId: number): void {
    this.db.prepare("UPDATE term_results SET is_approved = 0 WHERE grading_subject_id = ?").run(subjectId);
  }

  getStudentResultsForReportCard(studentId: number, sessionId?: number, termId?: number): (TermResult & { subject_name?: string; subject_code?: string })[] {
    let query = `
      SELECT tr.*, gs.name as subject_name, gs.code as subject_code
      FROM term_results tr
      JOIN grading_subjects gs ON gs.id = tr.grading_subject_id
      WHERE tr.student_id = ?
    `;
    const params: (number | string)[] = [studentId];
    if (sessionId) {
      query += " AND tr.session_id = ?";
      params.push(sessionId);
    }
    if (termId) {
      query += " AND tr.term_id = ?";
      params.push(termId);
    }
    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  getGradingStudents(subjectId: number): Array<{ id: number; name: string; reg_id?: string }> {
    const rows = this.db.prepare(`
      SELECT u.id, u.name, u.reg_id
      FROM users u
      JOIN subject_enrollments se ON se.student_id = u.id
      WHERE se.subject_id = (SELECT source_cbt_subject_id FROM grading_subjects WHERE id = ?)
      UNION
      SELECT u.id, u.name, u.reg_id
      FROM users u
      JOIN class_enrollments ce ON ce.student_id = u.id
      JOIN grading_subjects gs ON gs.class_id = ce.class_id
      WHERE gs.id = ?
    `).all(subjectId, subjectId) as Record<string, unknown>[];
    return rows.map(r => ({ id: Number(r.id), name: String(r.name), reg_id: r.reg_id ? String(r.reg_id) : undefined }));
  }
}

export class AnnualResultRepository extends BaseRepository<AnnualResult, Partial<AnnualResult>, Partial<AnnualResult>> {
  constructor(db: Database) {
    super(db, "annual_results", ["id", "student_id", "class_id", "session_id", "total_average", "promotion_status", "approved_by", "updated_at"]);
  }

  findBySession(sessionId: number): AnnualResult[] {
    const rows = this.db.prepare("SELECT * FROM annual_results WHERE session_id = ?").all(sessionId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findByStudentAndSession(studentId: number, sessionId: number): AnnualResult | null {
    const row = this.db.prepare("SELECT * FROM annual_results WHERE student_id = ? AND session_id = ?").get(studentId, sessionId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  upsert(result: AnnualResult): void {
    this.db.prepare(`
      INSERT INTO annual_results (student_id, class_id, session_id, total_average, promotion_status, approved_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(student_id, session_id) DO UPDATE SET
        class_id = excluded.class_id,
        total_average = excluded.total_average,
        promotion_status = excluded.promotion_status,
        approved_by = excluded.approved_by,
        updated_at = excluded.updated_at
    `).run(
      result.student_id, result.class_id, result.session_id, result.total_average,
      result.promotion_status, result.approved_by, result.updated_at
    );
  }

  getStudentAverages(sessionId: number): Array<{ student_id: number; student_name: string; reg_id: string; annual_average: number; subjects_count: number; terms_count: number }> {
    const rows = this.db.prepare(`
      SELECT
        tr.student_id,
        u.name as student_name,
        u.reg_id,
        ROUND(AVG(tr.total_score), 2) as annual_average,
        COUNT(DISTINCT tr.grading_subject_id) as subjects_count,
        COUNT(DISTINCT tr.term_id) as terms_count
      FROM term_results tr
      JOIN users u ON u.id = tr.student_id
      WHERE tr.session_id = ? AND tr.is_approved = 1
      GROUP BY tr.student_id
    `).all(sessionId) as Record<string, unknown>[];
    return rows.map(r => ({
      student_id: Number(r.student_id),
      student_name: String(r.student_name),
      reg_id: String(r.reg_id),
      annual_average: Number(r.annual_average),
      subjects_count: Number(r.subjects_count),
      terms_count: Number(r.terms_count)
    }));
  }

  promoteStudent(studentId: number, sessionId: number, nextGradeLevelId: number): void {
    this.db.prepare("UPDATE users SET grade_level_id = ? WHERE id = ?").run(nextGradeLevelId, studentId);
  }
}

export class GradingConfigRepository {
  constructor(private db: Database) {}

  get(): GradingConfig {
    const row = this.db.prepare("SELECT grading_config_json FROM config WHERE id = 1").get() as { grading_config_json?: string } | undefined;
    const defaultConfig: GradingConfig = {
      ca_max: 40,
      exam_max: 60,
      passing_score: 40,
      grade_scale: [
        { grade: "A", min: 75, label: "Excellent" },
        { grade: "B", min: 65, label: "Very Good" },
        { grade: "C", min: 55, label: "Credit" },
        { grade: "D", min: 45, label: "Pass" },
        { grade: "E", min: 40, label: "Poor Pass" },
        { grade: "F", min: 0, label: "Fail" }
      ],
      default_ca_template: [
        { name: "CBT Test", type: "cbt_test", marks: 20 },
        { name: "Assignment", type: "manual", marks: 10 },
        { name: "Classwork", type: "manual", marks: 10 }
      ]
    };
    if (row?.grading_config_json) {
      try {
        return { ...defaultConfig, ...JSON.parse(row.grading_config_json) };
      } catch {
        return defaultConfig;
      }
    }
    return defaultConfig;
  }

  set(config: GradingConfig): void {
    this.db.prepare("UPDATE config SET grading_config_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = 1").run(JSON.stringify(config));
  }
}