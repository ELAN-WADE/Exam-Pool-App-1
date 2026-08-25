import { Database } from "bun:sqlite";
import { BaseRepository } from "./base.repository";
import type { Exam, ExamAttempt, StudentAnswer, SubjectEnrollment } from "../types";

export class ExamRepository extends BaseRepository<Exam, Partial<Exam>, Partial<Exam>> {
  constructor(db: Database) {
    super(db, "exams", [
      "id", "student_id", "subject_id", "start_time", "end_time", "answers_json",
      "score", "total_score", "status", "created_at", "session", "term", "mode",
      "total_score", "retake_count", "reg_id", "teacher_remark", "principal_remark",
      "session_id", "term_id", "is_locked"
    ]);
  }

  findByStudent(studentId: number): Exam[] {
    const rows = this.db.prepare("SELECT * FROM exams WHERE student_id = ? ORDER BY created_at DESC").all(studentId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findBySubject(subjectId: number): Exam[] {
    const rows = this.db.prepare("SELECT * FROM exams WHERE subject_id = ? ORDER BY created_at DESC").all(subjectId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findByStudentAndSubject(studentId: number, subjectId: number): Exam | null {
    const row = this.db.prepare("SELECT * FROM exams WHERE student_id = ? AND subject_id = ?").get(studentId, subjectId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findInProgressByStudent(studentId: number): Exam[] {
    const rows = this.db.prepare("SELECT * FROM exams WHERE student_id = ? AND status = 'in-progress'").all(studentId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findCompletedBySubject(subjectId: number): Exam[] {
    const rows = this.db.prepare("SELECT * FROM exams WHERE subject_id = ? AND status = 'completed'").all(subjectId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findBySessionAndTerm(sessionId: number, termId: number): Exam[] {
    const rows = this.db.prepare("SELECT * FROM exams WHERE session_id = ? AND term_id = ?").all(sessionId, termId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  startExam(studentId: number, subjectId: number, sessionId: number | null, termId: number | null, regId: string): Exam {
    const now = new Date().toISOString();
    // deadline will be set by the service after fetching subject duration
    const result = this.db.prepare(`
      INSERT INTO exams (student_id, subject_id, start_time, answers_json, total_score, status, session_id, term_id, reg_id, retake_count)
      VALUES (?, ?, ?, '[]', 0, 'in-progress', ?, ?, ?, 0)
    `).run(studentId, subjectId, now, sessionId, termId, regId);
    const created = this.findById(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to start exam");
    return created;
  }

  setDeadline(examId: number, deadline: string): Exam | null {
    const result = this.db.prepare("UPDATE exams SET deadline = ? WHERE id = ?").run(deadline, examId);
    if (result.changes === 0) return null;
    return this.findById(examId);
  }

  saveAnswers(examId: number, answersJson: string): Exam | null {
    const result = this.db.prepare("UPDATE exams SET answers_json = ? WHERE id = ?").run(answersJson, examId);
    if (result.changes === 0) return null;
    return this.findById(examId);
  }

  submitExam(examId: number, score: number, totalScore: number, endTime: string): Exam | null {
    const result = this.db.prepare("UPDATE exams SET score = ?, total_score = ?, status = 'completed', end_time = ? WHERE id = ?").run(score, totalScore, endTime, examId);
    if (result.changes === 0) return null;
    return this.findById(examId);
  }

  updateTeacherRemark(examId: number, remark: string | null): Exam | null {
    const result = this.db.prepare("UPDATE exams SET teacher_remark = ? WHERE id = ?").run(remark, examId);
    if (result.changes === 0) return null;
    return this.findById(examId);
  }

  updatePrincipalRemark(examId: number, remark: string | null): Exam | null {
    const result = this.db.prepare("UPDATE exams SET principal_remark = ? WHERE id = ?").run(remark, examId);
    if (result.changes === 0) return null;
    return this.findById(examId);
  }

  lockExam(examId: number): Exam | null {
    const result = this.db.prepare("UPDATE exams SET is_locked = 1 WHERE id = ?").run(examId);
    if (result.changes === 0) return null;
    return this.findById(examId);
  }

  unlockExam(examId: number): Exam | null {
    const result = this.db.prepare("UPDATE exams SET is_locked = 0 WHERE id = ?").run(examId);
    if (result.changes === 0) return null;
    return this.findById(examId);
  }

  resetForRetake(examId: number, studentId: number): Exam | null {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE exams
      SET status = 'in-progress', start_time = ?, end_time = NULL, answers_json = '[]', score = NULL, retake_count = retake_count + 1
      WHERE id = ? AND student_id = ?
    `).run(now, examId, studentId);
    if (result.changes === 0) return null;
    return this.findById(examId);
  }

  getStudentExamStats(studentId: number, sessionId?: number, termId?: number): { completed: number; inProgress: number; totalScore: number } {
    let query = "SELECT COUNT(*) as completed FROM exams WHERE student_id = ? AND status = 'completed'";
    let query2 = "SELECT COUNT(*) as inProgress FROM exams WHERE student_id = ? AND status = 'in-progress'";
    let query3 = "SELECT SUM(score) as totalScore FROM exams WHERE student_id = ? AND status = 'completed'";
    const params: (number | null)[] = [studentId];

    if (sessionId) {
      query += " AND session_id = ?";
      query2 += " AND session_id = ?";
      query3 += " AND session_id = ?";
      params.push(sessionId);
    }
    if (termId) {
      query += " AND term_id = ?";
      query2 += " AND term_id = ?";
      query3 += " AND term_id = ?";
      params.push(termId);
    }

    const completed = this.db.prepare(query).get(...params) as { completed: number };
    const inProgress = this.db.prepare(query2).get(...params) as { inProgress: number };
    const totalScore = this.db.prepare(query3).get(...params) as { totalScore: number | null };

    return {
      completed: completed.completed,
      inProgress: inProgress.inProgress,
      totalScore: totalScore.totalScore || 0
    };
  }
}

export class ExamAttemptRepository extends BaseRepository<ExamAttempt, Partial<ExamAttempt>, Partial<ExamAttempt>> {
  constructor(db: Database) {
    super(db, "exam_attempts", [
      "id", "exam_id", "student_id", "subject_id", "attempt_number",
      "start_time", "end_time", "answers_json", "score", "total_score",
      "status", "archived_at"
    ]);
  }

  findByExam(examId: number): ExamAttempt[] {
    const rows = this.db.prepare("SELECT * FROM exam_attempts WHERE exam_id = ? ORDER BY attempt_number").all(examId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findByStudent(studentId: number): ExamAttempt[] {
    const rows = this.db.prepare("SELECT * FROM exam_attempts WHERE student_id = ? ORDER BY archived_at DESC").all(studentId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  archiveAttempt(exam: Exam, attemptNumber: number): ExamAttempt {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO exam_attempts (exam_id, student_id, subject_id, attempt_number, start_time, end_time, answers_json, score, total_score, status, archived_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
    `).run(
      exam.id,
      exam.student_id,
      exam.subject_id,
      attemptNumber,
      exam.start_time,
      exam.end_time ?? null,
      exam.answers_json,
      exam.score ?? null,
      exam.total_score,
      now
    );
    const created = this.findById(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to archive exam attempt");
    return created;
  }
}

export class StudentAnswerRepository extends BaseRepository<StudentAnswer, Partial<StudentAnswer>, Partial<StudentAnswer>> {
  constructor(db: Database) {
    super(db, "student_answers", [
      "id", "exam_id", "question_id", "student_id", "subject_id",
      "selected_option", "essay_response", "is_correct", "marks_awarded",
      "created_at", "file_url", "session_id", "term_id"
    ]);
  }

  findByExam(examId: number): StudentAnswer[] {
    const rows = this.db.prepare("SELECT * FROM student_answers WHERE exam_id = ?").all(examId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findByExamAndQuestion(examId: number, questionId: number): StudentAnswer | null {
    const row = this.db.prepare("SELECT * FROM student_answers WHERE exam_id = ? AND question_id = ?").get(examId, questionId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  upsert(answer: Partial<StudentAnswer> & { exam_id: number; question_id: number; student_id: number; subject_id: number }): StudentAnswer {
    const existing = this.findByExamAndQuestion(answer.exam_id, answer.question_id);
    if (existing) {
      const updates: string[] = [];
      const values: unknown[] = [];
      for (const [key, value] of Object.entries(answer)) {
        if (key !== "exam_id" && key !== "question_id" && key !== "student_id" && key !== "subject_id") {
          updates.push(`${key} = ?`);
          values.push(value);
        }
      }
      if (updates.length > 0) {
        values.push(answer.exam_id, answer.question_id);
        this.db.prepare(`UPDATE student_answers SET ${updates.join(", ")} WHERE exam_id = ? AND question_id = ?`).run(...(values as any[]));
      }
      return this.findByExamAndQuestion(answer.exam_id, answer.question_id)!;
    } else {
      return this.create(answer as any);
    }
  }

  bulkUpsert(answers: Array<Partial<StudentAnswer> & { exam_id: number; question_id: number; student_id: number; subject_id: number }>): void {
    const tx = this.db.transaction((items: typeof answers) => {
      for (const answer of items) {
        this.upsert(answer);
      }
    });
    tx(answers);
  }

  deleteByExam(examId: number): void {
    this.db.prepare("DELETE FROM student_answers WHERE exam_id = ?").run(examId);
  }
}

export class SubjectEnrollmentRepository extends BaseRepository<SubjectEnrollment, Partial<SubjectEnrollment>, Partial<SubjectEnrollment>> {
  constructor(db: Database) {
    super(db, "subject_enrollments", [
      "id", "subject_id", "student_id", "enrolled_by", "enrolled_at"
    ]);
  }

  findBySubject(subjectId: number): SubjectEnrollment[] {
    const rows = this.db.prepare("SELECT * FROM subject_enrollments WHERE subject_id = ?").all(subjectId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findByStudent(studentId: number): SubjectEnrollment[] {
    const rows = this.db.prepare("SELECT * FROM subject_enrollments WHERE student_id = ?").all(studentId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  isEnrolled(subjectId: number, studentId: number): boolean {
    const row = this.db.prepare("SELECT 1 FROM subject_enrollments WHERE subject_id = ? AND student_id = ? LIMIT 1").get(subjectId, studentId);
    return !!row;
  }

  enroll(subjectId: number, studentId: number, enrolledBy: number): SubjectEnrollment {
    const now = new Date().toISOString();
    try {
      const result = this.db.prepare("INSERT INTO subject_enrollments (subject_id, student_id, enrolled_by, enrolled_at) VALUES (?, ?, ?, ?)").run(subjectId, studentId, enrolledBy, now);
      const created = this.findById(Number(result.lastInsertRowid));
      if (!created) throw new Error("Failed to enroll student");
      return created;
    } catch (e: any) {
      if (e.message?.includes("UNIQUE")) {
        throw new Error("Student already enrolled in this subject");
      }
      throw e;
    }
  }

  unenroll(subjectId: number, studentId: number): boolean {
    const result = this.db.prepare("DELETE FROM subject_enrollments WHERE subject_id = ? AND student_id = ?").run(subjectId, studentId);
    return result.changes > 0;
  }

  bulkEnroll(subjectId: number, studentIds: number[], enrolledBy: number): number {
    const now = new Date().toISOString();
    const stmt = this.db.prepare("INSERT OR IGNORE INTO subject_enrollments (subject_id, student_id, enrolled_by, enrolled_at) VALUES (?, ?, ?, ?)");
    const tx = this.db.transaction((ids: number[]) => {
      for (const studentId of ids) {
        stmt.run(subjectId, studentId, enrolledBy, now);
      }
    });
    tx(studentIds);
    return studentIds.length;
  }
}