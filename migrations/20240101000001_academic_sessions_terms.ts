import { Migration } from "./types";

export const migration: Migration = {
  id: "20240101000001_academic_sessions_terms",
  name: "Academic sessions and terms",
  description: "Adds academic_sessions, academic_terms, terms, class_enrollments, guardian_student_links, academic_calendar_events, timetables tables",
  
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS academic_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0,1)),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS academic_terms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        start_date TEXT,
        end_date TEXT,
        is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0,1)),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived', 'locked')),
        registration_open INTEGER NOT NULL DEFAULT 1 CHECK(registration_open IN (0,1)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        UNIQUE(session_id, name)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS terms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session TEXT NOT NULL,
        name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0,1)),
        registration_open INTEGER NOT NULL DEFAULT 1 CHECK(registration_open IN (0,1)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS class_enrollments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
        term_id INTEGER NOT NULL REFERENCES terms(id) ON DELETE RESTRICT,
        enrollment_date TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        UNIQUE(student_id, term_id)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS guardian_student_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guardian_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        relationship TEXT NOT NULL DEFAULT 'Parent',
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','approved','rejected','revoked')),
        verification_method TEXT NOT NULL DEFAULT 'manual_admin'
          CHECK(verification_method IN ('manual_admin','dob_match','pin_match')),
        verified_by_data TEXT,
        verified_by INTEGER REFERENCES users(id),
        verified_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        UNIQUE(guardian_id, student_id)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS academic_calendar_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        term_id INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'event'
          CHECK(type IN ('holiday','exam_period','resumption','event','deadline','other')),
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS timetables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        class TEXT,
        section TEXT,
        exam_date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        duration INTEGER NOT NULL,
        exam_mode TEXT NOT NULL DEFAULT 'CBT' CHECK(exam_mode IN ('CBT','Assignment','Offline')),
        allow_students INTEGER NOT NULL DEFAULT 0 CHECK(allow_students IN (0,1)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        grade_level_id INTEGER REFERENCES grade_levels(id)
      )
    `);

    // Indexes for academic tables
    db.exec("CREATE INDEX IF NOT EXISTS idx_academic_sessions_active ON academic_sessions(is_active)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_academic_terms_active ON academic_terms(is_active)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_academic_terms_session ON academic_terms(session_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_terms_active ON terms(is_active)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_ce_student_term ON class_enrollments(student_id, term_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_ce_class_term ON class_enrollments(class_id, term_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_gsl_guardian ON guardian_student_links(guardian_id, status)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_gsl_student ON guardian_student_links(student_id, status)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_cal_term ON academic_calendar_events(term_id, start_date)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tt_subject ON timetables(subject_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tt_class ON timetables(class)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tt_grade_level ON timetables(grade_level_id)");

    // Seed default academic session and term if empty
    db.exec(`
      INSERT OR IGNORE INTO academic_sessions (name, is_active, status) 
      VALUES ('2026/2027', 1, 'active')
    `);

    db.exec(`
      INSERT OR IGNORE INTO academic_terms (session_id, name, is_active, status, registration_open) 
      VALUES (1, 'First Term', 1, 'active', 1)
    `);
  },
  
  down: (db) => {
    db.exec("DROP INDEX IF EXISTS idx_tt_grade_level");
    db.exec("DROP INDEX IF EXISTS idx_tt_class");
    db.exec("DROP INDEX IF EXISTS idx_tt_subject");
    db.exec("DROP INDEX IF EXISTS idx_cal_term");
    db.exec("DROP INDEX IF EXISTS idx_gsl_student");
    db.exec("DROP INDEX IF EXISTS idx_gsl_guardian");
    db.exec("DROP INDEX IF EXISTS idx_ce_class_term");
    db.exec("DROP INDEX IF EXISTS idx_ce_student_term");
    db.exec("DROP INDEX IF NOT EXISTS idx_terms_active");
    db.exec("DROP INDEX IF NOT EXISTS idx_academic_terms_session");
    db.exec("DROP INDEX IF NOT EXISTS idx_academic_terms_active");
    db.exec("DROP INDEX IF NOT EXISTS idx_academic_sessions_active");

    db.exec("DROP TABLE IF EXISTS timetables");
    db.exec("DROP TABLE IF EXISTS academic_calendar_events");
    db.exec("DROP TABLE IF EXISTS guardian_student_links");
    db.exec("DROP TABLE IF EXISTS class_enrollments");
    db.exec("DROP TABLE IF EXISTS terms");
    db.exec("DROP TABLE IF EXISTS academic_terms");
    db.exec("DROP TABLE IF EXISTS academic_sessions");
  },
};

export default migration;