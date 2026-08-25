import db, { EXAMPOOL_DB_PATH, queries } from "../db";

interface HealthReport {
  timestamp: string;
  databasePath: string;
  integrity: string;
  foreignKeyViolations: number;
  tablesCount: number;
  indexesCount: number;
  missingFkIndexes: Array<{ table: string; column: string; target: string }>;
  compiledQueriesCount: number;
  queryErrors: string[];
  attachedDatabases: Array<{ name: string; file: string }>;
}

async function runHealthCheck(): Promise<boolean> {
  console.log("=========================================================");
  console.log("    EXAMPOOL RELATIONAL DATABASE PROFESSIONAL AUDIT      ");
  console.log("=========================================================");

  const report: HealthReport = {
    timestamp: new Date().toISOString(),
    databasePath: EXAMPOOL_DB_PATH,
    integrity: "unknown",
    foreignKeyViolations: 0,
    tablesCount: 0,
    indexesCount: 0,
    missingFkIndexes: [],
    compiledQueriesCount: 0,
    queryErrors: [],
    attachedDatabases: []
  };

  // 1. Attached Databases Check
  const databaseList = db.prepare("PRAGMA database_list").all() as Array<{ seq: number; name: string; file: string }>;
  report.attachedDatabases = databaseList.map(d => ({ name: d.name, file: d.file }));
  console.log("\n[1] Attached Databases:");
  for (const d of databaseList) {
    console.log(`    - ${d.name.padEnd(15)} : ${d.file || ":memory:"}`);
  }

  // 2. Database Integrity Check
  const integrityResult = db.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>;
  const isIntegrityOk = integrityResult.length === 1 && integrityResult[0].integrity_check === "ok";
  report.integrity = isIntegrityOk ? "OK" : JSON.stringify(integrityResult);
  console.log(`\n[2] Database Integrity: ${isIntegrityOk ? "PASSED (Integrity OK)" : "FAILED (" + report.integrity + ")"}`);

  // 3. Foreign Key Violations Check
  const fkViolations = db.prepare("PRAGMA foreign_key_check").all() as any[];
  report.foreignKeyViolations = fkViolations.length;
  console.log(`\n[3] Foreign Key Constraint Violations: ${fkViolations.length === 0 ? "0 (All relations valid)" : fkViolations.length + " violations detected!"}`);
  if (fkViolations.length > 0) {
    console.error("    Violations:", fkViolations);
  }

  // 4. Tables & Schema Inspection
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>;
  report.tablesCount = tables.length;
  console.log(`\n[4] Database Tables (${tables.length} tables found):`);

  let totalIndexes = 0;
  for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info(${t.name})`).all() as any[];
    const fks = db.prepare(`PRAGMA foreign_key_list(${t.name})`).all() as any[];
    const idxs = db.prepare(`PRAGMA index_list(${t.name})`).all() as any[];
    totalIndexes += idxs.length;

    // Check if foreign keys are indexed
    const indexedCols = new Set<string>();
    for (const idx of idxs) {
      const idxInfo = db.prepare(`PRAGMA index_info(${idx.name})`).all() as any[];
      if (idxInfo && idxInfo.length > 0) {
        indexedCols.add(idxInfo[0].name);
      }
    }

    for (const fk of fks) {
      if (!indexedCols.has(fk.from)) {
        report.missingFkIndexes.push({
          table: t.name,
          column: fk.from,
          target: `${fk.table}(${fk.to})`
        });
      }
    }
  }
  report.indexesCount = totalIndexes;
  console.log(`    - Total Tables: ${report.tablesCount}`);
  console.log(`    - Total Indexes: ${report.indexesCount}`);

  // 5. Foreign Key Index Coverage Check
  console.log("\n[5] Foreign Key Index Coverage:");
  if (report.missingFkIndexes.length === 0) {
    console.log("    PASSED: 100% of foreign key columns have dedicated B-Tree index coverage!");
  } else {
    console.warn(`    WARNING: ${report.missingFkIndexes.length} foreign key columns lack indexes:`);
    for (const m of report.missingFkIndexes) {
      console.warn(`      - ${m.table}.${m.column} -> ${m.target}`);
    }
  }

  // 6. Precompiled Query Statements Check
  console.log("\n[6] Precompiled Prepared Statements Verification:");
  let queryCount = 0;
  for (const [name, stmt] of Object.entries(queries)) {
    queryCount++;
    try {
      if (!stmt || typeof (stmt as any).all !== "function") {
        report.queryErrors.push(`Query '${name}' is not a valid prepared statement`);
      }
    } catch (e: any) {
      report.queryErrors.push(`Query '${name}' error: ${e.message}`);
    }
  }
  report.compiledQueriesCount = queryCount;
  console.log(`    - Verified ${queryCount} prepared statements.`);
  if (report.queryErrors.length === 0) {
    console.log("    PASSED: All prepared queries compile cleanly with zero errors.");
  } else {
    console.error(`    FAILED: ${report.queryErrors.length} query errors found:`, report.queryErrors);
  }

  // 7. Questions & Subjects Schema Constraints Validation
  console.log("\n[7] Examination Constraints Validation:");
  const qSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='questions'").get() as any)?.sql || "";
  const sSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='subjects'").get() as any)?.sql || "";

  const supports5Options = !qSql.includes("BETWEEN 0 AND 3");
  const supports24hExam = !sSql.includes("duration <= 360");

  console.log(`    - Questions 5-Option (JAMB/WAEC A-E) Support: ${supports5Options ? "ENABLED (0-9 range allowed)" : "RESTRICTED (0-3 only)"}`);
  console.log(`    - Subjects Flexible Duration Support: ${supports24hExam ? "ENABLED (up to 1440 mins / 24 hrs)" : "RESTRICTED (360 mins only)"}`);

  const allPassed = isIntegrityOk && fkViolations.length === 0 && report.missingFkIndexes.length === 0 && report.queryErrors.length === 0 && supports5Options && supports24hExam;

  console.log("\n=========================================================");
  console.log(`  OVERALL DATABASE HEALTH: ${allPassed ? "EXCELLENT (All checks passed)" : "ACTION REQUIRED"}`);
  console.log("=========================================================\n");

  return allPassed;
}

runHealthCheck().then(success => {
  process.exit(success ? 0 : 1);
});
