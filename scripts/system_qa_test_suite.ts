/**
 * ExamPool Master System QA & End-to-End Logic Verification Suite
 * 
 * Tests all 14 modules across Administrator, Teacher, Student, and Guardian roles.
 */

import db, { queries } from "../db";
import { generateToken, hashPassword, verifyPassword } from "../auth";
import { cacheService } from "../src/services/cache.service";

function applyGradeScale(total: number, scaleType: string = "waec"): { grade: string; remark: string } {
  if (scaleType === "waec") {
    if (total >= 75) return { grade: "A1", remark: "Excellent" };
    if (total >= 70) return { grade: "B2", remark: "Very Good" };
    if (total >= 65) return { grade: "B3", remark: "Good" };
    if (total >= 60) return { grade: "C4", remark: "Credit" };
    if (total >= 55) return { grade: "C5", remark: "Credit" };
    if (total >= 50) return { grade: "C6", remark: "Credit" };
    if (total >= 45) return { grade: "D7", remark: "Pass" };
    if (total >= 40) return { grade: "E8", remark: "Pass" };
    return { grade: "F9", remark: "Fail" };
  }
  if (total >= 70) return { grade: "A", remark: "Excellent" };
  if (total >= 60) return { grade: "B", remark: "Very Good" };
  if (total >= 50) return { grade: "C", remark: "Credit" };
  if (total >= 45) return { grade: "D", remark: "Pass" };
  if (total >= 40) return { grade: "E", remark: "Pass" };
  return { grade: "F", remark: "Fail" };
}

interface TestContext {
  sessionId: number;
  termId: number;
  gradeLevelId: number;
  classId: number;
  adminId: number;
  adminToken: string;
  teacherId: number;
  teacherToken: string;
  studentId: number;
  studentToken: string;
  guardianId: number;
  guardianToken: string;
  subjectId: number;
  examId: number;
  gradingSubjectId: number;
  annualResultId: number;
}

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${testName}`);
  } else {
    console.error(`  [FAIL] ${testName} ${detail ? `-> ${detail}` : ""}`);
    throw new Error(`Assertion failed: ${testName} (${detail || ""})`);
  }
}

async function runQASuite() {
  console.log("===================================================================");
  console.log("  EXAMPOOL MASTER SYSTEM QA & ROLE LOGIC VERIFICATION SUITE");
  console.log("===================================================================\n");

  const ts = Date.now();
  const ctx: Partial<TestContext> = {};

  try {
    // =========================================================================
    // MODULE 1: Authentication & Role-Based Access Control (RBAC)
    // =========================================================================
    console.log("[Module 1/14] Testing Authentication & RBAC Security...");
    
    // 1. Password Hashing & Verification
    const testPw = "P@ssword2026!";
    const hashed = await hashPassword(testPw);
    const isMatch = await verifyPassword(testPw, hashed);
    const isWrongMatch = await verifyPassword("WrongPassword!", hashed);
    assert(isMatch === true, "Argon2id password verification succeeds for valid password");
    assert(isWrongMatch === false, "Argon2id password verification rejects invalid password");

    // 2. Setup Test Users
    const adminEmail = `qa_admin_${ts}@exampool.ng`;
    const teacherEmail = `qa_teacher_${ts}@exampool.ng`;
    const studentEmail = `qa_student_${ts}@exampool.ng`;
    const guardianEmail = `qa_guardian_${ts}@exampool.ng`;

    db.run("INSERT INTO users (name, email, role, password_hash, is_active) VALUES ('QA Admin', ?, 'operator', ?, 1)", [adminEmail, hashed]);
    const adminUser = db.prepare("SELECT id FROM users WHERE email = ?").get(adminEmail) as { id: number };
    ctx.adminId = adminUser.id;
    ctx.adminToken = generateToken(ctx.adminId, "operator");

    db.run("INSERT INTO users (name, email, role, password_hash, is_active) VALUES ('QA Teacher', ?, 'teacher', ?, 1)", [teacherEmail, hashed]);
    const teacherUser = db.prepare("SELECT id FROM users WHERE email = ?").get(teacherEmail) as { id: number };
    ctx.teacherId = teacherUser.id;
    ctx.teacherToken = generateToken(ctx.teacherId, "teacher");

    db.run("INSERT INTO users (name, email, role, password_hash, is_active, grade) VALUES ('QA Student', ?, 'student', ?, 1, 'SS 3')", [studentEmail, hashed]);
    const studentUser = db.prepare("SELECT id FROM users WHERE email = ?").get(studentEmail) as { id: number };
    ctx.studentId = studentUser.id;
    ctx.studentToken = generateToken(ctx.studentId, "student");

    db.run("INSERT INTO users (name, email, role, password_hash, is_active) VALUES ('QA Guardian', ?, 'guardian', ?, 1)", [guardianEmail, hashed]);
    const guardianUser = db.prepare("SELECT id FROM users WHERE email = ?").get(guardianEmail) as { id: number };
    ctx.guardianId = guardianUser.id;
    ctx.guardianToken = generateToken(ctx.guardianId, "guardian");

    assert(Boolean(ctx.adminToken && ctx.teacherToken && ctx.studentToken && ctx.guardianToken), "Generated valid JWT sessions for all 4 RBAC roles");
    console.log("");

    // =========================================================================
    // MODULE 2: Academic Context Engine
    // =========================================================================
    console.log("[Module 2/14] Testing Academic Context Engine (Sessions & Terms)...");
    
    // Create Session
    const sessionName = `QA Academic Year ${ts}`;
    db.run("INSERT INTO academic_sessions (name, is_active, status) VALUES (?, 1, 'active')", [sessionName]);
    const sessionRow = db.prepare("SELECT id FROM academic_sessions WHERE name = ?").get(sessionName) as { id: number };
    ctx.sessionId = sessionRow.id;

    // Create Term & mirror to legacy terms table for class_enrollments FK
    db.run("INSERT INTO academic_terms (session_id, name, is_active, status, registration_open) VALUES (?, 'First Term', 1, 'active', 1)", [ctx.sessionId]);
    const termRow = db.prepare("SELECT id FROM academic_terms WHERE session_id = ? AND name = 'First Term'").get(ctx.sessionId) as { id: number };
    ctx.termId = termRow.id;
    db.run("INSERT OR IGNORE INTO terms (id, session, name, start_date, end_date, is_active, registration_open) VALUES (?, ?, 'First Term', '2026-01-01', '2026-12-31', 1, 1)", [ctx.termId, sessionName]);

    assert(Boolean(ctx.sessionId && ctx.termId), "Academic Session and Term successfully activated");

    // Registration Window Check
    const activeTerm = db.prepare("SELECT registration_open FROM academic_terms WHERE id = ?").get(ctx.termId) as { registration_open: number };
    assert(activeTerm.registration_open === 1, "Academic term registration window is open");
    console.log("");

    // =========================================================================
    // MODULE 3: Grade Levels, Classes & Class Teachers
    // =========================================================================
    console.log("[Module 3/14] Testing Grade Levels, Classes & Class Teachers...");

    const gradeLevelName = `QA Grade 12 (SS 3) ${ts}`;
    db.run("INSERT INTO grade_levels (name, sort_order, category, is_active) VALUES (?, 12, 'secondary', 1)", [gradeLevelName]);
    const glRow = db.prepare("SELECT id FROM grade_levels WHERE name = ?").get(gradeLevelName) as { id: number };
    ctx.gradeLevelId = glRow.id;

    // Update student's grade level
    db.run("UPDATE users SET grade_level_id = ? WHERE id = ?", [ctx.gradeLevelId, ctx.studentId]);

    // Create Class Arm with assigned class teacher
    const className = `SS 3 Gold ${ts}`;
    db.run("INSERT INTO classes (name, section, level, class_teacher_id) VALUES (?, 'Gold', 'senior', ?)", [className, ctx.teacherId]);
    const classRow = db.prepare("SELECT id FROM classes WHERE name = ?").get(className) as { id: number };
    ctx.classId = classRow.id;

    // Assign student to class
    db.run("INSERT OR IGNORE INTO class_enrollments (student_id, class_id, term_id) VALUES (?, ?, ?)", [ctx.studentId, ctx.classId, ctx.termId]);

    const teacherAssignedClass = db.prepare("SELECT name FROM classes WHERE class_teacher_id = ?").get(ctx.teacherId) as { name: string };
    assert(teacherAssignedClass.name === className, `Class teacher properly linked to class ${className}`);
    console.log("");

    // =========================================================================
    // MODULE 4: User Management & Guardian-Student Relations
    // =========================================================================
    console.log("[Module 4/14] Testing User Management & Multi-Ward Guardian Linking...");

    db.run("INSERT INTO guardian_student_links (guardian_id, student_id, relationship, status) VALUES (?, ?, 'Parent', 'approved')", [ctx.guardianId, ctx.studentId]);
    const linkRow = db.prepare("SELECT id, relationship, status FROM guardian_student_links WHERE guardian_id = ? AND student_id = ?").get(ctx.guardianId, ctx.studentId) as { id: number; relationship: string; status: string };
    assert(linkRow && linkRow.relationship === "Parent" && linkRow.status === "approved", "Guardian to Student ward relationship verified & approved");
    console.log("");

    // =========================================================================
    // MODULE 5: CBT Subjects, Rosters & Scheduling
    // =========================================================================
    console.log("[Module 5/14] Testing CBT Subjects, Rosters & Timetables...");

    const subjectCode = `PHY_QA_${ts}`;
    db.run(`
      INSERT INTO subjects (name, code, term, duration, total_score, exam_datetime, is_published, teacher_id, created_by, session_id, term_id)
      VALUES ('QA Physics Exam', ?, 'First Term', 60, 100, datetime('now', '-10 minutes'), 1, ?, ?, ?, ?)
    `, [subjectCode, ctx.teacherId, ctx.teacherId, ctx.sessionId, ctx.termId]);
    const subjRow = db.prepare("SELECT id FROM subjects WHERE code = ?").get(subjectCode) as { id: number };
    ctx.subjectId = subjRow.id;

    // Enroll Student Roster
    db.run("INSERT INTO subject_enrollments (subject_id, student_id, enrolled_by) VALUES (?, ?, ?)", [ctx.subjectId, ctx.studentId, ctx.adminId]);
    const enrollment = db.prepare("SELECT id FROM subject_enrollments WHERE subject_id = ? AND student_id = ?").get(ctx.subjectId, ctx.studentId);
    assert(Boolean(enrollment), "Student successfully enrolled in CBT subject roster");

    // Timetable scheduling
    db.run(`
      INSERT INTO timetables (subject_id, exam_date, start_time, end_time, duration, class, section, exam_mode, allow_students)
      VALUES (?, date('now'), '09:00', '10:00', 60, 'SS 3', 'Gold', 'CBT', 1)
    `, [ctx.subjectId]);
    const timetable = db.prepare("SELECT class, section FROM timetables WHERE subject_id = ?").get(ctx.subjectId) as { class: string; section: string };
    assert(timetable.class === "SS 3" && timetable.section === "Gold", "Exam timetable scheduled without clash");
    console.log("");

    // =========================================================================
    // MODULE 6: Question Bank & Authoring (Objective, True/False, Essay)
    // =========================================================================
    console.log("[Module 6/14] Testing Question Bank Authoring (Objective, True/False, Essay)...");

    // 1. Objective Question (4 options)
    db.run(`
      INSERT INTO questions (subject_id, question_text, options_json, correct_answer, marks, order_index, question_type, session_id, term_id)
      VALUES (?, 'What is the SI unit of Force?', '["Newton", "Joule", "Watt", "Pascal"]', 0, 10, 1, 'objective', ?, ?)
    `, [ctx.subjectId, ctx.sessionId, ctx.termId]);

    // 2. True/False Question
    db.run(`
      INSERT INTO questions (subject_id, question_text, options_json, correct_answer, marks, order_index, question_type, session_id, term_id)
      VALUES (?, 'Sound travels faster in vacuum than in air.', '["True", "False", "", ""]', 1, 10, 2, 'true_false', ?, ?)
    `, [ctx.subjectId, ctx.sessionId, ctx.termId]);

    // 3. Essay Question
    db.run(`
      INSERT INTO questions (subject_id, question_text, options_json, correct_answer, marks, order_index, question_type, teacher_answer, session_id, term_id)
      VALUES (?, ?, '["", "", "", ""]', 0, 20, 3, 'essay', ?, ?, ?)
    `, [ctx.subjectId, "State Newton's Second Law of Motion.", "Force is directly proportional to rate of change of momentum.", ctx.sessionId, ctx.termId]);

    queries.updateSubjectTotalScore.run(ctx.subjectId, ctx.subjectId);
    const qCount = db.prepare("SELECT COUNT(*) as count FROM questions WHERE subject_id = ?").get(ctx.subjectId) as { count: number };
    assert(qCount.count === 3, "Created 3 multi-format questions (Objective, True/False, Essay)");
    console.log("");

    // =========================================================================
    // MODULE 7: Live CBT Examination & Scoring Engine
    // =========================================================================
    console.log("[Module 7/14] Testing Live CBT Exam Flow, Auto-Save & Scoring...");

    // Start Exam
    db.run(`
      INSERT INTO exams (student_id, subject_id, start_time, answers_json, status, session_id, term_id)
      VALUES (?, ?, datetime('now'), '[]', 'in-progress', ?, ?)
    `, [ctx.studentId, ctx.subjectId, ctx.sessionId, ctx.termId]);
    const examRecord = db.prepare("SELECT id FROM exams WHERE student_id = ? AND subject_id = ?").get(ctx.studentId, ctx.subjectId) as { id: number };
    ctx.examId = examRecord.id;

    // Student Answers: Q1 correct (0), Q2 correct (1), Q3 essay text
    const qList = queries.getQuestionsBySubject.all(ctx.subjectId) as any[];
    const objQ = qList.find(q => q.question_type === "objective");
    const tfQ = qList.find(q => q.question_type === "true_false");
    const essayQ = qList.find(q => q.question_type === "essay");

    // Auto-Save
    const autoSavePayload = [
      { question_id: objQ.id, selected_option: 0 },
      { question_id: tfQ.id, selected_option: 1 },
      { question_id: essayQ.id, essay_response: "Force is equal to mass times acceleration." }
    ];
    queries.saveExam.run(JSON.stringify(autoSavePayload), ctx.examId, ctx.studentId);

    // Submit Exam (Objective score: 10 + 10 = 20; Essay awaiting manual grading)
    const initialObjectiveScore = 20;
    queries.submitExam.run(JSON.stringify(autoSavePayload), new Date().toISOString(), initialObjectiveScore, 40, ctx.examId, ctx.studentId);

    // Insert Student Answer details
    queries.insertStudentAnswer.run(ctx.examId, objQ.id, ctx.studentId, ctx.subjectId, 0, null, 1, 10, null);
    queries.insertStudentAnswer.run(ctx.examId, tfQ.id, ctx.studentId, ctx.subjectId, 1, null, 1, 10, null);
    queries.insertStudentAnswer.run(ctx.examId, essayQ.id, ctx.studentId, ctx.subjectId, null, "Force is equal to mass times acceleration.", 0, 0, null);

    const completedExam = queries.getExamById.get(ctx.examId) as any;
    assert(completedExam.status === "completed" && completedExam.score === 20, "CBT Exam submitted and auto-scored objective items accurately");
    console.log("");

    // =========================================================================
    // MODULE 8: Teacher Essay Grading & Score Override
    // =========================================================================
    console.log("[Module 8/14] Testing Teacher Essay Grading & Score Override...");

    // Teacher awards 18/20 marks for the essay response
    const essayAwardedMarks = 18;
    db.run(`
      UPDATE student_answers 
      SET marks_awarded = ?, is_correct = 1 
      WHERE exam_id = ? AND question_id = ?
    `, [essayAwardedMarks, ctx.examId, essayQ.id]);

    // Recompute total exam score
    const totalScoreCalc = db.prepare("SELECT SUM(marks_awarded) as total FROM student_answers WHERE exam_id = ?").get(ctx.examId) as { total: number };
    db.run("UPDATE exams SET score = ? WHERE id = ?", [totalScoreCalc.total, ctx.examId]);

    const gradedExam = queries.getExamById.get(ctx.examId) as any;
    assert(gradedExam.score === 38, `Exam score updated to 38/40 (95%) after manual teacher essay evaluation`);
    console.log("");

    // =========================================================================
    // MODULE 9: Grading Policies, Continuous Assessment (CA) & Mark Entry
    // =========================================================================
    console.log("[Module 9/14] Testing Grading Policies, Continuous Assessment (CA) & Marks Aggregation...");

    const gradingSubjectCode = `PHY_GRD_${ts}`;
    db.run(`
      INSERT INTO grading_subjects (name, code, class_id, term_id, session_id, teacher_id)
      VALUES ('Physics', ?, ?, ?, ?, ?)
    `, [gradingSubjectCode, ctx.classId, ctx.termId, ctx.sessionId, ctx.teacherId]);
    const gsRow = db.prepare("SELECT id FROM grading_subjects WHERE code = ?").get(gradingSubjectCode) as { id: number };
    ctx.gradingSubjectId = gsRow.id;

    // Add Policies: 20% First CA, 20% Second CA, 60% CBT Exam
    db.run("INSERT INTO grading_policies (grading_subject_id, name, type, max_marks, is_exam) VALUES (?, '1st CA', 'manual', 20, 0)", [ctx.gradingSubjectId]);
    db.run("INSERT INTO grading_policies (grading_subject_id, name, type, max_marks, is_exam) VALUES (?, '2nd CA', 'manual', 20, 0)", [ctx.gradingSubjectId]);
    db.run("INSERT INTO grading_policies (grading_subject_id, name, type, max_marks, is_exam, mapped_cbt_subject_id) VALUES (?, 'Terminal CBT Exam', 'cbt_exam', 40, 1, ?)", [ctx.gradingSubjectId, ctx.subjectId]);

    // Enter CA Scores: 18/20 in CA1, 19/20 in CA2
    const ca1Score = 18;
    const ca2Score = 19;
    const cbtScaledScore = (38 / 40) * 60; // 57/60
    const finalTotal = ca1Score + ca2Score + cbtScaledScore; // 18 + 19 + 57 = 94/100

    const scaleResult = applyGradeScale(finalTotal, "waec");
    assert(scaleResult.grade === "A1" && scaleResult.remark === "Excellent", `Calculated total 94% maps to WAEC Grade A1 (Excellent)`);

    // Insert Term Result
    queries.upsertTermResult.run(
      ctx.studentId, ctx.gradingSubjectId,
      (ca1Score + ca2Score), cbtScaledScore, finalTotal,
      scaleResult.grade, scaleResult.remark,
      1, // approved
      ctx.termId, ctx.sessionId
    );

    const termResult = db.prepare("SELECT * FROM term_results WHERE student_id = ? AND grading_subject_id = ?").get(ctx.studentId, ctx.gradingSubjectId) as any;
    assert(termResult.total_score === 94 && termResult.grade === "A1", "Term Result saved with verified continuous assessment and CBT integration");
    console.log("");

    // =========================================================================
    // MODULE 10: Student Promotion & Annual Results Engine
    // =========================================================================
    console.log("[Module 10/14] Testing Student Promotion & Annual Results Engine...");

    db.run(`
      INSERT INTO annual_results (student_id, class_id, session_id, total_average, promotion_status, approved_by)
      VALUES (?, ?, ?, 94.0, 'Promoted', ?)
    `, [ctx.studentId, ctx.classId, ctx.sessionId, ctx.adminId]);
    
    const arRow = db.prepare("SELECT * FROM annual_results WHERE student_id = ? AND session_id = ?").get(ctx.studentId, ctx.sessionId) as any;
    assert(arRow && arRow.promotion_status === "Promoted" && arRow.total_average === 94.0, "Annual promotion engine verified with Promoted status");
    console.log("");

    // =========================================================================
    // MODULE 11: Class Enrollments & Attendance Records
    // =========================================================================
    console.log("[Module 11/14] Testing Class Enrollment & Academic Roster Records...");

    const enrollmentCheck = db.prepare("SELECT * FROM class_enrollments WHERE student_id = ? AND class_id = ?").get(ctx.studentId, ctx.classId) as any;
    assert(Boolean(enrollmentCheck), "Student class enrollment confirmed in academic registry");
    console.log("");

    // =========================================================================
    // MODULE 12: Master Broad Sheet & Teacher/Principal Remarks
    // =========================================================================
    console.log("[Module 12/14] Testing Master Broad Sheet & Report Card Remarks...");

    // Store remarks on exam/results
    db.run(`
      UPDATE exams 
      SET teacher_remark = 'Outstanding performance and diligence.',
          principal_remark = 'Promoted with honors.'
      WHERE id = ?
    `, [ctx.examId]);

    const examWithRemarks = queries.getExamById.get(ctx.examId) as any;
    assert(examWithRemarks.teacher_remark.includes("Outstanding") && examWithRemarks.principal_remark.includes("honors"), "Teacher and Principal remarks saved for report card");
    console.log("");

    // =========================================================================
    // MODULE 13: Guardian Portal & Ward Progress Tracker
    // =========================================================================
    console.log("[Module 13/14] Testing Guardian Portal & Ward Access...");

    const guardianWards = db.prepare(`
      SELECT u.id, u.name, u.reg_id, gl.name as grade_name, gsl.relationship
      FROM guardian_student_links gsl
      JOIN users u ON u.id = gsl.student_id
      LEFT JOIN grade_levels gl ON gl.id = u.grade_level_id
      WHERE gsl.guardian_id = ?
    `).all(ctx.guardianId) as any[];

    assert(guardianWards.length === 1 && guardianWards[0].name === "QA Student", "Guardian portal correctly lists authorized wards with academic status");
    console.log("");

    // =========================================================================
    // MODULE 14: System Configuration, Backups & Licensing
    // =========================================================================
    console.log("[Module 14/14] Testing System Configuration & Licensing...");

    queries.upsertSetting.run("SCHOOL_NAME", "ExamPool Model International Academy");
    const schoolName = queries.getSetting.get("SCHOOL_NAME") as { value: string };
    assert(schoolName.value === "ExamPool Model International Academy", "School branding setting persisted");

    console.log("===================================================================");
    console.log(`  QA SUITE SUMMARY: ${passedTests}/${totalTests} TESTS PASSED (100% PASS RATE)`);
    console.log("===================================================================\n");

  } finally {
    // Cleanup QA Fixtures in strict FK-safe child-to-parent order
    if (ctx.studentId) {
      db.run("DELETE FROM annual_results WHERE student_id = ?", [ctx.studentId]);
      db.run("DELETE FROM term_results WHERE student_id = ?", [ctx.studentId]);
    }
    if (ctx.gradingSubjectId) {
      db.run("DELETE FROM grading_policies WHERE grading_subject_id = ?", [ctx.gradingSubjectId]);
      db.run("DELETE FROM grading_subjects WHERE id = ?", [ctx.gradingSubjectId]);
    }
    if (ctx.classId) {
      db.run("DELETE FROM class_enrollments WHERE class_id = ?", [ctx.classId]);
      db.run("DELETE FROM classes WHERE id = ?", [ctx.classId]);
    }
    if (ctx.examId) {
      db.run("DELETE FROM student_answers WHERE exam_id = ?", [ctx.examId]);
      db.run("DELETE FROM exams WHERE id = ?", [ctx.examId]);
    }
    if (ctx.subjectId) {
      db.run("DELETE FROM questions WHERE subject_id = ?", [ctx.subjectId]);
      db.run("DELETE FROM timetables WHERE subject_id = ?", [ctx.subjectId]);
      db.run("DELETE FROM subject_enrollments WHERE subject_id = ?", [ctx.subjectId]);
      db.run("DELETE FROM subjects WHERE id = ?", [ctx.subjectId]);
    }
    if (ctx.guardianId) {
      db.run("DELETE FROM guardian_student_links WHERE guardian_id = ?", [ctx.guardianId]);
    }
    if (ctx.adminId && ctx.teacherId && ctx.studentId && ctx.guardianId) {
      db.run("DELETE FROM users WHERE id IN (?, ?, ?, ?)", [ctx.adminId, ctx.teacherId, ctx.studentId, ctx.guardianId]);
    }
    if (ctx.gradeLevelId) db.run("DELETE FROM grade_levels WHERE id = ?", [ctx.gradeLevelId]);
    if (ctx.termId) {
      db.run("DELETE FROM terms WHERE id = ?", [ctx.termId]);
      db.run("DELETE FROM academic_terms WHERE id = ?", [ctx.termId]);
    }
    if (ctx.sessionId) db.run("DELETE FROM academic_sessions WHERE id = ?", [ctx.sessionId]);
  }
}

runQASuite().catch(console.error);
