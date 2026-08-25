import { Database } from "bun:sqlite";
const d = new Database("C:\\Users\\DELL\\Exam-Pool-App-1\\exampool.db");

// Check class_enrollments for class 9 (JSS 3) term 1
const enrollments = d.prepare('SELECT * FROM class_enrollments WHERE class_id = 9 AND term_id = 1').all();
console.log("Class enrollments for JSS 3 term 1:", enrollments);

// Check users in JSS 3 grade level
const users = d.prepare('SELECT u.*, gl.name as grade_level FROM users u LEFT JOIN grade_levels gl ON gl.id = u.grade_level_id WHERE gl.name = "JSS 3" AND u.role = "student" AND u.is_active = 1').all();
console.log("Students in JSS 3 grade level:", users);