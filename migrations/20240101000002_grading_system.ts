import { Migration } from "./types";

export const migration: Migration = {
  id: "20240101000002_grading_system",
  name: "Grading system v8",
  description: "Adds grading_subjects, grading_policies, grading_manual_scores, term_results, annual_results, class_teacher_assignments tables",
  
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS grading_subjects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        class_id INTEGER REFERENCES classes(id),
        term_id INTEGER NOT NULL REFERENCES academic_terms(id),
        session_id INTEGER NOT NULL REFERENCES academic_sessions(id),
        teacher_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        mode TEXT,
        source_cbt_subject_id INTEGER,
        pass_mark REAL,
        UNIQUE(code, term_id, class_id)
      )
    `);

    db.exec(`
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

    db.exec(`
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

    db.exec(`
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

    db.exec(`
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

    db.exec(`
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

    db.exec(`
      CREATE TABLE IF NOT EXISTS student_term_remarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        term TEXT NOT NULL,
        teacher_remark TEXT,
        principal_remark TEXT,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(student_id, term)
      )
    `);

    db.exec(`
      ALTER TABLE student_term_remarks ADD COLUMN session_id INTEGER;
      ALTER TABLE student_term_remarks ADD COLUMN term_id INTEGER;
    `);

    // Indexes for grading tables
    db.exec("CREATE INDEX IF NOT EXISTS idx_grading_subjects_teacher ON grading_subjects(teacher_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_grading_subjects_term ON grading_subjects(term_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_grading_subjects_session ON grading_subjects(session_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_grading_subjects_source ON grading_subjects(source_cbt_subject_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_grading_policies_subject ON grading_policies(grading_subject_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_grading_policies_mapped ON grading_policies(mapped_cbt_subject_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_manual_scores_policy ON grading_manual_scores(grading_policy_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_manual_scores_student ON grading_manual_scores(student_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_term_results_student ON term_results(student_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_term_results_subject ON term_results(grading_subject_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_term_results_term ON term_results(term_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_term_results_session ON term_results(session_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_term_results_approved ON term_results(is_approved)");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_term_results_unique ON term_results(student_id, grading_subject_id, term_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_annual_results_session ON annual_results(session_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_annual_results_student ON annual_results(student_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_cta_class ON class_teacher_assignments(class_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_cta_teacher ON class_teacher_assignments(teacher_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_cta_time ON class_teacher_assignments(assigned_at DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_str_student_session_term ON student_term_remarks(student_id, session_id, term_id)");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uniq_str_student_session_term ON student_term_remarks(student_id, session_id, term_id)");

    // Add grading_config_json to config
    db.exec(`ALTER TABLE config ADD COLUMN grading_config_json TEXT`);

    // Seed default grading config
    db.exec(`
      UPDATE config 
      SET grading_config_json = '{
        "ca_max": 40,
        "exam_max": 60,
        "passing_score": 40,
        "grade_scale": [
          {"grade": "A", "min": 75, "label": "Excellent"},
          {"grade": "B", "min": 65, "label": "Very Good"},
          {"grade": "C", "min": 55, "label": "Credit"},
          {"grade": "D", "min": 45, "label": "Pass"},
          {"grade": "E", "min": 40, "label": "Poor Pass"},
          {"grade": "F", "min": 0, "label": "Fail"}
        ],
        "default_ca_template": [
          {"name": "CBT Test", "type": "cbt_test", "marks": 20},
          {"name": "Assignment", "type": "manual", "marks": 10},
          {"name": "Classwork", "type": "manual", "marks": 10}
        ]
      }'
      WHERE id = 1 AND grading_config_json IS NULL
    `);
  },
  
  down: (db) => {
    db.exec("DROP INDEX IF EXISTS idx_str_student_session_term");
    db.exec("DROP INDEX IF EXISTS idx_cta_time");
    db.exec("DROP INDEX IF EXISTS idx_cta_teacher");
    db.exec("DROP INDEX IF EXISTS idx_cta_class");
    db.exec("DROP INDEX IF EXISTS idx_annual_results_student");
    db.exec("DROP INDEX IF EXISTS idx_annual_results_session");
    db.exec("DROP INDEX IF EXISTS idx_term_results_approved");
    db.exec("DROP INDEX IF EXISTS idx_term_results_session");
    db.exec("DROP INDEX IF EXISTS idx_term_results_term");
    db.exec("DROP INDEX IF EXISTS idx_term_results_subject");
    db.exec("DROP INDEX IF EXISTS idx_term_results_student");
    db.exec("DROP INDEX IF EXISTS idx_manual_scores_student");
    db.exec("DROP INDEX IF EXISTS idx_manual_scores_policy");
    db.exec("DROP INDEX IF EXISTS idx_grading_policies_mapped");
    db.exec("DROP INDEX IF EXISTS idx_grading_policies_subject");
    db.exec("DROP INDEX IF EXISTS idx_grading_subjects_source");
    db.exec("DROP INDEX IF EXISTS idx_grading_subjects_session");
    db.exec("DROP INDEX IF EXISTS idx_grading_subjects_term");
    db.exec("DROP INDEX IF EXISTS idx_grading_subjects_teacher");

    db.exec("ALTER TABLE config DROP COLUMN grading_config_json");
    db.exec("DROP TABLE IF EXISTS class_teacher_assignments");
    db.exec("DROP TABLE IF EXISTS student_term_remarks");
    db.exec("DROP TABLE IF EXISTS annual_results");
    db.exec("DROP TABLE IF EXISTS term_results");
    db.exec("DROP TABLE IF EXISTS grading_manual_scores");
    db.exec("DROP TABLE IF EXISTS grading_policies");
    db.exec("DROP TABLE IF EXISTS grading_subjects");
  },
};

export default migration;