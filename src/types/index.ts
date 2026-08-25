export type Role = "student" | "teacher" | "operator" | "guardian";

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  password_hash: string;
  grade?: string | null;
  reg_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  address?: string | null;
  phone?: string | null;
  dob?: string | null;
  image_url?: string | null;
  avatar_url?: string | null;
  is_active: number;
  session_id?: number | null;
  term_id?: number | null;
  grade_level_id?: number | null;
  created_at: string;
}

export interface SafeUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  grade?: string | null;
  reg_id?: string | null;
  is_active: number;
  is_class_teacher?: boolean;
  assigned_class_id?: number | null;
  assigned_class_name?: string | null;
  assigned_class_section?: string | null;
  grade_level_name?: string | null;
}

export interface Subject {
  id: number;
  name: string;
  code: string;
  term: string;
  duration: number;
  total_score: number;
  exam_datetime: string;
  is_published: number;
  teacher_id: number;
  created_by: number;
  created_at: string;
  description?: string | null;
  class?: string | null;
  session?: string | null;
  mode?: string;
  instructions?: string | null;
  is_timetable_published?: number;
  window_duration?: number;
  can_retake?: number;
  is_assignment?: number;
  session_id?: number | null;
  term_id?: number | null;
  grade_level_id?: number | null;
}

export interface Question {
  id: number;
  subject_id: number;
  question_text: string;
  options_json: string;
  correct_answer: number;
  marks: number;
  order_index: number;
  created_at: string;
  updated_at?: string | null;
  question_type?: string;
  session?: string | null;
  term?: string | null;
  mode?: string;
  teacher_answer?: string | null;
  image_url?: string | null;
  is_file_upload?: number;
  attached_file_url?: string | null;
  session_id?: number | null;
  term_id?: number | null;
}

export interface Exam {
  id: number;
  student_id: number;
  subject_id: number;
  start_time: string;
  end_time?: string | null;
  answers_json: string;
  score?: number | null;
  total_score: number;
  status: "in-progress" | "completed";
  created_at: string;
  session?: string | null;
  term?: string | null;
  mode?: string | null;
  retake_count?: number;
  reg_id?: string | null;
  teacher_remark?: string | null;
  principal_remark?: string | null;
  session_id?: number | null;
  term_id?: number | null;
  is_locked?: number;
  deadline?: string | null;
}

export interface ExamAttempt {
  id: number;
  exam_id: number;
  student_id: number;
  subject_id: number;
  attempt_number: number;
  start_time: string;
  end_time?: string | null;
  answers_json: string;
  score?: number | null;
  total_score: number;
  status: string;
  archived_at: string;
}

export interface StudentAnswer {
  id: number;
  exam_id: number;
  question_id: number;
  student_id: number;
  subject_id: number;
  selected_option?: number | null;
  essay_response?: string | null;
  is_correct: number;
  marks_awarded: number;
  created_at: string;
  file_url?: string | null;
  session_id?: number | null;
  term_id?: number | null;
}

export interface SubjectEnrollment {
  id: number;
  subject_id: number;
  student_id: number;
  enrolled_by: number;
  enrolled_at: string;
}

export interface AcademicSession {
  id: number;
  name: string;
  is_active: number;
  status: "active" | "archived";
  created_at: string;
}

export interface AcademicTerm {
  id: number;
  session_id: number;
  name: string;
  start_date?: string | null;
  end_date?: string | null;
  is_active: number;
  status: "active" | "archived" | "locked";
  registration_open: number;
  created_at: string;
}

export interface Term {
  id: number;
  session: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: number;
  registration_open: number;
  created_at: string;
}

export interface Class {
  id: number;
  name: string;
  section?: string | null;
  level: "junior" | "senior";
  created_at: string;
  class_teacher_id?: number | null;
}

export interface GradeLevel {
  id: number;
  name: string;
  category: string;
  sort_order: number;
  is_active: number;
  created_at: string;
}

export interface ClassEnrollment {
  id: number;
  student_id: number;
  class_id: number;
  term_id: number;
  enrollment_date: string;
}

export interface GuardianStudentLink {
  id: number;
  guardian_id: number;
  student_id: number;
  relationship: string;
  status: "pending" | "approved" | "rejected" | "revoked";
  verification_method: "manual_admin" | "dob_match" | "pin_match";
  verified_by_data?: string | null;
  verified_by?: number | null;
  verified_at?: string | null;
  created_at: string;
}

export interface Timetable {
  id: number;
  subject_id: number;
  class?: string | null;
  section?: string | null;
  exam_date: string;
  start_time: string;
  end_time: string;
  duration: number;
  exam_mode: "CBT" | "Assignment" | "Offline";
  allow_students: number;
  created_at: string;
  updated_at: string;
  grade_level_id?: number | null;
}

export interface GradingSubject {
  id: number;
  name: string;
  code: string;
  class_id?: number | null;
  term_id: number;
  session_id: number;
  teacher_id: number;
  created_at: string;
  mode?: string | null;
  source_cbt_subject_id?: number | null;
  pass_mark?: number | null;
}

export interface GradingPolicy {
  id: number;
  grading_subject_id: number;
  name: string;
  type: "cbt_test" | "cbt_exam" | "manual";
  mapped_cbt_subject_id?: number | null;
  max_marks: number;
  is_exam: number;
  created_at: string;
}

export interface GradingManualScore {
  id: number;
  grading_policy_id: number;
  student_id: number;
  score: number;
  entered_by: number;
  updated_at: string;
}

export interface TermResult {
  id: number;
  student_id: number;
  grading_subject_id: number;
  ca_score: number;
  exam_score: number;
  total_score: number;
  grade?: string | null;
  remark?: string | null;
  is_approved: number;
  term_id: number;
  session_id: number;
  updated_at: string;
}

export interface AnnualResult {
  id: number;
  student_id: number;
  class_id?: number | null;
  session_id: number;
  total_average: number;
  promotion_status?: "Promoted" | "Repeated" | "Graduated" | null;
  approved_by?: number | null;
  updated_at: string;
}

export interface AuditLog {
  id: number;
  timestamp: string;
  actor_id: number;
  action: string;
  resource: string;
  resource_id?: number | null;
  details: string;
}

export interface Notification {
  id: number;
  user_id: number;
  type: string;
  message: string;
  link?: string | null;
  is_read: number;
  created_at: string;
}

export interface StudentTermRemark {
  id: number;
  student_id: number;
  term: string;
  teacher_remark?: string | null;
  principal_remark?: string | null;
  updated_at: string;
  session_id?: number | null;
  term_id?: number | null;
}

export interface ClassTeacherAssignment {
  id: number;
  class_id: number;
  teacher_id?: number | null;
  assigned_by: number;
  action: "assigned" | "reassigned" | "unassigned";
  assigned_at: string;
  notes?: string | null;
}

export interface Config {
  id: number;
  description?: string | null;
  favicon?: string | null;
  admin_name?: string | null;
  org_name: string;
  licence_key?: string | null;
  licence_type: "basic" | "standard" | "premium";
  theme_json: string;
  version: string;
  admin_email?: string | null;
  admin_password_hash?: string | null;
  updated_at: string;
  grading_config_json?: string | null;
}

export interface Settings {
  key: string;
  value: string;
  updated_at: string;
}

export interface TokenPayload {
  userId: number;
  role: Role;
  iat: number;
  exp: number;
}

export interface RateLimitRecord {
  count: number;
  resetAt: number;
}

export interface SSEClient {
  userId: number;
  controller: ReadableStreamDefaultController;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiResponse<T> {
  data?: T;
  message?: string;
  error?: string;
  setup?: boolean;
}

export interface GradingConfig {
  ca_max: number;
  exam_max: number;
  passing_score: number;
  grade_scale: Array<{ grade: string; min: number; label: string }>;
  default_ca_template: Array<{ name: string; type: string; marks: number }>;
}