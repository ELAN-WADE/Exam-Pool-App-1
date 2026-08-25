import { Database } from "bun:sqlite";
import { BaseRepository } from "./base.repository";
import type { Subject, Question, Timetable } from "../types";

export class SubjectRepository extends BaseRepository<Subject, Partial<Subject>, Partial<Subject>> {
  constructor(db: Database) {
    super(db, "subjects", [
      "id", "name", "code", "term", "duration", "total_score", "exam_datetime",
      "is_published", "teacher_id", "created_by", "created_at", "description",
      "class", "session", "mode", "instructions", "is_timetable_published",
      "window_duration", "can_retake", "is_assignment", "session_id", "term_id", "grade_level_id"
    ]);
  }

  findByTeacher(teacherId: number): Subject[] {
    const rows = this.db.prepare("SELECT * FROM subjects WHERE teacher_id = ?").all(teacherId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findPublishedByTerm(term: string): Subject[] {
    const rows = this.db.prepare("SELECT * FROM subjects WHERE term = ? AND is_published = 1").all(term) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findBySessionAndTerm(sessionId: number, termId: number): Subject[] {
    const rows = this.db.prepare("SELECT * FROM subjects WHERE session_id = ? AND term_id = ?").all(sessionId, termId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findByCodeAndTerm(code: string, term: string): Subject | null {
    const row = this.db.prepare("SELECT * FROM subjects WHERE code = ? AND term = ?").get(code, term) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  updatePublishStatus(id: number, isPublished: number): Subject | null {
    const result = this.db.prepare("UPDATE subjects SET is_published = ? WHERE id = ?").run(isPublished, id);
    if (result.changes === 0) return null;
    return this.findById(id);
  }

  assignTeacher(subjectId: number, teacherId: number): Subject | null {
    const result = this.db.prepare("UPDATE subjects SET teacher_id = ? WHERE id = ?").run(teacherId, subjectId);
    if (result.changes === 0) return null;
    return this.findById(subjectId);
  }

  getSubjectWithTeacher(subjectId: number): (Subject & { teacher_name?: string }) | null {
    const row = this.db.prepare(`
      SELECT s.*, u.name as teacher_name
      FROM subjects s
      LEFT JOIN users u ON u.id = s.teacher_id
      WHERE s.id = ?
    `).get(subjectId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }
}

export class QuestionRepository extends BaseRepository<Question, Partial<Question>, Partial<Question>> {
  constructor(db: Database) {
    super(db, "questions", [
      "id", "subject_id", "question_text", "options_json", "correct_answer",
      "marks", "order_index", "created_at", "updated_at", "question_type",
      "session", "term", "mode", "teacher_answer", "image_url",
      "is_file_upload", "attached_file_url", "session_id", "term_id"
    ]);
  }

  findBySubject(subjectId: number): Question[] {
    const rows = this.db.prepare("SELECT * FROM questions WHERE subject_id = ? ORDER BY order_index").all(subjectId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findBySubjectAndType(subjectId: number, questionType: string): Question[] {
    const rows = this.db.prepare("SELECT * FROM questions WHERE subject_id = ? AND question_type = ? ORDER BY order_index").all(subjectId, questionType) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  countBySubject(subjectId: number): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM questions WHERE subject_id = ?").get(subjectId) as { count: number };
    return row.count;
  }

  reorderQuestions(subjectId: number, questionIds: number[]): void {
    const stmt = this.db.prepare("UPDATE questions SET order_index = ? WHERE id = ? AND subject_id = ?");
    const tx = this.db.transaction((ids: number[]) => {
      for (let i = 0; i < ids.length; i++) {
        stmt.run(i, ids[i], subjectId);
      }
    });
    tx(questionIds);
  }
}

export class TimetableRepository extends BaseRepository<Timetable, Partial<Timetable>, Partial<Timetable>> {
  constructor(db: Database) {
    super(db, "timetables", [
      "id", "subject_id", "class", "section", "exam_date", "start_time",
      "end_time", "duration", "exam_mode", "allow_students", "created_at",
      "updated_at", "grade_level_id"
    ]);
  }

  findBySubject(subjectId: number): Timetable[] {
    const rows = this.db.prepare("SELECT * FROM timetables WHERE subject_id = ?").all(subjectId) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findByClass(className: string): Timetable[] {
    const rows = this.db.prepare("SELECT * FROM timetables WHERE class = ?").all(className) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findByDateRange(startDate: string, endDate: string): Timetable[] {
    const rows = this.db.prepare("SELECT * FROM timetables WHERE exam_date BETWEEN ? AND ?").all(startDate, endDate) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findUpcoming(limit = 50): Timetable[] {
    const rows = this.db.prepare("SELECT * FROM timetables WHERE exam_date >= date('now') ORDER BY exam_date, start_time LIMIT ?").all(limit) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }
}