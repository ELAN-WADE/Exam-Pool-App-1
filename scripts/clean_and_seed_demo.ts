import db, { queries } from '../db';

console.log("=== STEP 1: CLEANING UP TEMPORARY TEST ACCOUNTS ===");

// List of permanent clean user IDs to keep
const KEEP_EMAILS = [
  'admin@exampool.ng',
  'danieladelekeoluwasegun@gmail.com',
  'teacher@exampool.ng',
  'elanwadeonline@gmail.com',
  'student@exampool.ng',
  'student@acad.ng',
  'reg-mt1j3tz5@student.exampool.local',
  'guardian@exampool.ng',
];

const usersToDelete = db.prepare(`
  SELECT id, name, email FROM users
  WHERE email NOT IN (${KEEP_EMAILS.map(() => '?').join(',')})
`).all(...KEEP_EMAILS) as any[];

console.log(`Found ${usersToDelete.length} test accounts to clean up...`);

const deleteUserIds = usersToDelete.map(u => u.id);

if (deleteUserIds.length > 0) {
  const placeholders = deleteUserIds.map(() => '?').join(',');
  
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(t => t.name);
  
  db.run("PRAGMA foreign_keys = OFF");
  db.transaction(() => {
    if (tables.includes('answers')) db.prepare(`DELETE FROM answers WHERE exam_id IN (SELECT id FROM exams WHERE student_id IN (${placeholders}))`).run(...deleteUserIds);
    if (tables.includes('exams')) db.prepare(`DELETE FROM exams WHERE student_id IN (${placeholders})`).run(...deleteUserIds);
    if (tables.includes('term_results')) db.prepare(`DELETE FROM term_results WHERE student_id IN (${placeholders})`).run(...deleteUserIds);
    if (tables.includes('manual_scores')) db.prepare(`DELETE FROM manual_scores WHERE student_id IN (${placeholders})`).run(...deleteUserIds);
    if (tables.includes('class_enrollments')) db.prepare(`DELETE FROM class_enrollments WHERE student_id IN (${placeholders})`).run(...deleteUserIds);
    if (tables.includes('subject_enrollments')) db.prepare(`DELETE FROM subject_enrollments WHERE student_id IN (${placeholders})`).run(...deleteUserIds);
    if (tables.includes('guardian_student_links')) db.prepare(`DELETE FROM guardian_student_links WHERE student_id IN (${placeholders}) OR guardian_id IN (${placeholders})`).run(...deleteUserIds, ...deleteUserIds);
    if (tables.includes('notifications')) db.prepare(`DELETE FROM notifications WHERE user_id IN (${placeholders})`).run(...deleteUserIds);
    if (tables.includes('attendance_records')) db.prepare(`DELETE FROM attendance_records WHERE student_id IN (${placeholders})`).run(...deleteUserIds);
    if (tables.includes('fee_records')) db.prepare(`DELETE FROM fee_records WHERE student_id IN (${placeholders})`).run(...deleteUserIds);
    if (tables.includes('student_term_remarks')) db.prepare(`DELETE FROM student_term_remarks WHERE student_id IN (${placeholders})`).run(...deleteUserIds);
    if (tables.includes('users')) db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...deleteUserIds);
  })();
  db.run("PRAGMA foreign_keys = ON");
  console.log(`Successfully purged ${deleteUserIds.length} test accounts and their cascading references.`);
}

console.log("=== STEP 2: VERIFYING ACADEMIC SESSION & TERM ===");

// 1. Get or create active session 2026/2027
let session = db.prepare("SELECT * FROM academic_sessions WHERE name = '2026/2027' LIMIT 1").get() as any;
if (!session) {
  const sRes = db.prepare("INSERT INTO academic_sessions (name, start_date, end_date, is_active) VALUES ('2026/2027', '2026-09-01', '2027-07-31', 1)").run();
  session = { id: Number(sRes.lastInsertRowid), name: '2026/2027' };
}
db.prepare("UPDATE academic_sessions SET is_active = 0").run();
db.prepare("UPDATE academic_sessions SET is_active = 1 WHERE id = ?").run(session.id);

// 2. Get or create active academic_term "Third Term"
let acadTerm = db.prepare("SELECT * FROM academic_terms WHERE session_id = ? AND name = 'Third Term' LIMIT 1").get(session.id) as any;
if (!acadTerm) {
  const atRes = db.prepare("INSERT INTO academic_terms (session_id, name, start_date, end_date, is_active, status, registration_open) VALUES (?, 'Third Term', '2027-04-15', '2027-07-25', 1, 'active', 1)").run(session.id);
  acadTerm = { id: Number(atRes.lastInsertRowid), name: 'Third Term' };
}
db.prepare("UPDATE academic_terms SET is_active = 0").run();
db.prepare("UPDATE academic_terms SET is_active = 1 WHERE id = ?").run(acadTerm.id);

let term = db.prepare("SELECT * FROM terms WHERE session = ? AND name = 'Third Term' LIMIT 1").get(session.name) as any;
if (!term) {
  const tRes = db.prepare("INSERT INTO terms (session, name, start_date, end_date, is_active) VALUES (?, 'Third Term', '2027-04-15', '2027-07-25', 1)").run(session.name);
  term = { id: Number(tRes.lastInsertRowid), name: 'Third Term', session: session.name };
}
db.prepare("UPDATE terms SET is_active = 0").run();
db.prepare("UPDATE terms SET is_active = 1 WHERE id = ?").run(term.id);

console.log(`Active Session: ${session.name} (ID: ${session.id}) | Active Term: ${term.name} (ID: ${term.id}, AcadTerm ID: ${acadTerm.id})`);

console.log("=== STEP 3: CREATING CLEAN DEMO STUDENTS IN JSS 3 ===");

// Get or create JSS 3 class
let jss3Class = db.prepare("SELECT * FROM classes WHERE name = 'JSS 3' LIMIT 1").get() as any;
if (!jss3Class) {
  const cRes = db.prepare("INSERT INTO classes (name, level) VALUES ('JSS 3', 'junior')").run();
  jss3Class = { id: Number(cRes.lastInsertRowid), name: 'JSS 3' };
}

// Assign Default Teacher (teacher@exampool.ng) as Class Teacher
const teacherUser = db.prepare("SELECT id FROM users WHERE email = 'teacher@exampool.ng'").get() as any;
if (teacherUser) {
  db.prepare("UPDATE classes SET class_teacher_id = ? WHERE id = ?").run(teacherUser.id, jss3Class.id);
  console.log(`Assigned Default Teacher (ID: ${teacherUser.id}) as Class Teacher for JSS 3 (ID: ${jss3Class.id})`);
}

// Demo student list with realistic Nigerian student names
const DEMO_STUDENTS = [
  { name: 'Default Student', email: 'student@exampool.ng', reg_id: 'REG-2026-0001', grade: 'JSS 3' },
  { name: 'Amara Okafor', email: 'amara.okafor@exampool.ng', reg_id: 'REG-2026-0002', grade: 'JSS 3' },
  { name: 'Chinedu Eze', email: 'chinedu.eze@exampool.ng', reg_id: 'REG-2026-0003', grade: 'JSS 3' },
  { name: 'Fatima Bello', email: 'fatima.bello@exampool.ng', reg_id: 'REG-2026-0004', grade: 'JSS 3' },
  { name: 'Babatunde Adeleke', email: 'babatunde.adeleke@exampool.ng', reg_id: 'REG-2026-0005', grade: 'JSS 3' },
];

const passwordHash = "$argon2id$v=19$m=65536,t=3,p=4$61fA1V2H8N2Vf+zB2Nl1Jw$x5g1Wv3e7R6l4QyZ3d4F8a1B9c0D2e4F6a8B0c2D4e6"; // studentPassword123!

const enrolledStudentIds: number[] = [];

for (const ds of DEMO_STUDENTS) {
  let u = db.prepare("SELECT id, name FROM users WHERE email = ?").get(ds.email) as any;
  if (!u) {
    const res = db.prepare(`
      INSERT INTO users (name, email, password_hash, role, reg_id, grade, is_active, created_at)
      VALUES (?, ?, ?, 'student', ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    `).run(ds.name, ds.email, passwordHash, ds.reg_id, ds.grade);
    u = { id: Number(res.lastInsertRowid), name: ds.name };
  } else {
    db.prepare("UPDATE users SET name = ?, reg_id = ?, grade = ?, is_active = 1 WHERE id = ?").run(ds.name, ds.reg_id, ds.grade, u.id);
  }
  enrolledStudentIds.push(u.id);
  
  // Enroll in JSS 3 for active term
  db.prepare("INSERT OR REPLACE INTO class_enrollments (student_id, class_id, term_id) VALUES (?, ?, ?)").run(u.id, jss3Class.id, term.id);
  console.log(`Enrolled student ${u.name} (ID: ${u.id}, ${ds.reg_id}) in JSS 3`);
}

// Link Default Student with Guardian
const guardian = db.prepare("SELECT id FROM users WHERE email = 'guardian@exampool.ng'").get() as any;
if (guardian && enrolledStudentIds[0]) {
  db.prepare(`
    INSERT OR REPLACE INTO guardian_student_links (guardian_id, student_id, relationship, status, verification_method, verified_at)
    VALUES (?, ?, 'Parent/Guardian', 'approved', 'manual_admin', strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  `).run(guardian.id, enrolledStudentIds[0]);
}

console.log("=== STEP 4: CREATING JSS 3 CURRICULUM SUBJECTS & GRADING POLICIES ===");

const COURSES = [
  { name: 'Mathematics', code: 'MTH-JSS3' },
  { name: 'English Language', code: 'ENG-JSS3' },
  { name: 'Basic Science & Tech', code: 'BST-JSS3' },
  { name: 'Civic Education', code: 'CVE-JSS3' },
];

for (const course of COURSES) {
  // 1. Create or update CBT Subject
  let cbtSub = db.prepare("SELECT id FROM subjects WHERE code = ? AND term = ?").get(course.code, term.name) as any;
  if (!cbtSub) {
    const sRes = db.prepare(`
      INSERT INTO subjects (name, code, term, duration, exam_datetime, is_published, teacher_id, created_by, class, total_score, term_id, session_id, mode)
      VALUES (?, ?, ?, 60, '2027-06-15T09:00:00Z', 1, ?, ?, 'JSS 3', 100, ?, ?, 'exam')
    `).run(course.name, course.code, term.name, teacherUser.id, teacherUser.id, term.id, session.id);
    cbtSub = { id: Number(sRes.lastInsertRowid) };
  } else {
    db.prepare("UPDATE subjects SET term_id = ?, session_id = ?, teacher_id = ?, class = 'JSS 3', is_published = 1 WHERE id = ?").run(term.id, session.id, teacherUser.id, cbtSub.id);
  }

  // 2. Create or update Grading Subject
  let gSub = db.prepare("SELECT id FROM grading_subjects WHERE code = ? AND term_id = ? AND session_id = ?").get(course.code, acadTerm.id, session.id) as any;
  if (!gSub) {
    const gRes = db.prepare(`
      INSERT INTO grading_subjects (name, code, class_id, term_id, session_id, teacher_id, mode, source_cbt_subject_id, pass_mark, is_published_to_class)
      VALUES (?, ?, ?, ?, ?, ?, 'exam', ?, 40, 1)
    `).run(course.name, course.code, jss3Class.id, acadTerm.id, session.id, teacherUser.id, cbtSub.id);
    gSub = { id: Number(gRes.lastInsertRowid) };
  } else {
    db.prepare("UPDATE grading_subjects SET class_id = ?, is_published_to_class = 1 WHERE id = ?").run(jss3Class.id, gSub.id);
  }

  // 3. Set standard 40 CA / 60 Exam grading policies
  db.prepare("DELETE FROM grading_policies WHERE grading_subject_id = ?").run(gSub.id);
  
  const pol1 = db.prepare("INSERT INTO grading_policies (grading_subject_id, name, type, max_marks, is_exam) VALUES (?, 'Mid-Term Test', 'manual', 20, 0)").run(gSub.id);
  const pol2 = db.prepare("INSERT INTO grading_policies (grading_subject_id, name, type, max_marks, is_exam) VALUES (?, 'Assignment & Project', 'manual', 10, 0)").run(gSub.id);
  const pol3 = db.prepare("INSERT INTO grading_policies (grading_subject_id, name, type, max_marks, is_exam) VALUES (?, 'Classwork & Quiz', 'manual', 10, 0)").run(gSub.id);
  const pol4 = db.prepare("INSERT INTO grading_policies (grading_subject_id, name, type, max_marks, is_exam) VALUES (?, 'Written Examination', 'manual', 60, 1)").run(gSub.id);

  console.log(`Configured course ${course.name} (${course.code}) with 4 policies.`);

  // 4. Enter realistic scores for all students
  const scoreProfiles = [
    { ca1: 18, ca2: 9, ca3: 9, exam: 52, total: 88, grade: 'A', remark: 'Excellent' },
    { ca1: 16, ca2: 8, ca3: 8, exam: 46, total: 78, grade: 'A', remark: 'Excellent' },
    { ca1: 14, ca2: 7, ca3: 7, exam: 40, total: 68, grade: 'B', remark: 'Very Good' },
    { ca1: 12, ca2: 6, ca3: 6, exam: 34, total: 58, grade: 'C', remark: 'Credit' },
    { ca1: 10, ca2: 5, ca3: 5, exam: 28, total: 48, grade: 'D', remark: 'Pass' },
  ];

  db.prepare("DELETE FROM term_results WHERE grading_subject_id = ? AND term_id = ?").run(gSub.id, acadTerm.id);

  enrolledStudentIds.forEach((sid, idx) => {
    const prof = scoreProfiles[idx % scoreProfiles.length] ?? scoreProfiles[0]!;
    const caTotal = prof.ca1 + prof.ca2 + prof.ca3;
    db.prepare(`
      INSERT INTO term_results (student_id, grading_subject_id, term_id, session_id, ca_score, exam_score, total_score, grade, remark, is_approved)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(sid, gSub.id, acadTerm.id, session.id, caTotal, prof.exam, prof.total, prof.grade, prof.remark);
  });
}

console.log("=== STEP 5: ADDING REPORT CARD REMARKS ===");

const TEACHER_REMARKS = [
  "An exceptionally brilliant student with consistent dedication and focus. Keep up the high standard!",
  "Very good performance this term. Demonstrated strong analytical skills in coursework.",
  "Good result with steady academic improvement throughout the term.",
  "Fair performance. Needs to allocate more study time towards assignments and continuous revision.",
  "Satisfactory academic standing. Encouraged to participate more actively in classroom discussions.",
];

const PRINCIPAL_REMARKS = [
  "Promoted to Senior Secondary School (SS 1) with Distinction. Congratulations!",
  "Promoted to Senior Secondary School (SS 1) with Commendation.",
  "Promoted to Senior Secondary School (SS 1). Maintain this positive momentum.",
  "Promoted to Senior Secondary School (SS 1) on Academic Monitoring.",
  "Promoted to Senior Secondary School (SS 1). Sustained effort is recommended.",
];

enrolledStudentIds.forEach((sid, idx) => {
  const teacherRemark = TEACHER_REMARKS[idx % TEACHER_REMARKS.length] ?? TEACHER_REMARKS[0]!;
  const principalRemark = PRINCIPAL_REMARKS[idx % PRINCIPAL_REMARKS.length] ?? PRINCIPAL_REMARKS[0]!;
  db.prepare(`
    INSERT OR REPLACE INTO student_term_remarks (student_id, term, session_id, term_id, teacher_remark, principal_remark, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  `).run(sid, term.name, session.id, term.id, teacherRemark, principalRemark);
});

console.log("=== STEP 6: SEEDING GUARDIAN ATTENDANCE RECORDS ===");
// Seed realistic 30-day attendance for May–July for enrolled students
const sampleDays = [
  { day: "01", status: "present" },
  { day: "02", status: "present" },
  { day: "05", status: "present" },
  { day: "06", status: "late", remarks: "Traffic delay along Ring Road" },
  { day: "07", status: "present" },
  { day: "08", status: "present" },
  { day: "09", status: "present" },
  { day: "12", status: "present" },
  { day: "13", status: "present" },
  { day: "14", status: "absent", remarks: "Reported fever / medical rest" },
  { day: "15", status: "present" },
  { day: "16", status: "present" },
  { day: "19", status: "present" },
  { day: "20", status: "present" },
  { day: "21", status: "present" },
  { day: "22", status: "present" },
  { day: "23", status: "holiday", remarks: "Democracy Day Observance" },
  { day: "26", status: "present" },
  { day: "27", status: "present" },
  { day: "28", status: "present" },
  { day: "29", status: "present" },
  { day: "30", status: "present" },
];

for (const sid of enrolledStudentIds) {
  for (const sd of sampleDays) {
    const dateStr = `2026-05-${sd.day}`;
    db.prepare(`
      INSERT OR REPLACE INTO attendance_records (student_id, term_id, session_id, date, status, remarks, marked_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    `).run(sid, acadTerm.id, session.id, dateStr, sd.status, sd.remarks || null, teacherUser.id);
  }
}
console.log(`Seeded attendance records for ${enrolledStudentIds.length} students.`);

console.log("=== STEP 7: SEEDING FEE STRUCTURES & PAYMENTS ===");
// Seed JSS 3 fee structures
const feeItems = [
  { title: "First Term Tuition & Academic Instruction", amount: 150000, due_date: "2026-06-30" },
  { title: "CBT Examination & ICT Laboratory Levy", amount: 25000, due_date: "2026-06-30" },
  { title: "PTA Development Fund & Sports Levy", amount: 15000, due_date: "2026-06-30" },
];

db.prepare("DELETE FROM fee_payments WHERE fee_id IN (SELECT id FROM fee_structures WHERE class_id = ?)").run(jss3Class.id);
db.prepare("DELETE FROM fee_structures WHERE class_id = ? AND term_id = ?").run(jss3Class.id, acadTerm.id);
const insertedFeeIds: number[] = [];

for (const item of feeItems) {
  const feeRes = db.prepare(`
    INSERT INTO fee_structures (class_id, term_id, session_id, title, amount, due_date, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(jss3Class.id, acadTerm.id, session.id, item.title, item.amount, item.due_date);
  insertedFeeIds.push(Number(feeRes.lastInsertRowid));
}

// Seed completed payment for tuition + CBT for Default Student
if (guardian && enrolledStudentIds[0] && insertedFeeIds.length >= 2) {
  db.prepare("DELETE FROM fee_payments WHERE student_id = ?").run(enrolledStudentIds[0]);
  db.prepare(`
    INSERT INTO fee_payments (student_id, fee_id, amount_paid, payment_ref, method, status, paid_by, paid_at)
    VALUES (?, ?, 150000, 'PAY-EP-20260515-001', 'bank_transfer', 'completed', ?, '2026-05-15T10:30:00Z')
  `).run(enrolledStudentIds[0], insertedFeeIds[0], guardian.id);

  db.prepare(`
    INSERT INTO fee_payments (student_id, fee_id, amount_paid, payment_ref, method, status, paid_by, paid_at)
    VALUES (?, ?, 25000, 'PAY-EP-20260518-002', 'card', 'completed', ?, '2026-05-18T14:15:00Z')
  `).run(enrolledStudentIds[0], insertedFeeIds[1], guardian.id);
  console.log("Seeded ₦175,000 in fee payments for Default Student.");
}

console.log("=== STEP 8: SEEDING GUARDIAN-TEACHER CHAT THREADS & MESSAGES ===");
if (guardian && teacherUser && enrolledStudentIds[0]) {
  db.prepare("DELETE FROM guardian_message_threads WHERE guardian_id = ? AND recipient_id = ?").run(guardian.id, teacherUser.id);
  
  const threadRes = db.prepare(`
    INSERT INTO guardian_message_threads (guardian_id, recipient_id, student_id, category, subject, last_message, last_message_at, unread_for_guardian, unread_for_recipient)
    VALUES (?, ?, ?, 'teacher', 'Academic Progress & Punctuality', 'Good afternoon Chief Doe, Daniel has shown remarkable enthusiasm in Mathematics this term.', strftime('%Y-%m-%dT%H:%M:%SZ','now'), 0, 0)
  `).run(guardian.id, teacherUser.id, enrolledStudentIds[0]);
  const threadId = Number(threadRes.lastInsertRowid);

  db.prepare(`
    INSERT INTO guardian_messages (thread_id, sender_id, sender_role, text, is_read, created_at)
    VALUES (?, ?, 'guardian', 'Good morning Mr. Adeleke, how is Daniel adapting to the JSS 3 curriculum so far?', 1, '2026-05-20T08:30:00Z')
  `).run(threadId, guardian.id);

  db.prepare(`
    INSERT INTO guardian_messages (thread_id, sender_id, sender_role, text, is_read, created_at)
    VALUES (?, ?, 'teacher', 'Good afternoon Chief Doe, Daniel has shown remarkable enthusiasm in Mathematics this term. His recent test score of 18/20 was among the top in class.', 1, '2026-05-20T11:45:00Z')
  `).run(threadId, teacherUser.id);

  db.prepare(`
    INSERT INTO guardian_messages (thread_id, sender_id, sender_role, text, is_read, created_at)
    VALUES (?, ?, 'guardian', 'Thank you very much for the update. We will ensure he keeps up with the assignments at home.', 1, '2026-05-20T12:10:00Z')
  `).run(threadId, guardian.id);

  console.log(`Seeded conversation thread (ID: ${threadId}) between Guardian and Class Teacher.`);
}

console.log("=== STEP 9: SEEDING UPCOMING CBT TIMETABLE EXAMINATIONS ===");
const timetableExams = [
  { code: "MTH-JSS3", date: "2026-06-15", start: "09:00", end: "11:00", venue: "Computer Lab 1", instr: "Scientific calculators and mathematical geometry sets permitted." },
  { code: "ENG-JSS3", date: "2026-06-16", start: "09:00", end: "11:00", venue: "Examination Hall 2", instr: "Ensure attendance 15 minutes before the session starts." },
  { code: "BST-JSS3", date: "2026-06-18", start: "11:30", end: "13:00", venue: "Computer Lab 1", instr: "Covers Physics, Chemistry, and ICT modules." },
  { code: "CVE-JSS3", date: "2026-06-20", start: "09:00", end: "10:30", venue: "Main Auditorium", instr: "All candidates must be seated by 08:45 AM." },
];

for (const tt of timetableExams) {
  const sub = db.prepare("SELECT id FROM subjects WHERE code = ? LIMIT 1").get(tt.code) as any;
  if (sub) {
    db.prepare("DELETE FROM timetables WHERE subject_id = ?").run(sub.id);
    db.prepare(`
      INSERT INTO timetables (subject_id, class, section, exam_date, start_time, end_time, duration, exam_mode, allow_students, venue, instructions, session_id, term_id)
      VALUES (?, 'JSS 3', '', ?, ?, ?, 90, 'CBT', 1, ?, ?, ?, ?)
    `).run(sub.id, tt.date, tt.start, tt.end, tt.venue, tt.instr, session.id, acadTerm.id);
  }
}
console.log("Seeded 4 timetable examinations for JSS 3.");

console.log("=== DATABASE CLEANUP & DEMO SEEDING COMPLETED SUCCESSFULLY! ===");

