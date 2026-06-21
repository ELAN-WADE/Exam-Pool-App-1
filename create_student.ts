import { Database } from "bun:sqlite";
import { hashPassword } from "./auth.ts";

async function createStudent() {
  const db = new Database("exampool.db");
  const email = "student@exampool.ng";
  const newPassword = "studentPassword123!";
  const hash = await hashPassword(newPassword);

  const insertStmt = db.prepare("INSERT OR REPLACE INTO users (id, name, email, role, password_hash, is_active, grade) VALUES (999, 'Test Student', ?, 'student', ?, 1, 'SS3')");
  insertStmt.run(email, hash);

  console.log("Success! Created new student.");
  console.log("Email:", email);
  console.log("New Password:", newPassword);
}

createStudent().catch(console.error);
