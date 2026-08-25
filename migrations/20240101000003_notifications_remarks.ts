import { Migration } from "./types";

export const migration: Migration = {
  id: "20240101000003_notifications_remarks",
  name: "Notifications table",
  description: "Adds notifications table",
  
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        link TEXT,
        is_read INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0,1)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    db.exec("CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC)");
  },
  
  down: (db) => {
    db.exec("DROP INDEX IF EXISTS idx_notifications_user");
    db.exec("DROP TABLE IF EXISTS notifications");
  },
};

export default migration;