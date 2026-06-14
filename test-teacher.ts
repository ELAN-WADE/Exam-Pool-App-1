import db from "./db.ts";
const teachers = db.query("SELECT id, name, email, role, is_active FROM users WHERE role = 'teacher'").all();
console.log(teachers);
