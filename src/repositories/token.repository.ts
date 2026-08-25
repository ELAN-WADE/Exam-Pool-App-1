import { Database } from "bun:sqlite";

export class TokenBlacklistRepository {
  constructor(private db: Database) {}

  add(token: string): void {
    this.db.prepare("INSERT OR IGNORE INTO token_blacklist (token, invalidated_at) VALUES (?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))").run(token);
  }

  has(token: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM token_blacklist WHERE token = ? LIMIT 1").get(token);
    return !!row;
  }

  cleanup(): number {
    const result = this.db.prepare("DELETE FROM token_blacklist WHERE invalidated_at < datetime('now', '-30 days')").run();
    return result.changes;
  }
}