import { Migration } from "./types";

export const migration: Migration = {
  id: "20240101000004_license_practice_content",
  name: "License, practice logs, and content bank",
  description: "Adds license_registry, practice_logs, content_bank tables",
  
  up: (db) => {
    db.exec(`
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

    db.exec(`
      CREATE TABLE IF NOT EXISTS practice_logs (
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

    db.exec(`
      CREATE TABLE IF NOT EXISTS content_bank (
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

    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS content_bank_fts USING fts5(
        question_text,
        topic_tag,
        content='content_bank',
        content_rowid='id'
      )
    `);

    db.exec("CREATE INDEX IF NOT EXISTS idx_license_key ON license_registry(license_key)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_practice_student ON practice_logs(student_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_practice_date ON practice_logs(session_date)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_content_body ON content_bank(exam_body)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_content_subject ON content_bank(subject_code)");
  },
  
  down: (db) => {
    db.exec("DROP INDEX IF EXISTS idx_content_subject");
    db.exec("DROP INDEX IF EXISTS idx_content_body");
    db.exec("DROP INDEX IF EXISTS idx_practice_date");
    db.exec("DROP INDEX IF EXISTS idx_practice_student");
    db.exec("DROP INDEX IF EXISTS idx_license_key");
    db.exec("DROP TABLE IF EXISTS content_bank_fts");
    db.exec("DROP TABLE IF EXISTS content_bank");
    db.exec("DROP TABLE IF EXISTS practice_logs");
    db.exec("DROP TABLE IF EXISTS license_registry");
  },
};

export default migration;