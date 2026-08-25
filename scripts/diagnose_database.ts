import db, { EXAMPOOL_DB_PATH, queries } from "../db";

console.log("=== EXAMPOOL RELATIONAL DATABASE HEALTH CHECK ===");
console.log("Database Path:", EXAMPOOL_DB_PATH);

// 1. PRAGMA integrity_check
const integrity = db.prepare("PRAGMA integrity_check").all();
console.log("\n1. Integrity Check:", JSON.stringify(integrity));

// 2. PRAGMA foreign_key_check
const fkCheck = db.prepare("PRAGMA foreign_key_check").all();
console.log("\n2. Foreign Key Violations Check:", JSON.stringify(fkCheck));

// 3. Inspect all tables & schema SQL
const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string; sql: string }>;
console.log(`\n3. Discovered ${tables.length} tables:`);

const tableColumns: Record<string, any[]> = {};
const tableForeignKeys: Record<string, any[]> = {};
const tableIndexes: Record<string, any[]> = {};

for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
  const fks = db.prepare(`PRAGMA foreign_key_list(${t.name})`).all();
  const idxs = db.prepare(`PRAGMA index_list(${t.name})`).all();
  
  tableColumns[t.name] = cols;
  tableForeignKeys[t.name] = fks;
  tableIndexes[t.name] = idxs;
  
  console.log(`\n--- TABLE: ${t.name} (${cols.length} columns, ${fks.length} foreign keys, ${idxs.length} indexes) ---`);
  console.log("Columns:", cols.map((c: any) => `${c.name} (${c.type}${c.notnull ? ' NOT NULL' : ''}${c.pk ? ' PK' : ''}${c.dflt_value !== null ? ' DEFAULT ' + c.dflt_value : ''})`).join(", "));
  if (fks.length > 0) {
    console.log("Foreign Keys:", fks.map((fk: any) => `col[${fk.from}] -> ${fk.table}(${fk.to}) ON_DEL=${fk.on_delete} ON_UPD=${fk.on_update}`).join(" | "));
  }
}

// 4. Check for missing indexes on Foreign Keys
console.log("\n4. Checking for missing indexes on Foreign Key columns...");
const missingFkIndexes: Array<{ table: string; column: string; target: string }> = [];

for (const t of tables) {
  const fks = tableForeignKeys[t.name] || [];
  const idxs = tableIndexes[t.name] || [];
  
  // Get all indexed columns for this table
  const indexedCols = new Set<string>();
  for (const idx of idxs) {
    const idxInfo = db.prepare(`PRAGMA index_info(${idx.name})`).all() as any[];
    if (idxInfo && idxInfo.length > 0) {
      // First column in the index is indexed for prefix lookups
      indexedCols.add(idxInfo[0].name);
    }
  }
  
  for (const fk of fks) {
    if (!indexedCols.has(fk.from)) {
      missingFkIndexes.push({ table: t.name, column: fk.from, target: `${fk.table}(${fk.to})` });
    }
  }
}

if (missingFkIndexes.length > 0) {
  console.warn("WARNING: Missing indexes on foreign key columns (causes table scans on CASCADE / JOIN):");
  missingFkIndexes.forEach(m => console.warn(`  - ${m.table}.${m.column} -> ${m.target}`));
} else {
  console.log("All foreign key columns are properly indexed!");
}

// 5. Test queries object
console.log("\n5. Testing queries export in db.ts...");
let querySuccess = 0;
let queryErrors = 0;

for (const [name, stmt] of Object.entries(queries)) {
  try {
    if (!stmt || typeof (stmt as any).all !== 'function') {
      console.error(`Query ${name} is invalid`);
      queryErrors++;
    } else {
      querySuccess++;
    }
  } catch (e: any) {
    console.error(`Error in query ${name}:`, e.message);
    queryErrors++;
  }
}
console.log(`Query sanity check: ${querySuccess} valid, ${queryErrors} errors`);
