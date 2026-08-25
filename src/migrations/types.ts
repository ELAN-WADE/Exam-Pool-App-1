import { Database } from "bun:sqlite";

export interface Migration {
  id: string;
  name: string;
  up: (db: Database) => void | Promise<void>;
  down?: (db: Database) => void | Promise<void>;
}

export interface MigrationRecord {
  id: string;
  name: string;
  applied_at: string;
  checksum: string;
}

export interface MigrationStatus {
  id: string;
  name: string;
  applied: boolean;
  appliedAt?: string;
  checksum?: string;
}

export interface MigrationOptions {
  migrationsDir?: string;
  tableName?: string;
  dryRun?: boolean;
}

export interface CreateMigrationOptions {
  name: string;
  description?: string;
}