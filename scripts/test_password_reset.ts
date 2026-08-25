import db, { queries } from "../db";
import { hashPassword, verifyPassword } from "../auth";

console.log("=== TESTING ADMIN USER PASSWORD RESET FLOW ===");

// 1. Locate a sample teacher or operator
let user = db.prepare("SELECT id, name, email, role, password_hash FROM users WHERE role = 'teacher' LIMIT 1").get() as any;
if (!user) {
  user = db.prepare("SELECT id, name, email, role, password_hash FROM users LIMIT 1").get() as any;
}

if (!user) {
  console.log("No users found in database to test.");
  process.exit(0);
}

console.log(`Testing with user: ID ${user.id}, Name: ${user.name}, Email: ${user.email}, Role: ${user.role}`);

// 2. Perform password update (e.g. "Teacher2026!")
const testPassword = "Teacher2026!";
const newHash = await hashPassword(testPassword);
console.log("Generated new argon2id hash:", newHash.slice(0, 30) + "...");

queries.updateUserPassword.run(newHash, user.id);

// 3. Verify user from database with updated password
const updatedUser = queries.getUserById.get(user.id) as any;
const isMatch = await verifyPassword(testPassword, updatedUser.password_hash);
console.log("Password verification match result:", isMatch);

if (isMatch) {
  console.log("✅ PASSWORD RESET AND AUTHENTICATION VERIFICATION SUCCESSFUL!");
} else {
  console.error("❌ Password verification failed.");
  process.exit(1);
}
