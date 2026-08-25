import { Database } from "bun:sqlite";
const d = new Database("C:\\Users\\DELL\\Exam-Pool-App-1\\exampool.db");

// Try to find a user with password - check if there's a password for test
const users = d.prepare('SELECT id, name, email, role, password_hash FROM users WHERE role IN ("teacher", "operator") LIMIT 10').all();
console.log(users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, hasPassword: !!u.password_hash })));