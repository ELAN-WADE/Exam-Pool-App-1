import { Database } from "bun:sqlite";
import { hashPassword } from "./auth.ts";

async function main() {
  const db = new Database("exampool.db");
  const hash = await hashPassword("studentPassword123!");
  
  db.prepare(`
    INSERT OR REPLACE INTO users (id, name, email, reg_id, grade, role, password_hash, is_active)
    VALUES (9999, 'Elan Wade', 'student@acad.ng', 'ACAD-STU-001', 'Grade 11 - Science', 'student', ?, 1)
  `).run(hash);

  console.log("Successfully created/updated student@acad.ng");
}

main().catch(console.error);
