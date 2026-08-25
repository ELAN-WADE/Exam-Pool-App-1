import { Database } from "bun:sqlite";
const d = new Database("C:\\Users\\DELL\\Exam-Pool-App-1\\exampool.db");

// Check subjects for teacher ID 2
const subjects = d.prepare('SELECT * FROM subjects WHERE teacher_id = 2').all();
console.log("Subjects for teacher 2:", subjects);

// Check grading subjects
const gradingSubjects = d.prepare('SELECT * FROM grading_subjects WHERE teacher_id = 2').all();
console.log("Grading subjects for teacher 2:", gradingSubjects);

// Check classes
const classes = d.prepare('SELECT * FROM classes').all();
console.log("Classes:", classes);

// Check class teacher assignments
const classTeachers = d.prepare('SELECT * FROM classes WHERE class_teacher_id = 2').all();
console.log("Classes where teacher 2 is class teacher:", classTeachers);

// Check active term
const activeTerm = d.prepare('SELECT * FROM academic_terms WHERE is_active = 1').get();
console.log("Active term:", activeTerm);

// Check active session
const activeSession = d.prepare('SELECT * FROM academic_sessions WHERE is_active = 1').get();
console.log("Active session:", activeSession);