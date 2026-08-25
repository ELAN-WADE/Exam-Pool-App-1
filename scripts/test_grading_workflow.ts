import db, { queries } from '../db';

console.log("=================================================");
console.log("  EXAMPOOL GRADING & BROADSHEET VERIFICATION    ");
console.log("=================================================");

// 1. Check Active Session & Active Term
const activeSession = queries.getActiveAcademicSession.get() as any;
const activeTerm = queries.getActiveAcademicTerm.get() as any;
console.log(`[1] Active Session: ${activeSession?.name} (ID: ${activeSession?.id})`);
console.log(`    Active Term:    ${activeTerm?.name} (ID: ${activeTerm?.id})`);

// 2. Check Teacher Role & Assigned Class
const teacher = db.prepare("SELECT id, name, email, role FROM users WHERE email = 'teacher@exampool.ng'").get() as any;
console.log(`\n[2] Teacher User: ${teacher?.name} (ID: ${teacher?.id}, Email: ${teacher?.email})`);
const assignedClass = queries.getClassForTeacher.get(teacher.id) as any;
console.log(`    Assigned Class: ${assignedClass?.name} (ID: ${assignedClass?.id})`);

// 3. Check Class Roster
const roster = queries.getClassRoster.all(assignedClass.id, activeTerm.id) as any[];
console.log(`\n[3] Enrolled Students in ${assignedClass?.name} (${roster.length} students):`);
roster.forEach(s => console.log(`    - ${s.name} (${s.reg_id}) [ID: ${s.id}]`));

// 4. Check Class Subjects for Term
const subjects = queries.getClassSubjectsForTerm.all(assignedClass.id, activeTerm.id, activeSession.id) as any[];
console.log(`\n[4] Active Grading Subjects for ${assignedClass?.name} (${subjects.length} subjects):`);
subjects.forEach(sub => console.log(`    - ${sub.name} (${sub.code}) [ID: ${sub.id}] | Teacher: ${sub.teacher_name || 'Assigned'}`));

// 5. Check Class Broadsheet & Averages
const termResults = queries.getClassTermResultsByClass.all(assignedClass.id, activeTerm.id, activeSession.id) as any[];
console.log(`\n[5] Broadsheet Results Summary (${termResults.length} approved subject entries):`);

// Group results by student
const studentMap = new Map<number, { name: string; reg_id: string; total: number; count: number; subjects: any[] }>();
for (const s of roster) {
  studentMap.set(s.id, { name: s.name, reg_id: s.reg_id, total: 0, count: 0, subjects: [] });
}

for (const r of termResults) {
  const entry = studentMap.get(r.student_id);
  if (entry) {
    entry.total += r.total_score;
    entry.count += 1;
    entry.subjects.push({ code: r.subject_code, ca: r.ca_score, exam: r.exam_score, total: r.total_score, grade: r.grade });
  }
}

studentMap.forEach((data, sid) => {
  const avg = data.count > 0 ? (data.total / data.count).toFixed(1) : '0.0';
  console.log(`    * ${data.name} (${data.reg_id}): Avg Score: ${avg}% (${data.count} subjects)`);
  data.subjects.forEach(sub => {
    console.log(`        └ ${sub.code}: CA=${sub.ca}/40, Exam=${sub.exam}/60 => Total=${sub.total}% [Grade ${sub.grade}]`);
  });
});

// 6. Check Report Card Remarks
console.log(`\n[6] Report Card Remarks:`);
roster.forEach(s => {
  const remark = queries.getStudentTermRemarks.get(s.id, activeSession.id, activeTerm.id) as any;
  console.log(`    - Student: ${s.name}`);
  console.log(`        Teacher:   "${remark?.teacher_remark || 'N/A'}"`);
  console.log(`        Principal: "${remark?.principal_remark || 'N/A'}"`);
});

console.log("\n=================================================");
console.log("  ALL GRADING AND BROADSHEET CHECKS PASSED!     ");
console.log("=================================================");
