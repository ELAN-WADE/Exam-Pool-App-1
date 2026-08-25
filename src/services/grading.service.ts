import { Database } from "bun:sqlite";
import { GradingSubjectRepository } from "../repositories/grading.repository";
import { GradingPolicyRepository } from "../repositories/grading.repository";
import { GradingManualScoreRepository } from "../repositories/grading.repository";
import { TermResultRepository } from "../repositories/grading.repository";
import { AnnualResultRepository } from "../repositories/grading.repository";
import { GradingConfigRepository } from "../repositories/grading.repository";
import { SubjectRepository } from "../repositories/subject.repository";
import { ExamRepository } from "../repositories/exam.repository";
import { UserRepository } from "../repositories/user.repository";
import { ClassEnrollmentRepository } from "../repositories/academic.repository";
import { AcademicTermRepository } from "../repositories/academic.repository";
import { AcademicSessionRepository } from "../repositories/academic.repository";
import { auditService } from "./audit.service";
import { notificationService } from "./notification.service";
import type { GradingSubject, GradingPolicy, GradingConfig, TermResult, AnnualResult } from "../types";
import { sqlInt } from "../utils/validation";

export class GradingService {
  private gradingSubjectRepo: GradingSubjectRepository;
  private gradingPolicyRepo: GradingPolicyRepository;
  private manualScoreRepo: GradingManualScoreRepository;
  private termResultRepo: TermResultRepository;
  private annualResultRepo: AnnualResultRepository;
  private configRepo: GradingConfigRepository;
  private subjectRepo: SubjectRepository;
  private examRepo: ExamRepository;
  private userRepo: UserRepository;
  private classEnrollmentRepo: ClassEnrollmentRepository;
  private termRepo: AcademicTermRepository;
  private sessionRepo: AcademicSessionRepository;

  constructor(db: Database) {
    this.gradingSubjectRepo = new GradingSubjectRepository(db);
    this.gradingPolicyRepo = new GradingPolicyRepository(db);
    this.manualScoreRepo = new GradingManualScoreRepository(db);
    this.termResultRepo = new TermResultRepository(db);
    this.annualResultRepo = new AnnualResultRepository(db);
    this.configRepo = new GradingConfigRepository(db);
    this.subjectRepo = new SubjectRepository(db);
    this.examRepo = new ExamRepository(db);
    this.userRepo = new UserRepository(db);
    this.classEnrollmentRepo = new ClassEnrollmentRepository(db);
    this.termRepo = new AcademicTermRepository(db);
    this.sessionRepo = new AcademicSessionRepository(db);
  }

  getConfig(): GradingConfig {
    return this.configRepo.get();
  }

  updateConfig(config: GradingConfig, actorId: number): void {
    this.configRepo.set(config);
    auditService.log(actorId, "CONFIG_UPDATE", "grading_config", null, "Updated grading config");
  }

  getGradingSubjects(teacherId: number | null, termId: number, role: string): any[] {
    if (role === "teacher" && teacherId) {
      return this.getTeacherGradingSubjects(teacherId, termId);
    }
    return this.gradingSubjectRepo.findAllWithDetails(termId);
  }

  private getTeacherGradingSubjects(teacherId: number, termId: number): any[] {
    const activeSession = this.sessionRepo.findActive();
    const targetSessionId = activeSession?.id;

    const cbtWithSubmissions = this.db.prepare(`
      SELECT s.*,
        COUNT(DISTINCT e.student_id) as students_completed,
        (SELECT COUNT(*) FROM subject_enrollments se WHERE se.subject_id = s.id) as students_enrolled,
        ROUND(AVG(CASE WHEN e.total_score > 0 THEN e.score * 100.0 / e.total_score ELSE 0 END), 1) as avg_score_pct
      FROM subjects s
      JOIN exams e ON e.subject_id = s.id AND e.status = 'completed'
      LEFT JOIN academic_terms t ON (s.term_id = t.id OR s.term = t.name)
      WHERE s.teacher_id = ? AND (s.term_id = ? OR t.id = ?)
      GROUP BY s.id
    `).all(teacherId, termId, termId) as any[];

    if (targetSessionId) {
      for (const cbt of cbtWithSubmissions) {
        let existing = this.gradingSubjectRepo.findBySourceCbtSubject(cbt.id, termId);
        if (!existing) {
          existing = this.gradingSubjectRepo.findByTeacherCodeTerm(teacherId, cbt.code, termId);
        }

        if (!existing) {
          const gsRes = this.db.prepare(`
            INSERT INTO grading_subjects (name, code, class_id, term_id, session_id, teacher_id)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(cbt.name, cbt.code, null, termId, targetSessionId, teacherId);
          const newGsId = Number(gsRes.lastInsertRowid);
          this.gradingSubjectRepo.updateMeta(newGsId, cbt.mode || "exam", cbt.id);

          const config = this.getConfig();
          if (cbt.mode === "exam" || !cbt.mode) {
            this.gradingPolicyRepo.create({
              grading_subject_id: newGsId,
              name: "CBT Examination",
              type: "cbt_exam",
              mapped_cbt_subject_id: cbt.id,
              max_marks: config.exam_max,
              is_exam: 1
            });
            for (const tmpl of config.default_ca_template) {
              if (tmpl.type === "manual") {
                this.gradingPolicyRepo.create({
                  grading_subject_id: newGsId,
                  name: tmpl.name,
                  type: "manual",
                  mapped_cbt_subject_id: null,
                  max_marks: tmpl.marks,
                  is_exam: 0
                });
              }
            }
            for (const tmpl of config.default_ca_template) {
              if (tmpl.type === "cbt_test") {
                this.gradingPolicyRepo.create({
                  grading_subject_id: newGsId,
                  name: tmpl.name,
                  type: "cbt_test",
                  mapped_cbt_subject_id: null,
                  max_marks: tmpl.marks,
                  is_exam: 0
                });
              }
            }
          } else {
            const policyName = cbt.mode === "test" ? "CBT Test"
              : cbt.mode === "quiz" ? "CBT Quiz"
              : cbt.mode === "assignment" ? "CBT Assignment"
              : `CBT ${cbt.mode.charAt(0).toUpperCase() + cbt.mode.slice(1)}`;
            const caSlot = Math.min(config.ca_max, 40);
            this.gradingPolicyRepo.create({
              grading_subject_id: newGsId,
              name: policyName,
              type: "cbt_test",
              mapped_cbt_subject_id: cbt.id,
              max_marks: caSlot,
              is_exam: 0
            });
          }
        } else if (!existing.source_cbt_subject_id) {
          this.gradingSubjectRepo.updateMeta(existing.id, cbt.mode || existing.mode || "exam", cbt.id);
        }
      }
    }

    const gsubs = this.gradingSubjectRepo.findByTeacher(teacherId, termId);

    return gsubs.filter(gs => {
      if (gs.source_cbt_subject_id) {
        const sourceSub = this.db.prepare("SELECT s.term_id, s.term, t.id as term_id_from_name FROM subjects s LEFT JOIN academic_terms t ON s.term = t.name WHERE s.id = ?").get(gs.source_cbt_subject_id) as any;
        if (sourceSub) {
          const matchesTerm = sourceSub.term_id === termId || sourceSub.term_id_from_name === termId;
          if (!matchesTerm) return false;
        }
      }
      return true;
    }).map(gs => {
      let students_completed = 0, students_enrolled = 0, avg_score_pct: number | null = null;
      let is_approved = false;

      if (gs.source_cbt_subject_id) {
        const cbt = cbtWithSubmissions.find((c: any) => c.id === gs.source_cbt_subject_id);
        if (cbt) {
          students_completed = cbt.students_completed || 0;
          students_enrolled = cbt.students_enrolled || 0;
          avg_score_pct = cbt.avg_score_pct;
        }
      }
      const approved = this.db.prepare("SELECT is_approved FROM term_results WHERE grading_subject_id = ? AND is_approved = 1 LIMIT 1").get(gs.id);
      is_approved = !!approved;

      return { ...gs, students_completed, students_enrolled, avg_score_pct, is_approved };
    });
  }

  createGradingSubject(data: {
    name: string;
    code: string;
    classId?: number | null;
    termId: number;
    sessionId: number;
    teacherId: number;
    mode?: string;
    actorId: number;
  }): GradingSubject {
    const config = this.getConfig();
    const subject = this.gradingSubjectRepo.create({
      name: data.name,
      code: data.code,
      class_id: data.classId,
      term_id: data.termId,
      session_id: data.sessionId,
      teacher_id: data.teacherId,
      mode: data.mode || "exam"
    });

    this.gradingPolicyRepo.create({
      grading_subject_id: subject.id,
      name: "Written Exam",
      type: "manual",
      mapped_cbt_subject_id: null,
      max_marks: config.exam_max,
      is_exam: 1
    });
    for (const tmpl of config.default_ca_template) {
      this.gradingPolicyRepo.create({
        grading_subject_id: subject.id,
        name: tmpl.name,
        type: "manual",
        mapped_cbt_subject_id: null,
        max_marks: tmpl.marks,
        is_exam: 0
      });
    }

    auditService.log(data.actorId, "GRADING_SUBJECT_CREATE", "grading_subject", subject.id, JSON.stringify({ code: data.code }));
    return subject;
  }

  getPolicies(subjectId: number): GradingPolicy[] {
    return this.gradingPolicyRepo.findBySubject(subjectId);
  }

  updatePolicies(subjectId: number, policies: Array<Partial<GradingPolicy> & { id?: number }>, passMark: number | null, actorId: number, actorRole: string): void {
    const subject = this.gradingSubjectRepo.findById(subjectId);
    if (!subject) throw new Error("Grading subject not found");
    if (actorRole !== "operator" && subject.teacher_id !== actorId) throw new Error("Not authorized");

    const existingResults = this.termResultRepo.findApprovedBySubject(subjectId);
    if (existingResults.length > 0) throw new Error("Results are already approved and locked");

    const config = this.getConfig();
    let caTotal = 0;
    let examTotal = 0;
    for (const p of policies) {
      if (p.is_exam) examTotal += Number(p.max_marks);
      else caTotal += Number(p.max_marks);
    }
    if (caTotal !== config.ca_max) throw new Error(`Continuous Assessment total must be exactly ${config.ca_max} marks. Currently: ${caTotal}`);
    if (examTotal !== config.exam_max) throw new Error(`Examination total must be exactly ${config.exam_max} marks. Currently: ${examTotal}`);

    this.db.transaction(() => {
      this.gradingPolicyRepo.updatePassMark(subjectId, passMark);

      const existingPolicies = this.gradingPolicyRepo.findBySubject(subjectId);
      const incomingIds = new Set(policies.filter(p => p.id).map(p => Number(p.id)));

      for (const ep of existingPolicies) {
        if (!incomingIds.has(ep.id)) {
          this.db.prepare("DELETE FROM grading_policies WHERE id = ?").run(ep.id);
        }
      }

      for (const p of policies) {
        if (p.id) {
          this.db.prepare(`
            UPDATE grading_policies
            SET name = ?, type = ?, mapped_cbt_subject_id = ?, max_marks = ?, is_exam = ?
            WHERE id = ? AND grading_subject_id = ?
          `).run(
            p.name, p.type, p.mapped_cbt_subject_id || null, p.max_marks, p.is_exam ? 1 : 0,
            p.id, subjectId
          );
        } else {
          this.gradingPolicyRepo.create({
            grading_subject_id: subjectId,
            name: p.name!,
            type: p.type!,
            mapped_cbt_subject_id: p.mapped_cbt_subject_id,
            max_marks: p.max_marks!,
            is_exam: p.is_exam ? 1 : 0
          });
        }
      }
    })();

    auditService.log(actorId, "GRADING_POLICIES_UPDATE", "grading_subject", subjectId, JSON.stringify({ policies_count: policies.length }));
  }

  getScores(subjectId: number): any {
    const subject = this.gradingSubjectRepo.findById(subjectId);
    if (!subject) throw new Error("Grading subject not found");

    const policies = this.gradingPolicyRepo.findBySubject(subjectId);
    const students = this.getGradingStudents(subjectId);

    const cbtScores: Record<number, Record<number, number>> = {};
    for (const p of policies) {
      if ((p.type === 'cbt_test' || p.type === 'cbt_exam') && p.mapped_cbt_subject_id) {
        const exams = this.examRepo.findCompletedBySubject(p.mapped_cbt_subject_id);
        for (const e of exams) {
          if (!cbtScores[p.id]) cbtScores[p.id] = {};
          let scaledScore = 0;
          if (e.total_score > 0 && e.score != null) {
            scaledScore = (e.score / e.total_score) * p.max_marks;
          }
          cbtScores[p.id][e.student_id] = Number(scaledScore.toFixed(2));
        }
      }
    }

    const manualScores = this.manualScoreRepo.findBySubject(subjectId);
    const manualMap: Record<number, Record<number, number>> = {};
    for (const ms of manualScores) {
      if (!manualMap[ms.grading_policy_id]) manualMap[ms.grading_policy_id] = {};
      manualMap[ms.grading_policy_id][ms.student_id] = ms.score;
    }

    const termResults = this.termResultRepo.findBySubject(subjectId);

    return { students, policies, manualScores: manualMap, cbtScores, termResults, pass_mark: subject.pass_mark };
  }

  private getGradingStudents(subjectId: number): any[] {
    return this.termResultRepo.getGradingStudents(subjectId);
  }

  saveScores(subjectId: number, scores: Array<{ grading_policy_id: number; student_id: number; score: number }>, actorId: number, actorRole: string): void {
    const subject = this.gradingSubjectRepo.findById(subjectId);
    if (!subject) throw new Error("Grading subject not found");
    if (actorRole !== "operator" && subject.teacher_id !== actorId) throw new Error("Not authorized");

    const termResultsCheck = this.termResultRepo.findApprovedBySubject(subjectId);
    if (termResultsCheck.length > 0) throw new Error("Results are locked");

    this.db.transaction(() => {
      for (const entry of scores) {
        this.manualScoreRepo.upsert(entry.grading_policy_id, entry.student_id, entry.score, actorId);
      }

      this.recomputeDraftResults(subjectId, subject.term_id, subject.session_id);
    })();
  }

  private recomputeDraftResults(subjectId: number, termId: number, sessionId: number): void {
    const policies = this.gradingPolicyRepo.findBySubject(subjectId);
    const students = this.getGradingStudents(subjectId);
    const config = this.getConfig();

    const cbtScoresByPolicy: Record<number, Record<number, number>> = {};
    for (const p of policies) {
      if ((p.type === 'cbt_test' || p.type === 'cbt_exam') && p.mapped_cbt_subject_id) {
        const exams = this.examRepo.findCompletedBySubject(p.mapped_cbt_subject_id);
        for (const e of exams) {
          if (!cbtScoresByPolicy[p.id]) cbtScoresByPolicy[p.id] = {};
          let scaledScore = 0;
          if (e.total_score > 0 && e.score != null) {
            scaledScore = (e.score / e.total_score) * p.max_marks;
          }
          cbtScoresByPolicy[p.id][e.student_id] = Number(scaledScore.toFixed(2));
        }
      }
    }

    const manualScores = this.manualScoreRepo.findBySubject(subjectId);
    const manualMap: Record<number, Record<number, number>> = {};
    for (const ms of manualScores) {
      if (!manualMap[ms.grading_policy_id]) manualMap[ms.grading_policy_id] = {};
      manualMap[ms.grading_policy_id][ms.student_id] = ms.score;
    }

    function getGradeScale(total: number, passMark: number | null): { grade: string; remark: string } {
      if (passMark != null && passMark > 0) {
        if (total >= passMark) return { grade: "PASS", remark: "Pass" };
        return { grade: "FAIL", remark: "Fail" };
      }
      const sorted = [...config.grade_scale].sort((a, b) => b.min - a.min);
      for (const s of sorted) {
        if (total >= s.min) return { grade: s.grade, remark: s.label };
      }
      return { grade: "F", remark: "Fail" };
    }

    for (const st of students) {
      let caScore = 0;
      let examScore = 0;
      for (const p of policies) {
        let score = 0;
        if (p.type === 'manual') {
          score = manualMap[p.id]?.[st.id] || 0;
        } else {
          score = cbtScoresByPolicy[p.id]?.[st.id] || 0;
        }
        if (p.is_exam) examScore += score;
        else caScore += score;
      }
      const totalScore = Number((caScore + examScore).toFixed(2));
      const scale = getGradeScale(totalScore, subject.pass_mark);
      this.termResultRepo.upsert({
        id: 0,
        student_id: st.id,
        grading_subject_id: subjectId,
        ca_score: Number(caScore.toFixed(2)),
        exam_score: Number(examScore.toFixed(2)),
        total_score: totalScore,
        grade: scale.grade,
        remark: scale.remark,
        is_approved: 0,
        term_id: termId,
        session_id: sessionId,
        updated_at: new Date().toISOString()
      });
    }
  }

  approveResults(subjectId: number, actorId: number, actorRole: string): void {
    const subject = this.gradingSubjectRepo.findById(subjectId);
    if (!subject) throw new Error("Grading subject not found");
    if (actorRole !== "operator" && subject.teacher_id !== actorId) throw new Error("Not authorized");

    this.db.transaction(() => {
      this.recomputeDraftResults(subjectId, subject.term_id, subject.session_id);
      this.termResultRepo.approveAll(subjectId);
    })();

    auditService.log(actorId, "GRADING_APPROVE", "grading_subject", subjectId, "{}");
  }

  unapproveResults(subjectId: number, actorId: number, actorRole: string): void {
    const subject = this.gradingSubjectRepo.findById(subjectId);
    if (!subject) throw new Error("Grading subject not found");
    if (actorRole !== "operator" && subject.teacher_id !== actorId) throw new Error("Not authorized");

    this.termResultRepo.unapproveAll(subjectId);
    auditService.log(actorId, "GRADING_UNAPPROVE", "grading_subject", subjectId, "{}");
  }

  getAnnualResults(sessionId: number): any {
    const studentAverages = this.annualResultRepo.getStudentAverages(sessionId);
    const classEnrollments = this.classEnrollmentRepo.findByStudent(0); // Would need session filter
    const existingResults = this.annualResultRepo.findBySession(sessionId);

    return { studentAverages, classEnrollments, existingResults };
  }

  promoteStudent(data: {
    studentId: number;
    sessionId: number;
    promotionStatus: "Promoted" | "Repeated" | "Graduated";
    totalAverage: number;
    classId?: number | null;
    actorId: number;
  }): void {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.annualResultRepo.upsert({
        id: 0,
        student_id: data.studentId,
        class_id: data.classId,
        session_id: data.sessionId,
        total_average: data.totalAverage,
        promotion_status: data.promotionStatus,
        approved_by: data.actorId,
        updated_at: now
      });

      if (data.promotionStatus === 'Promoted' || data.promotionStatus === 'Graduated') {
        const currentGrade = this.db.prepare(
          "SELECT gl.id, gl.sort_order FROM grade_levels gl JOIN users u ON u.grade_level_id = gl.id WHERE u.id = ?"
        ).get(data.studentId) as any;

        if (currentGrade) {
          const nextGrade = this.db.prepare(
            "SELECT id FROM grade_levels WHERE sort_order > ? ORDER BY sort_order ASC LIMIT 1"
          ).get(currentGrade.sort_order) as any;

          if (nextGrade) {
            this.db.prepare("UPDATE users SET grade_level_id = ? WHERE id = ?").run(nextGrade.id, data.studentId);
          }
        }
      }
    })();
  }

  getStudentReportCard(studentId: number, sessionId?: number, termId?: number): any[] {
    return this.termResultRepo.getStudentResultsForReportCard(studentId, sessionId, termId);
  }

  private get db(): Database {
    // Access to db for raw queries - would be better to inject
    return (this.gradingSubjectRepo as any).db;
  }
}