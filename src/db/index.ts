import db, { EXAMPOOL_DB_PATH, initializeDatabase as initDb, queries } from "../../db";

export { EXAMPOOL_DB_PATH, db, queries };

export function initializeDatabase(): void {
  initDb();
}

export function runMigrations(): void {
  initDb();
}

export default db;