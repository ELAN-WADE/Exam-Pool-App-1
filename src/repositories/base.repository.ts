import { Database } from "bun:sqlite";
import type { Database as DatabaseType } from "bun:sqlite";

export interface Repository<T, CreateInput, UpdateInput> {
  findById(id: number): T | null;
  findAll(): T[];
  findWhere(conditions: Partial<T>): T[];
  create(input: CreateInput): T;
  update(id: number, input: UpdateInput): T | null;
  delete(id: number): boolean;
  count(): number;
}

export abstract class BaseRepository<T extends { id: number }, CreateInput, UpdateInput> {
  protected db: DatabaseType;
  protected tableName: string;
  protected columns: string[];

  constructor(db: DatabaseType, tableName: string, columns: string[]) {
    this.db = db;
    this.tableName = tableName;
    this.columns = columns;
  }

  protected mapRow(row: Record<string, unknown>): T {
    return row as T;
  }

  findById(id: number): T | null {
    const row = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findAll(): T[] {
    const rows = this.db.prepare(`SELECT * FROM ${this.tableName}`).all() as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  findWhere(conditions: Partial<T>): T[] {
    const keys = Object.keys(conditions) as (keyof T)[];
    if (keys.length === 0) return this.findAll();
    const whereClause = keys.map(k => `${String(k)} = ?`).join(" AND ");
    const values = keys.map(k => conditions[k]);
    const rows = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE ${whereClause}`).all(...values) as Record<string, unknown>[];
    return rows.map(this.mapRow.bind(this));
  }

  create(input: CreateInput): T {
    const keys = Object.keys(input) as string[];
    const placeholders = keys.map(() => "?").join(", ");
    const columns = keys.join(", ");
    const values = keys.map(k => (input as Record<string, unknown>)[k]);
    const result = this.db.prepare(`INSERT INTO ${this.tableName} (${columns}) VALUES (${placeholders})`).run(...values);
    const created = this.findById(Number(result.lastInsertRowid));
    if (!created) throw new Error(`Failed to create ${this.tableName}`);
    return created;
  }

  update(id: number, input: UpdateInput): T | null {
    const keys = Object.keys(input) as string[];
    if (keys.length === 0) return this.findById(id);
    const setClause = keys.map(k => `${k} = ?`).join(", ");
    const values = [...keys.map(k => (input as Record<string, unknown>)[k]), id];
    this.db.prepare(`UPDATE ${this.tableName} SET ${setClause} WHERE id = ?`).run(...values);
    return this.findById(id);
  }

  delete(id: number): boolean {
    const result = this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  count(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM ${this.tableName}`).get() as { count: number };
    return row.count;
  }

  exists(id: number): boolean {
    const row = this.db.prepare(`SELECT 1 FROM ${this.tableName} WHERE id = ? LIMIT 1`).get(id);
    return !!row;
  }
}

export class UnitOfWork {
  private db: DatabaseType;
  private committed = false;

  constructor(db: DatabaseType) {
    this.db = db;
  }

  begin(): void {
    this.db.exec("BEGIN");
  }

  commit(): void {
    if (!this.committed) {
      this.db.exec("COMMIT");
      this.committed = true;
    }
  }

  rollback(): void {
    if (!this.committed) {
      this.db.exec("ROLLBACK");
    }
  }

  transaction<T>(fn: () => T): T {
    this.begin();
    try {
      const result = fn();
      this.commit();
      return result;
    } catch (e) {
      this.rollback();
      throw e;
    }
  }
}

export function createUnitOfWork(db: DatabaseType): UnitOfWork {
  return new UnitOfWork(db);
}