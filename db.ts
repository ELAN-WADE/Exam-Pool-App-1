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
db.run("PRAGMA busy_timeout = 30000");
db.run("PRAGMA synchronous = NORMAL");
db.run("PRAGMA cache_size = -64000"); // 64MB memory page cache
db.run("PRAGMA mmap_size = 268435456"); // 256MB zero-copy memory-mapped I/O
db.run("PRAGMA temp_store = MEMORY"); // RAM for temp tables and sort buffers

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
db.run(`PRAGMA practice_logs.busy_timeout = 30000`);
db.run(`PRAGMA content_bank.busy_timeout = 30000`);
db.run(`PRAGMA content_bank.mmap_size = 134217728`); // 128MB mmap for fast question search

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
  "token_blacklist",
  // v5 tables
  "terms", "classes", "class_enrollments", "guardian_student_links",
  "academic_calendar_events", "timetables",
  // v8 tables
  "grading_subjects", "grading_policies", "grading_manual_scores", "term_results",
  // v9 tables
  "class_teacher_assignments",
  // v10 tables
  "user_devices", "user_tokens",
  // v11 guardian & hybrid messaging tables
  "attendance_records", "fee_structures", "fee_payments",
  "guardian_message_threads", "guardian_messages", "push_subscriptions",
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
  addColumnIfMissing("users", "session_id", "INTEGER");
  addColumnIfMissing("users", "term_id",    "INTEGER");
  addColumnIfMissing("users", "grade_level_id", "INTEGER");

  // ── subjects ─────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS subjects (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      code          TEXT NOT NULL,
      term          TEXT NOT NULL,
      duration      INTEGER NOT NULL CHECK(duration > 0 AND duration <= 1440),
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
  addColumnIfMissing("subjects", "mode",        "TEXT NOT NULL DEFAULT 'exam' CHECK(mode IN ('test','exam','quiz','assignment'))");
  addColumnIfMissing("subjects", "instructions","TEXT");
  addColumnIfMissing("subjects", "is_timetable_published", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("subjects", "window_duration", "INTEGER NOT NULL DEFAULT 120");
  addColumnIfMissing("subjects", "can_retake", "INTEGER NOT NULL DEFAULT 1");
  // Offline assignments
  addColumnIfMissing("subjects", "is_assignment", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("subjects", "session_id",    "INTEGER");
  addColumnIfMissing("subjects", "term_id",       "INTEGER");
  addColumnIfMissing("subjects", "grade_level_id", "INTEGER");
  // Teacher autonomy: soft delete / archival
  addColumnIfMissing("subjects", "archived_at", "TEXT");
  // Dual Assessment Engine: Learning Mode vs School Mode & Result Release Policy
  addColumnIfMissing("subjects", "assessment_type", "TEXT DEFAULT 'school_mode'");
  addColumnIfMissing("subjects", "result_policy", "TEXT DEFAULT 'immediate'");
  addColumnIfMissing("subjects", "result_release_time", "TEXT");

  // ── questions ────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS questions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id     INTEGER NOT NULL,
      question_text  TEXT NOT NULL,
      options_json   TEXT NOT NULL DEFAULT '[]',
      correct_answer INTEGER NOT NULL CHECK (correct_answer BETWEEN 0 AND 9),
      marks          REAL NOT NULL CHECK (marks > 0),
      order_index    INTEGER NOT NULL,
      created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at     TEXT,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
    )
  `);

  // v3 extensions
  addColumnIfMissing("questions", "question_type",   "TEXT NOT NULL DEFAULT 'objective' CHECK(question_type IN ('objective','essay','true_false','file_upload','fill_in_the_blank'))");
  addColumnIfMissing("questions", "session",         "TEXT");
  addColumnIfMissing("questions", "term",            "TEXT");
  addColumnIfMissing("questions", "mode",            "TEXT NOT NULL DEFAULT 'exam' CHECK(mode IN ('test','exam','quiz'))");
  addColumnIfMissing("questions", "teacher_answer",  "TEXT");
  // v4 extensions — image support for CBT
  addColumnIfMissing("questions", "image_url",       "TEXT");
  // Offline assignments
  addColumnIfMissing("questions", "is_file_upload",  "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("questions", "attached_file_url", "TEXT");
  addColumnIfMissing("questions", "session_id", "INTEGER");
  addColumnIfMissing("questions", "term_id",    "INTEGER");
  // Pedagogical extensions: Concise Explanation & Step-by-Step Worked Solution
  addColumnIfMissing("questions", "explanation", "TEXT");
  addColumnIfMissing("questions", "solution", "TEXT");

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
  // v7 Academic Session & Term linkage + locking
  addColumnIfMissing("exams", "session_id",        "INTEGER");
  addColumnIfMissing("exams", "term_id",           "INTEGER");
  addColumnIfMissing("exams", "is_locked",          "INTEGER NOT NULL DEFAULT 0");
  // v8: server-side deadline enforcement
  addColumnIfMissing("exams", "deadline",          "TEXT");
  // Dual Assessment Engine: Result Release Gate & Persistent 5-Reveal Solution Limit
  addColumnIfMissing("exams", "result_status", "TEXT DEFAULT 'released'");
  addColumnIfMissing("exams", "solution_reveals_remaining", "INTEGER NOT NULL DEFAULT 5");
  addColumnIfMissing("exams", "revealed_solutions_json", "TEXT NOT NULL DEFAULT '[]'");

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
  addColumnIfMissing("student_answers", "session_id", "INTEGER");
  addColumnIfMissing("student_answers", "term_id",    "INTEGER");

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
  db.run("CREATE INDEX IF NOT EXISTS idx_audit_action       ON audit_logs(action)");
  
  // ── token_blacklist ──────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS token_blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT,
      jti TEXT,
      invalidated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      reason TEXT
    )
  `);
  addColumnIfMissing("token_blacklist", "jti", "TEXT");
  addColumnIfMissing("token_blacklist", "reason", "TEXT");
  db.run("CREATE INDEX IF NOT EXISTS idx_blacklist_token ON token_blacklist(token)");
  db.run("CREATE INDEX IF NOT EXISTS idx_blacklist_jti ON token_blacklist(jti)");
  db.run("CREATE INDEX IF NOT EXISTS idx_blacklist_invalidated ON token_blacklist(invalidated_at)");

  // ── user_devices ─────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS user_devices (
      user_id INTEGER NOT NULL,
      device_fingerprint TEXT NOT NULL,
      user_agent TEXT,
      ip TEXT,
      last_used TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, device_fingerprint)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_user_devices_user ON user_devices(user_id)");

  // ── user_tokens ──────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS user_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jti TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      device_fingerprint TEXT NOT NULL,
      token_type TEXT NOT NULL CHECK(token_type IN ('access', 'refresh')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id, device_fingerprint) REFERENCES user_devices(user_id, device_fingerprint) ON DELETE CASCADE,
      UNIQUE(jti, token_type)
    )
  `);
  // Migration: old schema used jti as PRIMARY KEY which couldn't store access+refresh with same jti
  try {
    const cols = db.prepare("PRAGMA table_info(user_tokens)").all() as any[];
    const hasAutoIncrement = cols.some((c: any) => c.name === "id");
    if (!hasAutoIncrement) {
      console.log("[db] Migrating user_tokens table to support composite (jti, token_type)...");
      db.run("DROP TABLE IF EXISTS user_tokens_backup");
      db.run("ALTER TABLE user_tokens RENAME TO user_tokens_backup");
      db.run(`
        CREATE TABLE user_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          jti TEXT NOT NULL,
          user_id INTEGER NOT NULL,
          device_fingerprint TEXT NOT NULL,
          token_type TEXT NOT NULL CHECK(token_type IN ('access', 'refresh')),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
          expires_at TEXT NOT NULL,
          revoked_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id, device_fingerprint) REFERENCES user_devices(user_id, device_fingerprint) ON DELETE CASCADE,
          UNIQUE(jti, token_type)
        )
      `);
      db.run("DROP TABLE user_tokens_backup");
      console.log("[db] user_tokens migration complete.");
    }
  } catch (e) {
    console.warn("[db] user_tokens migration check skipped:", e);
  }

  // ── Migration: relax questions correct_answer check constraint (support 5-option JAMB/WAEC questions) ──
  try {
    const qSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='questions'").get() as any)?.sql || "";
    if (qSql.includes("BETWEEN 0 AND 3")) {
      console.log("[db] Upgrading questions schema (relaxing option check constraint to support 5-option exams)...");
      db.run("PRAGMA foreign_keys = OFF");
      db.run("DROP TABLE IF EXISTS questions_v2_mig");
      db.run(`
        CREATE TABLE questions_v2_mig (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          subject_id     INTEGER NOT NULL,
          question_text  TEXT NOT NULL,
          options_json   TEXT NOT NULL DEFAULT '[]',
          correct_answer INTEGER NOT NULL CHECK (correct_answer BETWEEN 0 AND 9),
          marks          REAL NOT NULL CHECK (marks > 0),
          order_index    INTEGER NOT NULL,
          created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
          updated_at     TEXT,
          question_type  TEXT NOT NULL DEFAULT 'objective' CHECK(question_type IN ('objective','essay','true_false','file_upload','fill_in_the_blank')),
          session        TEXT,
          term           TEXT,
          mode           TEXT NOT NULL DEFAULT 'exam' CHECK(mode IN ('test','exam','quiz')),
          teacher_answer TEXT,
          image_url      TEXT,
          is_file_upload INTEGER NOT NULL DEFAULT 0,
          attached_file_url TEXT,
          session_id     INTEGER,
          term_id        INTEGER,
          FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
        )
      `);
      db.run(`
        INSERT INTO questions_v2_mig
          (id, subject_id, question_text, options_json, correct_answer, marks, order_index, created_at, updated_at, question_type, session, term, mode, teacher_answer, image_url, is_file_upload, attached_file_url, session_id, term_id)
        SELECT
          id, subject_id, question_text, options_json, correct_answer, marks, order_index, created_at, updated_at,
          COALESCE(question_type, 'objective'), session, term, COALESCE(mode, 'exam'), teacher_answer, image_url,
          COALESCE(is_file_upload, 0), attached_file_url, session_id, term_id
        FROM questions
      `);
      db.run("DROP TABLE questions");
      db.run("ALTER TABLE questions_v2_mig RENAME TO questions");
      db.run("PRAGMA foreign_keys = ON");
      db.run("CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject_id, order_index)");
      db.run("CREATE INDEX IF NOT EXISTS idx_questions_type ON questions(question_type)");
      console.log("[db] questions schema upgrade complete.");
    }
  } catch (e) {
    console.warn("[db] questions migration check skipped:", e);
  }

  // ── Migration: relax subjects duration constraint up to 1440 mins (24 hrs) ──
  try {
    const sSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='subjects'").get() as any)?.sql || "";
    if (sSql.includes("duration <= 360")) {
      console.log("[db] Upgrading subjects schema (relaxing duration constraint up to 1440m)...");
      db.run("PRAGMA foreign_keys = OFF");
      db.run("DROP TABLE IF EXISTS subjects_v2_mig");
      db.run(`
        CREATE TABLE subjects_v2_mig (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          name          TEXT NOT NULL,
          code          TEXT NOT NULL,
          term          TEXT NOT NULL,
          duration      INTEGER NOT NULL CHECK(duration > 0 AND duration <= 1440),
          total_score   INTEGER NOT NULL DEFAULT 0,
          exam_datetime TEXT NOT NULL,
          is_published  INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0,1)),
          teacher_id    INTEGER NOT NULL,
          created_by    INTEGER NOT NULL,
          created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
          description   TEXT,
          class         TEXT,
          session       TEXT,
          mode          TEXT NOT NULL DEFAULT 'exam' CHECK(mode IN ('test','exam','quiz','assignment')),
          instructions  TEXT,
          is_timetable_published INTEGER NOT NULL DEFAULT 0,
          window_duration INTEGER NOT NULL DEFAULT 120,
          can_retake    INTEGER NOT NULL DEFAULT 1,
          is_assignment INTEGER NOT NULL DEFAULT 0,
          session_id    INTEGER,
          term_id       INTEGER,
          grade_level_id INTEGER,
          archived_at   TEXT,
          FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE RESTRICT,
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
          UNIQUE(code, term)
        )
      `);
      db.run(`
        INSERT INTO subjects_v2_mig
          (id, name, code, term, duration, total_score, exam_datetime, is_published, teacher_id, created_by, created_at, description, class, session, mode, instructions, is_timetable_published, window_duration, can_retake, is_assignment, session_id, term_id, grade_level_id, archived_at)
        SELECT
          id, name, code, term, duration, total_score, exam_datetime, is_published, teacher_id, created_by, created_at, description, class, session, mode, instructions, is_timetable_published, window_duration, can_retake, is_assignment, session_id, term_id, grade_level_id, archived_at
        FROM subjects
      `);
      db.run("DROP TABLE subjects");
      db.run("ALTER TABLE subjects_v2_mig RENAME TO subjects");
      db.run("PRAGMA foreign_keys = ON");
      db.run("CREATE INDEX IF NOT EXISTS idx_subjects_teacher ON subjects(teacher_id)");
      db.run("CREATE INDEX IF NOT EXISTS idx_subjects_published ON subjects(term, is_published)");
      db.run("CREATE INDEX IF NOT EXISTS idx_subjects_mode ON subjects(mode)");
      console.log("[db] subjects schema upgrade complete.");
    }
  } catch (e) {
    console.warn("[db] subjects migration check skipped:", e);
  }
  db.run("CREATE INDEX IF NOT EXISTS idx_user_tokens_user ON user_tokens(user_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_user_tokens_expires ON user_tokens(expires_at)");
  db.run("CREATE INDEX IF NOT EXISTS idx_user_tokens_device ON user_tokens(device_fingerprint)");
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
  
  addColumnIfMissing("student_term_remarks", "session_id", "INTEGER");
  addColumnIfMissing("student_term_remarks", "term_id",    "INTEGER");
  db.run("CREATE INDEX IF NOT EXISTS idx_str_student_session_term ON student_term_remarks(student_id, session_id, term_id)");
  // Ensure unique constraint for upsert to work
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS uniq_str_student_session_term ON student_term_remarks(student_id, session_id, term_id)");

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
  db.run("CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read)");

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

  // ═══════════════════════════════════════════════════════════════════════════
  // v5.0 Phase 1A — Academic Calendar + Guardian Foundation
  // All new tables use CREATE TABLE IF NOT EXISTS (idempotent).
  // ═══════════════════════════════════════════════════════════════════════════

  const schemaRow = db.prepare("SELECT value FROM settings WHERE key = ?").get("SCHEMA_VERSION") as { value?: string } | null;
  const schemaVer = Number(schemaRow?.value ?? 0);

  if (schemaVer < 5) {
    // ── Upgrade users table to support 'guardian' role ─────────────────────
    // SQLite CHECK constraints cannot be altered — requires a safe table swap.
    // PRAGMA foreign_keys = OFF is required so FK references don't block the DROP.
    console.log("[db v5] Upgrading users table to support guardian role...");
    db.run("PRAGMA foreign_keys = OFF");
    db.run("DROP TABLE IF EXISTS users_v5_new"); // clean up any half-run previous attempt
    db.run(`
      CREATE TABLE users_v5_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT NOT NULL,
        email         TEXT UNIQUE NOT NULL,
        role          TEXT NOT NULL CHECK(role IN ('student','teacher','operator','guardian')),
        password_hash TEXT NOT NULL,
        grade         TEXT,
        is_active     INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
        created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        reg_id        TEXT,
        first_name    TEXT,
        last_name     TEXT,
        address       TEXT,
        phone         TEXT,
        dob           TEXT,
        image_url     TEXT,
        avatar_url    TEXT
      )
    `);
    db.run(`
      INSERT INTO users_v5_new
        (id, name, email, role, password_hash, grade, is_active, created_at, reg_id, first_name, last_name, address, phone, dob, image_url)
      SELECT
        id, name, email, role, password_hash, grade, is_active, created_at, reg_id, first_name, last_name, address, phone, dob, image_url
      FROM users
    `);
    db.run("DROP TABLE users");
    db.run("ALTER TABLE users_v5_new RENAME TO users");
    db.run("PRAGMA foreign_keys = ON");
    // Restore indexes that existed on the old table
    db.run("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)");
    db.run("CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role)");
    db.run("CREATE INDEX IF NOT EXISTS idx_users_reg   ON users(reg_id)");
    // [FIX] The v5 table swap above dropped the session_id / term_id / grade_level_id
    // columns that were added earlier (lines 138-140). Without them, the backfill
    // UPDATEs later in this function crash with "no such column: session_id" on
    // any fresh database, preventing the server from booting.
    addColumnIfMissing("users", "session_id", "INTEGER");
    addColumnIfMissing("users", "term_id", "INTEGER");
    addColumnIfMissing("users", "grade_level_id", "INTEGER");
    db.prepare("UPDATE settings SET value = '5' WHERE key = 'SCHEMA_VERSION'").run();
    console.log("[db v5] users table upgraded. Schema version = 5.");
  }

  // ── ACADEMIC SESSIONS & TERMS — Platform Foundation ────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS academic_sessions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT UNIQUE NOT NULL,
      is_active   INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0,1)),
      status      TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_academic_sessions_active ON academic_sessions(is_active)");

  db.run(`
    CREATE TABLE IF NOT EXISTS academic_terms (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id        INTEGER NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
      name              TEXT NOT NULL,
      start_date        TEXT,
      end_date          TEXT,
      is_active         INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0,1)),
      status            TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived', 'locked')),
      registration_open INTEGER NOT NULL DEFAULT 1 CHECK(registration_open IN (0,1)),
      created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      UNIQUE(session_id, name)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_academic_terms_active ON academic_terms(is_active)");
  db.run("CREATE INDEX IF NOT EXISTS idx_academic_terms_session ON academic_terms(session_id)");

  // ── TERMS — The single blocking primitive. Everything scopes to a term. ──
  db.run(`
    CREATE TABLE IF NOT EXISTS terms (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      session           TEXT NOT NULL,
      name              TEXT NOT NULL,
      start_date        TEXT NOT NULL,
      end_date          TEXT NOT NULL,
      is_active         INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0,1)),
      registration_open INTEGER NOT NULL DEFAULT 1 CHECK(registration_open IN (0,1)),
      created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_terms_active ON terms(is_active)");

  // ── CLASSES — Grade / arm definitions ────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS classes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      section    TEXT,
      level      TEXT NOT NULL DEFAULT 'junior' CHECK(level IN ('junior','senior')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      UNIQUE(name, section)
    )
  `);

  // ── GRADE LEVELS — System-wide standardized class/grade options ──────────
  db.run(`
    CREATE TABLE IF NOT EXISTS grade_levels (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      category    TEXT NOT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_grade_levels_active ON grade_levels(is_active)");
  db.run("CREATE INDEX IF NOT EXISTS idx_grade_levels_category ON grade_levels(category)");

  // ── CLASS ENROLLMENTS — student → class → term ────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS class_enrollments (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
      term_id         INTEGER NOT NULL REFERENCES terms(id) ON DELETE RESTRICT,
      enrollment_date TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      UNIQUE(student_id, term_id)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_ce_student_term ON class_enrollments(student_id, term_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_ce_class_term   ON class_enrollments(class_id, term_id)");

  // ── GUARDIAN–STUDENT LINKS — with extensible verification ────────────────
  // verification_method + verified_by_data JSON allows upgrading from
  // manual admin approval to auto-approval (DOB/PIN match) without schema changes.
  db.run(`
    CREATE TABLE IF NOT EXISTS guardian_student_links (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      guardian_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      student_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      relationship        TEXT NOT NULL DEFAULT 'Parent',
      status              TEXT NOT NULL DEFAULT 'pending'
                            CHECK(status IN ('pending','approved','rejected','revoked')),
      verification_method TEXT NOT NULL DEFAULT 'manual_admin'
                            CHECK(verification_method IN ('manual_admin','dob_match','pin_match')),
      verified_by_data    TEXT,
      verified_by         INTEGER REFERENCES users(id),
      verified_at         TEXT,
      created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      UNIQUE(guardian_id, student_id)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_gsl_guardian ON guardian_student_links(guardian_id, status)");
  db.run("CREATE INDEX IF NOT EXISTS idx_gsl_student  ON guardian_student_links(student_id, status)");

  // ── ACADEMIC CALENDAR EVENTS ─────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS academic_calendar_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      term_id     INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      description TEXT,
      start_date  TEXT NOT NULL,
      end_date    TEXT NOT NULL,
      type        TEXT NOT NULL DEFAULT 'event'
                    CHECK(type IN ('holiday','exam_period','resumption','event','deadline','other')),
      created_by  INTEGER NOT NULL REFERENCES users(id),
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_cal_term ON academic_calendar_events(term_id, start_date)");

  // ── TIMETABLES — Dedicated examination scheduling ──────────────────────────
  try {
    const ttCols = db.prepare("PRAGMA table_info(timetables)").all() as any[];
    if (ttCols.some(c => c.name === 'class_id')) {
      db.run("DROP TABLE timetables"); // Drop old school-timetable schema
    }
  } catch (e) {}

  db.run(`
    CREATE TABLE IF NOT EXISTS timetables (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id  INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      class       TEXT,
      section     TEXT,
      exam_date   TEXT NOT NULL,
      start_time  TEXT NOT NULL,
      end_time    TEXT NOT NULL,
      duration    INTEGER NOT NULL,
      exam_mode   TEXT NOT NULL DEFAULT 'CBT' CHECK(exam_mode IN ('CBT','Assignment','Offline')),
      allow_students INTEGER NOT NULL DEFAULT 0 CHECK(allow_students IN (0,1)),
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_tt_subject ON timetables(subject_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tt_class ON timetables(class)");
  
  addColumnIfMissing("timetables", "grade_level_id", "INTEGER");
  addColumnIfMissing("timetables", "venue", "TEXT");
  addColumnIfMissing("timetables", "instructions", "TEXT");
  addColumnIfMissing("timetables", "session_id", "INTEGER");
  addColumnIfMissing("timetables", "term_id", "INTEGER");

  // Migrate existing subjects scheduling data to timetables
  try {
    const ttCountRow = db.prepare("SELECT COUNT(*) as count FROM timetables").get() as any;
    if (ttCountRow && Number(ttCountRow.count) === 0) {
      db.run(`
        INSERT INTO timetables (subject_id, class, section, exam_date, start_time, end_time, duration, exam_mode, allow_students)
        SELECT 
          id, 
          class, 
          '', 
          CASE WHEN exam_datetime LIKE '%T%' THEN substr(exam_datetime, 1, 10) ELSE '2027-01-01' END, 
          CASE WHEN exam_datetime LIKE '%T%' THEN substr(exam_datetime, 12, 5) ELSE '09:00' END, 
          CASE WHEN exam_datetime LIKE '%T%' THEN substr(datetime(exam_datetime, '+' || IFNULL(duration, 60) || ' minutes'), 12, 5) ELSE '10:00' END, 
          IFNULL(duration, 60), 
          CASE WHEN mode = 'assignment' OR is_assignment = 1 THEN 'Assignment' ELSE 'CBT' END, 
          IFNULL(is_published, 0)
        FROM subjects 
        WHERE exam_datetime IS NOT NULL AND exam_datetime != ''
      `);
    }
  } catch (e) {
    console.warn("Could not migrate subjects to timetables:", e);
  }

  // ── Seeding Default Academic Session and Term if empty ──
  const sessionRow = db.prepare("SELECT COUNT(*) as count FROM academic_sessions").get() as any;
  const sessionCount = sessionRow?.count ? Number(sessionRow.count) : 0;
  if (sessionCount === 0) {
    db.run("INSERT INTO academic_sessions (name, is_active, status) VALUES ('2026/2027', 1, 'active')");
  }
  const termRow = db.prepare("SELECT COUNT(*) as count FROM academic_terms").get() as any;
  const termCount = termRow?.count ? Number(termRow.count) : 0;
  if (termCount === 0) {
    db.run("INSERT INTO academic_terms (session_id, name, is_active, status, registration_open) VALUES (1, 'First Term', 1, 'active', 1)");
  }

  // ── Mirror academic_terms into the legacy `terms` table ──────────────────────────
  // class_enrollments.term_id has an FK to the legacy `terms` table, but the rest of
  // the system keys on academic_terms. Mirror each academic term (reusing its id) so
  // FK constraints resolve and both systems share term ids on fresh installs.
  db.run(`
    INSERT OR IGNORE INTO terms (id, session, name, start_date, end_date, is_active, registration_open)
    SELECT at.id,
           COALESCE((SELECT name FROM academic_sessions WHERE id = at.session_id), 'Default'),
           at.name,
           COALESCE(at.start_date, '2020-01-01'),
           COALESCE(at.end_date, '2030-12-31'),
           at.is_active,
           at.registration_open
    FROM academic_terms at
  `);
  db.run(`UPDATE terms SET is_active = 1 WHERE id IN (SELECT id FROM academic_terms WHERE is_active = 1)`);

  // ── Backfill legacy subjects/exams missing session_id or term_id ─────────────────
  db.run(`UPDATE subjects SET session_id = (SELECT id FROM academic_sessions WHERE is_active = 1 LIMIT 1) WHERE session_id IS NULL AND EXISTS (SELECT 1 FROM academic_sessions WHERE is_active = 1)`);
  db.run(`UPDATE subjects SET term_id = (SELECT id FROM academic_terms WHERE is_active = 1 LIMIT 1) WHERE term_id IS NULL AND EXISTS (SELECT 1 FROM academic_terms WHERE is_active = 1)`);
  db.run(`UPDATE exams SET session_id = (SELECT id FROM academic_sessions WHERE is_active = 1 LIMIT 1) WHERE session_id IS NULL AND EXISTS (SELECT 1 FROM academic_sessions WHERE is_active = 1)`);
  db.run(`UPDATE exams SET term_id = (SELECT id FROM academic_terms WHERE is_active = 1 LIMIT 1) WHERE term_id IS NULL AND EXISTS (SELECT 1 FROM academic_sessions WHERE is_active = 1)`);
  
  db.run(`UPDATE users SET session_id = (SELECT id FROM academic_sessions WHERE is_active = 1 LIMIT 1) WHERE session_id IS NULL AND EXISTS (SELECT 1 FROM academic_sessions WHERE is_active = 1)`);
  db.run(`UPDATE users SET term_id = (SELECT id FROM academic_terms WHERE is_active = 1 LIMIT 1) WHERE term_id IS NULL AND EXISTS (SELECT 1 FROM academic_sessions WHERE is_active = 1)`);
  
  db.run(`UPDATE questions SET session_id = (SELECT id FROM academic_sessions WHERE is_active = 1 LIMIT 1) WHERE session_id IS NULL AND EXISTS (SELECT 1 FROM academic_sessions WHERE is_active = 1)`);
  db.run(`UPDATE questions SET term_id = (SELECT id FROM academic_terms WHERE is_active = 1 LIMIT 1) WHERE term_id IS NULL AND EXISTS (SELECT 1 FROM academic_sessions WHERE is_active = 1)`);
  
  db.run(`UPDATE student_answers SET session_id = (SELECT id FROM academic_sessions WHERE is_active = 1 LIMIT 1) WHERE session_id IS NULL AND EXISTS (SELECT 1 FROM academic_sessions WHERE is_active = 1)`);
  db.run(`UPDATE student_answers SET term_id = (SELECT id FROM academic_terms WHERE is_active = 1 LIMIT 1) WHERE term_id IS NULL AND EXISTS (SELECT 1 FROM academic_sessions WHERE is_active = 1)`);
  
  db.run(`UPDATE student_term_remarks SET session_id = (SELECT id FROM academic_sessions WHERE is_active = 1 LIMIT 1) WHERE session_id IS NULL AND EXISTS (SELECT 1 FROM academic_sessions WHERE is_active = 1)`);
  db.run(`UPDATE student_term_remarks SET term_id = (SELECT id FROM academic_terms WHERE is_active = 1 LIMIT 1) WHERE term_id IS NULL AND EXISTS (SELECT 1 FROM academic_sessions WHERE is_active = 1)`);

  // ── v8: Grading System ──────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS grading_subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      class_id INTEGER REFERENCES classes(id),
      term_id INTEGER NOT NULL REFERENCES academic_terms(id),
      session_id INTEGER NOT NULL REFERENCES academic_sessions(id),
      teacher_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      UNIQUE(code, term_id, class_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS grading_policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grading_subject_id INTEGER NOT NULL REFERENCES grading_subjects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('cbt_test', 'cbt_exam', 'manual')),
      mapped_cbt_subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
      max_marks INTEGER NOT NULL,
      is_exam INTEGER NOT NULL DEFAULT 0 CHECK(is_exam IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS grading_manual_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grading_policy_id INTEGER NOT NULL REFERENCES grading_policies(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      score REAL NOT NULL,
      entered_by INTEGER NOT NULL REFERENCES users(id),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      UNIQUE(grading_policy_id, student_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS term_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      grading_subject_id INTEGER NOT NULL REFERENCES grading_subjects(id) ON DELETE CASCADE,
      ca_score REAL NOT NULL DEFAULT 0,
      exam_score REAL NOT NULL DEFAULT 0,
      total_score REAL NOT NULL DEFAULT 0,
      grade TEXT,
      remark TEXT,
      is_approved INTEGER NOT NULL DEFAULT 0 CHECK(is_approved IN (0,1)),
      term_id INTEGER NOT NULL REFERENCES academic_terms(id),
      session_id INTEGER NOT NULL REFERENCES academic_sessions(id),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      UNIQUE(student_id, grading_subject_id, term_id)
    )
  `);
  // Ensure unique index with term_id exists — CREATE IF NOT EXISTS is idempotent.
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_term_results_unique ON term_results(student_id, grading_subject_id, term_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS annual_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      class_id INTEGER REFERENCES classes(id),
      session_id INTEGER NOT NULL REFERENCES academic_sessions(id),
      total_average REAL NOT NULL DEFAULT 0,
      promotion_status TEXT CHECK(promotion_status IN ('Promoted', 'Repeated', 'Graduated')),
      approved_by INTEGER REFERENCES users(id),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      UNIQUE(student_id, session_id)
    )
  `);

  // v8+: grading flexibility migrations
  addColumnIfMissing("config", "grading_config_json", "TEXT");
  addColumnIfMissing("grading_subjects", "mode", "TEXT");
  addColumnIfMissing("grading_subjects", "source_cbt_subject_id", "INTEGER");
  addColumnIfMissing("grading_subjects", "pass_mark", "REAL");
  // Teacher autonomy: publish gate for class teacher view
  addColumnIfMissing("grading_subjects", "is_published_to_class", "INTEGER NOT NULL DEFAULT 0");
  // v9: Class Teacher assignment
  addColumnIfMissing("classes", "class_teacher_id", "INTEGER REFERENCES users(id)");

  // ── v10: Flexible Grading System ────────────────────────────────────────────
  // Grading Schemes: top-level configuration per subject/term/class
  db.run(`
    CREATE TABLE IF NOT EXISTS grading_schemes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grading_subject_id INTEGER NOT NULL REFERENCES grading_subjects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'locked')),
      is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      published_at TEXT,
      locked_at TEXT
    )
  `);
  // Partial unique index: only one default scheme per grading_subject
  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_grading_schemes_default_per_subject
    ON grading_schemes(grading_subject_id) WHERE is_default = 1
  `);

  // Grading Categories: hierarchical categories within a scheme (Examination, CAT, Assignments, etc.)
  db.run(`
    CREATE TABLE IF NOT EXISTS grading_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grading_scheme_id INTEGER NOT NULL REFERENCES grading_schemes(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      weight REAL NOT NULL DEFAULT 0,  -- percentage weight (e.g., 60.0 for 60%)
      order_index INTEGER NOT NULL DEFAULT 0,
      parent_category_id INTEGER REFERENCES grading_categories(id) ON DELETE CASCADE,
      is_exam_category INTEGER NOT NULL DEFAULT 0 CHECK(is_exam_category IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `);

  // Grading Assessments: individual assessments within categories (CAT 1, Mid-term Exam, etc.)
  db.run(`
    CREATE TABLE IF NOT EXISTS grading_assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grading_category_id INTEGER NOT NULL REFERENCES grading_categories(id) ON DELETE CASCADE,
      grading_scheme_id INTEGER NOT NULL REFERENCES grading_schemes(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,  -- 'examination', 'cat', 'assignment', 'quiz', 'weekly_test', 'practical', 'project', 'presentation', 'participation', 'attendance', 'custom'
      max_marks REAL NOT NULL DEFAULT 100,
      weight REAL NOT NULL DEFAULT 100,  -- weight within category (percentage)
      order_index INTEGER NOT NULL DEFAULT 0,
      mapped_cbt_subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
      is_mandatory INTEGER NOT NULL DEFAULT 1 CHECK(is_mandatory IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `);

  // Grade Boundaries: configurable grade scale per scheme
  db.run(`
    CREATE TABLE IF NOT EXISTS grading_grade_boundaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grading_scheme_id INTEGER NOT NULL REFERENCES grading_schemes(id) ON DELETE CASCADE,
      grade_symbol TEXT NOT NULL,
      min_percentage REAL NOT NULL,
      max_percentage REAL NOT NULL,
      grade_point REAL,
      description TEXT,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      UNIQUE(grading_scheme_id, grade_symbol)
    )
  `);

  // Student Scores: scores per assessment per student
  db.run(`
    CREATE TABLE IF NOT EXISTS grading_student_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grading_assessment_id INTEGER NOT NULL REFERENCES grading_assessments(id) ON DELETE CASCADE,
      grading_scheme_id INTEGER NOT NULL REFERENCES grading_schemes(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      score REAL,
      max_marks_override REAL,  -- if different from assessment max_marks
      entered_by INTEGER NOT NULL REFERENCES users(id),
      entered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      is_overridden INTEGER NOT NULL DEFAULT 0 CHECK(is_overridden IN (0,1)),
      UNIQUE(grading_assessment_id, student_id)
    )
  `);

  // Calculated Results: computed breakdown per student per scheme
  db.run(`
    CREATE TABLE IF NOT EXISTS grading_calculated_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grading_scheme_id INTEGER NOT NULL REFERENCES grading_schemes(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      term_id INTEGER NOT NULL REFERENCES academic_terms(id),
      session_id INTEGER NOT NULL REFERENCES academic_sessions(id),
      category_breakdown_json TEXT NOT NULL,  -- JSON with category scores, percentages, contributions
      overall_percentage REAL NOT NULL DEFAULT 0,
      grade_symbol TEXT,
      grade_point REAL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'locked')),
      calculated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      calculated_by INTEGER NOT NULL REFERENCES users(id),
      approved_at TEXT,
      approved_by INTEGER REFERENCES users(id),
      UNIQUE(grading_scheme_id, student_id, term_id)
    )
  `);

  // Scheme Version History: audit trail for scheme changes
  db.run(`
    CREATE TABLE IF NOT EXISTS grading_scheme_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grading_scheme_id INTEGER NOT NULL REFERENCES grading_schemes(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      scheme_snapshot_json TEXT NOT NULL,  -- full scheme config at this version
      categories_snapshot_json TEXT NOT NULL,
      assessments_snapshot_json TEXT NOT NULL,
      boundaries_snapshot_json TEXT NOT NULL,
      changed_by INTEGER NOT NULL REFERENCES users(id),
      change_summary TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      UNIQUE(grading_scheme_id, version_number)
    )
  `);

  // Indexes for flexible grading
  db.run("CREATE INDEX IF NOT EXISTS idx_grading_schemes_subject ON grading_schemes(grading_subject_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_grading_schemes_status ON grading_schemes(status)");
  db.run("CREATE INDEX IF NOT EXISTS idx_grading_categories_scheme ON grading_categories(grading_scheme_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_grading_categories_parent ON grading_categories(parent_category_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_grading_assessments_category ON grading_assessments(grading_category_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_grading_assessments_scheme ON grading_assessments(grading_scheme_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_grading_assessments_cbt ON grading_assessments(mapped_cbt_subject_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_grading_boundaries_scheme ON grading_grade_boundaries(grading_scheme_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_grading_scores_assessment ON grading_student_scores(grading_assessment_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_grading_scores_student ON grading_student_scores(student_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_grading_scores_scheme ON grading_student_scores(grading_scheme_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_grading_results_scheme ON grading_calculated_results(grading_scheme_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_grading_results_student ON grading_calculated_results(student_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_grading_versions_scheme ON grading_scheme_versions(grading_scheme_id)");

  // ── v9: Class Teacher Assignments Records ─────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS class_teacher_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      assigned_by INTEGER NOT NULL REFERENCES users(id),
      action TEXT NOT NULL CHECK(action IN ('assigned', 'reassigned', 'unassigned')),
      assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      notes TEXT
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_cta_class ON class_teacher_assignments(class_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_cta_teacher ON class_teacher_assignments(teacher_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_cta_time ON class_teacher_assignments(assigned_at DESC)");

  // ── v11: Guardian Attendance Records ─────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS attendance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      term_id INTEGER NOT NULL REFERENCES academic_terms(id) ON DELETE RESTRICT,
      session_id INTEGER NOT NULL REFERENCES academic_sessions(id) ON DELETE RESTRICT,
      date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('present', 'absent', 'late', 'holiday', 'excused')),
      remarks TEXT,
      marked_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      UNIQUE(student_id, term_id, date)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_att_student_date ON attendance_records(student_id, date)");
  db.run("CREATE INDEX IF NOT EXISTS idx_att_term_date ON attendance_records(term_id, date)");

  // ── v11: Guardian Fee Structures ─────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS fee_structures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
      term_id INTEGER NOT NULL REFERENCES academic_terms(id) ON DELETE RESTRICT,
      session_id INTEGER NOT NULL REFERENCES academic_sessions(id) ON DELETE RESTRICT,
      title TEXT NOT NULL,
      amount REAL NOT NULL,
      due_date TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_fees_class_term ON fee_structures(class_id, term_id)");

  // ── v11: Guardian Fee Payments ───────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS fee_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      fee_id INTEGER NOT NULL REFERENCES fee_structures(id) ON DELETE RESTRICT,
      amount_paid REAL NOT NULL,
      payment_ref TEXT NOT NULL UNIQUE,
      method TEXT NOT NULL DEFAULT 'bank_transfer' CHECK(method IN ('bank_transfer', 'cash', 'card', 'online_gateway')),
      status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('pending', 'completed', 'failed')),
      paid_by INTEGER NOT NULL REFERENCES users(id),
      paid_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_fee_payments_student ON fee_payments(student_id)");

  // ── v11: Guardian Message Threads ────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS guardian_message_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guardian_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL DEFAULT 'teacher' CHECK(category IN ('teacher', 'school', 'system')),
      subject TEXT,
      last_message TEXT,
      last_message_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      unread_for_guardian INTEGER NOT NULL DEFAULT 0,
      unread_for_recipient INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      UNIQUE(guardian_id, recipient_id, student_id)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_gmt_guardian ON guardian_message_threads(guardian_id, last_message_at DESC)");
  db.run("CREATE INDEX IF NOT EXISTS idx_gmt_recipient ON guardian_message_threads(recipient_id, last_message_at DESC)");
  db.run("CREATE INDEX IF NOT EXISTS idx_gmt_student ON guardian_message_threads(student_id)");

  // ── v11: Guardian Messages ───────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS guardian_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL REFERENCES guardian_message_threads(id) ON DELETE CASCADE,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sender_role TEXT NOT NULL CHECK(sender_role IN ('guardian', 'teacher', 'operator')),
      text TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_gm_thread ON guardian_messages(thread_id, created_at ASC)");

  // ── v11: Push Subscriptions (VAPID / Web Push) ──────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id)");

  // ── Guardian Notification Preferences in Users table ──
  addColumnIfMissing("users", "notify_attendance", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing("users", "notify_results", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing("users", "notify_fees", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing("users", "notify_messages", "INTEGER NOT NULL DEFAULT 1");

  // ── RBAC: Role Permissions ──────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role TEXT NOT NULL,
      permission TEXT NOT NULL,
      PRIMARY KEY (role, permission)
    )
  `);

  // Seed default permissions
  const defaultPermissions: [string, string][] = [
    ["operator", "*"],
    ["teacher", "subject:create"],
    ["teacher", "subject:read:own"],
    ["teacher", "subject:write:own"],
    ["teacher", "subject:delete:own"],
    ["teacher", "subject:publish:own"],
    ["teacher", "subject:schedule:own"],
    ["teacher", "enrollment:manage:own"],
    ["teacher", "questions:manage:own"],
    ["teacher", "grade:essay:own"],
    ["teacher", "grade:ca:own"],
    ["teacher", "results:read:own"],
    ["teacher", "results:publish:own"],
    ["teacher", "remarks:write:own"],
    ["student", "exam:take"],
    ["student", "results:read:own"],
    ["student", "exam:retake:own"],
    ["guardian", "student:read:wards"],
  ];
  for (const [role, permission] of defaultPermissions) {
    db.prepare("INSERT OR IGNORE INTO role_permissions (role, permission) VALUES (?, ?)").run(role, permission);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPREHENSIVE RELATIONAL FOREIGN KEY & COVERING INDEXES
  // Prevents SQLite full-table scans during ON DELETE CASCADE / RESTRICT / JOINs
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Users FK indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_users_grade_level ON users(grade_level_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_users_session     ON users(session_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_users_term        ON users(term_id)");

  // Subjects FK & filter indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_subjects_created_by  ON subjects(created_by)");
  db.run("CREATE INDEX IF NOT EXISTS idx_subjects_session     ON subjects(session_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_subjects_term_id     ON subjects(term_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_subjects_grade_level ON subjects(grade_level_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_subjects_archived    ON subjects(archived_at)");

  // Questions FK & sorting indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_questions_session ON questions(session_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_questions_term    ON questions(term_id)");

  // Exams FK & search indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_exams_session_term ON exams(session_id, term_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_exams_reg_id       ON exams(reg_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_exams_locked       ON exams(is_locked)");

  // Student Answers FK indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_sa_session ON student_answers(session_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_sa_term    ON student_answers(term_id)");

  // Subject Enrollments FK indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_se_enrolled_by ON subject_enrollments(enrolled_by)");

  // Classes & Class Teacher FK indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_classes_teacher   ON classes(class_teacher_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_cta_assigned_by   ON class_teacher_assignments(assigned_by)");
  db.run("CREATE INDEX IF NOT EXISTS idx_ce_term           ON class_enrollments(term_id)");

  // Guardian Links FK indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_gsl_verified_by ON guardian_student_links(verified_by)");

  // Academic Calendar FK indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_cal_created_by ON academic_calendar_events(created_by)");

  // Timetables FK indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_tt_grade_level ON timetables(grade_level_id)");

  // Grading Subjects FK indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_gs_teacher    ON grading_subjects(teacher_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_gs_session    ON grading_subjects(session_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_gs_term       ON grading_subjects(term_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_gs_class      ON grading_subjects(class_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_gs_source_cbt ON grading_subjects(source_cbt_subject_id)");

  // Grading Policies FK indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_gp_subject    ON grading_policies(grading_subject_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_gp_mapped_cbt ON grading_policies(mapped_cbt_subject_id)");

  // Grading Manual Scores FK indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_gms_policy     ON grading_manual_scores(grading_policy_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_gms_student    ON grading_manual_scores(student_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_gms_entered_by ON grading_manual_scores(entered_by)");

  // Term Results & Annual Results FK & Composite indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_tr_student              ON term_results(student_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tr_subject              ON term_results(grading_subject_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tr_term                 ON term_results(term_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tr_session              ON term_results(session_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tr_student_term_session ON term_results(student_id, term_id, session_id)");
  
  db.run("CREATE INDEX IF NOT EXISTS idx_ar_student     ON annual_results(student_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_ar_session     ON annual_results(session_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_ar_class       ON annual_results(class_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_ar_approved_by ON annual_results(approved_by)");

  // Flexible Grading System Foreign Keys
  db.run("CREATE INDEX IF NOT EXISTS idx_gs_created_by  ON grading_schemes(created_by)");
  db.run("CREATE INDEX IF NOT EXISTS idx_gsv_changed_by ON grading_scheme_versions(changed_by)");
  db.run("CREATE INDEX IF NOT EXISTS idx_gss_entered_by ON grading_student_scores(entered_by)");
  db.run("CREATE INDEX IF NOT EXISTS idx_gcr_term       ON grading_calculated_results(term_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_gcr_session    ON grading_calculated_results(session_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_gcr_calc_by    ON grading_calculated_results(calculated_by)");
  db.run("CREATE INDEX IF NOT EXISTS idx_gcr_appr_by    ON grading_calculated_results(approved_by)");

  // Kiosk & Operational Tables FK indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_kiosk_student ON kiosk_sessions(student_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_kiosk_exam    ON kiosk_sessions(exam_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_qm_exam       ON question_map(exam_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_qm_question   ON question_map(question_id)");

  // Re-run query planner optimization
  db.run("PRAGMA optimize");

  seedGradeLevels();
  migrateLegacyGrades();
  seedStandardizedClasses();
}

function seedGradeLevels() {
  // Seed ALL grade types every time so the dropdown is always universal.
  // INSERT OR IGNORE ensures idempotency — existing rows are never duplicated.
  const allSeeds: { name: string; cat: string; sort_order: number }[] = [
    { name: 'Primary 1',  cat: 'primary',      sort_order: 1  },
    { name: 'Primary 2',  cat: 'primary',      sort_order: 2  },
    { name: 'Primary 3',  cat: 'primary',      sort_order: 3  },
    { name: 'Primary 4',  cat: 'primary',      sort_order: 4  },
    { name: 'Primary 5',  cat: 'primary',      sort_order: 5  },
    { name: 'Primary 6',  cat: 'primary',      sort_order: 6  },
    { name: 'JSS 1',      cat: 'secondary',    sort_order: 7  },
    { name: 'JSS 2',      cat: 'secondary',    sort_order: 8  },
    { name: 'JSS 3',      cat: 'secondary',    sort_order: 9  },
    { name: 'SS 1',       cat: 'secondary',    sort_order: 10 },
    { name: 'SS 2',       cat: 'secondary',    sort_order: 11 },
    { name: 'SS 3',       cat: 'secondary',    sort_order: 12 },
    { name: '100 Level',  cat: 'university',   sort_order: 13 },
    { name: '200 Level',  cat: 'university',   sort_order: 14 },
    { name: '300 Level',  cat: 'university',   sort_order: 15 },
    { name: '400 Level',  cat: 'university',   sort_order: 16 },
    { name: '500 Level',  cat: 'university',   sort_order: 17 },
    { name: '600 Level',  cat: 'university',   sort_order: 18 },
    { name: 'ND 1',       cat: 'polytechnic',  sort_order: 19 },
    { name: 'ND 2',       cat: 'polytechnic',  sort_order: 20 },
    { name: 'HND 1',      cat: 'polytechnic',  sort_order: 21 },
    { name: 'HND 2',      cat: 'polytechnic',  sort_order: 22 },
  ];
  const stmt = db.prepare('INSERT OR IGNORE INTO grade_levels (name, category, sort_order) VALUES (?, ?, ?)');
  for (const s of allSeeds) stmt.run(s.name, s.cat, s.sort_order);
}

function migrateLegacyGrades() {
  // Migrate users.grade -> grade_level_id
  const users = db.prepare("SELECT id, grade FROM users WHERE grade IS NOT NULL AND grade != '' AND grade_level_id IS NULL").all() as any[];
  const insertGrade = db.prepare("INSERT OR IGNORE INTO grade_levels (name, category, sort_order) VALUES (?, 'custom', 99)");
  const getGradeId = db.prepare("SELECT id FROM grade_levels WHERE name COLLATE NOCASE = ?");
  const updateUserId = db.prepare("UPDATE users SET grade_level_id = ? WHERE id = ?");
  
  for (const u of users) {
    const rawGrade = String(u.grade).trim();
    if (!rawGrade) continue;
    let gidRow = getGradeId.get(rawGrade) as any;
    if (!gidRow) {
      insertGrade.run(rawGrade);
      gidRow = getGradeId.get(rawGrade) as any;
    }
    if (gidRow) {
      updateUserId.run(gidRow.id, u.id);
    }
  }

  // Migrate subjects.class -> grade_level_id
  const subjects = db.prepare("SELECT id, class FROM subjects WHERE class IS NOT NULL AND class != '' AND grade_level_id IS NULL").all() as any[];
  const updateSubjectId = db.prepare("UPDATE subjects SET grade_level_id = ? WHERE id = ?");
  for (const s of subjects) {
    const rawClass = String(s.class).trim();
    if (!rawClass) continue;
    let gidRow = getGradeId.get(rawClass) as any;
    if (!gidRow) {
      insertGrade.run(rawClass);
      gidRow = getGradeId.get(rawClass) as any;
    }
    if (gidRow) {
      updateSubjectId.run(gidRow.id, s.id);
    }
  }

  // Migrate timetables.class -> grade_level_id
  const timetables = db.prepare("SELECT id, class FROM timetables WHERE class IS NOT NULL AND class != '' AND grade_level_id IS NULL").all() as any[];
  const updateTimetableId = db.prepare("UPDATE timetables SET grade_level_id = ? WHERE id = ?");
  for (const t of timetables) {
    const rawClass = String(t.class).trim();
    if (!rawClass) continue;
    let gidRow = getGradeId.get(rawClass) as any;
    if (!gidRow) {
      insertGrade.run(rawClass);
      gidRow = getGradeId.get(rawClass) as any;
    }
    if (gidRow) {
      updateTimetableId.run(gidRow.id, t.id);
    }
  }
}

function seedStandardizedClasses() {
  // Auto-seed all standardized grade classes so the "Assign Class Teacher" dropdown
  // is always fully populated without requiring any manual class creation.
  // INSERT OR IGNORE is idempotent — existing rows are never duplicated.
  const standardizedGrades = [
    { name: 'Primary 1',  level: 'junior' },
    { name: 'Primary 2',  level: 'junior' },
    { name: 'Primary 3',  level: 'junior' },
    { name: 'Primary 4',  level: 'junior' },
    { name: 'Primary 5',  level: 'junior' },
    { name: 'Primary 6',  level: 'junior' },
    { name: 'JSS 1',      level: 'junior' },
    { name: 'JSS 2',      level: 'junior' },
    { name: 'JSS 3',      level: 'junior' },
    { name: 'SS 1',       level: 'senior' },
    { name: 'SS 2',       level: 'senior' },
    { name: 'SS 3',       level: 'senior' },
    { name: '100 Level',  level: 'senior' },
    { name: '200 Level',  level: 'senior' },
    { name: '300 Level',  level: 'senior' },
    { name: '400 Level',  level: 'senior' },
    { name: '500 Level',  level: 'senior' },
    { name: '600 Level',  level: 'senior' },
    { name: 'ND 1',       level: 'senior' },
    { name: 'ND 2',       level: 'senior' },
    { name: 'HND 1',      level: 'senior' },
    { name: 'HND 2',      level: 'senior' },
  ];
  const stmt = db.prepare("INSERT OR IGNORE INTO classes (name, section, level) VALUES (?, NULL, ?)");
  for (const g of standardizedGrades) stmt.run(g.name, g.level);
}

// Initialize schema before preparing statements so new tables exist.
initializeDatabase();

export const queries = {
  // ── Users ──────────────────────────────────────────────────────────────
  getUserByEmail: db.prepare("SELECT u.*, COALESCE(gl.name, u.grade) as grade, gl.name as grade_level_name FROM users u LEFT JOIN grade_levels gl ON u.grade_level_id = gl.id WHERE u.email = ?"),
  getUserByEmailOrReg: db.prepare("SELECT u.*, COALESCE(gl.name, u.grade) as grade, gl.name as grade_level_name FROM users u LEFT JOIN grade_levels gl ON u.grade_level_id = gl.id WHERE u.email = ? OR u.reg_id = ?"),
  createUser:     db.prepare(`
    INSERT INTO users (name, email, role, password_hash, grade, reg_id, first_name, last_name, address, phone, dob, grade_level_id, session_id, term_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
      (SELECT id FROM academic_sessions WHERE is_active = 1 LIMIT 1), 
      (SELECT id FROM academic_terms WHERE is_active = 1 LIMIT 1))
  `),
  getUserById:    db.prepare("SELECT u.*, COALESCE(gl.name, u.grade) as grade, gl.name as grade_level_name FROM users u LEFT JOIN grade_levels gl ON u.grade_level_id = gl.id WHERE u.id = ?"),
  getAllUsers:    db.prepare("SELECT u.id, u.name, u.email, u.role, COALESCE(gl.name, u.grade) as grade, u.grade_level_id, u.reg_id, u.first_name, u.last_name, u.phone, u.is_active, u.created_at FROM users u LEFT JOIN grade_levels gl ON u.grade_level_id = gl.id ORDER BY u.id DESC LIMIT 1000"),
  updateUser:     db.prepare("UPDATE users SET first_name=?, last_name=?, address=?, phone=?, dob=?, grade=?, grade_level_id=?, image_url=? WHERE id=?"),
  deactivateUser: db.prepare("UPDATE users SET is_active = 0 WHERE id = ?"),
  activateUser:   db.prepare("UPDATE users SET is_active = 1 WHERE id = ?"),
  countOperators: db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'operator' AND is_active = 1"),
  /** Targeted operator fetch — avoids scanning all users in notifyOperators. */
  getOperators:   db.prepare("SELECT id FROM users WHERE role = 'operator' AND is_active = 1"),

  // ── Subjects ──────────────────────────────────────────────────────────
  getSubjectsByTeacher: db.prepare("SELECT * FROM subjects WHERE teacher_id = ?"),
  getAllSubjects:        db.prepare("SELECT * FROM subjects"),
  getSubjectById:       db.prepare("SELECT * FROM subjects WHERE id = ?"),
  /** Subjects with question counts — single query replaces N+1 in teacher dashboard */
  getSubjectsWithQuestionCounts: db.prepare(`
    SELECT s.*, COUNT(q.id) as question_count
    FROM subjects s
    LEFT JOIN questions q ON q.subject_id = s.id
    WHERE s.teacher_id = ?
    GROUP BY s.id
  `),

  // ── Enrollments ───────────────────────────────────────────────────────
  enrollStudent:   db.prepare("INSERT OR IGNORE INTO subject_enrollments (subject_id, student_id, enrolled_by) VALUES (?, ?, ?)"),
  unenrollStudent: db.prepare("DELETE FROM subject_enrollments WHERE subject_id = ? AND student_id = ?"),
  getEnrollmentsBySubject: db.prepare(`
    SELECT
      u.id, u.name, u.email, COALESCE(gl.name, u.grade) as grade, u.grade_level_id, u.reg_id, u.is_active,
      se.enrolled_at,
      e.id as exam_id, e.status as exam_status, e.score, e.total_score, e.end_time
    FROM subject_enrollments se
    JOIN users u ON u.id = se.student_id
    LEFT JOIN grade_levels gl ON u.grade_level_id = gl.id
    LEFT JOIN exams e ON e.student_id = se.student_id AND e.subject_id = se.subject_id
    WHERE se.subject_id = ?
  `),
  getEnrolledSubjectsByStudent: db.prepare(`
    SELECT s.* FROM subjects s
    INNER JOIN subject_enrollments se ON se.subject_id = s.id AND se.student_id = ?
  `),
  countEnrollments: db.prepare("SELECT COUNT(*) as count FROM subject_enrollments WHERE subject_id = ?"),
  createSubject:             db.prepare(`
    INSERT INTO subjects (name, code, term, duration, total_score, exam_datetime, is_published, teacher_id, created_by, description, class, grade_level_id, session, mode, instructions, is_timetable_published, window_duration, can_retake, is_assignment, session_id, term_id, assessment_type, result_policy, result_release_time)
    VALUES (?, ?, ?, 60, ?, '2099-01-01T00:00', 0, ?, ?, ?, ?, ?, ?, ?, ?, 0, 120, ?, 0, ?, ?, ?, ?, ?)
  `),
  updateSubject: db.prepare(`
    UPDATE subjects SET name=?, code=?, term=?, total_score=?, teacher_id=?, description=?, class=?, grade_level_id=?, session=?, mode=?, instructions=?, can_retake=?, session_id=?, term_id=?, is_published=?, assessment_type=?, result_policy=?, result_release_time=?
    WHERE id=?
  `),
  updateSubjectSchedulingInfo: db.prepare("UPDATE subjects SET teacher_id=?, can_retake=?, mode=?, exam_datetime=?, duration=?, window_duration=?, is_timetable_published=? WHERE id=?"),
  deleteSubject: db.prepare("DELETE FROM subjects WHERE id = ?"),
  
  // ── Timetables ────────────────────────────────────────────────────────
  getTimetables: db.prepare(`
    SELECT t.*, s.name as subject_name, s.code as subject_code, s.teacher_id, s.session_id, s.term_id, COALESCE(gl.name, t.class) as class_name 
    FROM timetables t
    JOIN subjects s ON t.subject_id = s.id
    LEFT JOIN grade_levels gl ON t.grade_level_id = gl.id
    ORDER BY t.exam_date, t.start_time
  `),
  createTimetable: db.prepare(`
    INSERT INTO timetables (subject_id, class, grade_level_id, section, exam_date, start_time, end_time, duration, exam_mode, allow_students)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateTimetable: db.prepare(`
    UPDATE timetables SET subject_id=?, class=?, grade_level_id=?, section=?, exam_date=?, start_time=?, end_time=?, duration=?, exam_mode=?, allow_students=?, updated_at=(strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    WHERE id=?
  `),
  deleteTimetable: db.prepare("DELETE FROM timetables WHERE id = ?"),

  // ── Questions ─────────────────────────────────────────────────────────
  getQuestionById:       db.prepare("SELECT * FROM questions WHERE id = ?"),
  getQuestionsBySubject: db.prepare("SELECT * FROM questions WHERE subject_id = ? ORDER BY order_index"),
  createQuestion:        db.prepare(`
    INSERT INTO questions (subject_id, question_text, options_json, correct_answer, marks, order_index, question_type, session, term, mode, teacher_answer, image_url, is_file_upload, attached_file_url, explanation, solution)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateQuestion: db.prepare(`
    UPDATE questions SET question_text=?, options_json=?, correct_answer=?, marks=?, question_type=?, teacher_answer=?, image_url=?, is_file_upload=?, attached_file_url=?, explanation=?, solution=?,
    updated_at=(strftime('%Y-%m-%dT%H:%M:%SZ','now')) WHERE id=?
  `),
  deleteQuestion: db.prepare("DELETE FROM questions WHERE id = ?"),

  // ── Student Answers ───────────────────────────────────────────────────
  insertStudentAnswer: db.prepare(`
    INSERT OR REPLACE INTO student_answers
      (exam_id, question_id, student_id, subject_id, selected_option, essay_response, is_correct, marks_awarded, file_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getStudentAnswersByExam: db.prepare("SELECT sa.*, q.question_text, q.question_type, q.correct_answer, q.teacher_answer, q.options_json, q.marks, q.explanation, q.solution FROM student_answers sa JOIN questions q ON q.id = sa.question_id WHERE sa.exam_id = ?"),

  // ── Exams / Results ───────────────────────────────────────────────────
  createExam: db.prepare(`
    INSERT INTO exams (student_id, subject_id, start_time, answers_json, status, session, term, mode, session_id, term_id, deadline, result_status, solution_reveals_remaining, revealed_solutions_json) 
    VALUES (?, ?, ?, ?, 'in-progress', ?, ?, ?,
      (SELECT session_id FROM subjects WHERE id = ?2), 
      (SELECT term_id FROM subjects WHERE id = ?2),
      ?, ?, ?, ?)
  `),
  updateExamReveals: db.prepare("UPDATE exams SET solution_reveals_remaining = ?, revealed_solutions_json = ? WHERE id = ?"),
  releaseSubjectResults: db.prepare("UPDATE exams SET result_status = 'released' WHERE subject_id = ? AND status = 'completed'"),
  getExamById:             db.prepare("SELECT * FROM exams WHERE id = ?"),
  getExamByStudentSubject: db.prepare("SELECT * FROM exams WHERE student_id = ? AND subject_id = ?"),
  saveExam:                db.prepare("UPDATE exams SET answers_json = ? WHERE id = ? AND student_id = ?"),
  submitExam:              db.prepare("UPDATE exams SET answers_json=?, end_time=?, score=?, total_score=?, status='completed' WHERE id=? AND student_id=? AND status='in-progress'"),
  resetExam:               db.prepare("UPDATE exams SET answers_json='[]', score=NULL, total_score=0, end_time=NULL, start_time=(strftime('%Y-%m-%dT%H:%M:%SZ','now')), deadline=NULL, retake_count = retake_count + 1, status='in-progress', solution_reveals_remaining=5, revealed_solutions_json='[]' WHERE id=? AND student_id=?"),
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
  updateUserGrade: db.prepare("UPDATE users SET grade_level_id = ? WHERE id = ? AND role = 'student'"),

  // ── Audit / Settings ──────────────────────────────────────────────────
  createAuditLog: db.prepare("INSERT INTO audit_logs (actor_id, action, resource, resource_id, details) VALUES (?, ?, ?, ?, ?)"),
  getAuditLogs:   db.prepare("SELECT al.*, u.name as actor_name FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_id ORDER BY al.timestamp DESC LIMIT 500"),
  
  insertTokenBlacklist: db.prepare("INSERT OR IGNORE INTO token_blacklist (token, jti, reason) VALUES (?, ?, ?)"),
  isTokenBlacklisted: db.prepare("SELECT 1 FROM token_blacklist WHERE token = ? OR jti = ? LIMIT 1"),
  insertUserToken: db.prepare("INSERT INTO user_tokens (jti, user_id, device_fingerprint, token_type, expires_at) VALUES (?, ?, ?, ?, ?)"),
  revokeUserToken: db.prepare("UPDATE user_tokens SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE jti = ?"),
  revokeAllUserTokens: db.prepare("UPDATE user_tokens SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE user_id = ? AND revoked_at IS NULL"),
  getUserDevices: db.prepare("SELECT * FROM user_devices WHERE user_id = ? ORDER BY last_used DESC"),
  revokeUserDevice: db.prepare("UPDATE user_devices SET last_used = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE user_id = ? AND device_fingerprint = ?"),

  countUsers:    db.prepare("SELECT COUNT(*) as count FROM users"),
  countActiveOperators: db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'operator' AND is_active = 1"),
  getSetting:    db.prepare("SELECT value FROM settings WHERE key = ?"),
  upsertSetting: db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=(strftime('%Y-%m-%dT%H:%M:%SZ','now'))"),

  // ── Term Remarks ──────────────────────────────────────────────────────
  getTermRemark: db.prepare("SELECT * FROM student_term_remarks WHERE student_id = ? AND session_id = ? AND term_id = ?"),
  insertTeacherRemark: db.prepare("INSERT INTO student_term_remarks (student_id, session_id, term_id, teacher_remark, term) VALUES (?, ?, ?, ?, ?)"),
  updateTeacherRemark: db.prepare("UPDATE student_term_remarks SET teacher_remark = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%SZ','now')) WHERE student_id = ? AND session_id = ? AND term_id = ?"),
  insertPrincipalRemark: db.prepare("INSERT INTO student_term_remarks (student_id, session_id, term_id, principal_remark, term) VALUES (?, ?, ?, ?, ?)"),
  updatePrincipalRemark: db.prepare("UPDATE student_term_remarks SET principal_remark = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%SZ','now')) WHERE student_id = ? AND session_id = ? AND term_id = ?"),

  // ── Hot-path pre-compiled statements (prevents repeated query plan compilation) ─
  getExamByIdAndStudent:   db.prepare("SELECT * FROM exams WHERE id = ? AND student_id = ?"),
  getQuestionByIdAndSubject: db.prepare("SELECT * FROM questions WHERE id = ? AND subject_id = ?"),
  getCompletedExamsByStudent: db.prepare("SELECT e.*, s.name as subject_name FROM exams e JOIN subjects s ON s.id = e.subject_id WHERE e.student_id = ? AND e.status = 'completed'"),
  getCompletedExamsByTeacher: db.prepare("SELECT e.*, s.name as subject_name, u.name as student_name, COALESCE(gl.name, u.grade) as grade, u.grade_level_id, u.reg_id, u.id as student_user_id FROM exams e JOIN subjects s ON s.id = e.subject_id JOIN users u ON u.id = e.student_id LEFT JOIN grade_levels gl ON gl.id = u.grade_level_id WHERE e.status = 'completed' AND s.teacher_id = ? ORDER BY e.end_time DESC"),
  getAllCompletedExams:        db.prepare("SELECT e.*, s.name as subject_name, u.name as student_name, COALESCE(gl.name, u.grade) as grade, u.grade_level_id, u.reg_id, u.id as student_user_id FROM exams e JOIN subjects s ON s.id = e.subject_id JOIN users u ON u.id = e.student_id LEFT JOIN grade_levels gl ON gl.id = u.grade_level_id WHERE e.status = 'completed' ORDER BY e.end_time DESC"),
  updateExamAnswersJson:   db.prepare("UPDATE exams SET answers_json = '[]' WHERE id = ?"),
  updateUserPassword:      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?"),
  updateExamScore:         db.prepare("UPDATE exams SET score = ? WHERE id = ?"),
  updateExamTeacherRemark: db.prepare("UPDATE exams SET teacher_remark = ? WHERE id = ?"),
  updateExamPrincipalRemark: db.prepare("UPDATE exams SET principal_remark = ? WHERE id = ?"),
  getSubjectExamCheck:     db.prepare("SELECT id FROM exams WHERE subject_id = ? LIMIT 1"),
  getStudentHasExam:       db.prepare("SELECT id FROM exams WHERE student_id = ? LIMIT 1"),
  getSubjectTotalScore:    db.prepare("SELECT COALESCE(SUM(marks),0) as total FROM questions WHERE subject_id = ?"),
  updateSubjectTotalScore: db.prepare("UPDATE subjects SET total_score = (SELECT COALESCE(SUM(marks),0) FROM questions WHERE subject_id = ?) WHERE id = ?"),
  getStudentsByGrade:      db.prepare("SELECT u.id FROM users u LEFT JOIN grade_levels gl ON gl.id = u.grade_level_id WHERE u.role = 'student' AND (gl.name = ? OR u.grade = ?) AND u.is_active = 1"),
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
    SELECT e.id as exam_id, e.subject_id, e.score, e.total_score, e.end_time,
           e.teacher_remark, e.principal_remark,
           s.name as subject_name, s.code, s.term, s.teacher_id
    FROM exams e
    JOIN subjects s ON e.subject_id = s.id
    WHERE e.student_id = ? AND e.status = 'completed'
    ORDER BY e.end_time DESC
  `),
  getStudentTermResultsForReportCard: db.prepare(`
    SELECT tr.id as exam_id, 
           tr.ca_score as ca_score,
           tr.exam_score as exam_score,
           tr.total_score as score, 
           (SELECT COALESCE(SUM(max_marks), 100) FROM grading_policies WHERE grading_subject_id = tr.grading_subject_id) as total_score,
           tr.grade as grade,
           tr.updated_at as end_time,
           tr.remark as teacher_remark,
           (SELECT principal_remark FROM student_term_remarks WHERE student_id = tr.student_id AND (session_id = tr.session_id OR session_id IS NULL) AND term_id = tr.term_id ORDER BY id DESC LIMIT 1) as principal_remark,
           (SELECT teacher_remark FROM student_term_remarks WHERE student_id = tr.student_id AND (session_id = tr.session_id OR session_id IS NULL) AND term_id = tr.term_id ORDER BY id DESC LIMIT 1) as term_teacher_remark,
           gs.name as subject_name, gs.code as code, 
           at.name as term,
           at.id as term_id,
           tr.session_id as session_id,
           acs.name as session_name,
           gs.teacher_id,
           tr.is_approved as is_approved,
           (SELECT COUNT(*) FROM academic_terms WHERE session_id = tr.session_id AND id <= tr.term_id) as term_order_in_session
    FROM term_results tr
    JOIN grading_subjects gs ON tr.grading_subject_id = gs.id
    JOIN academic_terms at ON tr.term_id = at.id
    JOIN academic_sessions acs ON tr.session_id = acs.id
    WHERE tr.student_id = ? AND tr.is_approved = 1
    ORDER BY tr.session_id ASC, tr.term_id ASC
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

  // ── v5: Terms ──────────────────────────────────────────────────────────────
  getActiveTerm:      db.prepare("SELECT * FROM terms WHERE is_active = 1 LIMIT 1"),
  getAllTerms:         db.prepare("SELECT * FROM terms ORDER BY created_at DESC"),
  getTermById:        db.prepare("SELECT * FROM terms WHERE id = ?"),
  createTerm:         db.prepare("INSERT INTO terms (session, name, start_date, end_date) VALUES (?, ?, ?, ?)"),
  deactivateAllTerms: db.prepare("UPDATE terms SET is_active = 0"),
  activateTerm:       db.prepare("UPDATE terms SET is_active = 1 WHERE id = ?"),
  updateTerm:         db.prepare("UPDATE terms SET session=?, name=?, start_date=?, end_date=?, registration_open=? WHERE id=?"),

  // ── v7: Academic Sessions & Academic Terms ─────────────────────────────────
  getActiveAcademicSession: db.prepare("SELECT * FROM academic_sessions WHERE is_active = 1 LIMIT 1"),
  getActiveAcademicTerm:    db.prepare("SELECT * FROM academic_terms WHERE is_active = 1 LIMIT 1"),
  getAllAcademicSessions:   db.prepare("SELECT * FROM academic_sessions ORDER BY id DESC"),
  getAcademicSessionById:   db.prepare("SELECT * FROM academic_sessions WHERE id = ?"),
  getAcademicTermsBySession:db.prepare("SELECT * FROM academic_terms WHERE session_id = ? ORDER BY id ASC"),
  getAllAcademicTerms:      db.prepare("SELECT t.*, s.name as session_name FROM academic_terms t JOIN academic_sessions s ON s.id = t.session_id ORDER BY t.id DESC"),
  getAcademicTermById:      db.prepare("SELECT * FROM academic_terms WHERE id = ?"),
  createAcademicSession:    db.prepare("INSERT INTO academic_sessions (name, is_active, status) VALUES (?, ?, ?)"),
  createAcademicTerm:       db.prepare("INSERT INTO academic_terms (session_id, name, start_date, end_date, is_active, status) VALUES (?, ?, ?, ?, ?, ?)"),
  deactivateAllAcademicSessions: db.prepare("UPDATE academic_sessions SET is_active = 0"),
  activateAcademicSession:   db.prepare("UPDATE academic_sessions SET is_active = 1 WHERE id = ?"),
  deactivateAllAcademicTerms:    db.prepare("UPDATE academic_terms SET is_active = 0"),
  activateAcademicTerm:      db.prepare("UPDATE academic_terms SET is_active = 1 WHERE id = ?"),
  lockExamsForTerm:          db.prepare("UPDATE exams SET is_locked = 1 WHERE term_id = ?"),
  archiveAcademicTerm:       db.prepare("UPDATE academic_terms SET status = 'archived', is_active = 0 WHERE id = ?"),

  // ── v5: Classes ─────────────────────────────────────────────────────────────
  getAllClasses:  db.prepare(`
    SELECT 
      c.*, 
      u.name as class_teacher_name, 
      u.email as class_teacher_email,
      u.phone as class_teacher_phone,
      u.id as class_teacher_id,
      (
        SELECT COUNT(*) 
        FROM users stu 
        LEFT JOIN grade_levels gl ON gl.id = stu.grade_level_id 
        WHERE stu.role = 'student' 
          AND stu.is_active = 1 
          AND COALESCE(gl.name, stu.grade) = c.name
      ) as enrolled_students_count
    FROM classes c
    LEFT JOIN users u ON u.id = c.class_teacher_id
    ORDER BY c.level, c.name, c.section
  `),
  getClassById:  db.prepare(`
    SELECT 
      c.*, 
      u.name as class_teacher_name,
      u.email as class_teacher_email,
      u.phone as class_teacher_phone,
      u.id as class_teacher_id,
      (
        SELECT COUNT(*) 
        FROM users stu 
        LEFT JOIN grade_levels gl ON gl.id = stu.grade_level_id 
        WHERE stu.role = 'student' 
          AND stu.is_active = 1 
          AND COALESCE(gl.name, stu.grade) = c.name
      ) as enrolled_students_count
    FROM classes c
    LEFT JOIN users u ON u.id = c.class_teacher_id
    WHERE c.id = ?
  `),
  createClass:   db.prepare("INSERT INTO classes (name, section, level) VALUES (?, ?, ?)"),
  updateClass:   db.prepare("UPDATE classes SET name=?, section=?, level=?, class_teacher_id=? WHERE id=?"),
  deleteClass:   db.prepare("DELETE FROM classes WHERE id=?"),
  /** Find which class (if any) a teacher is the class teacher for */
  getClassForTeacher: db.prepare("SELECT * FROM classes WHERE class_teacher_id = ? LIMIT 1"),
  assignClassTeacher: db.prepare("UPDATE classes SET class_teacher_id = ? WHERE id = ?"),
  unassignClassTeacher: db.prepare("UPDATE classes SET class_teacher_id = NULL WHERE id = ?"),
  unassignTeacherFromAllClasses: db.prepare("UPDATE classes SET class_teacher_id = NULL WHERE class_teacher_id = ?"),
  logClassTeacherAssignment: db.prepare(`
    INSERT INTO class_teacher_assignments (class_id, teacher_id, assigned_by, action, notes)
    VALUES (?, ?, ?, ?, ?)
  `),
  getClassTeacherAssignmentHistory: db.prepare(`
    SELECT 
      cta.*,
      c.name as class_name,
      c.section as class_section,
      c.level as class_level,
      tu.name as teacher_name,
      tu.email as teacher_email,
      tu.phone as teacher_phone,
      au.name as assigned_by_name,
      au.role as assigned_by_role
    FROM class_teacher_assignments cta
    JOIN classes c ON c.id = cta.class_id
    LEFT JOIN users tu ON tu.id = cta.teacher_id
    LEFT JOIN users au ON au.id = cta.assigned_by
    ORDER BY cta.id DESC
    LIMIT 500
  `),

  // ── v5: Class Enrollments ───────────────────────────────────────────────────
  getClassRoster:             db.prepare("SELECT u.id, u.name, u.email, COALESCE(gl.name, u.grade) as grade, u.reg_id, u.is_active, ce.enrollment_date FROM class_enrollments ce JOIN users u ON u.id = ce.student_id LEFT JOIN grade_levels gl ON gl.id = u.grade_level_id WHERE ce.class_id = ? AND ce.term_id = ? AND u.role = 'student' AND u.is_active = 1 ORDER BY u.name"),
  getStudentClassForTerm:     db.prepare("SELECT c.*, ce.enrollment_date FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id WHERE ce.student_id = ? AND ce.term_id = ? LIMIT 1"),
  enrollStudentInClass:       db.prepare("INSERT OR REPLACE INTO class_enrollments (student_id, class_id, term_id) VALUES (?, ?, ?)"),
  unenrollStudentFromClass:   db.prepare("DELETE FROM class_enrollments WHERE student_id=? AND term_id=?"),
  getEnrollmentCountForClass: db.prepare("SELECT COUNT(*) as count FROM users u LEFT JOIN grade_levels gl ON gl.id = u.grade_level_id JOIN classes c ON c.name = COALESCE(gl.name, u.grade) WHERE c.id=? AND u.role='student' AND u.is_active = 1"),

  // ── v5: Guardian-Student Links ──────────────────────────────────────────────
  getPendingGuardianLinks:  db.prepare("SELECT gsl.*, gu.name as guardian_name, gu.email as guardian_email, su.name as student_name, su.grade as student_grade, su.reg_id FROM guardian_student_links gsl JOIN users gu ON gu.id = gsl.guardian_id JOIN users su ON su.id = gsl.student_id WHERE gsl.status = 'pending' ORDER BY gsl.created_at DESC"),
  getAllGuardianLinks:       db.prepare("SELECT gsl.*, gu.name as guardian_name, gu.email as guardian_email, su.name as student_name, su.grade as student_grade, su.reg_id FROM guardian_student_links gsl JOIN users gu ON gu.id = gsl.guardian_id JOIN users su ON su.id = gsl.student_id ORDER BY gsl.created_at DESC LIMIT 200"),
  getGuardianWards:         db.prepare("SELECT gsl.*, su.name as student_name, su.grade, su.reg_id, su.image_url FROM guardian_student_links gsl JOIN users su ON su.id = gsl.student_id WHERE gsl.guardian_id = ? AND gsl.status = 'approved'"),
  getStudentGuardians:      db.prepare("SELECT gsl.*, gu.name as guardian_name, gu.email, gu.phone FROM guardian_student_links gsl JOIN users gu ON gu.id = gsl.guardian_id WHERE gsl.student_id = ? AND gsl.status = 'approved'"),
  createGuardianLink:       db.prepare("INSERT INTO guardian_student_links (guardian_id, student_id, relationship, verification_method) VALUES (?, ?, ?, 'manual_admin')"),
  updateGuardianLinkStatus: db.prepare("UPDATE guardian_student_links SET status=?, verified_by=?, verified_at=(strftime('%Y-%m-%dT%H:%M:%SZ','now')) WHERE id=?"),
  getGuardianLink:          db.prepare("SELECT * FROM guardian_student_links WHERE id=?"),

  // ── v5: Guardian Dashboard Queries ──────────────────────────────────────────
  getGuardianWardsWithStats: db.prepare(`
    SELECT gsl.*, 
      su.name as student_name, su.grade, su.reg_id, su.image_url,
      (SELECT COUNT(*) FROM exams WHERE student_id = su.id AND status = 'completed') as completed_exams,
      (SELECT ROUND(AVG(CASE WHEN status = 'completed' AND total_score > 0 THEN CAST(score AS REAL)/total_score*100 END), 1) FROM exams WHERE student_id = su.id) as avg_score
    FROM guardian_student_links gsl
    JOIN users su ON su.id = gsl.student_id
    WHERE gsl.guardian_id = ? AND gsl.status = 'approved'
  `),
  getWardTermResults: db.prepare(`
    SELECT tr.*, gs.name as subject_name, gs.code,
      (SELECT COALESCE(SUM(max_marks), 100) FROM grading_policies WHERE grading_subject_id = tr.grading_subject_id) as total_score
    FROM term_results tr
    JOIN grading_subjects gs ON gs.id = tr.grading_subject_id
    WHERE tr.student_id = ? AND tr.term_id = ? AND tr.is_approved = 1
    ORDER BY gs.name
  `),
  getWardExams: db.prepare(`
    SELECT e.*, s.name as subject_name, s.code
    FROM exams e
    JOIN subjects s ON s.id = e.subject_id
    WHERE e.student_id = ? AND e.status = 'completed'
    ORDER BY e.end_time DESC
    LIMIT ?
  `),
  getGuardianLinksByGuardian: db.prepare(`
    SELECT gsl.*, su.name as student_name, su.grade, su.reg_id
    FROM guardian_student_links gsl
    JOIN users su ON su.id = gsl.student_id
    WHERE gsl.guardian_id = ?
    ORDER BY gsl.created_at DESC
  `),
  getGuardianStats: db.prepare(`
    SELECT 
      (SELECT COUNT(*) FROM guardian_student_links WHERE guardian_id = ? AND status = 'approved') as total_wards,
      (SELECT COUNT(*) FROM guardian_student_links WHERE guardian_id = ? AND status = 'pending') as pending_links,
      (SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = 0) as unread_notifications
  `),

  // ── v5: Academic Calendar Events ────────────────────────────────────────────
  getCalendarByTerm:   db.prepare("SELECT * FROM academic_calendar_events WHERE term_id=? ORDER BY start_date"),
  createCalendarEvent: db.prepare("INSERT INTO academic_calendar_events (term_id, title, description, start_date, end_date, type, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)"),
  updateCalendarEvent: db.prepare("UPDATE academic_calendar_events SET title=?, description=?, start_date=?, end_date=?, type=? WHERE id=?"),
  deleteCalendarEvent: db.prepare("DELETE FROM academic_calendar_events WHERE id=?"),
  getCalendarEvent:    db.prepare("SELECT * FROM academic_calendar_events WHERE id=?"),

  // ── v5: Timetables ──────────────────────────────────────────────────────────
  // Removed legacy v5 timetable queries (repurposed table for exam scheduling)
  
  // ── v8: Grading System Queries ──────────────────────────────────────────────
  getGradingSubjectsByTeacher: db.prepare(`
    SELECT gs.*, c.name as class_name
    FROM grading_subjects gs
    LEFT JOIN classes c ON c.id = gs.class_id
    WHERE gs.teacher_id = ? AND gs.term_id = ?
  `),
  getAllGradingSubjects: db.prepare(`
    SELECT gs.*, c.name as class_name
    FROM grading_subjects gs
    LEFT JOIN classes c ON c.id = gs.class_id
    WHERE gs.term_id = ?
  `),
  getGradingSubjectById: db.prepare("SELECT gs.*, c.name as class_name FROM grading_subjects gs LEFT JOIN classes c ON c.id = gs.class_id WHERE gs.id = ?"),
  getGradingSubjectBySource: db.prepare("SELECT * FROM grading_subjects WHERE source_cbt_subject_id = ? AND term_id = ?"),
  getGradingSubjectByTeacherCodeTerm: db.prepare("SELECT * FROM grading_subjects WHERE teacher_id = ? AND code = ? AND term_id = ?"),
  createGradingSubject: db.prepare("INSERT INTO grading_subjects (name, code, class_id, term_id, session_id, teacher_id) VALUES (?, ?, ?, ?, ?, ?)"),
  updateGradingSubject: db.prepare("UPDATE grading_subjects SET name=?, code=?, class_id=?, teacher_id=? WHERE id=?"),
  deleteGradingSubject: db.prepare("DELETE FROM grading_subjects WHERE id=?"),
  
  getGradingPoliciesBySubject: db.prepare("SELECT * FROM grading_policies WHERE grading_subject_id = ? ORDER BY is_exam ASC, id ASC"),
  createGradingPolicy: db.prepare("INSERT INTO grading_policies (grading_subject_id, name, type, mapped_cbt_subject_id, max_marks, is_exam) VALUES (?, ?, ?, ?, ?, ?)"),
  updateGradingPolicy: db.prepare("UPDATE grading_policies SET name=?, type=?, mapped_cbt_subject_id=?, max_marks=?, is_exam=? WHERE id=?"),
  deleteGradingPolicy: db.prepare("DELETE FROM grading_policies WHERE id=?"),
  
  getManualScoresBySubject: db.prepare(`
    SELECT ms.* FROM grading_manual_scores ms
    JOIN grading_policies p ON p.id = ms.grading_policy_id
    WHERE p.grading_subject_id = ?
  `),
  upsertManualScore: db.prepare(`
    INSERT INTO grading_manual_scores (grading_policy_id, student_id, score, entered_by, updated_at)
    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    ON CONFLICT(grading_policy_id, student_id) DO UPDATE SET
    score = excluded.score, entered_by = excluded.entered_by, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
  `),
  
  getTermResultsBySubject: db.prepare("SELECT * FROM term_results WHERE grading_subject_id = ?"),
  getTermResultsByStudent: db.prepare("SELECT * FROM term_results WHERE student_id = ? AND term_id = ?"),
  upsertTermResult: db.prepare(`
    INSERT INTO term_results (student_id, grading_subject_id, ca_score, exam_score, total_score, grade, remark, is_approved, term_id, session_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    ON CONFLICT(student_id, grading_subject_id, term_id) DO UPDATE SET
    ca_score=excluded.ca_score, exam_score=excluded.exam_score, total_score=excluded.total_score,
    grade=excluded.grade, remark=excluded.remark, is_approved=excluded.is_approved,
    term_id=excluded.term_id, session_id=excluded.session_id,
    updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
  `),
  approveTermResults: db.prepare("UPDATE term_results SET is_approved = 1 WHERE grading_subject_id = ?"),
  
  // ── v5: Class Teacher Grading Center ──────────────────────────────────────────
  getClassTermResults: db.prepare(`
    SELECT 
      tr.*,
      gs.name as subject_name,
      gs.code as subject_code,
      gs.id as grading_subject_id,
      u.name as student_name,
      u.email as student_email,
      u.reg_id as student_reg_id
    FROM term_results tr
    JOIN grading_subjects gs ON gs.id = tr.grading_subject_id
    JOIN users u ON u.id = tr.student_id
    WHERE tr.term_id = ? AND tr.session_id = ?
    ORDER BY u.name, gs.name
  `),
  
  getClassTermResultsByClass: db.prepare(`
    WITH target AS (SELECT ? AS target_class_id)
    SELECT 
      tr.*,
      gs.name as subject_name,
      gs.code as subject_code,
      gs.id as grading_subject_id,
      u.name as student_name,
      u.email as student_email,
      u.reg_id as student_reg_id
    FROM term_results tr
    JOIN grading_subjects gs ON gs.id = tr.grading_subject_id
    JOIN users u ON u.id = tr.student_id
    JOIN target t ON 1=1
    WHERE tr.term_id = ? AND tr.session_id = ?
      AND (
        u.id IN (
          SELECT u2.id FROM users u2 
          LEFT JOIN grade_levels gl ON gl.id = u2.grade_level_id 
          JOIN classes c ON c.name = COALESCE(gl.name, u2.grade)
          WHERE c.id = t.target_class_id AND u2.role = 'student' AND u2.is_active = 1
        )
        OR EXISTS (
          SELECT 1 FROM class_enrollments ce
          WHERE ce.student_id = u.id AND ce.class_id = t.target_class_id
        )
      )
    ORDER BY u.name, gs.name
  `),
  
  getClassSubjectsForTerm: db.prepare(`
    WITH target AS (SELECT ? AS target_class_id)
    SELECT DISTINCT gs.id, gs.name, gs.code, gs.teacher_id, t.name as teacher_name
    FROM grading_subjects gs
    LEFT JOIN users t ON t.id = gs.teacher_id
    JOIN target tg ON 1=1
    WHERE gs.term_id = ? AND gs.session_id = ?
      AND (
        gs.class_id = tg.target_class_id
        OR gs.class_id IS NULL
        OR EXISTS (
          SELECT 1 FROM subjects s 
          JOIN classes c ON c.name = s.class 
          WHERE s.id = gs.source_cbt_subject_id AND c.id = tg.target_class_id
        )
        OR EXISTS (
          SELECT 1 FROM term_results tr
          JOIN class_enrollments ce ON ce.student_id = tr.student_id
          WHERE tr.grading_subject_id = gs.id AND ce.class_id = tg.target_class_id
        )
      )
  `),
  
  getStudentTermRemarks: db.prepare("SELECT * FROM student_term_remarks WHERE student_id = ? AND session_id = ? AND term_id = ?"),
  upsertStudentTermRemarks: db.prepare(`
    INSERT INTO student_term_remarks (student_id, session_id, term_id, teacher_remark, principal_remark)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(student_id, session_id, term_id) DO UPDATE SET
    teacher_remark=excluded.teacher_remark, principal_remark=excluded.principal_remark,
    updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
  `),
  
  getAnnualResultsBySession: db.prepare("SELECT * FROM annual_results WHERE session_id = ?"),
  getAnnualResultByStudent: db.prepare("SELECT * FROM annual_results WHERE student_id = ? AND session_id = ?"),
  upsertAnnualResult: db.prepare(`
    INSERT INTO annual_results (student_id, class_id, session_id, total_average, promotion_status, approved_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    ON CONFLICT(student_id, session_id) DO UPDATE SET
    total_average=excluded.total_average, promotion_status=excluded.promotion_status, approved_by=excluded.approved_by, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
  `),

  // ── v10: Flexible Grading System Queries ─────────────────────────────────────
  // Grading Schemes
  getGradingSchemesBySubject: db.prepare("SELECT * FROM grading_schemes WHERE grading_subject_id = ? ORDER BY is_default DESC, created_at DESC"),
  getGradingSchemeById: db.prepare("SELECT * FROM grading_schemes WHERE id = ?"),
  createGradingScheme: db.prepare("INSERT INTO grading_schemes (grading_subject_id, name, description, created_by) VALUES (?, ?, ?, ?)"),
  updateGradingScheme: db.prepare("UPDATE grading_schemes SET name=?, description=?, status=?, is_default=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?"),
  deleteGradingScheme: db.prepare("DELETE FROM grading_schemes WHERE id=?"),
  publishGradingScheme: db.prepare("UPDATE grading_schemes SET status='published', published_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'), updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?"),
  lockGradingScheme: db.prepare("UPDATE grading_schemes SET status='locked', locked_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'), updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?"),

  // Grading Categories
  getGradingCategoriesByScheme: db.prepare("SELECT * FROM grading_categories WHERE grading_scheme_id = ? ORDER BY order_index"),
  getGradingCategoryById: db.prepare("SELECT * FROM grading_categories WHERE id = ?"),
  createGradingCategory: db.prepare("INSERT INTO grading_categories (grading_scheme_id, name, description, weight, order_index, parent_category_id, is_exam_category) VALUES (?, ?, ?, ?, ?, ?, ?)"),
  updateGradingCategory: db.prepare("UPDATE grading_categories SET name=?, description=?, weight=?, order_index=?, parent_category_id=?, is_exam_category=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?"),
  deleteGradingCategory: db.prepare("DELETE FROM grading_categories WHERE id=?"),
  reorderGradingCategories: db.prepare("UPDATE grading_categories SET order_index=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?"),

  // Grading Assessments
  getGradingAssessmentsByScheme: db.prepare("SELECT * FROM grading_assessments WHERE grading_scheme_id = ? ORDER BY order_index"),
  getGradingAssessmentsByCategory: db.prepare("SELECT * FROM grading_assessments WHERE grading_category_id = ? ORDER BY order_index"),
  getGradingAssessmentById: db.prepare("SELECT * FROM grading_assessments WHERE id = ?"),
  createGradingAssessment: db.prepare("INSERT INTO grading_assessments (grading_category_id, grading_scheme_id, name, description, type, max_marks, weight, order_index, mapped_cbt_subject_id, is_mandatory) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
  updateGradingAssessment: db.prepare("UPDATE grading_assessments SET name=?, description=?, type=?, max_marks=?, weight=?, order_index=?, mapped_cbt_subject_id=?, is_mandatory=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?"),
  deleteGradingAssessment: db.prepare("DELETE FROM grading_assessments WHERE id=?"),
  reorderGradingAssessments: db.prepare("UPDATE grading_assessments SET order_index=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?"),

  // Grade Boundaries
  getGradeBoundariesByScheme: db.prepare("SELECT * FROM grading_grade_boundaries WHERE grading_scheme_id = ? ORDER BY min_percentage DESC"),
  getGradeBoundaryById: db.prepare("SELECT * FROM grading_grade_boundaries WHERE id = ?"),
  createGradeBoundary: db.prepare("INSERT INTO grading_grade_boundaries (grading_scheme_id, grade_symbol, min_percentage, max_percentage, grade_point, description, order_index) VALUES (?, ?, ?, ?, ?, ?, ?)"),
  updateGradeBoundary: db.prepare("UPDATE grading_grade_boundaries SET grade_symbol=?, min_percentage=?, max_percentage=?, grade_point=?, description=?, order_index=? WHERE id=?"),
  deleteGradeBoundary: db.prepare("DELETE FROM grading_grade_boundaries WHERE id=?"),

  // Student Scores
  getStudentScoresByScheme: db.prepare("SELECT gss.*, ga.name as assessment_name, ga.type, ga.max_marks, ga.weight, gc.name as category_name, gc.weight as category_weight FROM grading_student_scores gss JOIN grading_assessments ga ON ga.id = gss.grading_assessment_id JOIN grading_categories gc ON gc.id = ga.grading_category_id WHERE gss.grading_scheme_id = ? ORDER BY gc.order_index, ga.order_index"),
  getStudentScoresByAssessment: db.prepare("SELECT gss.*, u.name as student_name, u.reg_id FROM grading_student_scores gss JOIN users u ON u.id = gss.student_id WHERE gss.grading_assessment_id = ?"),
  upsertStudentScore: db.prepare("INSERT INTO grading_student_scores (grading_assessment_id, grading_scheme_id, student_id, score, max_marks_override, entered_by, entered_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now')) ON CONFLICT(grading_assessment_id, student_id) DO UPDATE SET score=excluded.score, max_marks_override=excluded.max_marks_override, entered_by=excluded.entered_by, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')"),
  deleteStudentScore: db.prepare("DELETE FROM grading_student_scores WHERE grading_assessment_id = ? AND student_id = ?"),

  // Calculated Results
  getCalculatedResultsByScheme: db.prepare("SELECT * FROM grading_calculated_results WHERE grading_scheme_id = ?"),
  getCalculatedResultByStudent: db.prepare("SELECT * FROM grading_calculated_results WHERE grading_scheme_id = ? AND student_id = ? AND term_id = ?"),
  upsertCalculatedResult: db.prepare("INSERT INTO grading_calculated_results (grading_scheme_id, student_id, term_id, session_id, category_breakdown_json, overall_percentage, grade_symbol, grade_point, status, calculated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(grading_scheme_id, student_id, term_id) DO UPDATE SET category_breakdown_json=excluded.category_breakdown_json, overall_percentage=excluded.overall_percentage, grade_symbol=excluded.grade_symbol, grade_point=excluded.grade_point, status=excluded.status, calculated_by=excluded.calculated_by, calculated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')"),
  approveCalculatedResults: db.prepare("UPDATE grading_calculated_results SET status='published', approved_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'), approved_by=? WHERE grading_scheme_id = ?"),

  // Scheme Versions
  getSchemeVersions: db.prepare("SELECT * FROM grading_scheme_versions WHERE grading_scheme_id = ? ORDER BY version_number DESC"),
  createSchemeVersion: db.prepare("INSERT INTO grading_scheme_versions (grading_scheme_id, version_number, scheme_snapshot_json, categories_snapshot_json, assessments_snapshot_json, boundaries_snapshot_json, changed_by, change_summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
  getLatestSchemeVersion: db.prepare("SELECT * FROM grading_scheme_versions WHERE grading_scheme_id = ? ORDER BY version_number DESC LIMIT 1"),

  // Validation helpers
  getTotalCategoryWeight: db.prepare("SELECT SUM(weight) as total_weight FROM grading_categories WHERE grading_scheme_id = ? AND parent_category_id IS NULL"),
  getTotalAssessmentWeight: db.prepare("SELECT SUM(weight) as total_weight FROM grading_assessments WHERE grading_category_id = ?"),
  checkSchemeHasResults: db.prepare("SELECT COUNT(*) as count FROM grading_calculated_results WHERE grading_scheme_id = ? AND status != 'draft'"),
  checkCategoryHasScores: db.prepare("SELECT COUNT(*) as count FROM grading_student_scores gss JOIN grading_assessments ga ON ga.id = gss.grading_assessment_id WHERE ga.grading_category_id = ?"),
  checkAssessmentHasScores: db.prepare("SELECT COUNT(*) as count FROM grading_student_scores WHERE grading_assessment_id = ?"),
  /** Get students for a grading subject (class roster + exam takers + manual score entries) */
  getGradingStudentsBySubject: db.prepare(`
    SELECT DISTINCT u.id, u.name, u.email, u.reg_id, COALESCE(gl.name, u.grade) as grade
    FROM users u
    LEFT JOIN grade_levels gl ON gl.id = u.grade_level_id
    WHERE u.role = 'student' AND u.is_active = 1
      AND (
        -- 1. Matched by grading subject's class_id
        (EXISTS (
          SELECT 1 FROM grading_subjects gs 
          JOIN classes c ON c.id = gs.class_id 
          WHERE gs.id = ? AND c.name = COALESCE(gl.name, u.grade)
        ))
        -- 2. OR matched by source CBT subject's class/grade or direct subject enrollment
        OR (EXISTS (
          SELECT 1 FROM grading_subjects gs
          JOIN subjects s ON s.id = gs.source_cbt_subject_id
          WHERE gs.id = ? AND (
            (s.grade_level_id IS NOT NULL AND s.grade_level_id = u.grade_level_id)
            OR (s.class IS NOT NULL AND s.class != '' AND s.class = COALESCE(gl.name, u.grade))
            OR EXISTS (SELECT 1 FROM subject_enrollments se WHERE se.subject_id = s.id AND se.student_id = u.id)
          )
        ))
        -- 3. OR student completed an exam mapped to this grading subject
        OR u.id IN (
          SELECT DISTINCT e.student_id FROM exams e
          JOIN grading_policies gp ON gp.mapped_cbt_subject_id = e.subject_id
          WHERE gp.grading_subject_id = ? AND e.status = 'completed'
        )
        -- 4. OR student has a manual score entry in this grading subject
        OR u.id IN (
          SELECT DISTINCT ms.student_id FROM grading_manual_scores ms
          JOIN grading_policies gp ON gp.id = ms.grading_policy_id
          WHERE gp.grading_subject_id = ?
        )
      )
    ORDER BY u.name
  `),
  /** Update mode + source_cbt_subject_id for auto-created grading subjects */
  updateGradingSubjectMeta: db.prepare(
    "UPDATE grading_subjects SET mode = ?, source_cbt_subject_id = ? WHERE id = ?"
  ),

  // ── Student Telemetry & Gamification Queries ────────────────────────────────
  getStudentDailyActivityDates: db.prepare(`
    SELECT DISTINCT activity_date FROM (
      SELECT strftime('%Y-%m-%d', datetime(session_date/1000, 'unixepoch')) as activity_date 
      FROM practice_logs.practice_logs WHERE student_id = ? AND session_date IS NOT NULL
      UNION
      SELECT strftime('%Y-%m-%d', end_time) as activity_date 
      FROM exams WHERE student_id = ? AND end_time IS NOT NULL AND status = 'completed'
      UNION
      SELECT strftime('%Y-%m-%d', end_time) as activity_date 
      FROM exam_attempts WHERE student_id = ? AND end_time IS NOT NULL
    ) WHERE activity_date IS NOT NULL ORDER BY activity_date ASC
  `),
  getStudentTodayQuestionCount: db.prepare(`
    SELECT (
      (SELECT COUNT(*) FROM practice_logs.practice_logs WHERE student_id = ? AND strftime('%Y-%m-%d', datetime(session_date/1000, 'unixepoch')) = strftime('%Y-%m-%d', 'now'))
      +
      (SELECT COUNT(*) FROM student_answers sa JOIN exams e ON e.id = sa.exam_id WHERE e.student_id = ? AND strftime('%Y-%m-%d', e.end_time) = strftime('%Y-%m-%d', 'now'))
    ) as count
  `),
  getStudentCohortStats: db.prepare(`
    SELECT 
      u.id, 
      COALESCE(gl.name, u.grade) as grade_name,
      (SELECT COUNT(*) FROM users u2 WHERE u2.role = 'student' AND u2.is_active = 1 AND COALESCE(u2.grade_level_id, 0) = COALESCE(u.grade_level_id, 0) AND (u2.grade = u.grade OR u.grade IS NULL)) as cohort_size
    FROM users u
    LEFT JOIN grade_levels gl ON gl.id = u.grade_level_id
    WHERE u.id = ?
  `),

  // ── v11: Guardian & Hybrid Messaging Prepared Queries ────────────────────────
  upsertAttendanceRecord: db.prepare(`
    INSERT INTO attendance_records (student_id, term_id, session_id, date, status, remarks, marked_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    ON CONFLICT(student_id, term_id, date) DO UPDATE SET
      status=excluded.status,
      remarks=excluded.remarks,
      marked_by=excluded.marked_by
  `),
  getStudentAttendanceSummary: db.prepare(`
    SELECT 
      COUNT(*) as total_days,
      COALESCE(SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END), 0) as present_days,
      COALESCE(SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END), 0) as absent_days,
      COALESCE(SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END), 0) as late_days,
      COALESCE(SUM(CASE WHEN status = 'excused' THEN 1 ELSE 0 END), 0) as excused_days,
      COALESCE(SUM(CASE WHEN status = 'holiday' THEN 1 ELSE 0 END), 0) as holiday_days
    FROM attendance_records
    WHERE student_id = ? AND term_id = ?
  `),
  getStudentAttendanceCalendar: db.prepare(`
    SELECT id, date, status, remarks
    FROM attendance_records
    WHERE student_id = ? AND term_id = ?
    ORDER BY date ASC
  `),

  getFeeStructuresForStudent: db.prepare(`
    SELECT fs.*
    FROM fee_structures fs
    JOIN users u ON u.id = ?
    LEFT JOIN classes c ON c.name = u.grade
    WHERE (fs.class_id = c.id OR fs.class_id IS NULL)
      AND fs.term_id = ? AND fs.session_id = ? AND fs.is_active = 1
    ORDER BY fs.id ASC
  `),
  getFeePaymentsForStudent: db.prepare(`
    SELECT fp.*, fs.title as fee_title
    FROM fee_payments fp
    JOIN fee_structures fs ON fs.id = fp.fee_id
    WHERE fp.student_id = ?
    ORDER BY fp.paid_at DESC
  `),
  createFeePayment: db.prepare(`
    INSERT INTO fee_payments (student_id, fee_id, amount_paid, payment_ref, method, status, paid_by, paid_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  `),

  getGuardianThreads: db.prepare(`
    SELECT 
      gmt.*,
      u_teacher.name as recipient_name,
      u_teacher.role as recipient_role,
      u_student.name as student_name,
      u_student.grade as student_grade
    FROM guardian_message_threads gmt
    JOIN users u_teacher ON u_teacher.id = gmt.recipient_id
    JOIN users u_student ON u_student.id = gmt.student_id
    WHERE gmt.guardian_id = ?
    ORDER BY gmt.last_message_at DESC
  `),
  getTeacherThreads: db.prepare(`
    SELECT 
      gmt.*,
      u_guardian.name as guardian_name,
      u_guardian.role as guardian_role,
      u_student.name as student_name,
      u_student.grade as student_grade
    FROM guardian_message_threads gmt
    JOIN users u_guardian ON u_guardian.id = gmt.guardian_id
    JOIN users u_student ON u_student.id = gmt.student_id
    WHERE gmt.recipient_id = ?
    ORDER BY gmt.last_message_at DESC
  `),
  getThreadById: db.prepare(`
    SELECT 
      gmt.*,
      u_guardian.name as guardian_name,
      u_teacher.name as recipient_name,
      u_teacher.role as recipient_role,
      u_student.name as student_name,
      u_student.grade as student_grade
    FROM guardian_message_threads gmt
    JOIN users u_guardian ON u_guardian.id = gmt.guardian_id
    JOIN users u_teacher ON u_teacher.id = gmt.recipient_id
    JOIN users u_student ON u_student.id = gmt.student_id
    WHERE gmt.id = ?
  `),
  findThreadByParticipants: db.prepare(`
    SELECT * FROM guardian_message_threads
    WHERE guardian_id = ? AND recipient_id = ? AND student_id = ?
  `),
  createMessageThread: db.prepare(`
    INSERT INTO guardian_message_threads (guardian_id, recipient_id, student_id, category, subject, last_message, last_message_at, unread_for_guardian, unread_for_recipient)
    VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?, ?)
  `),
  getMessagesByThread: db.prepare(`
    SELECT gm.*, u.name as sender_name
    FROM guardian_messages gm
    JOIN users u ON u.id = gm.sender_id
    WHERE gm.thread_id = ?
    ORDER BY gm.created_at ASC
  `),
  insertMessage: db.prepare(`
    INSERT INTO guardian_messages (thread_id, sender_id, sender_role, text, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  `),
  updateThreadLastMessage: db.prepare(`
    UPDATE guardian_message_threads
    SET last_message = ?, last_message_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
        unread_for_guardian = unread_for_guardian + ?,
        unread_for_recipient = unread_for_recipient + ?
    WHERE id = ?
  `),
  markThreadReadForGuardian: db.prepare(`
    UPDATE guardian_message_threads SET unread_for_guardian = 0 WHERE id = ?
  `),
  markThreadReadForRecipient: db.prepare(`
    UPDATE guardian_message_threads SET unread_for_recipient = 0 WHERE id = ?
  `),

  upsertPushSubscription: db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth_key, created_at)
    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, p256dh=excluded.p256dh, auth_key=excluded.auth_key
  `),
  getPushSubscriptionsByUser: db.prepare(`
    SELECT * FROM push_subscriptions WHERE user_id = ?
  `),

  getTeacherClasses: db.prepare(`
    SELECT c.*,
           (SELECT COUNT(*) FROM class_enrollments ce WHERE ce.class_id = c.id) as enrolled_count
    FROM classes c
    WHERE c.class_teacher_id = ?
    ORDER BY c.name ASC
  `),
  getClassEnrolledStudentsForAttendance: db.prepare(`
    SELECT u.id, u.name, u.reg_id, u.image_url, ce.class_id, c.name as class_name
    FROM class_enrollments ce
    JOIN users u ON u.id = ce.student_id
    JOIN classes c ON c.id = ce.class_id
    WHERE ce.class_id = ? AND u.is_active = 1
    ORDER BY u.name ASC
  `),
  getAttendanceRecordForStudentDate: db.prepare(`
    SELECT * FROM attendance_records
    WHERE student_id = ? AND date = ? AND term_id = ?
  `),
  updateGuardianProfile: db.prepare(`
    UPDATE users
    SET phone = ?, address = ?
    WHERE id = ?
  `),
  updateGuardianNotificationPreferences: db.prepare(`
    UPDATE users
    SET notify_attendance = ?, notify_results = ?, notify_fees = ?, notify_messages = ?
    WHERE id = ?
  `),
  getStudentGuardians: db.prepare(`
    SELECT gsl.guardian_id, u.name as guardian_name, u.email as guardian_email, u.notify_results, u.notify_attendance
    FROM guardian_student_links gsl
    JOIN users u ON u.id = gsl.guardian_id
    WHERE gsl.student_id = ? AND gsl.status = 'approved'
  `),
};

// ─────────────────────────────────────────────────────────────────────────────
// bootstrap_v5_migration(): runs once on first deploy so v2 API is never empty.
// Creates a default term, a Legacy Class, and enrolls all existing students.
// Fully idempotent — safe to call on every server start.
// ─────────────────────────────────────────────────────────────────────────────
export function bootstrap_v5_migration(): void {
  const termCount = (db.prepare("SELECT COUNT(*) as c FROM terms").get() as any)?.c ?? 0;
  if (termCount > 0) return;

  console.log("[db v5] bootstrap_v5_migration() — first deploy, seeding default term...");

  db.transaction(() => {
    const ctRow = db.prepare("SELECT value FROM settings WHERE key='CURRENT_TERM'").get() as any;
    const currentTermStr = String(ctRow?.value ?? "2026-T1");
    const parts = currentTermStr.split("-");
    const year = parts[0] ?? "2026";
    const termLabel = parts[1] === "T2" ? "Second Term" : parts[1] === "T3" ? "Third Term" : "First Term";
    const session = (Number(year) - 1) + "/" + year;

    const termResult = db.prepare(
      "INSERT INTO terms (session, name, start_date, end_date, is_active, registration_open) VALUES (?, ?, date('now','start of year'), date('now','start of year','+4 months'), 1, 1)"
    ).run(session, termLabel) as { lastInsertRowid: number | bigint };
    const termId = Number(termResult.lastInsertRowid);

    let classId: number;
    const existingClass = db.prepare("SELECT id FROM classes WHERE name='Legacy Class'").get() as any;
    if (existingClass) {
      classId = Number(existingClass.id);
    } else {
      const cr = db.prepare("INSERT INTO classes (name, level) VALUES ('Legacy Class', 'junior')").run() as { lastInsertRowid: number | bigint };
      classId = Number(cr.lastInsertRowid);
    }

    const students = db.prepare("SELECT id FROM users WHERE role='student' AND is_active=1").all() as Array<{ id: number }>;
    const stmt = db.prepare("INSERT OR IGNORE INTO class_enrollments (student_id, class_id, term_id) VALUES (?, ?, ?)");
    for (const s of students) stmt.run(s.id, classId, termId);

    console.log("[db v5] Bootstrap done: term=" + termLabel + " (" + session + "), enrolled " + students.length + " students into Legacy Class.");
  })();
}
export default db;
