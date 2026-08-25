import { Database } from "bun:sqlite";
import { ExamRepository } from "../repositories/exam.repository";
import { StudentAnswerRepository } from "../repositories/exam.repository";
import { ExamAttemptRepository } from "../repositories/exam.repository";
import { SubjectRepository } from "../repositories/subject.repository";
import { QuestionRepository } from "../repositories/subject.repository";
import { UserRepository } from "../repositories/user.repository";
import { SubjectEnrollmentRepository } from "../repositories/exam.repository";
import { auditService } from "./audit.service";
import { notificationService } from "./notification.service";
import type { Exam, StudentAnswer, ExamAttempt, Question, Subject } from "../types";
import { sqlInt } from "../utils/validation";

export class ExamService {
  private examRepo: ExamRepository;
  private answerRepo: StudentAnswerRepository;
  private attemptRepo: ExamAttemptRepository;
  private subjectRepo: SubjectRepository;
  private questionRepo: QuestionRepository;
  private userRepo: UserRepository;
  private enrollmentRepo: SubjectEnrollmentRepository;

  constructor(db: Database) {
    this.examRepo = new ExamRepository(db);
    this.answerRepo = new StudentAnswerRepository(db);
    this.attemptRepo = new ExamAttemptRepository(db);
    this.subjectRepo = new SubjectRepository(db);
    this.questionRepo = new QuestionRepository(db);
    this.userRepo = new UserRepository(db);
    this.enrollmentRepo = new SubjectEnrollmentRepository(db);
  }

  startExam(studentId: number, subjectId: number, sessionId: number | null, termId: number | null): Exam {
    const subject = this.subjectRepo.findById(subjectId);
    if (!subject) throw new Error("Subject not found");

    if (subject.is_published !== 1) throw new Error("Exam is not published");

    const enrollment = this.enrollmentRepo.isEnrolled(subjectId, studentId);
    if (!enrollment) throw new Error("Student not enrolled in this subject");

    const existing = this.examRepo.findByStudentAndSubject(studentId, subjectId);
    if (existing) {
      if (existing.status === "in-progress") {
        // Re-sync deadline if missing (for exams started before deadline column existed)
        if (!existing.deadline) {
          const durationMs = (subject.duration || 45) * 60_000;
          const deadlineIso = new Date(Date.parse(existing.start_time) + durationMs).toISOString();
          this.examRepo.setDeadline(existing.id, deadlineIso);
          existing.deadline = deadlineIso;
        }
        return existing;
      }
      if (existing.status === "completed" && subject.can_retake !== 1) {
        throw new Error("Exam completed and retakes not allowed");
      }
    }

    const student = this.userRepo.findById(studentId);
    if (!student) throw new Error("Student not found");

    const exam = this.examRepo.startExam(studentId, subjectId, sessionId, termId, student.reg_id || "");

    // Server-side deadline: start_time + duration (in minutes)
    const durationMs = (subject.duration || 45) * 60_000;
    const deadlineIso = new Date(Date.parse(exam.start_time) + durationMs).toISOString();
    this.examRepo.setDeadline(exam.id, deadlineIso);
    exam.deadline = deadlineIso;

    return exam;
  }

  /**
   * Check if an exam has passed its deadline. If so, lock it.
   * Returns true if the exam is past deadline.
   */
  checkAndEnforceDeadline(examId: number): boolean {
    const exam = this.examRepo.findById(examId);
    if (!exam || !exam.deadline || exam.status !== "in-progress") return false;

    const now = Date.now();
    const deadline = Date.parse(exam.deadline);
    if (now >= deadline) {
      // Auto-lock the exam — student can no longer save or submit
      this.examRepo.lockExam(examId);
      auditService.log(0, "EXAM_DEADLINE_ENFORCED", "exam", examId, JSON.stringify({ deadline: exam.deadline }));
      return true;
    }
    return false;
  }

  /**
   * Returns seconds remaining until exam deadline (server-authoritative).
   * Returns 0 if no deadline or past deadline.
   */
  getRemainingSeconds(examId: number): number {
    const exam = this.examRepo.findById(examId);
    if (!exam || !exam.deadline) return 0;
    const now = Date.now();
    const deadline = Date.parse(exam.deadline);
    return Math.max(0, Math.floor((deadline - now) / 1000));
  }

  saveAnswers(examId: number, answers: Array<{ questionId: number; selectedOption?: number; essayResponse?: string }>): Exam {
    const exam = this.examRepo.findById(examId);
    if (!exam) throw new Error("Exam not found");
    if (exam.status !== "in-progress") throw new Error("Exam is not in progress");

    // Server-side deadline enforcement
    if (exam.deadline && Date.now() >= Date.parse(exam.deadline)) {
      this.examRepo.lockExam(examId);
      throw new Error("Exam time has expired. Answers cannot be saved.");
    }

    const answersJson = JSON.stringify(answers);
    return this.examRepo.saveAnswers(examId, answersJson)!;
  }

  submitExam(examId: number, studentId: number, answers: Array<{ questionId: number; selectedOption?: number; essayResponse?: string }>): Exam {
    const exam = this.examRepo.findById(examId);
    if (!exam) throw new Error("Exam not found");
    if (exam.student_id !== studentId) throw new Error("Unauthorized");
    if (exam.status !== "in-progress") throw new Error("Exam already submitted");

    // Server-side deadline enforcement
    if (exam.deadline && Date.now() >= Date.parse(exam.deadline)) {
      // Allow submission if already past deadline — just lock and grade what we have
      console.warn(`[EXAM] Exam ${examId} submitted after deadline ${exam.deadline}`);
    }

    const questions = this.questionRepo.findBySubject(exam.subject_id);
    let score = 0;
    let totalScore = 0;

    const answerDetails: StudentAnswer[] = [];

    for (const answer of answers) {
      const question = questions.find(q => q.id === answer.questionId);
      if (!question) continue;

      totalScore += question.marks;
      let isCorrect = 0;
      let marksAwarded = 0;

      if (question.question_type === "objective" || question.question_type === "true_false") {
        if (answer.selectedOption === question.correct_answer) {
          isCorrect = 1;
          marksAwarded = question.marks;
          score += question.marks;
        }
      } else if (question.question_type === "essay") {
        // Essay questions require manual grading
        marksAwarded = 0;
      }

      answerDetails.push({
        id: 0,
        exam_id: examId,
        question_id: answer.questionId,
        student_id: studentId,
        subject_id: exam.subject_id,
        selected_option: answer.selectedOption,
        essay_response: answer.essayResponse,
        is_correct: isCorrect,
        marks_awarded: marksAwarded,
        created_at: new Date().toISOString()
      });
    }

    this.answerRepo.bulkUpsert(answerDetails);

    const endTime = new Date().toISOString();
    const submitted = this.examRepo.submitExam(examId, score, totalScore, endTime)!;

    auditService.log(studentId, "EXAM_SUBMIT", "exam", examId, JSON.stringify({ score, total_score: totalScore }));

    const subject = this.subjectRepo.findById(exam.subject_id);
    if (subject && subject.teacher_id) {
      const essayCount = answerDetails.filter(a => {
        const q = questions.find(q => q.id === a.question_id);
        return q?.question_type === "essay";
      }).length;
      const msg = essayCount > 0
        ? `Student submitted exam for ${subject.name} — ${essayCount} essay question${essayCount > 1 ? "s" : ""} need grading`
        : `Student submitted exam for ${subject.name}`;
      notificationService.createForUser(subject.teacher_id, "exam_submitted", msg, `/teacher/grading`);
    }

    return submitted;
  }

  getExamWithDetails(examId: number, role: string, userId: number): any {
    const exam = this.examRepo.findById(examId);
    if (!exam) throw new Error("Exam not found");

    if (role === "student" && exam.student_id !== userId) throw new Error("Forbidden");
    if (role === "teacher") {
      const subject = this.subjectRepo.findById(exam.subject_id);
      if (!subject || subject.teacher_id !== userId) throw new Error("Forbidden");
    }

    const questions = this.questionRepo.findBySubject(exam.subject_id);
    const answers = this.answerRepo.findByExam(examId);

    const questionMap = new Map(questions.map(q => [q.id, q]));
    const answerMap = new Map(answers.map(a => [a.question_id, a]));

    const questionsWithAnswers = questions.map(q => {
      const answer = answerMap.get(q.id);
      return {
        ...q,
        student_answer: answer ? {
          selected_option: answer.selected_option,
          essay_response: answer.essay_response,
          is_correct: answer.is_correct,
          marks_awarded: answer.marks_awarded
        } : null,
        correct_answer: role === "student" ? undefined : q.correct_answer
      };
    });

    return {
      exam,
      questions: questionsWithAnswers,
      subject: this.subjectRepo.findById(exam.subject_id)
    };
  }

  getStudentExams(studentId: number, sessionId?: number, termId?: number) {
    return this.examRepo.findByStudent(studentId);
  }

  getSubjectExams(subjectId: number, status?: string): Exam[] {
    if (status) {
      return this.examRepo.findBySubject(subjectId).filter(e => e.status === status);
    }
    return this.examRepo.findBySubject(subjectId);
  }

  getCompletedExamsForSubject(subjectId: number): Exam[] {
    return this.examRepo.findCompletedBySubject(subjectId);
  }

  addTeacherRemark(examId: number, remark: string, actorId: number, actorRole: string): Exam | null {
    const exam = this.examRepo.findById(examId);
    if (!exam) throw new Error("Exam not found");
    if (exam.status !== "completed") throw new Error("Exam must be completed");

    if (actorRole === "teacher") {
      const subject = this.subjectRepo.findById(exam.subject_id);
      if (!subject || subject.teacher_id !== actorId) throw new Error("Not your subject");
    }

    const updated = this.examRepo.updateTeacherRemark(examId, remark);
    if (updated) {
      auditService.log(actorId, "EXAM_REMARK", "exam", examId, JSON.stringify({ type: "teacher" }));
      const subject = this.subjectRepo.findById(exam.subject_id);
      if (subject) {
        notificationService.createForOperators("remark_added", `Teacher added a remark for ${subject.name}`, "/ADMIN/report-card");
      }
    }
    return updated;
  }

  addPrincipalRemark(examId: number, remark: string, actorId: number): Exam | null {
    const exam = this.examRepo.findById(examId);
    if (!exam) throw new Error("Exam not found");
    if (exam.status !== "completed") throw new Error("Exam must be completed");

    const updated = this.examRepo.updatePrincipalRemark(examId, remark);
    if (updated) {
      auditService.log(actorId, "EXAM_PRINCIPAL_REMARK", "exam", examId, JSON.stringify({ type: "principal" }));
      const subject = this.subjectRepo.findById(exam.subject_id);
      if (subject && subject.teacher_id) {
        notificationService.createForUser(subject.teacher_id, "remark_added", `Admin added a principal remark for ${subject.name}`, "/teacher/results");
      }
    }
    return updated;
  }

  gradeEssay(examId: number, questionId: number, marksAwarded: number, feedback: string | undefined, actorId: number, actorRole: string): void {
    const exam = this.examRepo.findById(examId);
    if (!exam) throw new Error("Exam not found");
    if (exam.status !== "completed") throw new Error("Exam not completed");

    if (actorRole === "teacher") {
      const subject = this.subjectRepo.findById(exam.subject_id);
      if (!subject || subject.teacher_id !== actorId) throw new Error("Not your subject");
    }

    const question = this.questionRepo.findById(questionId);
    if (!question) throw new Error("Question not found");
    if (marksAwarded > question.marks) throw new Error("Marks exceed question maximum");

    this.answerRepo.upsert({
      exam_id: examId,
      question_id: questionId,
      student_id: exam.student_id,
      subject_id: exam.subject_id,
      marks_awarded: marksAwarded,
      is_correct: marksAwarded > 0 ? 1 : 0
    });

    const answers = this.answerRepo.findByExam(examId);
    const newScore = answers.reduce((sum, a) => sum + a.marks_awarded, 0);
    this.examRepo.update(examId, { score: newScore });

    auditService.log(actorId, "EXAM_GRADE_ESSAY", "exam", examId, JSON.stringify({ question_id: questionId, marks_awarded: marksAwarded }));
  }

  retakeExam(examId: number, studentId: number): Exam {
    const exam = this.examRepo.findById(examId);
    if (!exam) throw new Error("Exam not found");
    if (exam.student_id !== studentId) throw new Error("Not your exam");
    if (exam.status !== "completed") throw new Error("Exam not completed");

    const subject = this.subjectRepo.findById(exam.subject_id);
    if (!subject || subject.can_retake !== 1) throw new Error("Retakes not allowed for this subject");

    if (subject.exam_datetime) {
      const now = Date.now();
      const start = Date.parse(subject.exam_datetime);
      const end = start + (subject.window_duration || 120) * 60_000;
      if (now >= end) throw new Error("Exam window has closed");
    }

    const attemptNumber = (exam.retake_count || 0) + 1;
    this.attemptRepo.archiveAttempt(exam, attemptNumber);
    this.answerRepo.deleteByExam(examId);

    const reset = this.examRepo.resetForRetake(examId, studentId);
    if (!reset) throw new Error("Failed to reset exam");

    auditService.log(studentId, "EXAM_RETAKE", "exam", examId, JSON.stringify({ retake_count: attemptNumber }));
    return reset;
  }

  getActiveExams(studentId: number): Exam[] {
    return this.examRepo.findInProgressByStudent(studentId);
  }

  getExamStats(studentId: number, sessionId?: number, termId?: number) {
    return this.examRepo.getStudentExamStats(studentId, sessionId, termId);
  }

  lockExam(examId: number): Exam | null {
    return this.examRepo.lockExam(examId);
  }

  unlockExam(examId: number): Exam | null {
    return this.examRepo.unlockExam(examId);
  }
}