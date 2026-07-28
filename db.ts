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
  // v5 tables
  "terms", "classes", "class_enrollments", "guardian_student_links",
  "academic_calendar_events", "timetables",
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
  addColumnIfMissing("subjects", "session_id",    "INTEGER");
  addColumnIfMissing("subjects", "term_id",       "INTEGER");

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
  addColumnIfMissing("questions", "session_id", "INTEGER");
  addColumnIfMissing("questions", "term_id",    "INTEGER");

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
      name              TEXT NOT NULL CHECK(name IN ('First Term', 'Second Term', 'Third Term')),
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

  // ── TIMETABLES — with conflict-detection indexes ──────────────────────────
  // classroom is TEXT (not FK) — allows gradual classroom management later.
  // Teacher + classroom double-booking is validated at the API layer.
  db.run(`
    CREATE TABLE IF NOT EXISTS timetables (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      subject_id  INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      session_id  INTEGER NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
      term_id     INTEGER NOT NULL REFERENCES academic_terms(id) ON DELETE CASCADE,
      teacher_id  INTEGER REFERENCES users(id),
      day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
      start_time  TEXT NOT NULL,
      end_time    TEXT NOT NULL,
      classroom   TEXT,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      UNIQUE(class_id, session_id, term_id, day_of_week, start_time)
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_tt_class_term   ON timetables(class_id, session_id, term_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tt_teacher_slot ON timetables(teacher_id, day_of_week, start_time)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tt_room_slot    ON timetables(classroom, day_of_week, start_time)");

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
}

// Initialize schema before preparing statements so new tables exist.
initializeDatabase();

export const queries = {
  // ── Users ──────────────────────────────────────────────────────────────
  getUserByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
  getUserByEmailOrReg: db.prepare("SELECT * FROM users WHERE email = ? OR reg_id = ?"),
  createUser:     db.prepare(`
    INSERT INTO users (name, email, role, password_hash, grade, reg_id, first_name, last_name, address, phone, dob, session_id, term_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
      (SELECT id FROM academic_sessions WHERE is_active = 1 LIMIT 1), 
      (SELECT id FROM academic_terms WHERE is_active = 1 LIMIT 1))
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
  createExam: db.prepare(`
    INSERT INTO exams (student_id, subject_id, start_time, answers_json, status, session, term, mode, session_id, term_id) 
    VALUES (?, ?, ?, ?, 'in-progress', ?, ?, ?,
      (SELECT id FROM academic_sessions WHERE is_active = 1 LIMIT 1), 
      (SELECT id FROM academic_terms WHERE is_active = 1 LIMIT 1))
  `),
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
  getAllClasses:  db.prepare("SELECT * FROM classes ORDER BY level, name, section"),
  getClassById:  db.prepare("SELECT * FROM classes WHERE id = ?"),
  createClass:   db.prepare("INSERT INTO classes (name, section, level) VALUES (?, ?, ?)"),
  updateClass:   db.prepare("UPDATE classes SET name=?, section=?, level=? WHERE id=?"),
  deleteClass:   db.prepare("DELETE FROM classes WHERE id=?"),

  // ── v5: Class Enrollments ───────────────────────────────────────────────────
  getClassRoster:             db.prepare("SELECT u.id, u.name, u.email, u.grade, u.reg_id, u.is_active, ce.enrollment_date FROM class_enrollments ce JOIN users u ON u.id = ce.student_id WHERE ce.class_id = ? AND ce.term_id = ? ORDER BY u.name"),
  getStudentClassForTerm:     db.prepare("SELECT c.*, ce.enrollment_date FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id WHERE ce.student_id = ? AND ce.term_id = ? LIMIT 1"),
  enrollStudentInClass:       db.prepare("INSERT OR REPLACE INTO class_enrollments (student_id, class_id, term_id) VALUES (?, ?, ?)"),
  unenrollStudentFromClass:   db.prepare("DELETE FROM class_enrollments WHERE student_id=? AND term_id=?"),
  getEnrollmentCountForClass: db.prepare("SELECT COUNT(*) as count FROM class_enrollments WHERE class_id=? AND term_id=?"),

  // ── v5: Guardian-Student Links ──────────────────────────────────────────────
  getPendingGuardianLinks:  db.prepare("SELECT gsl.*, gu.name as guardian_name, gu.email as guardian_email, su.name as student_name, su.grade as student_grade, su.reg_id FROM guardian_student_links gsl JOIN users gu ON gu.id = gsl.guardian_id JOIN users su ON su.id = gsl.student_id WHERE gsl.status = 'pending' ORDER BY gsl.created_at DESC"),
  getAllGuardianLinks:       db.prepare("SELECT gsl.*, gu.name as guardian_name, gu.email as guardian_email, su.name as student_name, su.grade as student_grade, su.reg_id FROM guardian_student_links gsl JOIN users gu ON gu.id = gsl.guardian_id JOIN users su ON su.id = gsl.student_id ORDER BY gsl.created_at DESC LIMIT 200"),
  getGuardianWards:         db.prepare("SELECT gsl.*, su.name as student_name, su.grade, su.reg_id, su.image_url FROM guardian_student_links gsl JOIN users su ON su.id = gsl.student_id WHERE gsl.guardian_id = ? AND gsl.status = 'approved'"),
  getStudentGuardians:      db.prepare("SELECT gsl.*, gu.name as guardian_name, gu.email, gu.phone FROM guardian_student_links gsl JOIN users gu ON gu.id = gsl.guardian_id WHERE gsl.student_id = ? AND gsl.status = 'approved'"),
  createGuardianLink:       db.prepare("INSERT INTO guardian_student_links (guardian_id, student_id, relationship, verification_method) VALUES (?, ?, ?, 'manual_admin')"),
  updateGuardianLinkStatus: db.prepare("UPDATE guardian_student_links SET status=?, verified_by=?, verified_at=(strftime('%Y-%m-%dT%H:%M:%SZ','now')) WHERE id=?"),
  getGuardianLink:          db.prepare("SELECT * FROM guardian_student_links WHERE id=?"),

  // ── v5: Academic Calendar Events ────────────────────────────────────────────
  getCalendarByTerm:   db.prepare("SELECT * FROM academic_calendar_events WHERE term_id=? ORDER BY start_date"),
  createCalendarEvent: db.prepare("INSERT INTO academic_calendar_events (term_id, title, description, start_date, end_date, type, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)"),
  updateCalendarEvent: db.prepare("UPDATE academic_calendar_events SET title=?, description=?, start_date=?, end_date=?, type=? WHERE id=?"),
  deleteCalendarEvent: db.prepare("DELETE FROM academic_calendar_events WHERE id=?"),
  getCalendarEvent:    db.prepare("SELECT * FROM academic_calendar_events WHERE id=?"),

  // ── v5: Timetables ──────────────────────────────────────────────────────────
  getTimetableByClass:    db.prepare("SELECT tt.*, s.name as subject_name, s.code as subject_code, u.name as teacher_name FROM timetables tt JOIN subjects s ON s.id = tt.subject_id LEFT JOIN users u ON u.id = tt.teacher_id WHERE tt.class_id=? AND tt.term_id=? ORDER BY tt.day_of_week, tt.start_time"),
  checkTeacherConflict:   db.prepare("SELECT id FROM timetables WHERE teacher_id=? AND term_id=? AND day_of_week=? AND start_time=? LIMIT 1"),
  checkClassroomConflict: db.prepare("SELECT id FROM timetables WHERE classroom IS NOT NULL AND classroom=? AND term_id=? AND day_of_week=? AND start_time=? LIMIT 1"),
  createTimetableSlot:    db.prepare("INSERT INTO timetables (class_id, subject_id, term_id, teacher_id, day_of_week, start_time, end_time, classroom) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
  deleteTimetableSlot:    db.prepare("DELETE FROM timetables WHERE id=?"),
  getTimetableSlot:       db.prepare("SELECT * FROM timetables WHERE id=?"),
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
