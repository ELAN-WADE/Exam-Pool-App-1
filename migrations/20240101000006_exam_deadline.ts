import { Migration } from "./types";

export const migration: Migration = {
  id: "20240101000006_exam_deadline",
  name: "Add deadline column to exams for server-side time enforcement",
  description: "Adds deadline column to exams table to store the absolute deadline timestamp for server-side enforcement",

  up: (db) => {
    db.exec(`
      ALTER TABLE exams ADD COLUMN deadline TEXT;
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_exams_deadline ON exams(deadline);
    `);
  },

  down: (db) => {
    db.exec("DROP INDEX IF EXISTS idx_exams_deadline");
    db.exec("ALTER TABLE exams DROP COLUMN deadline");
  },
};

export default migration;