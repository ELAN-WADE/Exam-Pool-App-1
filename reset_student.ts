import { Database } from "bun:sqlite";
import { hashPassword } from "./auth.ts";

async function resetStudents() {
  const db = new Database("exampool.db");
  const newPassword = "studentPassword123!";
  const hash = await hashPassword(newPassword);

  const stmt = db.prepare("UPDATE users SET password_hash = ?, is_active = 1 WHERE role = 'student'");
  const info = stmt.run(hash);

  const students = db.prepare("SELECT id, name, email, reg_id, grade, role, is_active FROM users WHERE role = 'student'").all() as Array<{
    id: number;
    name: string;
    email: string;
    reg_id: string | null;
    grade: string | null;
    role: string;
    is_active: number;
  }>;

  if (students.length > 0) {
    console.log(`\nSuccess! Reset password for ${students.length} student(s):\n`);
    console.log("--------------------------------------------------");
    for (const s of students) {
      console.log(`Name:     ${s.name}`);
      console.log(`Email:    ${s.email}`);
      console.log(`Reg ID:   ${s.reg_id || "(none)"}`);
      console.log(`Grade:    ${s.grade || "(none)"}`);
      console.log(`Password: ${newPassword}`);
      console.log("--------------------------------------------------");
    }
  } else {
    // Create a default student account if none exists
    const defaultEmail = "student@exampool.ng";
    const defaultRegId = "REG-2026-0001";
    db.prepare("INSERT INTO users (name, email, reg_id, grade, role, password_hash, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "Default Student",
      defaultEmail,
      defaultRegId,
      "Grade 10",
      "student",
      hash,
      1
    );
    console.log("\nNo student accounts found. Created a new student account:\n");
    console.log("--------------------------------------------------");
    console.log(`Name:     Default Student`);
    console.log(`Email:    ${defaultEmail}`);
    console.log(`Reg ID:   ${defaultRegId}`);
    console.log(`Password: ${newPassword}`);
    console.log("--------------------------------------------------");
  }
}

resetStudents().catch(console.error);
