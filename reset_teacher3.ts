import { Database } from "bun:sqlite";
import { hashPassword } from "./auth.ts";

async function resetTeacher() {
  const db = new Database("exampool.db");
  
  const email = "elanonline@gmail.com";
  const newPassword = "password123!";
  const hash = await hashPassword(newPassword);

  const stmt = db.prepare("UPDATE users SET password_hash = ?, is_active = 1 WHERE email = ?");
  const info = stmt.run(hash, email);

  if (info.changes > 0) {
    console.log("Success! Teacher password reset.");
    console.log("Email:", email);
    console.log("New Password:", newPassword);
  } else {
    console.log("User not found");
  }
}

resetTeacher().catch(console.error);