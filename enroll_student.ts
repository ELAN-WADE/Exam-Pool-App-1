import { Database } from "bun:sqlite";
const d = new Database("C:\\Users\\DELL\\Exam-Pool-App-1\\exampool.db");

// Check terms
const terms = d.prepare('SELECT * FROM academic_terms WHERE session_id = 1').all();
console.log("Terms:", terms);

// Enroll student 1006 in class 9 for term 1
const result = d.prepare('INSERT OR REPLACE INTO class_enrollments (student_id, class_id, term_id) VALUES (?, ?, ?)').run(1006, 9, 1);
console.log("Enrollment result:", result);