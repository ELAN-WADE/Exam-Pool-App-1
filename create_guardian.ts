import { Database } from "bun:sqlite";
import { hashPassword } from "./auth.ts";

async function setupGuardian() {
  const db = new Database("exampool.db");
  const guardianEmail = "guardian@exampool.ng";
  const guardianPassword = "guardianPassword123!";
  const hash = await hashPassword(guardianPassword);

  // Check if guardian already exists
  let guardian = db.prepare("SELECT id, name, email FROM users WHERE email = ?").get(guardianEmail) as any;

  if (!guardian) {
    const info = db.prepare(
      "INSERT INTO users (name, email, role, password_hash, is_active, phone) VALUES (?, ?, 'guardian', ?, 1, ?)"
    ).run("Chief John Doe (Guardian)", guardianEmail, hash, "+234 801 234 5678");
    guardian = { id: Number(info.lastInsertRowid), name: "Chief John Doe (Guardian)", email: guardianEmail };
    console.log(`Created guardian user: ${guardianEmail}`);
  } else {
    db.prepare("UPDATE users SET password_hash = ?, is_active = 1, role = 'guardian' WHERE id = ?").run(hash, guardian.id);
    console.log(`Updated existing guardian user: ${guardianEmail}`);
  }

  // Find students to link
  const students = db.prepare("SELECT id, name, reg_id, grade FROM users WHERE role = 'student' LIMIT 3").all() as any[];

  // Ensure guardian_student_links table exists
  db.run(`
    CREATE TABLE IF NOT EXISTS guardian_student_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guardian_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      relationship TEXT DEFAULT 'Parent/Guardian',
      status TEXT DEFAULT 'approved',
      verification_method TEXT DEFAULT 'admin_verified',
      verified_by_data TEXT,
      verified_by INTEGER,
      verified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(guardian_id, student_id)
    )
  `);

  // Link guardian to each student
  for (const s of students) {
    db.prepare(`
      INSERT OR REPLACE INTO guardian_student_links 
      (guardian_id, student_id, relationship, status, verification_method, verified_at)
      VALUES (?, ?, 'Parent/Guardian', 'approved', 'manual_admin', CURRENT_TIMESTAMP)
    `).run(guardian.id, s.id);
    console.log(`Linked ward: ${s.name} (${s.reg_id || s.grade || "Student"}) to guardian.`);
  }

  console.log("\n--------------------------------------------------");
  console.log("GUARDIAN ACCOUNT READY:");
  console.log(`Email:    ${guardianEmail}`);
  console.log(`Password: ${guardianPassword}`);
  console.log(`Portal:   http://localhost:3000/guardian/dashboard`);
  console.log("--------------------------------------------------");
}

setupGuardian().catch(console.error);
