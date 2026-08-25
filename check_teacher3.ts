import { Database } from "bun:sqlite";
const d = new Database("C:\\Users\\DELL\\Exam-Pool-App-1\\exampool.db");

// Check subjects for teacher ID 3
const subjects = d.prepare('SELECT * FROM subjects WHERE teacher_id = 3').all();
console.log("Subjects for teacher 3:", subjects);

// Check grading subjects
const gradingSubjects = d.prepare('SELECT * FROM grading_subjects WHERE teacher_id = 3').all();
console.log("Grading subjects for teacher 3:", gradingSubjects);

// Check classes where teacher 3 is class teacher
const classTeachers = d.prepare('SELECT * FROM classes WHERE class_teacher_id = 3').all();
console.log("Classes where teacher 3 is class teacher:", classTeachers);

// Check exams for teacher 3's subjects
const exams = d.prepare('SELECT e.*, s.name as subject_name FROM exams e JOIN subjects s ON s.id = e.subject_id WHERE s.teacher_id = 3 AND e.status = "completed"').all();
console.log("Completed exams for teacher 3's subjects:", exams);