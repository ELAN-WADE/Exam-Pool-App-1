import { Database } from "bun:sqlite";
import { hashPassword } from "./auth.ts";

async function resetAdmin() {
  const db = new Database("exampool.db");
  
  const email = "admin@exampool.ng";
  const newPassword = "adminPassword123!";
  const hash = await hashPassword(newPassword);

  const stmt = db.prepare("UPDATE users SET password_hash = ? WHERE role = 'operator'");
  const info = stmt.run(hash);

  if (info.changes > 0) {
    const user = db.prepare("SELECT email, role FROM users WHERE role = 'operator'").get() as { email: string; role: string } | null;
    console.log("Success! Operator password reset.");
    console.log("Email:", user?.email ?? "(unknown)");
    console.log("New Password:", newPassword);
  } else {
    // If no operator exists, create one
    console.log("No operator found. Creating a new one...");
    const insertStmt = db.prepare("INSERT INTO users (name, email, role, password_hash, is_active) VALUES (?, ?, ?, ?, ?)");
    insertStmt.run("System Admin", email, "operator", hash, 1);
    console.log("Success! Created new operator.");
    console.log("Email:", email);
    console.log("New Password:", newPassword);
  }
}

resetAdmin().catch(console.error);
