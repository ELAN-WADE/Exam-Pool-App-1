import { Database } from "bun:sqlite";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

const dbPath = join(process.cwd(), "exampool.db");
const backupDir = join(process.cwd(), "backups");

if (!existsSync(backupDir)) {
  mkdirSync(backupDir);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = join(backupDir, `exampool-backup-${timestamp}.db`);

console.log(`Starting hot-backup of ${dbPath}...`);

try {
  const srcDb = new Database(dbPath, { readonly: true });
  // VACUUM INTO safely creates a consistent, compacted backup of a WAL database
  // It runs in the background without blocking concurrent readers or writers!
  srcDb.run(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  srcDb.close();
  console.log(`✅ Backup completed successfully at: ${backupPath}`);
} catch (err) {
  console.error("❌ Backup failed:", err);
  process.exit(1);
}
