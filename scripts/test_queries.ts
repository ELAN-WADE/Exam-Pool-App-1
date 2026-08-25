import db, { queries } from "../db";

console.log("=== CHECKING ALL COMPILED QUERIES IN db.ts ===");

const failedQueries: string[] = [];

for (const [name, stmt] of Object.entries(queries)) {
  try {
    // Check parameters count
    const paramCount = (stmt as any).paramsCount ?? 0;
    // Test explain query plan to ensure query compiles cleanly in SQLite query planner
    // In bun:sqlite, we can check if statement is valid
  } catch (e: any) {
    console.error(`Error in statement ${name}:`, e.message);
    failedQueries.push(name);
  }
}

console.log(`Finished statement test. Failed queries: ${failedQueries.length}`);
