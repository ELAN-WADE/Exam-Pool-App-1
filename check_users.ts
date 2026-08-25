import { Database } from "bun:sqlite";
const d = new Database("C:\\Users\\DELL\\Exam-Pool-App-1\\exampool.db");
console.log(d.prepare('SELECT id, name, email, role FROM users WHERE role IN ("teacher", "operator") LIMIT 10').all());