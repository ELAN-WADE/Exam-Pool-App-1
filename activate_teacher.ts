import { Database } from "bun:sqlite";
const d = new Database("C:\\Users\\DELL\\Exam-Pool-App-1\\exampool.db");

// Activate a teacher user
const result = d.prepare('UPDATE users SET is_active = 1 WHERE email = "johnbo@gmail.com"').run();
console.log("Changes:", result.changes);

// Verify
const user = d.prepare('SELECT id, name, email, role, is_active FROM users WHERE email = "johnbo@gmail.com"').get();
console.log(user);