import { Database } from "bun:sqlite";

export interface Auth {
  userId: number;
  role: string;
  token: string;
  jti: string;
}

export type SubjectAction = "read" | "write" | "delete" | "publish" | "schedule" | "enrollment" | "questions" | "grade" | "remarks";
export type GradingAction = "read" | "write" | "delete" | "publish" | "scores" | "approve";

export class AuthorizationService {
  private teacherSubjectCache = new Map<number, { subjects: number[]; expires: number }>();
  private classTeacherCache = new Map<number, { classId: number | null; expires: number }>();

  constructor(private db: Database, private queries: any) {}

  canAccessSubject(auth: Auth, subjectId: number, action: SubjectAction): boolean {
    if (auth.role === "operator") return true;

    const subject = this.queries.getSubjectById.get(subjectId) as any;
    if (!subject) return false;

    const isOwner = subject.teacher_id === auth.userId;
    if (!isOwner) return false;

    switch (action) {
      case "read":
      case "write":
      case "questions":
      case "grade":
      case "remarks":
        return true;
      case "delete":
        return this.canDeleteSubject(subject);
      case "publish":
        return !subject.is_published;
      case "schedule":
        return true;
      case "enrollment":
        return true;
      default:
        return false;
    }
  }

  private canDeleteSubject(subject: any): boolean {
    const hasExams = this.queries.getSubjectExamCheck.get(subject.id);
    return !hasExams;
  }

  canAccessGradingSubject(auth: Auth, gsId: number, action: GradingAction): boolean {
    if (auth.role === "operator") return true;

    const gs = this.queries.getGradingSubjectById.get(gsId) as any;
    if (!gs) return false;

    const isOwner = gs.teacher_id === auth.userId;
    if (!isOwner) return false;

    switch (action) {
      case "read":
      case "write":
      case "scores":
        return true;
      case "publish":
        return true;
      case "approve":
        return true;
      case "delete":
        return false;
      default:
        return false;
    }
  }

  canManageEnrollment(auth: Auth, subjectId: number): boolean {
    if (auth.role === "operator") return true;
    return this.canAccessSubject(auth, subjectId, "enrollment");
  }

  isClassTeacherForStudent(auth: Auth, studentId: number): boolean {
    if (auth.role !== "teacher") return false;

    const cached = this.classTeacherCache.get(auth.userId);
    if (cached && cached.expires > Date.now()) {
      if (!cached.classId) return false;
      const enrolled = this.db.prepare(
        "SELECT 1 FROM users u LEFT JOIN grade_levels gl ON gl.id = u.grade_level_id LEFT JOIN classes c ON c.name = COALESCE(gl.name, u.grade) WHERE u.id = ? AND (c.id = ? OR EXISTS (SELECT 1 FROM class_enrollments ce WHERE ce.student_id = u.id AND ce.class_id = ?)) LIMIT 1"
      ).get(studentId, cached.classId, cached.classId);
      return !!enrolled;
    }

    const teacherClass = this.queries.getClassForTeacher.get(auth.userId) as any;
    this.classTeacherCache.set(auth.userId, {
      classId: teacherClass?.id || null,
      expires: Date.now() + 5 * 60 * 1000
    });

    if (!teacherClass) return false;

    const enrolled = this.db.prepare(
      "SELECT 1 FROM users u LEFT JOIN grade_levels gl ON gl.id = u.grade_level_id LEFT JOIN classes c ON c.name = COALESCE(gl.name, u.grade) WHERE u.id = ? AND (c.id = ? OR EXISTS (SELECT 1 FROM class_enrollments ce WHERE ce.student_id = u.id AND ce.class_id = ?)) LIMIT 1"
    ).get(studentId, teacherClass.id, teacherClass.id);
    return !!enrolled;
  }

  getTeacherSubjects(auth: Auth): number[] {
    if (auth.role !== "teacher") return [];

    const cached = this.teacherSubjectCache.get(auth.userId);
    if (cached && cached.expires > Date.now()) {
      return cached.subjects;
    }

    const subjects = this.queries.getSubjectsByTeacher.all(auth.userId) as any[];
    const subjectIds = subjects.map(s => s.id);

    this.teacherSubjectCache.set(auth.userId, {
      subjects: subjectIds,
      expires: Date.now() + 5 * 60 * 1000
    });

    return subjectIds;
  }

  canClassTeacherViewGradingSubject(auth: Auth, gsId: number): boolean {
    if (auth.role === "operator") return true;
    if (auth.role !== "teacher") return false;

    const gs = this.queries.getGradingSubjectById.get(gsId) as any;
    if (!gs) return false;

    const isPublishedToClass = gs.is_published_to_class === 1;
    if (!isPublishedToClass) return false;

    const teacherClass = this.queries.getClassForTeacher.get(auth.userId) as any;
    if (!teacherClass) return false;

    if (gs.class_id && gs.class_id !== teacherClass.id) return false;

    return true;
  }

  invalidateTeacherCache(userId: number): void {
    this.teacherSubjectCache.delete(userId);
    this.classTeacherCache.delete(userId);
  }

  hasPermission(auth: Auth, permission: string): boolean {
    if (auth.role === "operator") return true;

    const row = this.db.prepare(
      "SELECT 1 FROM role_permissions WHERE role = ? AND permission = ?"
    ).get(auth.role, permission);
    return !!row;
  }
}

export function createAuthorizationService(db: Database, queries: any): AuthorizationService {
  return new AuthorizationService(db, queries);
}