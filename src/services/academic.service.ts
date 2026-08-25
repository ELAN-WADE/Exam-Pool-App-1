import { Database } from "bun:sqlite";
import { AcademicSessionRepository } from "../repositories/academic.repository";
import { AcademicTermRepository } from "../repositories/academic.repository";
import { TermRepository } from "../repositories/academic.repository";
import { ClassRepository } from "../repositories/academic.repository";
import { GradeLevelRepository } from "../repositories/academic.repository";
import { ClassEnrollmentRepository } from "../repositories/academic.repository";
import { GuardianStudentLinkRepository } from "../repositories/academic.repository";
import { ClassTeacherAssignmentRepository } from "../repositories/academic.repository";
import { AcademicCalendarEventRepository } from "../repositories/academic.repository";
import { SubjectRepository } from "../repositories/subject.repository";
import { ExamRepository } from "../repositories/exam.repository";
import { UserRepository } from "../repositories/user.repository";
import { auditService } from "./audit.service";
import type { AcademicSession, AcademicTerm, Term, Class, GradeLevel, ClassEnrollment, GuardianStudentLink, ClassTeacherAssignment, AcademicCalendarEvent } from "../types";
import { trimStr, isPositiveIntId } from "../utils/validation";

export class AcademicService {
  private sessionRepo: AcademicSessionRepository;
  private termRepo: AcademicTermRepository;
  private legacyTermRepo: TermRepository;
  private classRepo: ClassRepository;
  private gradeLevelRepo: GradeLevelRepository;
  private classEnrollmentRepo: ClassEnrollmentRepository;
  private guardianLinkRepo: GuardianStudentLinkRepository;
  private teacherAssignmentRepo: ClassTeacherAssignmentRepository;
  private calendarRepo: AcademicCalendarEventRepository;
  private subjectRepo: SubjectRepository;
  private examRepo: ExamRepository;
  private userRepo: UserRepository;

  constructor(db: Database) {
    this.sessionRepo = new AcademicSessionRepository(db);
    this.termRepo = new AcademicTermRepository(db);
    this.legacyTermRepo = new TermRepository(db);
    this.classRepo = new ClassRepository(db);
    this.gradeLevelRepo = new GradeLevelRepository(db);
    this.classEnrollmentRepo = new ClassEnrollmentRepository(db);
    this.guardianLinkRepo = new GuardianStudentLinkRepository(db);
    this.teacherAssignmentRepo = new ClassTeacherAssignmentRepository(db);
    this.calendarRepo = new AcademicCalendarEventRepository(db);
    this.subjectRepo = new SubjectRepository(db);
    this.examRepo = new ExamRepository(db);
    this.userRepo = new UserRepository(db);
  }

  // Academic Sessions
  getActiveSession(): AcademicSession | null {
    return this.sessionRepo.findActive();
  }

  getAllSessions(): AcademicSession[] {
    return this.sessionRepo.findAll();
  }

  createSession(name: string, actorId: number): AcademicSession {
    const nameTrimmed = trimStr(name);
    if (!nameTrimmed) throw new Error("Session name is required");

    const existing = this.sessionRepo.findByName(nameTrimmed);
    if (existing) throw new Error("Session already exists");

    const session = this.sessionRepo.create({ name: nameTrimmed, is_active: 0, status: "active" });
    auditService.log(actorId, "SESSION_CREATE", "academic_session", session.id, JSON.stringify({ name: nameTrimmed }));
    return session;
  }

  activateSession(sessionId: number, actorId: number): void {
    if (!isPositiveIntId(sessionId)) throw new Error("Invalid session ID");
    this.sessionRepo.activate(sessionId);
    auditService.log(actorId, "SESSION_ACTIVATE", "academic_session", sessionId, "{}");
  }

  // Academic Terms
  getActiveTerm(): AcademicTerm | null {
    return this.termRepo.findActive();
  }

  getTermsBySession(sessionId: number): AcademicTerm[] {
    return this.termRepo.findBySession(sessionId);
  }

  createTerm(data: {
    sessionId: number;
    name: string;
    startDate?: string | null;
    endDate?: string | null;
    actorId: number;
  }): AcademicTerm {
    const validNames = ["First Term", "Second Term", "Third Term", "First Semester", "Second Semester"];
    if (!validNames.includes(data.name)) throw new Error("Invalid term name");

    const existing = this.termRepo.findByNameAndSession(data.name, data.sessionId);
    if (existing) throw new Error("Term already exists for this session");

    const term = this.termRepo.create({
      session_id: data.sessionId,
      name: data.name,
      start_date: data.startDate,
      end_date: data.endDate,
      is_active: 0,
      status: "active",
      registration_open: 1
    });

    auditService.log(data.actorId, "TERM_CREATE", "academic_term", term.id, JSON.stringify(data));
    return term;
  }

  activateTerm(termId: number, actorId: number): void {
    if (!isPositiveIntId(termId)) throw new Error("Invalid term ID");
    this.termRepo.activate(termId);
    auditService.log(actorId, "TERM_ACTIVATE", "academic_term", termId, "{}");
  }

  endTerm(actorId: number): void {
    this.termRepo.endActiveTerm();
    auditService.log(actorId, "TERM_END", "academic_term", 0, "{}");
  }

  // Legacy Terms (for backward compatibility)
  getActiveLegacyTerm(): Term | null {
    return this.legacyTermRepo.findActive();
  }

  // Classes
  getAllClasses(): Class[] {
    return this.classRepo.findAll();
  }

  getClassesWithTeachers(): (Class & { teacher_name?: string })[] {
    return this.classRepo.findWithTeacher();
  }

  getClassById(id: number): Class | null {
    return this.classRepo.findById(id);
  }

  updateClass(id: number, data: { name?: string; section?: string; level?: string; classTeacherId?: number | null; notes?: string }, actorId: number): Class | null {
    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates.name = trimStr(data.name);
    if (data.section !== undefined) updates.section = data.section;
    if (data.level !== undefined) updates.level = data.level;
    if (data.classTeacherId !== undefined) updates.class_teacher_id = data.classTeacherId;

    if (Object.keys(updates).length === 0) return this.classRepo.findById(id);

    const updated = this.classRepo.update(id, updates);
    if (updated && data.classTeacherId !== undefined) {
      const action = data.classTeacherId ? "assigned" : "unassigned";
      this.classRepo.assignTeacher(id, data.classTeacherId, actorId, action, data.notes);
    }
    return updated;
  }

  assignClassTeacher(classId: number, teacherId: number | null, actorId: number, notes?: string): void {
    const action = teacherId ? "assigned" : "unassigned";
    this.classRepo.assignTeacher(classId, teacherId, actorId, action, notes);
  }

  getTeacherAssignmentHistory(): ClassTeacherAssignment[] {
    return this.teacherAssignmentRepo.findAll();
  }

  // Grade Levels
  getAllGradeLevels(): GradeLevel[] {
    return this.gradeLevelRepo.findAll();
  }

  getActiveGradeLevels(): GradeLevel[] {
    return this.gradeLevelRepo.findActive();
  }

  getGradeLevelsByCategory(category: string): GradeLevel[] {
    return this.gradeLevelRepo.findByCategory(category);
  }

  // Class Enrollments
  enrollStudentInClass(studentId: number, classId: number, termId: number): ClassEnrollment {
    return this.classEnrollmentRepo.enroll(studentId, classId, termId);
  }

  bulkEnrollStudentsInClass(studentIds: number[], classId: number, termId: number): void {
    this.classEnrollmentRepo.bulkEnroll(studentIds, classId, termId);
  }

  getClassRoster(classId: number, termId: number): ClassEnrollment[] {
    return this.classEnrollmentRepo.findByClassAndTerm(classId, termId);
  }

  getStudentClassEnrollment(studentId: number, termId: number): ClassEnrollment | null {
    return this.classEnrollmentRepo.findCurrentForStudent(studentId, termId);
  }

  // Guardian Links
  getGuardianLinks(guardianId: number): GuardianStudentLink[] {
    return this.guardianLinkRepo.findByGuardian(guardianId);
  }

  getStudentGuardianLinks(studentId: number): GuardianStudentLink[] {
    return this.guardianLinkRepo.findByStudent(studentId);
  }

  approveGuardianLink(linkId: number, verifiedBy: number, method: "manual_admin" | "dob_match" | "pin_match", data?: string): GuardianStudentLink | null {
    return this.guardianLinkRepo.approve(linkId, verifiedBy, method, data);
  }

  rejectGuardianLink(linkId: number): GuardianStudentLink | null {
    return this.guardianLinkRepo.reject(linkId);
  }

  // Calendar Events
  getCalendarEvents(termId: number): AcademicCalendarEvent[] {
    return this.calendarRepo.findByTerm(termId);
  }

  getUpcomingEvents(termId: number, limit?: number): AcademicCalendarEvent[] {
    return this.calendarRepo.findUpcoming(termId, limit);
  }

  createCalendarEvent(data: {
    termId: number;
    title: string;
    description?: string;
    startDate: string;
    endDate: string;
    type: "holiday" | "exam_period" | "resumption" | "event" | "deadline" | "other";
    createdBy: number;
  }): AcademicCalendarEvent {
    return this.calendarRepo.create({
      term_id: data.termId,
      title: data.title,
      description: data.description,
      start_date: data.startDate,
      end_date: data.endDate,
      type: data.type,
      created_by: data.createdBy
    });
  }

  // Stats
  getStats(sessionId?: number, termId?: number): any {
    const activeSession = this.sessionRepo.findActive();
    const activeTerm = this.termRepo.findActive();
    const targetSessionId = sessionId || activeSession?.id;
    const targetTermId = termId || activeTerm?.id;

    if (!targetSessionId || !targetTermId) {
      const students = this.userRepo.countByRole("student");
      const teachers = this.userRepo.countByRole("teacher");
      return { students, teachers, subjects: 0, completedExams: 0 };
    }

    const subjectsCount = this.subjectRepo.findBySessionAndTerm(targetSessionId, targetTermId).length;
    const examsCount = this.examRepo.findBySessionAndTerm(targetSessionId, targetTermId).filter(e => e.status === "completed").length;

    const students = this.userRepo.countByRole("student");
    const teachers = this.userRepo.countByRole("teacher");

    return { students, teachers, subjects: subjectsCount, completedExams: examsCount };
  }

  // Session Snapshots (for admin dashboard)
  getSessionSnapshots(sessionId?: number): any[] {
    let sessions = this.sessionRepo.findAll();
    if (sessionId) {
      sessions = sessions.filter(s => s.id === sessionId);
    }

    const snapshots: any[] = [];
    for (const session of sessions) {
      const sid = session.id;

      const studentCountRow = this.db.prepare(`
        SELECT COUNT(DISTINCT student_id) as count 
        FROM (
          SELECT student_id FROM term_results WHERE session_id = ?
          UNION
          SELECT student_id FROM exams WHERE session_id = ?
          UNION
          SELECT student_id FROM class_enrollments WHERE term_id IN (SELECT id FROM academic_terms WHERE session_id = ?)
        )
      `).get(sid, sid, sid) as any;
      const totalStudents = Number(studentCountRow?.count || 0);

      const teacherCountRow = this.db.prepare(`
        SELECT COUNT(DISTINCT teacher_id) as count
        FROM (
          SELECT teacher_id FROM grading_subjects WHERE session_id = ? AND teacher_id IS NOT NULL
          UNION
          SELECT teacher_id FROM subjects WHERE session_id = ? AND teacher_id IS NOT NULL
          UNION
          SELECT class_teacher_id as teacher_id FROM classes WHERE class_teacher_id IS NOT NULL
        )
      `).get(sid, sid) as any;
      const totalTeachers = Number(teacherCountRow?.count || 0);

      const gradingSubCount = this.db.prepare("SELECT COUNT(*) as count FROM grading_subjects WHERE session_id = ?").get(sid) as any;
      const cbtSubCount = this.db.prepare("SELECT COUNT(*) as count FROM subjects WHERE session_id = ?").get(sid) as any;

      const examsCompletedRow = this.db.prepare(`
        SELECT COUNT(*) as count, AVG(CASE WHEN total_score > 0 THEN (score * 100.0 / total_score) ELSE 0 END) as avg_pct
        FROM exams WHERE session_id = ? AND status = 'completed'
      `).get(sid) as any;
      const totalExamsCompleted = Number(examsCompletedRow?.count || 0);
      const avgExamPct = examsCompletedRow?.avg_pct ? Number(examsCompletedRow.avg_pct.toFixed(1)) : 0;

      snapshots.push({
        session: session,
        totalStudents,
        totalTeachers,
        gradingSubjects: Number(gradingSubCount?.count || 0),
        cbtSubjects: Number(cbtSubCount?.count || 0),
        totalExamsCompleted,
        avgExamPct
      });
    }

    return snapshots;
  }

  private get db(): Database {
    return (this.sessionRepo as any).db;
  }
}