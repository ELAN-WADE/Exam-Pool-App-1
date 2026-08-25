import db, { queries } from "../db";
import { hashPassword } from "../auth";

const teachers = db.prepare("SELECT id, name, email, role, reg_id, is_active FROM users WHERE role = 'teacher'").all() as any[];

console.log("Found teachers:", teachers);

if (teachers.length > 0) {
  const teacher = teachers[0];
  const testPassword = "Teacher123!";
  const hash = await hashPassword(testPassword);
  queries.updateUserPassword.run(hash, teacher.id);
  db.prepare("UPDATE users SET is_active = 1 WHERE id = ?").run(teacher.id);

  console.log("\n==========================================");
  console.log("TEACHER LOGIN DETAILS READY:");
  console.log("==========================================");
  console.log("Name:    ", teacher.name);
  console.log("Email:   ", teacher.email);
  console.log("Reg ID:  ", teacher.reg_id || "N/A");
  console.log("Password:", testPassword);
  console.log("==========================================");
} else {
  // If no teacher exists, create one
  const testPassword = "Teacher123!";
  const hash = await hashPassword(testPassword);
  const res = queries.createUser.run(
    "Teacher Demo",
    "teacher@exampool.ng",
    "teacher",
    hash,
    null,
    "TCH-DEMO",
    "Teacher",
    "Demo",
    null,
    "08012345678",
    null,
    null
  ) as any;
  console.log("\n==========================================");
  console.log("CREATED NEW TEACHER LOGIN DETAILS:");
  console.log("==========================================");
  console.log("Name:    ", "Teacher Demo");
  console.log("Email:   ", "teacher@exampool.ng");
  console.log("Reg ID:  ", "TCH-DEMO");
  console.log("Password:", testPassword);
  console.log("==========================================");
}
