import { Migration } from "./types";

export const migration: Migration = {
  id: "20240101000000_initial_schema",
  name: "Initial schema - core tables",
  description: "Creates all core tables: users, subjects, questions, exams, config, settings, audit_logs, student_answers, subject_enrollments, token_blacklist",
  
  up: (db) => {
    // Core tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        description TEXT,
        favicon TEXT,
        admin_name TEXT,
        org_name TEXT NOT NULL DEFAULT 'ExamPool School',
        licence_key TEXT,
        licence_type TEXT NOT NULL DEFAULT 'basic' CHECK(licence_type IN ('basic','standard','premium')),
        theme_json TEXT NOT NULL DEFAULT '{}',
        version TEXT NOT NULL DEFAULT '1.0.0',
        admin_email TEXT,
        admin_password_hash TEXT,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('student', 'teacher', 'operator', 'guardian')),
        password_hash TEXT NOT NULL,
        grade TEXT,
        reg_id TEXT,
        first_name TEXT,
        last_name TEXT,
        address TEXT,
        phone TEXT,
        dob TEXT,
        image_url TEXT,
        avatar_url TEXT,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
        session_id INTEGER,
        term_id INTEGER,
        grade_level_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS grade_levels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS classes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        section TEXT,
        level TEXT NOT NULL DEFAULT 'junior' CHECK(level IN ('junior','senior')),
        class_teacher_id INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        UNIQUE(name, section)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS subjects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        term TEXT NOT NULL,
        duration INTEGER NOT NULL CHECK(duration > 0 AND duration <= 360),
        total_score INTEGER NOT NULL DEFAULT 0,
        exam_datetime TEXT NOT NULL,
        is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0,1)),
        teacher_id INTEGER NOT NULL,
        created_by INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        description TEXT,
        class TEXT,
        session TEXT,
        mode TEXT NOT NULL DEFAULT 'exam' CHECK(mode IN ('test','exam','quiz')),
        instructions TEXT,
        is_timetable_published INTEGER NOT NULL DEFAULT 0,
        window_duration INTEGER NOT NULL DEFAULT 120,
        can_retake INTEGER NOT NULL DEFAULT 1,
        is_assignment INTEGER NOT NULL DEFAULT 0,
        session_id INTEGER,
        term_id INTEGER,
        grade_level_id INTEGER,
        FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE RESTRICT,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
        UNIQUE(code, term)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_id INTEGER NOT NULL,
        question_text TEXT NOT NULL,
        options_json TEXT NOT NULL DEFAULT '[]',
        correct_answer INTEGER NOT NULL CHECK (correct_answer BETWEEN 0 AND 3),
        marks INTEGER NOT NULL CHECK (marks > 0),
        order_index INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        updated_at TEXT,
        question_type TEXT NOT NULL DEFAULT 'objective' CHECK(question_type IN ('objective','essay','true_false')),
        session TEXT,
        term TEXT,
        mode TEXT NOT NULL DEFAULT 'exam' CHECK(mode IN ('test','exam','quiz')),
        teacher_answer TEXT,
        image_url TEXT,
        is_file_upload INTEGER NOT NULL DEFAULT 0,
        attached_file_url TEXT,
        session_id INTEGER,
        term_id INTEGER,
        FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS exams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        subject_id INTEGER NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT,
        answers_json TEXT NOT NULL DEFAULT '[]',
        score REAL,
        total_score INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'in-progress' CHECK(status IN ('in-progress', 'completed')),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        session TEXT,
        term TEXT,
        mode TEXT,
        retake_count INTEGER NOT NULL DEFAULT 0,
        reg_id TEXT,
        teacher_remark TEXT,
        principal_remark TEXT,
        session_id INTEGER,
        term_id INTEGER,
        is_locked INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE RESTRICT,
        FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT,
        UNIQUE(student_id, subject_id)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS exam_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exam_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        subject_id INTEGER NOT NULL,
        attempt_number INTEGER NOT NULL DEFAULT 1,
        start_time TEXT NOT NULL,
        end_time TEXT,
        answers_json TEXT NOT NULL DEFAULT '[]',
        score REAL,
        total_score INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'completed',
        archived_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE RESTRICT,
        FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS student_answers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exam_id INTEGER NOT NULL,
        question_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        subject_id INTEGER NOT NULL,
        selected_option INTEGER,
        essay_response TEXT,
        is_correct INTEGER NOT NULL DEFAULT 0 CHECK(is_correct IN (0,1)),
        marks_awarded REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        file_url TEXT,
        session_id INTEGER,
        term_id INTEGER,
        FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
        FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
        FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE RESTRICT,
        FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
        UNIQUE(exam_id, question_id)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS subject_enrollments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        enrolled_by INTEGER NOT NULL,
        enrolled_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
        FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (enrolled_by) REFERENCES users(id) ON DELETE RESTRICT,
        UNIQUE(subject_id, student_id)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        actor_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        resource_id INTEGER,
        details TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS token_blacklist (
        token TEXT PRIMARY KEY,
        invalidated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);

    db.exec(`
      INSERT OR IGNORE INTO settings (key, value) VALUES 
        ('SCHEMA_VERSION', '1'),
        ('REGISTRATION_OPEN', 'true'),
        ('CURRENT_TERM', '2026-T1'),
        ('SCHOOL_NAME', 'Exampool School')
    `);

    db.exec(`INSERT OR IGNORE INTO config (id, org_name, version) VALUES (1, 'ExamPool School', '1.0.0')`);

    // Core indexes
    db.exec("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_users_reg ON users(reg_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_users_grade_level ON users(grade_level_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_subjects_teacher ON subjects(teacher_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_subjects_published ON subjects(term, is_published)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_subjects_mode ON subjects(mode)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_subjects_session_term ON subjects(session_id, term_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject_id, order_index)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_questions_type ON questions(question_type)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_exams_student ON exams(student_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_exams_subject ON exams(subject_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_exams_status ON exams(status)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_exams_student_status ON exams(student_id, status)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_exams_subject_status ON exams(subject_id, status)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_exams_session_term ON exams(session_id, term_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource, resource_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_sa_exam ON student_answers(exam_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_sa_student ON student_answers(student_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_sa_question ON student_answers(question_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_sa_subject ON student_answers(subject_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_se_subject ON subject_enrollments(subject_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_se_student ON subject_enrollments(student_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_attempts_student ON exam_attempts(student_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_attempts_subject ON exam_attempts(subject_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_attempts_exam ON exam_attempts(exam_id)");
  },
  
  down: (db) => {
    db.exec("DROP INDEX IF EXISTS idx_attempts_exam");
    db.exec("DROP INDEX IF EXISTS idx_attempts_subject");
    db.exec("DROP INDEX IF EXISTS idx_attempts_student");
    db.exec("DROP INDEX IF EXISTS idx_se_student");
    db.exec("DROP INDEX IF EXISTS idx_se_subject");
    db.exec("DROP INDEX IF EXISTS idx_sa_subject");
    db.exec("DROP INDEX IF EXISTS idx_sa_question");
    db.exec("DROP INDEX IF EXISTS idx_sa_student");
    db.exec("DROP INDEX IF EXISTS idx_sa_exam");
    db.exec("DROP INDEX IF EXISTS idx_audit_resource");
    db.exec("DROP INDEX IF EXISTS idx_audit_timestamp");
    db.exec("DROP INDEX IF EXISTS idx_audit_actor");
    db.exec("DROP INDEX IF EXISTS idx_exams_subject_status");
    db.exec("DROP INDEX IF EXISTS idx_exams_student_status");
    db.exec("DROP INDEX IF EXISTS idx_exams_status");
    db.exec("DROP INDEX IF EXISTS idx_exams_subject");
    db.exec("DROP INDEX IF EXISTS idx_exams_student");
    db.exec("DROP INDEX IF EXISTS idx_questions_type");
    db.exec("DROP INDEX IF EXISTS idx_questions_subject");
    db.exec("DROP INDEX IF EXISTS idx_subjects_session_term");
    db.exec("DROP INDEX IF EXISTS idx_subjects_mode");
    db.exec("DROP INDEX IF EXISTS idx_subjects_published");
    db.exec("DROP INDEX IF EXISTS idx_subjects_teacher");
    db.exec("DROP INDEX IF EXISTS idx_users_grade_level");
    db.exec("DROP INDEX IF EXISTS idx_users_reg");
    db.exec("DROP INDEX IF EXISTS idx_users_role");
    db.exec("DROP INDEX IF EXISTS idx_users_email");

    db.exec("DROP TABLE IF EXISTS token_blacklist");
    db.exec("DROP TABLE IF EXISTS audit_logs");
    db.exec("DROP TABLE IF EXISTS subject_enrollments");
    db.exec("DROP TABLE IF EXISTS student_answers");
    db.exec("DROP TABLE IF EXISTS exam_attempts");
    db.exec("DROP TABLE IF EXISTS exams");
    db.exec("DROP TABLE IF EXISTS questions");
    db.exec("DROP TABLE IF EXISTS subjects");
    db.exec("DROP TABLE IF EXISTS classes");
    db.exec("DROP TABLE IF EXISTS grade_levels");
    db.exec("DROP TABLE IF EXISTS users");
    db.exec("DROP TABLE IF EXISTS config");
    db.exec("DROP TABLE IF EXISTS settings");
  },
};

export default migration;