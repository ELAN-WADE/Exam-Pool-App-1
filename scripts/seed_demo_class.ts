import db, { queries } from '../db';

const activeTerm = queries.getActiveAcademicTerm.get() as any;
const activeSession = queries.getActiveAcademicSession.get() as any;
console.log('Active Term:', activeTerm?.id, activeTerm?.name, 'Active Session:', activeSession?.id, activeSession?.name);

const classId = 31; // JSS 3
const teacherId = 10048; // teacher@exampool.ng

// 1. Ensure teacher 10048 is class teacher for class 31
db.prepare('UPDATE classes SET class_teacher_id = ? WHERE id = ?').run(teacherId, classId);

// 2. Enroll default student (10049) and a few other students into class 31 for the active term
const students = db.prepare("SELECT id, name, reg_id FROM users WHERE role = 'student' LIMIT 5").all() as any[];
for (const s of students) {
  db.prepare('INSERT OR IGNORE INTO class_enrollments (student_id, class_id, term_id) VALUES (?, ?, ?)').run(s.id, classId, activeTerm.id);
  console.log(`Enrolled student ${s.name} (${s.id}) into class ${classId} for term ${activeTerm.id}`);
}

// 3. Ensure teacher 10048 has assigned subjects (e.g. Mathematics, English Language, Basic Science) in active term and session
const existingSubs = db.prepare('SELECT id, name, code FROM subjects WHERE teacher_id = ? AND term_id = ?').all(teacherId, activeTerm.id) as any[];
if (existingSubs.length === 0) {
  const insertSub = db.prepare(`
    INSERT INTO subjects (name, code, term, duration, exam_datetime, is_published, teacher_id, created_by, class, total_score, term_id, session_id, mode)
    VALUES (?, ?, ?, 60, '2026-12-01T09:00:00Z', 1, ?, ?, 'JSS 3', 100, ?, ?, 'exam')
  `);
  const s1 = insertSub.run('Mathematics', 'MTH-JSS3', activeTerm.name, teacherId, teacherId, activeTerm.id, activeSession.id);
  const s2 = insertSub.run('English Language', 'ENG-JSS3', activeTerm.name, teacherId, teacherId, activeTerm.id, activeSession.id);
  const s3 = insertSub.run('Basic Science', 'SCI-JSS3', activeTerm.name, teacherId, teacherId, activeTerm.id, activeSession.id);
  console.log('Created subjects for teacher:', s1.lastInsertRowid, s2.lastInsertRowid, s3.lastInsertRowid);
}

// 4. Ensure grading subjects exist for class 31
const existingGradingSubs = db.prepare('SELECT id, name FROM grading_subjects WHERE class_id = ? AND term_id = ?').all(classId, activeTerm.id) as any[];
if (existingGradingSubs.length === 0) {
  const insertGs = db.prepare(`
    INSERT INTO grading_subjects (name, code, class_id, term_id, session_id, teacher_id, mode)
    VALUES (?, ?, ?, ?, ?, ?, 'exam')
  `);
  const g1 = insertGs.run('Mathematics', 'MTH-JSS3', classId, activeTerm.id, activeSession.id, teacherId);
  const g2 = insertGs.run('English Language', 'ENG-JSS3', classId, activeTerm.id, activeSession.id, teacherId);
  const g3 = insertGs.run('Basic Science', 'SCI-JSS3', classId, activeTerm.id, activeSession.id, teacherId);
  console.log('Created grading subjects for class 31:', g1.lastInsertRowid, g2.lastInsertRowid, g3.lastInsertRowid);
}

console.log('Done setup!');
