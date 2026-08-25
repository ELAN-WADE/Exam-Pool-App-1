import db, { queries } from "../db";
import { hashPassword } from "../auth";

const testPassword = "Teacher123!";
const hash = await hashPassword(testPassword);

// Update teacher Adeleke Daniel
db.prepare("UPDATE users SET password_hash = ?, is_active = 1 WHERE email = 'elanwadeonline@gmail.com'").run(hash);

console.log("Teacher Adeleke Daniel password updated to Teacher123!");
