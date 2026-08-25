import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import fs from "fs";
import path from "path";
import { Migration, MigrationRecord, MigrationStatus, MigrationOptions } from "./types";

const DEFAULT_MIGRATIONS_DIR = path.join(import.meta.dir, "..", "..", "migrations");
const DEFAULT_TABLE_NAME = "schema_migrations";

export class MigrationRunner {
  private db: Database;
  private migrationsDir: string;
  private tableName: string;
  private dryRun: boolean;

  constructor(db: Database, options: MigrationOptions = {}) {
    this.db = db;
    this.migrationsDir = options.migrationsDir || DEFAULT_MIGRATIONS_DIR;
    this.tableName = options.tableName || DEFAULT_TABLE_NAME;
    this.dryRun = options.dryRun || false;
  }

  async initialize(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        checksum TEXT NOT NULL
      )
    `);
  }

  private computeChecksum(migration: Migration): string {
    const content = `${migration.id}:${migration.name}:${migration.up.toString()}:${migration.down?.toString() || ""}`;
    return createHash("sha256").update(content).digest("hex").substring(0, 16);
  }

  private async loadMigrations(): Promise<Migration[]> {
    if (!fs.existsSync(this.migrationsDir)) {
      return [];
    }

    const files = fs.readdirSync(this.migrationsDir)
      .filter(f => (f.endsWith(".ts") || f.endsWith(".js")) && !f.startsWith("index"))
      .sort();

    const migrations: Migration[] = [];

    for (const file of files) {
      const filePath = path.join(this.migrationsDir, file);
      try {
        const module = await import(filePath);
        const migration = module.default || module.migration;
        if (migration && migration.id && migration.up) {
          migrations.push(migration);
        }
      } catch (error) {
        console.error(`[Migration] Failed to load ${file}:`, error);
      }
    }

    return migrations;
  }

  private getAppliedMigrations(): MigrationRecord[] {
    return this.db.prepare(`SELECT * FROM ${this.tableName} ORDER BY applied_at`).all() as MigrationRecord[];
  }

  async status(): Promise<MigrationStatus[]> {
    await this.initialize();
    const migrations = await this.loadMigrations();
    const applied = this.getAppliedMigrations();
    const appliedMap = new Map(applied.map(m => [m.id, m]));

    return migrations.map(m => {
      const record = appliedMap.get(m.id);
      return {
        id: m.id,
        name: m.name,
        applied: !!record,
        appliedAt: record?.applied_at,
        checksum: record?.checksum,
      };
    });
  }

  async up(targetId?: string): Promise<void> {
    await this.initialize();
    const migrations = await this.loadMigrations();
    const applied = new Set(this.getAppliedMigrations().map(m => m.id));

    const pending = migrations.filter(m => !applied.has(m.id));
    
    if (targetId) {
      const targetIndex = pending.findIndex(m => m.id === targetId);
      if (targetIndex === -1) {
        throw new Error(`Target migration ${targetId} not found in pending migrations`);
      }
      pending.splice(targetIndex + 1);
    }

    if (pending.length === 0) {
      console.log("[Migration] No pending migrations");
      return;
    }

    console.log(`[Migration] Applying ${pending.length} migration(s)...`);

    for (const migration of pending) {
      await this.applyMigration(migration);
    }

    console.log("[Migration] All migrations applied successfully");
  }

  async down(targetId: string): Promise<void> {
    await this.initialize();
    const applied = this.getAppliedMigrations();
    const appliedMap = new Map(applied.map(m => [m.id, m]));

    if (!appliedMap.has(targetId)) {
      throw new Error(`Migration ${targetId} not found in applied migrations`);
    }

    const targetIndex = applied.findIndex(m => m.id === targetId);
    const toRollback = applied.slice(targetIndex).reverse();

    console.log(`[Migration] Rolling back ${toRollback.length} migration(s)...`);

    for (const record of toRollback) {
      await this.rollbackMigration(record);
    }

    console.log("[Migration] Rollback complete");
  }

  private async applyMigration(migration: Migration): Promise<void> {
    const checksum = this.computeChecksum(migration);
    
    console.log(`[Migration] Applying: ${migration.id} - ${migration.name}`);
    
    if (this.dryRun) {
      console.log(`[Migration] DRY RUN: Would apply ${migration.id}`);
      return;
    }

    const tx = this.db.transaction(() => {
      migration.up(this.db);
      this.db.prepare(`
        INSERT INTO ${this.tableName} (id, name, checksum)
        VALUES (?, ?, ?)
      `).run(migration.id, migration.name, checksum);
    });

    try {
      tx();
      console.log(`[Migration] Applied: ${migration.id}`);
    } catch (error) {
      console.error(`[Migration] Failed to apply ${migration.id}:`, error);
      throw new Error(`Migration ${migration.id} failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  private async rollbackMigration(record: MigrationRecord): Promise<void> {
    const migrations = this.loadMigrations();
    const migration = migrations.find(m => m.id === record.id);

    if (!migration) {
      throw new Error(`Migration ${record.id} not found in source files`);
    }

    if (!migration.down) {
      throw new Error(`Migration ${record.id} does not support rollback`);
    }

    const currentChecksum = this.computeChecksum(migration);
    if (currentChecksum !== record.checksum) {
      throw new Error(`Migration ${record.id} has been modified since applied (checksum mismatch)`);
    }

    console.log(`[Migration] Rolling back: ${record.id} - ${record.name}`);

    if (this.dryRun) {
      console.log(`[Migration] DRY RUN: Would rollback ${record.id}`);
      return;
    }

    const tx = this.db.transaction(() => {
      migration.down!(this.db);
      this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`).run(record.id);
    });

    try {
      tx();
      console.log(`[Migration] Rolled back: ${record.id}`);
    } catch (error) {
      console.error(`[Migration] Failed to rollback ${record.id}:`, error);
      throw new Error(`Rollback ${record.id} failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  async create(name: string, description?: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const id = `${timestamp}_${slug}`;
    const fileName = `${id}.ts`;
    const filePath = path.join(this.migrationsDir, fileName);

    if (!fs.existsSync(this.migrationsDir)) {
      fs.mkdirSync(this.migrationsDir, { recursive: true });
    }

    const template = `import { Migration } from "./types";

export const migration: Migration = {
  id: "${id}",
  name: "${name}",
  description: "${description || ""}",
  
  up: (db) => {
    // Add your migration SQL here
    // db.exec(\`...\`);
  },
  
  down: (db) => {
    // Add rollback SQL here
    // db.exec(\`...\`);
  },
};

export default migration;
`;

    fs.writeFileSync(filePath, template);
    console.log(`[Migration] Created: ${filePath}`);
    return filePath;
  }
}

export function createMigrationRunner(db: Database, options?: MigrationOptions): MigrationRunner {
  return new MigrationRunner(db, options);
}