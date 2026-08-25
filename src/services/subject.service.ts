import { Database } from "bun:sqlite";
import { SubjectRepository } from "../repositories/subject.repository";
import { QuestionRepository } from "../repositories/subject.repository";
import { TimetableRepository } from "../repositories/subject.repository";
import { UserRepository } from "../repositories/user.repository";
import { SubjectEnrollmentRepository } from "../repositories/exam.repository";
import { auditService } from "./audit.service";
import type { Subject, Question, Timetable } from "../types";
import { isValidSubjectDuration, isValidExamDateTime, isExamDatetimeInFuture, isExamDatetimeEditValid, trimStr, sqlInt } from "../utils/validation";

export class SubjectService {
  private subjectRepo: SubjectRepository;
  private questionRepo: QuestionRepository;
  private timetableRepo: TimetableRepository;
  private userRepo: UserRepository;
  private enrollmentRepo: SubjectEnrollmentRepository;

  constructor(db: Database) {
    this.subjectRepo = new SubjectRepository(db);
    this.questionRepo = new QuestionRepository(db);
    this.timetableRepo = new TimetableRepository(db);
    this.userRepo = new UserRepository(db);
    this.enrollmentRepo = new SubjectEnrollmentRepository(db);
  }

  create(data: {
    name: string;
    code: string;
    term: string;
    duration: number;
    examDatetime: string;
    teacherId: number;
    createdBy: number;
    description?: string;
    class?: string;
    session?: string;
    mode?: string;
    instructions?: string;
    windowDuration?: number;
    canRetake?: number;
    isAssignment?: number;
    sessionId?: number | null;
    termId?: number | null;
    gradeLevelId?: number | null;
  }): Subject {
    const name = trimStr(data.name);
    const code = trimStr(data.code).toUpperCase();
    const term = trimStr(data.term);
    const duration = data.duration;
    const examDatetime = data.examDatetime;

    if (!name) throw new Error("Subject name is required");
    if (!code) throw new Error("Subject code is required");
    if (!term) throw new Error("Term is required");
    if (!isValidSubjectDuration(duration)) throw new Error("Duration must be 1-360 minutes");
    if (!isValidExamDateTime(examDatetime)) throw new Error("Valid exam date/time is required");
    if (!isExamDatetimeInFuture(examDatetime)) throw new Error("Exam date/time must be in the future");
    if (!data.teacherId) throw new Error("Teacher is required");

    const teacher = this.userRepo.findById(data.teacherId);
    if (!teacher || teacher.role !== "teacher") throw new Error("Invalid teacher");

    if (this.subjectRepo.findByCodeAndTerm(code, term)) {
      throw new Error("Subject with this code already exists for this term");
    }

    const subject = this.subjectRepo.create({
      name,
      code,
      term,
      duration,
      total_score: 0,
      exam_datetime: examDatetime,
      is_published: 0,
      teacher_id: data.teacherId,
      created_by: data.createdBy,
      description: data.description || null,
      class: data.class || null,
      session: data.session || null,
      mode: data.mode || "exam",
      instructions: data.instructions || null,
      is_timetable_published: 0,
      window_duration: data.windowDuration || 120,
      can_retake: data.canRetake ?? 1,
      is_assignment: data.isAssignment || 0,
      session_id: data.sessionId,
      term_id: data.termId,
      grade_level_id: data.gradeLevelId
    });

    auditService.log(data.createdBy, "SUBJECT_CREATE", "subject", subject.id, JSON.stringify({ code, term }));
    return subject;
  }

  update(id: number, data: Partial<Subject>, actorId: number): Subject | null {
    const subject = this.subjectRepo.findById(id);
    if (!subject) throw new Error("Subject not found");

    const updates: Record<string, unknown> = {};

    if (data.name !== undefined) updates.name = trimStr(data.name);
    if (data.code !== undefined) {
      const newCode = trimStr(data.code).toUpperCase();
      if (newCode !== subject.code) {
        if (this.subjectRepo.findByCodeAndTerm(newCode, data.term || subject.term)) {
          throw new Error("Subject with this code already exists for this term");
        }
        updates.code = newCode;
      }
    }
    if (data.term !== undefined) updates.term = trimStr(data.term);
    if (data.duration !== undefined) {
      if (!isValidSubjectDuration(data.duration)) throw new Error("Duration must be 1-360 minutes");
      updates.duration = data.duration;
    }
    if (data.exam_datetime !== undefined) {
      if (!isValidExamDateTime(data.exam_datetime)) throw new Error("Valid exam date/time is required");
      if (!isExamDatetimeEditValid(data.exam_datetime)) throw new Error("Invalid exam date/time");
      updates.exam_datetime = data.exam_datetime;
    }
    if (data.teacher_id !== undefined) {
      const teacher = this.userRepo.findById(data.teacher_id);
      if (!teacher || teacher.role !== "teacher") throw new Error("Invalid teacher");
      updates.teacher_id = data.teacher_id;
    }
    if (data.description !== undefined) updates.description = data.description;
    if (data.class !== undefined) updates.class = data.class;
    if (data.session !== undefined) updates.session = data.session;
    if (data.mode !== undefined) updates.mode = data.mode;
    if (data.instructions !== undefined) updates.instructions = data.instructions;
    if (data.window_duration !== undefined) updates.window_duration = data.window_duration;
    if (data.can_retake !== undefined) updates.can_retake = data.can_retake;
    if (data.is_assignment !== undefined) updates.is_assignment = data.is_assignment;
    if (data.session_id !== undefined) updates.session_id = data.session_id;
    if (data.term_id !== undefined) updates.term_id = data.term_id;
    if (data.grade_level_id !== undefined) updates.grade_level_id = data.grade_level_id;

    if (Object.keys(updates).length === 0) return subject;

    const updated = this.subjectRepo.update(id, updates);
    if (updated) {
      auditService.log(actorId, "SUBJECT_UPDATE", "subject", id, JSON.stringify(updates));
    }
    return updated;
  }

  delete(id: number, actorId: number): boolean {
    const subject = this.subjectRepo.findById(id);
    if (!subject) throw new Error("Subject not found");

    const result = this.subjectRepo.delete(id);
    if (result) {
      auditService.log(actorId, "SUBJECT_DELETE", "subject", id, JSON.stringify({ code: subject.code }));
    }
    return result;
  }

  findById(id: number): Subject | null {
    return this.subjectRepo.findById(id);
  }

  findByIdWithTeacher(id: number): (Subject & { teacher_name?: string }) | null {
    return this.subjectRepo.getSubjectWithTeacher(id);
  }

  findAll(filters?: { sessionId?: number; termId?: number; teacherId?: number }): Subject[] {
    if (filters?.sessionId && filters?.termId) {
      return this.subjectRepo.findBySessionAndTerm(filters.sessionId, filters.termId);
    }
    if (filters?.teacherId) {
      return this.subjectRepo.findByTeacher(filters.teacherId);
    }
    return this.subjectRepo.findAll();
  }

  findPublished(term: string): Subject[] {
    return this.subjectRepo.findPublishedByTerm(term);
  }

  togglePublish(id: number, isPublished: number, actorId: number): Subject | null {
    const subject = this.subjectRepo.updatePublishStatus(id, isPublished);
    if (subject) {
      auditService.log(actorId, isPublished ? "SUBJECT_PUBLISH" : "SUBJECT_UNPUBLISH", "subject", id, "{}");
    }
    return subject;
  }

  assignTeacher(subjectId: number, teacherId: number, actorId: number): Subject | null {
    const subject = this.subjectRepo.assignTeacher(subjectId, teacherId);
    if (subject) {
      auditService.log(actorId, "SUBJECT_ASSIGN_TEACHER", "subject", subjectId, JSON.stringify({ teacher_id: teacherId }));
    }
    return subject;
  }

  getEnrolledStudents(subjectId: number): Array<{ id: number; name: string; email: string; grade?: string; reg_id?: string; enrolled_at?: string; score?: number; total_score?: number; exam_status?: string; exam_id?: number }> {
    const enrollments = this.enrollmentRepo.findBySubject(subjectId);
    const students: Array<{ id: number; name: string; email: string; grade?: string; reg_id?: string; enrolled_at?: string; score?: number; total_score?: number; exam_status?: string; exam_id?: number }> = [];

    for (const enr of enrollments) {
      const user = this.userRepo.findById(enr.student_id);
      if (user) {
        const exam = this.enrollmentRepo.db.prepare("SELECT * FROM exams WHERE student_id = ? AND subject_id = ?").get(enr.student_id, subjectId) as any;
        students.push({
          id: user.id,
          name: user.name,
          email: user.email,
          grade: user.grade,
          reg_id: user.reg_id,
          enrolled_at: enr.enrolled_at,
          score: exam?.score,
          total_score: exam?.total_score,
          exam_status: exam?.status,
          exam_id: exam?.id
        });
      }
    }
    return students;
  }

  enrollStudent(subjectId: number, studentId: number, enrolledBy: number): void {
    this.enrollmentRepo.enroll(subjectId, studentId, enrolledBy);
  }

  unenrollStudent(subjectId: number, studentId: number): boolean {
    return this.enrollmentRepo.unenroll(subjectId, studentId);
  }

  bulkEnrollByGrade(subjectId: number, grade: string, enrolledBy: number): number {
    const students = this.userRepo.findStudentsByGradeLevel(0); // Would need grade level lookup
    const studentIds = students.map(s => s.id);
    return this.enrollmentRepo.bulkEnroll(subjectId, studentIds, enrolledBy);
  }

  // Questions
  addQuestion(data: {
    subjectId: number;
    questionText: string;
    options: string[];
    correctAnswer: number;
    marks: number;
    orderIndex: number;
    questionType?: string;
    teacherAnswer?: string;
    imageUrl?: string;
    isFileUpload?: number;
    attachedFileUrl?: string;
    sessionId?: number;
    termId?: number;
  }): Question {
    const subject = this.subjectRepo.findById(data.subjectId);
    if (!subject) throw new Error("Subject not found");

    const question = this.questionRepo.create({
      subject_id: data.subjectId,
      question_text: data.questionText,
      options_json: JSON.stringify(data.options),
      correct_answer: data.correctAnswer,
      marks: data.marks,
      order_index: data.orderIndex,
      question_type: data.questionType || "objective",
      teacher_answer: data.teacherAnswer || null,
      image_url: data.imageUrl || null,
      is_file_upload: data.isFileUpload || 0,
      attached_file_url: data.attachedFileUrl || null,
      session_id: data.sessionId,
      term_id: data.termId
    });

    this.updateSubjectTotalScore(data.subjectId);
    return question;
  }

  updateQuestion(id: number, data: Partial<Question>): Question | null {
    return this.questionRepo.update(id, data);
  }

  deleteQuestion(id: number): boolean {
    const question = this.questionRepo.findById(id);
    if (!question) throw new Error("Question not found");
    const result = this.questionRepo.delete(id);
    if (result) {
      this.updateSubjectTotalScore(question.subject_id);
    }
    return result;
  }

  getQuestions(subjectId: number): Question[] {
    return this.questionRepo.findBySubject(subjectId);
  }

  reorderQuestions(subjectId: number, questionIds: number[]): void {
    this.questionRepo.reorderQuestions(subjectId, questionIds);
  }

  private updateSubjectTotalScore(subjectId: number): void {
    const questions = this.questionRepo.findBySubject(subjectId);
    const totalScore = questions.reduce((sum, q) => sum + q.marks, 0);
    this.subjectRepo.update(subjectId, { total_score: totalScore });
  }

  // Timetables
  createTimetable(data: {
    subjectId: number;
    class?: string;
    section?: string;
    examDate: string;
    startTime: string;
    endTime: string;
    duration: number;
    examMode: "CBT" | "Assignment" | "Offline";
    allowStudents?: number;
    gradeLevelId?: number;
  }): Timetable {
    const subject = this.subjectRepo.findById(data.subjectId);
    if (!subject) throw new Error("Subject not found");

    return this.timetableRepo.create({
      subject_id: data.subjectId,
      class: data.class,
      section: data.section,
      exam_date: data.examDate,
      start_time: data.startTime,
      end_time: data.endTime,
      duration: data.duration,
      exam_mode: data.examMode,
      allow_students: data.allowStudents || 0,
      grade_level_id: data.gradeLevelId
    });
  }

  updateTimetable(id: number, data: Partial<Timetable>): Timetable | null {
    return this.timetableRepo.update(id, data);
  }

  deleteTimetable(id: number): boolean {
    return this.timetableRepo.delete(id);
  }

  getTimetables(filters?: { subjectId?: number; class?: string; upcoming?: boolean }): Timetable[] {
    if (filters?.subjectId) return this.timetableRepo.findBySubject(filters.subjectId);
    if (filters?.class) return this.timetableRepo.findByClass(filters.class);
    if (filters?.upcoming) return this.timetableRepo.findUpcoming();
    return this.timetableRepo.findAll();
  }
}