export interface User {
  id: number;
  name: string;
  email: string;
  role: "student" | "teacher" | "operator";
  grade?: string | null;
  phone?: string | null;
  is_active?: boolean | number;
  reg_id?: string | null;
}

export interface EnrolledStudent {
  id: number;
  name: string;
  email: string;
  grade?: string | null;
  reg_id?: string | null;
  enrolled_at?: string;
  score?: number;
  total_score?: number;
  exam_status?: string;
  exam_id?: number;
  student_user_id?: number;
}

export interface Subject {
  id: number;
  name: string;
  code: string;
  term: string;
  exam_datetime?: string | null;
  duration?: number;
  window_duration?: number;
  is_published?: number;
  teacher_id?: number;
  total_score?: number;
  can_retake?: number;
  retake_count?: number;
  exam_id?: number; // When active for student
  instructions?: string;
  is_assignment?: number; // 1 if offline-capable assignment
  mode?: string; // "exam", "test", "quiz"
}

export interface ExamResult {
  id: number;
  subject_id: number;
  student_user_id: number;
  student_name?: string;
  subject_name?: string;
  grade?: string;
  reg_id?: string;
  score: number;
  total_score: number;
  status: string;
  end_time?: string;
  answered_questions?: number;
  total_questions?: number;
  teacher_remark?: string | null;
  principal_remark?: string | null;
}

export interface Question {
  id: number;
  subject_id: number;
  question_text: string;
  question_type: string;
  options_json?: string;
  image_url?: string | null;
  marks?: number;
  is_file_upload?: number; // 1 if question requires file upload
  attached_file_url?: string | null; // teacher attached file
}

export interface ActiveExamData {
  exams: Subject[];
  server_time: string;
}

export interface Config {
  id?: number;
  description?: string;
  favicon?: string;
  admin_name?: string;
  org_name?: string;
  licence_key?: string;
  licence_type?: string;
  theme_json?: string;
  version?: string;
  admin_email?: string;
  registration_open?: boolean;
}

export interface AuditLog {
  id: number;
  timestamp: string;
  actor_name?: string;
  actor_id?: number;
  action: string;
  resource?: string;
  resource_id?: number;
}
