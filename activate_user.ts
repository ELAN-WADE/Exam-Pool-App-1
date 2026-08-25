import { Database } from "bun:sqlite";
const d = new Database("C:\\Users\\DELL\\Exam-Pool-App-1\\exampool.db");

// Activate the test user
const result = d.prepare('UPDATE users SET is_active = 1 WHERE email = "test@exampool.ng"').run();
console.log("Changes:", result.changes);

// Verify
const user = d.prepare('SELECT id, name, email, role, is_active FROM users WHERE email = "test@exampool.ng"').get();
console.log(user);