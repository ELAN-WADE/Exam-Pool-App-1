import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";

/**
 * Absolute path so the same file is always used regardless of process cwd.
 * Override with env EXAMPOOL_DB if needed (e.g. tests).
 */
export const EXAMPOOL_DB_PATH = Bun.env.EXAMPOOL_DB || path.join(import.meta.dir, "exampool.db");

const dbDir = path.dirname(EXAMPOOL_DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(EXAMPOOL_DB_PATH, { create: true });

db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA foreign_keys = ON");
db.run("PRAGMA busy_timeout = 5000");
db.run("PRAGMA synchronous = NORMAL");
db.run("PRAGMA cache_size = -8000");

// Attach auxiliary databases for ExamPool v4.1 Naija Hybrid
const contentBankPath = path.join(dbDir, "content_bank.db");
const practiceLogsPath = path.join(dbDir, "practice_logs.db");

// Create files if they don't exist to ensure ATTACH works predictably
if (!fs.existsSync(practiceLogsPath)) fs.writeFileSync(practiceLogsPath, "");
if (!fs.existsSync(contentBankPath)) fs.writeFileSync(contentBankPath, "");

db.run(`ATTACH DATABASE '${contentBankPath.replace(/'/g, "''")}' AS content_bank`);
db.run(`ATTACH DATABASE '${practiceLogsPath.replace(/'/g, "''")}' AS practice_logs`);
db.run(`PRAGMA practice_logs.journal_mode = WAL`);
db.run(`PRAGMA practice_logs.synchronous = NORMAL`);

// Create content_bank schemas before making it read-only
db.run(`
  CREATE TABLE IF NOT EXISTS content_bank.content_bank (
      id INTEGER PRIMARY KEY,
      exam_body TEXT CHECK(exam_body IN ('JAMB','WAEC','NECO','NABTEB')),
      year INTEGER,
      subject_code TEXT,
      paper_type TEXT,
      question_text TEXT,
      question_text_local TEXT,
      options_json TEXT,
      correct_answer TEXT,
      solution_text TEXT,
      difficulty INTEGER CHECK(difficulty BETWEEN 1 AND 5),
      topic_tag TEXT,
      diagram_path TEXT,
      fts_document TEXT
  )
`);
db.run(`
  CREATE VIRTUAL TABLE IF NOT EXISTS content_bank.content_bank_fts USING fts5(
      question_text,
      topic_tag,
      content='content_bank',
      content_rowid='id'
  )
`);

// content_bank is restricted by application logic (practiceFirewall)

/**
 * Allowlist of tables that may be altered via safe migration.
 * Prevents SQL injection if this function is ever called with dynamic input.
 */
const ALTERABLE_TABLES = new Set([
  "users", "subjects", "questions", "exams", "config",
  "subject_enrollments", "student_answers", "audit_logs",
  "student_term_remarks", "notifications", "kiosk_sessions",
  "license_registry", "content_manifest", "question_map",
]);

/** Run ALTER TABLE only if the column doesn't exist yet (idempotent migration). */
function addColumnIfMissing(table: string, column: string, definition: string): void {
  if (!ALTERABLE_TABLES.has(table)) {
    throw new Error(`[db] addColumnIfMissing: table '${table}' is not in the alterable allowlist`);
  }
  // Column names are validated by PRAGMA — never interpolate user input here
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function initializeDatabase(): void {
  db.run("CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))");
  const schemaVersion = db.prepare("SELECT value FROM settings WHERE key = ?").get("SCHEMA_VERSION") as { value?: string } | null;

  if (!schemaVersion || schemaVersion.value === "1") {
    // One-time schema reset for v2 architecture.
    db.run("DROP TABLE IF EXISTS exams");
    db.run("DROP TABLE IF EXISTS questions");
    db.run("DROP TABLE IF EXISTS subjects");
    db.run("DROP TABLE IF EXISTS audit_logs");
    db.run("DROP TABLE IF EXISTS users");
    db.run("DROP TABLE IF EXISTS config");
    db.run("DROP TABLE IF EXISTS settings");
    db.run("CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))");
  }

  // ── users ────────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      email         TEXT UNIQUE NOT NULL,
      role          TEXT NOT NULL CHECK(role IN ('student', 'teacher', 'operator')),
      password_hash TEXT NOT NULL,
      grade         TEXT CHECK (role != 'student' OR grade IS NOT NULL),
      is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `);

  // v3 extensions — safe migrations (add only if missing)
  addColumnIfMissing("users", "reg_id",     "TEXT");
  addColumnIfMissing("users", "first_name", "TEXT");
  addColumnIfMissing("users", "last_name",  "TEXT");
  addColumnIfMissing("users", "address",    "TEXT");
  addColumnIfMissing("users", "phone",      "TEXT");
  addColumnIfMissing("users", "dob",        "TEXT");
  addColumnIfMissing("users", "image_url",  "TEXT");

  // ── subjects ─────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS subjects (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      code          TEXT NOT NULL,
      term          TEXT NOT NULL,
      duration      INTEGER NOT NULL CHECK(duration > 0 AND duration <= 360),
      total_score   INTEGER NOT NULL DEFAULT 0,
      exam_datetime TEXT NOT NULL,
      is_published  INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0,1)),
      teacher_id    INTEGER NOT NULL,
      created_by    INTEGER NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
      UNIQUE(code, term)
    )
  `);

  // v3 extensions
  addColumnIfMissing("subjects", "description", "TEXT");
  addColumnIfMissing("subjects", "class",       "TEXT");
  addColumnIfMissing("subjects", "session",     "TEXT");
  addColumnIfMissing("subjects", "mode",        "TEXT NOT NULL DEFAULT 'exam' CHECK(mode IN ('test','exam','quiz'))");
  addColumnIfMissing("subjects", "instructions","TEXT");
  addColumnIfMissing("subjects", "is_timetable_published", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("subjects", "window_duration", "INTEGER NOT NULL DEFAULT 120");
  addColumnIfMissing("subjects", "can_retake", "INTEGER NOT NULL DEFAULT 1");
  // Offline assignments
  addColumnIfMissing("subjects", "is_assignment", "INTEGER NOT NULL DEFAULT 0");

  // ── questions ────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS questions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id     INTEGER NOT NULL,
      question_text  TEXT NOT NULL,
      options_json   TEXT NOT NULL DEFAULT '[]',
      correct_answer INTEGER NOT NULL CHECK (correct_answer BETWEEN 0 AND 3),
      marks          INTEGER NOT NULL CHECK (marks > 0),
      order_index    INTEGER NOT NULL,
      created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at     TEXT,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
    )
  `);

  // v3 extensions
  addColumnIfMissing("questions", "question_type",   "TEXT NOT NULL DEFAULT 'objective' CHECK(question_type IN ('objective','essay','true_false'))");
  addColumnIfMissing("questions", "session",         "TEXT");
  addColumnIfMissing("questions", "term",            "TEXT");
  addColumnIfMissing("questions", "mode",            "TEXT NOT NULL DEFAULT 'exam' CHECK(mode IN ('test','exam','quiz'))");
  addColumnIfMissing("questions", "teacher_answer",  "TEXT");
  // v4 extensions — image support for CBT
  addColumnIfMissing("questions", "image_url",       "TEXT");
  // Offline assignments
  addColumnIfMissing("questions", "is_file_upload",  "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("questions", "attached_file_url", "TEXT");

  // ── exams (result table) ─────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS exams (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id   INTEGER NOT NULL,
      subject_id   INTEGER NOT NULL,
      start_time   TEXT NOT NULL,
      end_time     TEXT,
      answers_json TEXT NOT NULL DEFAULT '[]',
      score        REAL,
      status       TEXT NOT NULL DEFAULT 'in-progress' CHECK(status IN ('in-progress', 'completed')),
      created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT,
      UNIQUE(student_id, subject_id)
    )
  `);

  // v3: per-question result tracking
  addColumnIfMissing("exams", "session",           "TEXT");
  addColumnIfMissing("exams", "term",              "TEXT");
  addColumnIfMissing("exams", "mode",              "TEXT");
  addColumnIfMissing("exams", "total_score",       "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("exams", "retake_count",      "INTEGER NOT NULL DEFAULT 0");
  // v6: backfill any legacy NULL total_score rows to 0 to prevent NULL arithmetic in score % calculations
  db.run("UPDATE exams SET total_score = 0 WHERE total_score IS NULL");
  // v4: denormalised reg_id for fast result lookup
  addColumnIfMissing("exams", "reg_id",            "TEXT");
  // v5: per-student per-exam remarks
  addColumnIfMissing("exams", "teacher_remark",    "TEXT");
  addColumnIfMissing("exams", "principal_remark",  "TEXT");

  // ── exam_attempts — historical archive of every completed attempt (retakes) ──
  // The `exams` table only holds the CURRENT/LATEST attempt per student+subject.
  // Before a retake resets that row, it is archived here for audit & history.
  db.run(`
    CREATE TABLE IF NOT EXISTS exam_attempts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id       INTEGER NOT NULL,
      student_id    INTEGER NOT NULL,
      subject_id    INTEGER NOT NULL,
      attempt_number INTEGER NOT NULL DEFAULT 1,
      start_time    TEXT NOT NULL,
      end_time      TEXT,
      answers_json  TEXT NOT NULL DEFAULT '[]',
      score         REAL,
      total_score   INTEGER NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'completed',
      archived_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_attempts_student  ON exam_attempts(student_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_attempts_subject  ON exam_attempts(subject_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_attempts_exam     ON exam_attempts(exam_id)");

  // ── config ───────────────────────────────────────────────────────────────
  // Full Config table as per data structure diagram
  db.run(`
    CREATE TABLE IF NOT EXISTS config (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      description      TEXT,
      favicon          TEXT,
      admin_name       TEXT,
      org_name         TEXT NOT NULL DEFAULT 'ExamPool School',
      licence_key      TEXT,
      licence_type     TEXT NOT NULL DEFAULT 'basic' CHECK(licence_type IN ('basic','standard','premium')),
      theme_json            TEXT NOT NULL DEFAULT '{}',
      version               TEXT NOT NULL DEFAULT '1.0.0',
      admin_email           TEXT,
      admin_password_hash   TEXT,
      updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `);

  // ── student_answers ──────────────────────────────────────────────────────
  // Per-question granular tracking; populated on exam submit.
  db.run(`
    CREATE TABLE IF NOT EXISTS student_answers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id         INTEGER NOT NULL,
      question_id     INTEGER NOT NULL,
      student_id      INTEGER NOT NULL,
      subject_id      INTEGER NOT NULL,
      selected_option INTEGER,
      essay_response  TEXT,
      is_correct      INTEGER NOT NULL DEFAULT 0 CHECK(is_correct IN (0,1)),
      marks_awarded   REAL NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      FOREIGN KEY (exam_id)     REFERENCES exams(id) ON DELETE CASCADE,
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id)  REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (subject_id)  REFERENCES subjects(id) ON DELETE CASCADE,
      UNIQUE(exam_id, question_id)
    )
  `);

  // Offline assignments
  addColumnIfMissing("student_answers", "file_url", "TEXT");

  // v4: safe migration — add admin_password_hash to config
  addColumnIfMissing("config", "admin_password_hash", "TEXT");

  // ── audit_logs ───────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      actor_id    INTEGER NOT NULL,
      action      TEXT NOT NULL,
      resource    TEXT NOT NULL,
      resource_id INTEGER,
      details     TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT
    )
  `);

  // ── Indexes ──────────────────────────────────────────────────────────────
  db.run("CREATE INDEX IF NOT EXISTS idx_users_email        ON users(email)");
  db.run("CREATE INDEX IF NOT EXISTS idx_users_role         ON users(role)");
  db.run("CREATE INDEX IF NOT EXISTS idx_users_reg          ON users(reg_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_subjects_teacher   ON subjects(teacher_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_subjects_published ON subjects(term, is_published)");
  db.run("CREATE INDEX IF NOT EXISTS idx_subjects_mode      ON subjects(mode)");
  db.run("CREATE INDEX IF NOT EXISTS idx_questions_subject  ON questions(subject_id, order_index)");
  db.run("CREATE INDEX IF NOT EXISTS idx_questions_type     ON questions(question_type)");
  db.run("CREATE INDEX IF NOT EXISTS idx_exams_student      ON exams(student_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_exams_subject      ON exams(subject_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_exams_status       ON exams(status)");
  // Composite covering index — used by every dashboard and results query
  db.run("CREATE INDEX IF NOT EXISTS idx_exams_student_status   ON exams(student_id, status)");
  db.run("CREATE INDEX IF NOT EXISTS idx_exams_subject_status   ON exams(subject_id, status)");
  db.run("CREATE INDEX IF NOT EXISTS idx_audit_actor        ON audit_logs(actor_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_audit_timestamp    ON audit_logs(timestamp)");
  db.run("CREATE INDEX IF NOT EXISTS idx_audit_resource     ON audit_logs(resource, resource_id)");
  // student_answers indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_sa_exam       ON student_answers(exam_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_sa_student    ON student_answers(student_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_sa_question   ON student_answers(question_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_sa_subject    ON student_answers(subject_id)");
  // Composite covering index for exam review joins
  db.run("CREATE INDEX IF NOT EXISTS idx_sa_exam_question ON student_answers(exam_id, question_id)");

  // Run SQLite's built-in statistics analyzer so the query planner uses all new indexes effectively
  db.run("PRAGMA optimize");

  // ── subject_enrollments ───────────────────────────────────────────────────
  // Operator assigns students to specific subjects.
  db.run(`
    CREATE TABLE IF NOT EXISTS subject_enrollments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id  INTEGER NOT NULL,
      student_id  INTEGER NOT NULL,
      enrolled_by INTEGER NOT NULL,
      enrolled_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      FOREIGN KEY (subject_id)  REFERENCES subjects(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id)  REFERENCES users(id)    ON DELETE CASCADE,
      FOREIGN KEY (enrolled_by) REFERENCES users(id)    ON DELETE RESTRICT,
      UNIQUE(subject_id, student_id)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_se_subject ON subject_enrollments(subject_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_se_student ON subject_enrollments(student_id)");

  // ── student_term_remarks ───────────────────────────────────────────────────
  // Stores overall term remarks for a student (from teacher and principal).
  db.run(`
    CREATE TABLE IF NOT EXISTS student_term_remarks (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id       INTEGER NOT NULL,
      term             TEXT NOT NULL,
      teacher_remark   TEXT,
      principal_remark TEXT,
      updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(student_id, term)
    )
  `);

  // ── notifications ──────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      type       TEXT NOT NULL,
      message    TEXT NOT NULL,
      link       TEXT,
      is_read    INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC)");

  // ── Seed defaults ─────────────────────────────────────────────────────────
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run("SCHEMA_VERSION", "3");
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run("REGISTRATION_OPEN", "true");
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run("CURRENT_TERM", "2026-T1");

  // Migrate schema version from 2 → 3 without wipe
  db.prepare("UPDATE settings SET value = '3' WHERE key = 'SCHEMA_VERSION' AND value = '2'").run();

  // Ensure at least one config row exists
  db.prepare("INSERT OR IGNORE INTO config (id, org_name, version) VALUES (1, 'ExamPool School', '1.0.0')").run();

  // ── v4.1 Operational Tables (core_exampool.db) ───────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS question_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id INTEGER NOT NULL,
      display_order INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      shuffle_seed TEXT NOT NULL,
      FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS kiosk_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pc_id TEXT NOT NULL,
      seat_number INTEGER,
      student_id INTEGER NOT NULL,
      exam_id INTEGER,
      login_time INTEGER NOT NULL,
      logout_time INTEGER,
      status TEXT NOT NULL CHECK(status IN ('active','suspended','completed')),
      hardware_fingerprint TEXT,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE SET NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS license_registry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_key TEXT UNIQUE NOT NULL,
      license_type TEXT NOT NULL CHECK(license_type IN ('core','practice_lan','practice_home','full_bundle')),
      hardware_fingerprint TEXT,
      activated_at INTEGER,
      expires_at INTEGER,
      max_pcs INTEGER,
      max_devices INTEGER,
      content_packs TEXT NOT NULL DEFAULT '[]',
      device_whitelist TEXT,
      public_key_pem TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS content_manifest (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_name TEXT NOT NULL,
      version TEXT NOT NULL,
      exam_body TEXT NOT NULL,
      import_date INTEGER NOT NULL,
      signature_valid INTEGER NOT NULL DEFAULT 0 CHECK(signature_valid IN (0,1)),
      file_size_bytes INTEGER NOT NULL
    )
  `);

  // ── v4.1 Practice Logs (practice_logs.db) ────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS practice_logs.practice_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      selected_answer TEXT,
      is_correct INTEGER NOT NULL DEFAULT 0 CHECK(is_correct IN (0,1)),
      time_spent_seconds INTEGER NOT NULL DEFAULT 0,
      session_date INTEGER NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('lan','home_synced','home_local')),
      device_fingerprint TEXT,
      log_signature TEXT NOT NULL
    )
  `);
}

// Initialize schema before preparing statements so new tables exist.
initializeDatabase();

export const queries = {
  // ── Users ──────────────────────────────────────────────────────────────
  getUserByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
  getUserByEmailOrReg: db.prepare("SELECT * FROM users WHERE email = ? OR reg_id = ?"),
  createUser:     db.prepare(`
    INSERT INTO users (name, email, role, password_hash, grade, reg_id, first_name, last_name, address, phone, dob)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getUserById:    db.prepare("SELECT * FROM users WHERE id = ?"),
  getAllUsers:     db.prepare("SELECT id, name, email, role, grade, reg_id, first_name, last_name, phone, is_active, created_at FROM users ORDER BY id DESC LIMIT 1000"),
  updateUser:     db.prepare("UPDATE users SET first_name=?, last_name=?, address=?, phone=?, dob=?, grade=?, image_url=? WHERE id=?"),
  deactivateUser: db.prepare("UPDATE users SET is_active = 0 WHERE id = ?"),
  activateUser:   db.prepare("UPDATE users SET is_active = 1 WHERE id = ?"),
  countOperators: db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'operator' AND is_active = 1"),
  /** Targeted operator fetch — avoids scanning all users in notifyOperators. */
  getOperators:   db.prepare("SELECT id FROM users WHERE role = 'operator' AND is_active = 1"),

  // ── Subjects ──────────────────────────────────────────────────────────
  getSubjectsByTeacher: db.prepare("SELECT * FROM subjects WHERE teacher_id = ?"),
  getAllSubjects:        db.prepare("SELECT * FROM subjects"),
  getSubjectById:       db.prepare("SELECT * FROM subjects WHERE id = ?"),

  // ── Enrollments ───────────────────────────────────────────────────────
  enrollStudent:   db.prepare("INSERT OR IGNORE INTO subject_enrollments (subject_id, student_id, enrolled_by) VALUES (?, ?, ?)"),
  unenrollStudent: db.prepare("DELETE FROM subject_enrollments WHERE subject_id = ? AND student_id = ?"),
  getEnrollmentsBySubject: db.prepare(`
    SELECT
      u.id, u.name, u.email, u.grade, u.reg_id, u.is_active,
      se.enrolled_at,
      e.id as exam_id, e.status as exam_status, e.score, e.total_score, e.end_time
    FROM subject_enrollments se
    JOIN users u ON u.id = se.student_id
    LEFT JOIN exams e ON e.student_id = se.student_id AND e.subject_id = se.subject_id
    WHERE se.subject_id = ?
  `),
  getEnrolledSubjectsByStudent: db.prepare(`
    SELECT s.* FROM subjects s
    INNER JOIN subject_enrollments se ON se.subject_id = s.id AND se.student_id = ?
  `),
  countEnrollments: db.prepare("SELECT COUNT(*) as count FROM subject_enrollments WHERE subject_id = ?"),
  createSubject:             db.prepare(`
    INSERT INTO subjects (name, code, term, duration, total_score, exam_datetime, is_published, teacher_id, created_by, description, class, session, mode, instructions, is_timetable_published, window_duration, can_retake, is_assignment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateSubject: db.prepare(`
    UPDATE subjects SET name=?, code=?, term=?, duration=?, total_score=?, exam_datetime=?, is_published=?, teacher_id=?, description=?, class=?, session=?, mode=?, instructions=?, is_timetable_published=?, window_duration=?, can_retake=?, is_assignment=?
    WHERE id=?
  `),
  deleteSubject: db.prepare("DELETE FROM subjects WHERE id = ?"),

  // ── Questions ─────────────────────────────────────────────────────────
  getQuestionById:       db.prepare("SELECT * FROM questions WHERE id = ?"),
  getQuestionsBySubject: db.prepare("SELECT * FROM questions WHERE subject_id = ? ORDER BY order_index"),
  createQuestion:        db.prepare(`
    INSERT INTO questions (subject_id, question_text, options_json, correct_answer, marks, order_index, question_type, session, term, mode, teacher_answer, image_url, is_file_upload, attached_file_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateQuestion: db.prepare(`
    UPDATE questions SET question_text=?, options_json=?, correct_answer=?, marks=?, question_type=?, teacher_answer=?, image_url=?, is_file_upload=?, attached_file_url=?,
    updated_at=(strftime('%Y-%m-%dT%H:%M:%SZ','now')) WHERE id=?
  `),
  deleteQuestion: db.prepare("DELETE FROM questions WHERE id = ?"),

  // ── Student Answers ───────────────────────────────────────────────────
  insertStudentAnswer: db.prepare(`
    INSERT OR REPLACE INTO student_answers
      (exam_id, question_id, student_id, subject_id, selected_option, essay_response, is_correct, marks_awarded, file_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getStudentAnswersByExam: db.prepare("SELECT sa.*, q.question_text, q.question_type, q.correct_answer, q.teacher_answer, q.options_json, q.marks FROM student_answers sa JOIN questions q ON q.id = sa.question_id WHERE sa.exam_id = ?"),

  // ── Exams / Results ───────────────────────────────────────────────────
  createExam:              db.prepare("INSERT INTO exams (student_id, subject_id, start_time, answers_json, status, session, term, mode) VALUES (?, ?, ?, ?, 'in-progress', ?, ?, ?)"),
  getExamById:             db.prepare("SELECT * FROM exams WHERE id = ?"),
  getExamByStudentSubject: db.prepare("SELECT * FROM exams WHERE student_id = ? AND subject_id = ?"),
  saveExam:                db.prepare("UPDATE exams SET answers_json = ? WHERE id = ? AND student_id = ?"),
  submitExam:              db.prepare("UPDATE exams SET answers_json=?, end_time=?, score=?, total_score=?, status='completed' WHERE id=? AND student_id=? AND status='in-progress'"),
  resetExam:               db.prepare("UPDATE exams SET answers_json='[]', score=NULL, total_score=0, end_time=NULL, start_time=(strftime('%Y-%m-%dT%H:%M:%SZ','now')), retake_count = retake_count + 1, status='in-progress' WHERE id=? AND student_id=?"),
  deleteStudentAnswersForExam: db.prepare("DELETE FROM student_answers WHERE exam_id=?"),
  /** Archive the current exam row before resetting for retake. */
  archiveExamAttempt: db.prepare(`
    INSERT INTO exam_attempts (exam_id, student_id, subject_id, attempt_number, start_time, end_time, answers_json, score, total_score, status)
    SELECT id, student_id, subject_id, retake_count + 1, start_time, end_time, answers_json, score, total_score, status
    FROM exams WHERE id = ?
  `),
  getExamAttemptsByStudent: db.prepare("SELECT * FROM exam_attempts WHERE student_id = ? ORDER BY archived_at DESC"),
  getExamsByStudent:       db.prepare("SELECT * FROM exams WHERE student_id = ? AND status = 'completed'"),
  getExamsBySubject:       db.prepare("SELECT * FROM exams WHERE subject_id = ? AND status = 'completed'"),

  // ── Config ────────────────────────────────────────────────────────────
  getConfig:    db.prepare("SELECT * FROM config WHERE id = 1"),
  upsertConfig: db.prepare(`
    INSERT INTO config (id, description, favicon, admin_name, org_name, licence_key, licence_type, theme_json, version, admin_email, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    ON CONFLICT(id) DO UPDATE SET
      description=excluded.description, favicon=excluded.favicon, admin_name=excluded.admin_name,
      org_name=excluded.org_name, licence_key=excluded.licence_key, licence_type=excluded.licence_type,
      theme_json=excluded.theme_json, version=excluded.version, admin_email=excluded.admin_email,
      updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
  `),
  updateUserGrade: db.prepare("UPDATE users SET grade = ? WHERE id = ? AND role = 'student'"),

  // ── Audit / Settings ──────────────────────────────────────────────────
  createAuditLog: db.prepare("INSERT INTO audit_logs (actor_id, action, resource, resource_id, details) VALUES (?, ?, ?, ?, ?)"),
  getAuditLogs:   db.prepare("SELECT al.*, u.name as actor_name FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_id ORDER BY al.timestamp DESC LIMIT 500"),

  countUsers:    db.prepare("SELECT COUNT(*) as count FROM users"),
  countActiveOperators: db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'operator' AND is_active = 1"),
  getSetting:    db.prepare("SELECT value FROM settings WHERE key = ?"),
  upsertSetting: db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=(strftime('%Y-%m-%dT%H:%M:%SZ','now'))"),

  // ── Term Remarks ──────────────────────────────────────────────────────
  getTermRemark: db.prepare("SELECT * FROM student_term_remarks WHERE student_id = ? AND term = ?"),
  upsertTeacherRemark: db.prepare(`
    INSERT INTO student_term_remarks (student_id, term, teacher_remark)
    VALUES (?, ?, ?)
    ON CONFLICT(student_id, term) DO UPDATE SET teacher_remark=excluded.teacher_remark, updated_at=(strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  `),
  upsertPrincipalRemark: db.prepare(`
    INSERT INTO student_term_remarks (student_id, term, principal_remark)
    VALUES (?, ?, ?)
    ON CONFLICT(student_id, term) DO UPDATE SET principal_remark=excluded.principal_remark, updated_at=(strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  `),

  // ── Hot-path pre-compiled statements (prevents repeated query plan compilation) ─
  getExamByIdAndStudent:   db.prepare("SELECT * FROM exams WHERE id = ? AND student_id = ?"),
  getQuestionByIdAndSubject: db.prepare("SELECT * FROM questions WHERE id = ? AND subject_id = ?"),
  getCompletedExamsByStudent: db.prepare("SELECT e.*, s.name as subject_name FROM exams e JOIN subjects s ON s.id = e.subject_id WHERE e.student_id = ? AND e.status = 'completed'"),
  getCompletedExamsByTeacher: db.prepare("SELECT e.*, s.name as subject_name, u.name as student_name, u.grade, u.reg_id, u.id as student_user_id FROM exams e JOIN subjects s ON s.id = e.subject_id JOIN users u ON u.id = e.student_id WHERE e.status = 'completed' AND s.teacher_id = ? ORDER BY e.end_time DESC"),
  getAllCompletedExams:        db.prepare("SELECT e.*, s.name as subject_name, u.name as student_name, u.grade, u.reg_id, u.id as student_user_id FROM exams e JOIN subjects s ON s.id = e.subject_id JOIN users u ON u.id = e.student_id WHERE e.status = 'completed' ORDER BY e.end_time DESC"),
  updateExamAnswersJson:   db.prepare("UPDATE exams SET answers_json = '[]' WHERE id = ?"),
  updateUserPassword:      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?"),
  updateExamScore:         db.prepare("UPDATE exams SET score = ? WHERE id = ?"),
  updateExamTeacherRemark: db.prepare("UPDATE exams SET teacher_remark = ? WHERE id = ?"),
  updateExamPrincipalRemark: db.prepare("UPDATE exams SET principal_remark = ? WHERE id = ?"),
  getSubjectExamCheck:     db.prepare("SELECT id FROM exams WHERE subject_id = ? LIMIT 1"),
  getStudentHasExam:       db.prepare("SELECT id FROM exams WHERE student_id = ? LIMIT 1"),
  getSubjectTotalScore:    db.prepare("SELECT COALESCE(SUM(marks),0) as total FROM questions WHERE subject_id = ?"),
  updateSubjectTotalScore: db.prepare("UPDATE subjects SET total_score = (SELECT COALESCE(SUM(marks),0) FROM questions WHERE subject_id = ?) WHERE id = ?"),
  getStudentsByGrade:      db.prepare("SELECT id FROM users WHERE role = 'student' AND grade = ? AND is_active = 1"),
  getStudentEnrolledSubjects: db.prepare(`
    SELECT s.id, s.name, s.code, s.term, s.duration, s.total_score,
           s.exam_datetime, s.is_published, s.mode, s.can_retake,
           e.id as exam_id, e.status as exam_status, e.score, e.end_time, e.retake_count
    FROM subject_enrollments se
    JOIN subjects s ON s.id = se.subject_id
    LEFT JOIN exams e ON e.student_id = se.student_id AND e.subject_id = se.subject_id
    WHERE se.student_id = ?
    ORDER BY s.name
  `),
  getStudentExamStats: db.prepare(`
    SELECT
      COUNT(*) as total_exams,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
      ROUND(AVG(CASE WHEN status = 'completed' AND total_score > 0 THEN CAST(score AS REAL)/total_score*100 END), 1) as avg_pct
    FROM exams WHERE student_id = ?
  `),
  getStudentExamsForRoster: db.prepare(`
    SELECT e.id as exam_id, e.score, e.total_score, e.end_time,
           e.teacher_remark, e.principal_remark,
           s.name as subject_name, s.code, s.term
    FROM exams e
    JOIN subjects s ON e.subject_id = s.id
    WHERE e.student_id = ? AND e.status = 'completed'
    ORDER BY e.end_time DESC
  `),
  
  // ── Notifications ─────────────────────────────────────────────────────────
  getNotifications: db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"),
  createNotification: db.prepare("INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?) RETURNING *"),
  markNotificationsRead: db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0"),
  getUnreadNotificationCount: db.prepare("SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0"),

  // ── v4.1 Kiosk & License ──────────────────────────────────────────────────
  insertKioskSession: db.prepare(
    "INSERT INTO kiosk_sessions (pc_id, seat_number, student_id, login_time, status) VALUES (?, ?, ?, ?, 'active')"
  ),
  verifyLicense: db.prepare("SELECT * FROM license_registry WHERE license_key = ?"),

  // ── v4.1 Practice Sandbox ─────────────────────────────────────────────────
  insertPracticeLog: db.prepare(`
    INSERT INTO practice_logs.practice_logs (
      student_id, question_id, selected_answer, is_correct, time_spent_seconds, 
      session_date, mode, device_fingerprint, log_signature
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  // ── v4.1 Content Bank ─────────────────────────────────────────────────────
  searchContentBank: db.prepare(`
    SELECT c.* FROM content_bank.content_bank c
    JOIN content_bank.content_bank_fts fts ON c.id = fts.rowid
    WHERE content_bank_fts MATCH ?
  `),
  getContentBankQuestionById: db.prepare("SELECT * FROM content_bank.content_bank WHERE id = ?"),
};

export default db;
