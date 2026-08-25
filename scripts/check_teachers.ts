import db, { queries } from '../db';

console.log("=== CLASSES ===");
console.log(db.prepare('SELECT id, name, section, level, class_teacher_id FROM classes').all());

console.log("=== TEACHERS ===");
const teachers = db.prepare("SELECT id, name, email FROM users WHERE role = 'teacher'").all() as any[];
for (const t of teachers) {
  const cls = queries.getClassForTeacher.get(t.id) as any;
  console.log(`Teacher ID ${t.id} (${t.name}, ${t.email}): ${cls ? `Class Master for "${cls.name} ${cls.section || ''}" (Class ID: ${cls.id})` : 'Subject Teacher only'}`);
}
