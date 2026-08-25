export interface User {
  id: number;
  name: string;
  email: string;
  role: "student" | "teacher" | "operator" | "guardian";
  grade?: string | null;
  phone?: string | null;
  is_active?: boolean | number;
  reg_id?: string | null;
  is_class_teacher?: boolean;
  assigned_class_id?: number | null;
  assigned_class_name?: string | null;
}

export interface GradeLevel {
  id: number;
  name: string;
  category: string;
  sort_order: number;
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
  description?: string | null;
  class?: string | null;
  grade_level_id?: number | null;
  session?: string | null;
  exam_datetime?: string | null;
  duration?: number;
  window_duration?: number;
  is_published?: number;
  teacher_id?: number;
  total_score?: number;
  can_retake?: number;
  retake_count?: number;
  exam_id?: number;
  instructions?: string;
  is_assignment?: number;
  mode?: string;
  question_count?: number;
  session_id?: number;
  term_id?: number;
  assessment_type?: "learning_practice" | "learning_mock" | "school_test" | "school_exam" | string;
  result_policy?: "immediate" | "manual" | "scheduled" | string;
  result_release_time?: string | null;
}

export interface ExamResult {
  id: number;
  subject_id: number;
  student_user_id: number;
  student_name?: string;
  subject_name?: string;
  grade?: string;
  grade_level_id?: number | string;
  reg_id?: string;
  score: number | null;
  total_score: number;
  status: string;
  created_at?: string;
  end_time?: string;
  answered_questions?: number;
  total_questions?: number;
  teacher_remark?: string | null;
  principal_remark?: string | null;
  result_status?: "released" | "hidden" | "scheduled" | string;
  result_policy?: "immediate" | "manual" | "scheduled" | string;
  result_release_time?: string | null;
  is_result_released?: boolean;
  practice_id?: string | null;
}

export interface Question {
  id: number;
  subject_id: number;
  question_text: string;
  question_type: "objective" | "true_false" | "essay" | string;
  options_json?: string;
  correct_answer?: number | string;
  teacher_answer?: string | null;
  explanation?: string | null;
  solution?: string | null;
  image_url?: string | null;
  marks?: number;
  is_file_upload?: number;
  attached_file_url?: string | null;
  is_solution_revealed?: boolean;
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

export interface AcademicSession {
  id: number;
  name: string;
  is_active: number;
  start_date?: string;
  end_date?: string;
}

export interface AcademicTerm {
  id: number;
  session_id: number;
  name: string;
  is_active: number;
  start_date?: string;
  end_date?: string;
}

export interface TimetableEntry {
  id: number;
  subject_id: number;
  subject_name?: string;
  subject_code?: string;
  exam_datetime: string;
  duration: number;
  window_duration?: number;
  is_timetable_published?: number;
  term?: string;
}

export interface ContentPackage {
  id: string | number;
  exam_body?: string;
  year?: number;
  subject?: string;
  subject_code?: string;
  name?: string;
  type?: string;
  paper_type?: string;
  content_count?: number;
  question_count?: number;
  created_at?: string;
}

export interface ContentQuestion {
  id: number;
  exam_body?: string;
  year?: number;
  subject_code?: string;
  paper_type?: string;
  question_text: string;
  options_json?: string;
  options?: string[];
  correct_answer: string | number;
  solution_text?: string | null;
  difficulty?: number;
  topic_tag?: string | null;
  diagram_path?: string | null;
}

export interface LogEntry {
  ts: string;
  level: string;
  msg: string;
}

export interface StudentTelemetry {
  streak: number;
  bestStreak: number;
  todayQuestions: number;
  dailyGoal: number;
  practicePercent: number;
  rank: number;
  cohortTotal: number;
  cohortName: string;
}

export interface PracticeReviewItem {
  question_id: number;
  question_text: string;
  options: string[];
  selected_option: number | string | null;
  correct_answer: number | string;
  is_correct: boolean;
  solution_text?: string | null;
  solution?: string | null;
  explanation?: string | null;
  topic_tag?: string | null;
  difficulty?: number | null;
}
