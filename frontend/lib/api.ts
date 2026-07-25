import type { User, Subject, Question, ExamResult, ActiveExamData, Config, AuditLog, EnrolledStudent } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || ""; // Supports external backends on Vercel

/** Next.js `trailingSlash: true` uses `/setup/`; avoid full-page redirects that reload the SPA while already on setup. */
export function isSetupRoute(): boolean {
  if (typeof window === "undefined") return false;
  const p = window.location.pathname.replace(/\/+$/, "") || "/";
  return p === "/setup";
}

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  role: "student" | "teacher" | "operator";
  grade?: string | null;
};

export type SessionInfo = {
  user: SessionUser | null;
  setupRequired: boolean;
};

function isSessionUser(value: unknown): value is SessionUser {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  const role = o.role;
  return (
    typeof o.id === "number" &&
    typeof o.name === "string" &&
    typeof o.email === "string" &&
    (role === "student" || role === "teacher" || role === "operator")
  );
}

/** Session probe: never navigates. Used on initial load and /setup so 401/503 do not cause redirect loops. */
export async function getSession(): Promise<SessionInfo> {
  const res = await fetch(API_BASE + "/api/auth/me", {
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
  });
  if (res.status === 503) {
    const body = await res.json().catch(() => ({}));
    const setup = (body as { setup?: boolean }).setup;
    return { user: null, setupRequired: setup !== false };
  }
  if (res.status === 401) return { user: null, setupRequired: false };
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
  }
  const body = await res.json().catch(() => ({}));
  const data = "data" in body ? (body as { data: unknown }).data : body;
  const raw = data && typeof data === "object" && "user" in (data as object) ? (data as { user: unknown }).user : data;
  const user = isSessionUser(raw) ? raw : null;
  return { user, setupRequired: false };
}

type FetchAuthBehavior = {
  redirectOn401?: boolean;
  redirectOn503?: boolean;
};

export async function fetchWithAuth<T = any>(url: string, options: RequestInit = {}, behavior: FetchAuthBehavior = {}): Promise<T> {
  const redirectOn401 = behavior.redirectOn401 ?? true;
  const redirectOn503 = behavior.redirectOn503 ?? true;
  const res = await fetch(API_BASE + url, {
    ...options,
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (res.status === 401) {
    if (redirectOn401) {
      if (!isSetupRoute()) window.location.href = "/";
      return null as unknown as T;
    }
  }

  if (res.status === 503) {
    if (redirectOn503 && !isSetupRoute()) window.location.href = "/setup/";
    return null as unknown as T;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const body = await res.json().catch(() => ({}));
  if ("data" in body) return body.data;
  if ("message" in body) return body;
  return body;
}

export const api = {
  setup: (data: any) => fetchWithAuth<any>("/api/setup", { method: "POST", body: JSON.stringify(data) }),
  register: (data: any) => fetchWithAuth<any>("/api/auth/register", { method: "POST", body: JSON.stringify(data) }),
  login: (data: any) => fetchWithAuth<any>("/api/auth/login", { method: "POST", body: JSON.stringify(data) }, { redirectOn401: false }),
  me: () => getSession().then((s) => s.user),
  logout: () => fetchWithAuth<any>("/api/auth/logout", { method: "POST" }),
  getSubjects: () => fetchWithAuth<Subject[]>("/api/subjects"),
  createSubject: (data: any) => fetchWithAuth<Subject>("/api/subjects", { method: "POST", body: JSON.stringify(data) }),
  updateSubject: (id: number, data: any) =>
    fetchWithAuth<Subject>(`/api/subjects/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSubject: (id: number) => fetchWithAuth<any>(`/api/subjects/${id}`, { method: "DELETE" }),
  getQuestions: (subjectId: number) => fetchWithAuth<Question[]>(`/api/subjects/${subjectId}/questions`),
  createQuestion: (data: any) => fetchWithAuth<Question>("/api/questions", { method: "POST", body: JSON.stringify(data) }),
  updateQuestion: (id: number, data: any) =>
    fetchWithAuth<Question>(`/api/questions/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteQuestion: (id: number) => fetchWithAuth<any>(`/api/questions/${id}`, { method: "DELETE" }),
  startExam: (subjectId: number) =>
    fetchWithAuth<any>("/api/exams/start", { method: "POST", body: JSON.stringify({ subject_id: subjectId }) }),
  saveExam: (examId: number, answers: any[]) =>
    fetchWithAuth<any>(`/api/exams/${examId}/save`, { method: "POST", body: JSON.stringify({ answers }) }),
  /** Submit exam and send all answers in the same request (ensures scoring even if auto-save failed) */
  submitExamWithAnswers: (examId: number, answers: any[]) =>
    fetchWithAuth<any>(`/api/exams/${examId}/submit`, { method: "POST", body: JSON.stringify({ answers }) }),
  startPractice: (practiceId: string) =>
    fetchWithAuth<any>(`/api/practice/start?practiceId=${practiceId}`, { method: "POST" }),
  submitPractice: (practiceId: string, answers: any[]) =>
    fetchWithAuth<any>(`/api/practice/submit?practiceId=${practiceId}`, { method: "POST", body: JSON.stringify({ answers }) }),
  getContentManifest: () => fetchWithAuth<any>("/api/sync/content/manifest"),
  /** @deprecated Use submitExamWithAnswers instead */
  submitExam: (examId: number) => fetchWithAuth<any>(`/api/exams/${examId}/submit`, { method: "POST", body: JSON.stringify({ answers: [] }) }),
  getResults: () => fetchWithAuth<ExamResult[]>("/api/exams/results"),
  retakeExam: (examId: number) => fetchWithAuth<any>(`/api/exams/${examId}/retake`, { method: "POST" }),
  /** Get in-progress exams for the current student (for resume detection) */
  getActiveExams: () => fetchWithAuth<ActiveExamData | Subject[]>("/api/exams/active"),
  getUsers: () => fetchWithAuth<User[]>("/api/users"),
  deleteUser: (id: number) => fetchWithAuth<any>(`/api/users/${id}`, { method: "DELETE" }),
  createOperator: (data: any) => fetchWithAuth<User>("/api/users/operator", { method: "POST", body: JSON.stringify(data) }),
  getAuditLogs: () => fetchWithAuth<AuditLog[]>("/api/audit-logs"),
  /** Export database as binary download (streams file directly — do not use fetchWithAuth which parses JSON) */
  exportDb: () => {
    window.open("/api/settings/export", "_blank");
  },
  importDb: (data: any) => fetchWithAuth<any>("/api/settings/import", { method: "POST", body: JSON.stringify(data) }),
  resetDb: (confirmation: string) =>
    fetchWithAuth<any>("/api/settings/reset", { method: "POST", body: JSON.stringify({ confirm: confirmation }) }),
  /** Get only teachers */
  getTeachers: () => fetchWithAuth<User[]>("/api/users?role=teacher"),
  /** Update user profile fields */
  updateUser: (id: number, data: any) =>
    fetchWithAuth<User>(`/api/users/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  /** Activate a deactivated user */
  activateUser: (id: number) =>
    fetchWithAuth<User>(`/api/users/${id}`, { method: "PUT", body: JSON.stringify({ is_active: true }) }),
  /** Reset user password (operator only) */
  resetPassword: (id: number, newPassword: string) =>
    fetchWithAuth<any>(`/api/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ new_password: newPassword }) }),
  /** Assign (or reassign) a teacher to a subject */
  assignTeacher: (subjectId: number, teacherId: number) =>
    fetchWithAuth<Subject>(`/api/subjects/${subjectId}`, { method: "PUT", body: JSON.stringify({ teacher_id: teacherId }) }),
  /** Toggle publish state of a subject */
  togglePublish: (subjectId: number, isPublished: boolean) =>
    fetchWithAuth<Subject>(`/api/subjects/${subjectId}`, { method: "PUT", body: JSON.stringify({ is_published: isPublished ? 1 : 0 }) }),
  /** Get school config */
  getConfig: () => fetchWithAuth<Config>("/api/config"),
  /** Update school config */
  updateConfig: (data: any) => fetchWithAuth<Config>("/api/config", { method: "PUT", body: JSON.stringify(data) }),
  /** Change authenticated user's password */
  changePassword: (current_password: string, new_password: string) =>
    fetchWithAuth<any>("/api/auth/change-password", { method: "POST", body: JSON.stringify({ current_password, new_password }) }),
  /** Promote or demote a student's grade */
  updateStudentGrade: (studentId: number, grade: string) =>
    fetchWithAuth<any>(`/api/users/${studentId}/grade`, { method: "PUT", body: JSON.stringify({ grade }) }),
  /** Get per-question exam review detail */
  getExamReview: (examId: number) => fetchWithAuth<any>(`/api/exams/${examId}/review`),
  /** Trigger results CSV download */
  exportResultsCsv: () => {
    // Direct window navigation so the browser handles the file download
    window.open("/api/exams/results/export", "_blank");
  },
  /** Get all students enrolled in a subject (with their scores) */
  getSubjectStudents: (subjectId: number) => fetchWithAuth<EnrolledStudent[]>(`/api/subjects/${subjectId}/students`),
  /** Enroll a student into a subject (operator only) */
  enrollStudent: (subjectId: number, studentId: number) =>
    fetchWithAuth<any>(`/api/subjects/${subjectId}/students`, { method: "POST", body: JSON.stringify({ student_id: studentId }) }),
  /** Unenroll a student from a subject (operator only) */
  unenrollStudent: (subjectId: number, studentId: number) =>
    fetchWithAuth<any>(`/api/subjects/${subjectId}/students/${studentId}`, { method: "DELETE" }),
  /** Get all students (for enrollment UI) */
  getStudents: () => fetchWithAuth<User[]>("/api/users?role=student"),
  /** Full student profile: enrolled subjects + exam stats */
  getMyProfile: () => fetchWithAuth<any>("/api/users/me/profile"),
  /** Bulk-enroll all active students in a grade into a subject */
  bulkEnrollByGrade: (subjectId: number, grade: string) =>
    fetchWithAuth<any>(`/api/subjects/${subjectId}/students/bulk`, { method: "POST", body: JSON.stringify({ grade }) }),
  /** Get a student's exam for a specific subject (teacher/operator use — for review lookup) */
  getExamByStudentSubject: (studentId: number, subjectId: number) =>
    fetchWithAuth<any>(`/api/exams/by-student-subject?student_id=${studentId}&subject_id=${subjectId}`),
  /** Get all completed exams for a student (for report card generation) */
  getStudentExams: (studentId: number) => fetchWithAuth<ExamResult[]>(`/api/users/${studentId}/exams?t=${Date.now()}`),
  /** Save teacher's remark for a specific completed exam */
  saveTeacherRemark: (examId: number, remark: string) =>
    fetchWithAuth<any>(`/api/exams/${examId}/remarks`, { method: "PUT", body: JSON.stringify({ remark }) }),
  /** Save principal/admin remark for a specific completed exam */
  savePrincipalRemark: (examId: number, remark: string) =>
    fetchWithAuth<any>(`/api/exams/${examId}/principal-remark`, { method: "PUT", body: JSON.stringify({ remark }) }),
  /** Grade an essay answer (teacher/operator) */
  gradeEssay: (examId: number, questionId: number, marksAwarded: number, feedback?: string) =>
    fetchWithAuth<any>(`/api/exams/${examId}/grade`, { method: "POST", body: JSON.stringify({ question_id: questionId, marks_awarded: marksAwarded, feedback }) }),
  /** Get term remark for a student */
  getTermRemark: (studentId: number, term: string) =>
    fetchWithAuth<any>(`/api/users/${studentId}/term-remarks/${encodeURIComponent(term)}`),
  /** Save term remark for a student (role determines if it's teacher or principal) */
  saveTermRemark: (studentId: number, term: string, remark: string) =>
    fetchWithAuth<any>(`/api/users/${studentId}/term-remarks/${encodeURIComponent(term)}`, { method: "PUT", body: JSON.stringify({ remark }) }),
  /** Get public school settings: name, current term, admin name, logo — accessible to all roles */
  getPublicSettings: () => fetchWithAuth<Config>("/api/settings/public"),
  /** Upload a file (PDF) */
  uploadFile: async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    // Uses native fetch directly because fetchWithAuth defaults to application/json
    const token = localStorage.getItem("exampool_token");
    const res = await fetch(process.env.NEXT_PUBLIC_API_URL ? `${process.env.NEXT_PUBLIC_API_URL}/api/upload` : "/api/upload", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    if (!res.ok) throw new Error("Upload failed");
    const json = await res.json();
    return json.data as { url: string };
  },
  /** Get assignments for offline caching */
  getOfflineAssignments: () => fetchWithAuth<{ assignments: any[] }>("/api/offline/assignments"),
  /** Sync offline answers */
  syncOfflineAssignments: (exams: any[]) => fetchWithAuth<{ synced: number }>("/api/offline/sync", { method: "POST", body: JSON.stringify({ exams }) }),
  /** Get system network and custom domain settings (Operator only) */
  getSystemSettings: () => fetchWithAuth<{ custom_url: string; server_ip: string; server_port: number; dns_active: boolean }>("/api/system/settings"),
  /** Update custom domain URL (Operator only) */
  updateSystemSettings: (data: { custom_url: string }) => fetchWithAuth<{ custom_url: string; server_ip: string; server_port: number; dns_active: boolean }>("/api/system/settings", { method: "PUT", body: JSON.stringify(data) }),
};
