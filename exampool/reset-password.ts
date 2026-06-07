import db from "./db.ts";
import { hashPassword } from "./auth.ts";

async function resetPassword() {
  const email = "elanwadeonline@gmail.com";
  const newPassword = "Password123!";
  
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  
  if (!user) {
    console.log(`User ${email} not found. Creating a new operator account...`);
    const hash = await hashPassword(newPassword);
    db.prepare(`
      INSERT INTO users (name, email, role, password_hash, is_active) 
      VALUES (?, ?, ?, ?, ?)
    `).run("Admin User", email, "operator", hash, 1);
    console.log(`✅ Created ${email} with password: ${newPassword}`);
    return;
  }
  
  const hash = await hashPassword(newPassword);
  db.prepare("UPDATE users SET password_hash = ? WHERE email = ?").run(hash, email);
  console.log(`✅ Password for ${email} has been reset to: ${newPassword}`);
}

resetPassword();
