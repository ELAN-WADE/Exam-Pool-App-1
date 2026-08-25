import { Database } from "bun:sqlite";
import { hashPassword } from "./auth.ts";

async function resetTeacher() {
  const db = new Database("exampool.db");
  const newPassword = "teacherPassword123!";
  const hash = await hashPassword(newPassword);

  const stmt = db.prepare("UPDATE users SET password_hash = ?, is_active = 1 WHERE role = 'teacher'");
  const info = stmt.run(hash);

  const teachers = db.prepare("SELECT id, name, email, role, is_active FROM users WHERE role = 'teacher'").all() as Array<{
    id: number;
    name: string;
    email: string;
    role: string;
    is_active: number;
  }>;

  if (teachers.length > 0) {
    console.log(`\nSuccess! Reset password for ${teachers.length} teacher(s):\n`);
    console.log("--------------------------------------------------");
    for (const t of teachers) {
      console.log(`Name:     ${t.name}`);
      console.log(`Email:    ${t.email}`);
      console.log(`Password: ${newPassword}`);
      console.log("--------------------------------------------------");
    }
  } else {
    // Create a default teacher account if none exists
    const defaultEmail = "teacher@exampool.ng";
    db.prepare("INSERT INTO users (name, email, role, password_hash, is_active) VALUES (?, ?, ?, ?, ?)").run(
      "Default Teacher",
      defaultEmail,
      "teacher",
      hash,
      1
    );
    console.log("\nNo teacher accounts found. Created a new teacher account:\n");
    console.log("--------------------------------------------------");
    console.log(`Name:     Default Teacher`);
    console.log(`Email:    ${defaultEmail}`);
    console.log(`Password: ${newPassword}`);
    console.log("--------------------------------------------------");
  }
}

resetTeacher().catch(console.error);