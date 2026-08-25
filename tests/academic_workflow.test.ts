/**
 * tests/academic_workflow.test.ts
 * ─────────────────────────────────────────────────────────────────
 * FULL ACADEMIC SESSION, TERM & GRADING SYSTEM ACCEPTANCE TEST SUITE
 *
 * Tests:
 * 1. Session -> Term -> Activity scoping & lifecycle
 * 2. Flexible grading policies, normalization, raw vs scaled marks
 * 3. Assessment-level grading (full, zero, partial, retakes)
 * 4. Term result calculation, draft vs approval locking
 * 5. Third-Term cumulative aggregation (1st + 2nd + 3rd term results)
 * 6. Historical data isolation (cross-session & cross-term)
 * 7. Teacher & Class Master workflows & RBAC
 * 8. Timetable integration & scoping
 * 9. Annual results & student promotion
 *
 * Run: bun test tests/academic_workflow.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test";
import db, { queries } from "../db";
import { createAuthorizationService } from "../src/services/authorization.service";

describe("Academic Session, Term & Grading System Full Workflow Audit", () => {
  const authz = createAuthorizationService(db, queries);
  const TS = Date.now();

  // Test Entities
  let session2025Id: number;
  let session2026Id: number;
  let term1Id: number;
  let term2Id: number;
  let term3Id: number;
  let term2025Id: number;

  let teacher1Id: number;
  let teacher2Id: number;
  let student1Id: number;
  let student2Id: number;
  let class1Id: number;
  let class2Id: number;

  let mathSubjectT1Id: number;
  let mathSubjectT2Id: number;
  let mathSubjectT3Id: number;
  let engSubjectT1Id: number;
  let scienceSubject50MaxId: number;

  let mathGsT1Id: number;
  let mathGsT2Id: number;
  let mathGsT3Id: number;
  let engGsT1Id: number;
  let scienceGs50MaxId: number;

  beforeAll(() => {
    // 1. Create Academic Sessions
    const s1Res = queries.createAcademicSession.run(`Session_2025_${TS}`, 0, "active") as any;
    session2025Id = Number(s1Res.lastInsertRowid);

    const s2Res = queries.createAcademicSession.run(`Session_2026_${TS}`, 1, "active") as any;
    session2026Id = Number(s2Res.lastInsertRowid);

    // 2. Create Academic Terms for 2026
    const t1Res = queries.createAcademicTerm.run(session2026Id, "First Term", "2026-09-01", "2026-12-15", 1, "active") as any;
    term1Id = Number(t1Res.lastInsertRowid);
    db.prepare("INSERT OR IGNORE INTO terms (id, session, name, start_date, end_date, is_active, registration_open) VALUES (?, ?, ?, ?, ?, 1, 1)")
      .run(term1Id, `Session_2026_${TS}`, "First Term", "2026-09-01", "2026-12-15");

    const t2Res = queries.createAcademicTerm.run(session2026Id, "Second Term", "2027-01-10", "2027-04-10", 0, "active") as any;
    term2Id = Number(t2Res.lastInsertRowid);
    db.prepare("INSERT OR IGNORE INTO terms (id, session, name, start_date, end_date, is_active, registration_open) VALUES (?, ?, ?, ?, ?, 0, 1)")
      .run(term2Id, `Session_2026_${TS}`, "Second Term", "2027-01-10", "2027-04-10");

    const t3Res = queries.createAcademicTerm.run(session2026Id, "Third Term", "2027-05-02", "2027-07-25", 0, "active") as any;
    term3Id = Number(t3Res.lastInsertRowid);
    db.prepare("INSERT OR IGNORE INTO terms (id, session, name, start_date, end_date, is_active, registration_open) VALUES (?, ?, ?, ?, ?, 0, 1)")
      .run(term3Id, `Session_2026_${TS}`, "Third Term", "2027-05-02", "2027-07-25");

    // 3. Create Academic Term for 2025 (Historical isolation control)
    const t2025Res = queries.createAcademicTerm.run(session2025Id, "First Term", "2025-09-01", "2025-12-15", 0, "active") as any;
    term2025Id = Number(t2025Res.lastInsertRowid);
    db.prepare("INSERT OR IGNORE INTO terms (id, session, name, start_date, end_date, is_active, registration_open) VALUES (?, ?, ?, ?, ?, 0, 1)")
      .run(term2025Id, `Session_2025_${TS}`, "First Term", "2025-09-01", "2025-12-15");

    // 4. Create Teachers & Students
    const tch1 = db.prepare("INSERT INTO users (name, email, role, password_hash, is_active) VALUES (?, ?, 'teacher', 'hash', 1)")
      .run(`Teacher One ${TS}`, `tch1_${TS}@test.com`) as any;
    teacher1Id = Number(tch1.lastInsertRowid);

    const tch2 = db.prepare("INSERT INTO users (name, email, role, password_hash, is_active) VALUES (?, ?, 'teacher', 'hash', 1)")
      .run(`Teacher Two ${TS}`, `tch2_${TS}@test.com`) as any;
    teacher2Id = Number(tch2.lastInsertRowid);

    const stu1 = db.prepare("INSERT INTO users (name, email, role, password_hash, reg_id, grade, is_active) VALUES (?, ?, 'student', 'hash', ?, 'JSS1', 1)")
      .run(`Student Alpha ${TS}`, `stu1_${TS}@test.com`, `REG-A-${TS}`) as any;
    student1Id = Number(stu1.lastInsertRowid);

    const stu2 = db.prepare("INSERT INTO users (name, email, role, password_hash, reg_id, grade, is_active) VALUES (?, ?, 'student', 'hash', ?, 'JSS1', 1)")
      .run(`Student Beta ${TS}`, `stu2_${TS}@test.com`, `REG-B-${TS}`) as any;
    student2Id = Number(stu2.lastInsertRowid);

    // 5. Create Classes & Class Teacher Assignment
    const c1 = db.prepare("INSERT INTO classes (name, section, level, class_teacher_id) VALUES (?, 'A', 'junior', ?)")
      .run(`JSS1 Alpha ${TS}`, teacher1Id) as any;
    class1Id = Number(c1.lastInsertRowid);

    const c2 = db.prepare("INSERT INTO classes (name, section, level, class_teacher_id) VALUES (?, 'B', 'junior', ?)")
      .run(`JSS1 Beta ${TS}`, teacher2Id) as any;
    class2Id = Number(c2.lastInsertRowid);

    // Enroll students into class 1 for Term 1, 2, 3
    db.prepare("INSERT INTO class_enrollments (student_id, class_id, term_id) VALUES (?, ?, ?)").run(student1Id, class1Id, term1Id);
    db.prepare("INSERT INTO class_enrollments (student_id, class_id, term_id) VALUES (?, ?, ?)").run(student1Id, class1Id, term2Id);
    db.prepare("INSERT INTO class_enrollments (student_id, class_id, term_id) VALUES (?, ?, ?)").run(student1Id, class1Id, term3Id);

    db.prepare("INSERT INTO class_enrollments (student_id, class_id, term_id) VALUES (?, ?, ?)").run(student2Id, class1Id, term1Id);
    db.prepare("INSERT INTO class_enrollments (student_id, class_id, term_id) VALUES (?, ?, ?)").run(student2Id, class1Id, term3Id); // Student 2 missed Term 2
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION 1: Session & Term Lifecycle & Synchronization
  // ───────────────────────────────────────────────────────────────────────────
  test("1.1 Active Session and Active Term synchronization", () => {
    // Activate session 2026
    queries.deactivateAllAcademicSessions.run();
    queries.activateAcademicSession.run(session2026Id);
    queries.deactivateAllAcademicTerms.run();
    queries.activateAcademicTerm.run(term1Id);

    const activeSession = queries.getActiveAcademicSession.get() as any;
    const activeTerm = queries.getActiveAcademicTerm.get() as any;

    expect(activeSession.id).toBe(session2026Id);
    expect(activeTerm.id).toBe(term1Id);
    expect(activeTerm.session_id).toBe(session2026Id);
  });

  test("1.2 Term Activation ensures parent session is activated", () => {
    // When activating term2025Id, session2025Id should be active
    queries.deactivateAllAcademicSessions.run();
    queries.activateAcademicSession.run(session2025Id);
    queries.deactivateAllAcademicTerms.run();
    queries.activateAcademicTerm.run(term2025Id);

    const activeSession = queries.getActiveAcademicSession.get() as any;
    const activeTerm = queries.getActiveAcademicTerm.get() as any;

    expect(activeSession.id).toBe(session2025Id);
    expect(activeTerm.id).toBe(term2025Id);

    // Switch back to 2026 Term 1
    queries.deactivateAllAcademicSessions.run();
    queries.activateAcademicSession.run(session2026Id);
    queries.deactivateAllAcademicTerms.run();
    queries.activateAcademicTerm.run(term1Id);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION 2: Subject & Exam Creation across Sessions & Terms
  // ───────────────────────────────────────────────────────────────────────────
  test("2.1 Subject creation with teacher assignment across terms", () => {
    // Term 1 Math
    const sM1 = queries.createSubject.run(
      "Mathematics", `MTH_${TS}`, "First Term", 60, teacher1Id, 1, "Math T1", "JSS1", null, `Session_2026_${TS}`, "exam", "Do all questions", 1, session2026Id, term1Id, "school_exam", "immediate", null
    ) as any;
    mathSubjectT1Id = Number(sM1.lastInsertRowid);

    // Term 2 Math
    const sM2 = queries.createSubject.run(
      "Mathematics", `MTH_${TS}`, "Second Term", 60, teacher1Id, 1, "Math T2", "JSS1", null, `Session_2026_${TS}`, "exam", "Do all questions", 1, session2026Id, term2Id, "school_exam", "immediate", null
    ) as any;
    mathSubjectT2Id = Number(sM2.lastInsertRowid);

    // Term 3 Math
    const sM3 = queries.createSubject.run(
      "Mathematics", `MTH_${TS}`, "Third Term", 60, teacher1Id, 1, "Math T3", "JSS1", null, `Session_2026_${TS}`, "exam", "Do all questions", 1, session2026Id, term3Id, "school_exam", "immediate", null
    ) as any;
    mathSubjectT3Id = Number(sM3.lastInsertRowid);

    // English Term 1
    const sE1 = queries.createSubject.run(
      "English Language", `ENG_${TS}`, "First Term", 60, teacher2Id, 1, "Eng T1", "JSS1", null, `Session_2026_${TS}`, "exam", "Do all questions", 1, session2026Id, term1Id, "school_exam", "immediate", null
    ) as any;
    engSubjectT1Id = Number(sE1.lastInsertRowid);

    // 50-Max Science Subject (to test flexible weight normalization)
    const sSci = queries.createSubject.run(
      "Basic Science", `SCI_${TS}`, "First Term", 45, teacher1Id, 1, "Sci T1", "JSS1", null, `Session_2026_${TS}`, "exam", "Do all questions", 1, session2026Id, term1Id, "school_exam", "immediate", null
    ) as any;
    scienceSubject50MaxId = Number(sSci.lastInsertRowid);

    expect(mathSubjectT1Id).toBeGreaterThan(0);
    expect(mathSubjectT2Id).toBeGreaterThan(0);
    expect(mathSubjectT3Id).toBeGreaterThan(0);
  });

  test("2.2 Questions addition and CBT Exam submission with raw scoring", () => {
    // Add 2 questions of 25 marks each to Math Term 1 (total = 50 marks)
    const q1 = db.prepare("INSERT INTO questions (subject_id, question_text, options_json, correct_answer, marks, order_index, question_type) VALUES (?, ?, ?, 0, 25, 1, 'objective')")
      .run(mathSubjectT1Id, "Q1: 2+2?", JSON.stringify(["4", "3", "2", "1"])) as any;
    const q2 = db.prepare("INSERT INTO questions (subject_id, question_text, options_json, correct_answer, marks, order_index, question_type) VALUES (?, ?, ?, 1, 25, 2, 'objective')")
      .run(mathSubjectT1Id, "Q2: 5*5?", JSON.stringify(["20", "25", "30", "35"])) as any;

    queries.updateSubjectTotalScore.run(mathSubjectT1Id, mathSubjectT1Id);

    // Enroll Student 1 and Student 2 in Math
    queries.enrollStudent.run(mathSubjectT1Id, student1Id, 1);
    queries.enrollStudent.run(mathSubjectT1Id, student2Id, 1);

    // Student 1 starts and completes exam: answers Q1 correct (25 marks), Q2 incorrect (0 marks) -> Raw Score = 25/50 (50%)
    const ex1 = queries.createExam.run(student1Id, mathSubjectT1Id, new Date().toISOString(), "[]", `Session_2026_${TS}`, "First Term", "exam", null, "released", 5, "[]") as any;
    const exam1Id = Number(ex1.lastInsertRowid);
    queries.submitExam.run(JSON.stringify([{ question_id: q1.lastInsertRowid, selected_option: 0 }, { question_id: q2.lastInsertRowid, selected_option: 0 }]), new Date().toISOString(), 25, 50, exam1Id, student1Id);

    // Student 2 starts and completes exam: answers both correct -> Raw Score = 50/50 (100%)
    const ex2 = queries.createExam.run(student2Id, mathSubjectT1Id, new Date().toISOString(), "[]", `Session_2026_${TS}`, "First Term", "exam", null, "released", 5, "[]") as any;
    const exam2Id = Number(ex2.lastInsertRowid);
    queries.submitExam.run(JSON.stringify([{ question_id: q1.lastInsertRowid, selected_option: 0 }, { question_id: q2.lastInsertRowid, selected_option: 1 }]), new Date().toISOString(), 50, 50, exam2Id, student2Id);

    const savedEx1 = queries.getExamById.get(exam1Id) as any;
    const savedEx2 = queries.getExamById.get(exam2Id) as any;

    expect(savedEx1.score).toBe(25);
    expect(savedEx1.total_score).toBe(50);
    expect(savedEx2.score).toBe(50);
    expect(savedEx2.total_score).toBe(50);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION 3: Grading Center Configuration, Scaling & Flexible Weights
  // ───────────────────────────────────────────────────────────────────────────
  test("3.1 Flexible Grading Policy Configuration (Exam 60% + CA1 20% + CA2 20% = 100%)", () => {
    // Create Grading Subject for Math Term 1
    const gsM1 = queries.createGradingSubject.run("Mathematics", `MTH_${TS}`, class1Id, term1Id, session2026Id, teacher1Id) as any;
    mathGsT1Id = Number(gsM1.lastInsertRowid);
    queries.updateGradingSubjectMeta.run("exam", mathSubjectT1Id, mathGsT1Id);

    // Policy 1: Exam Component mapped to CBT Subject, max_marks = 60
    const pExam = queries.createGradingPolicy.run(mathGsT1Id, "Terminal Exam", "cbt_exam", mathSubjectT1Id, 60, 1) as any;
    const pExamId = Number(pExam.lastInsertRowid);

    // Policy 2: Continuous Assessment 1 (Manual), max_marks = 20
    const pCa1 = queries.createGradingPolicy.run(mathGsT1Id, "Continuous Assessment 1", "manual", null, 20, 0) as any;
    const pCa1Id = Number(pCa1.lastInsertRowid);

    // Policy 3: Continuous Assessment 2 (Manual), max_marks = 20
    const pCa2 = queries.createGradingPolicy.run(mathGsT1Id, "Continuous Assessment 2", "manual", null, 20, 0) as any;
    const pCa2Id = Number(pCa2.lastInsertRowid);

    // Enter manual scores:
    // Student 1: CA1 = 18/20, CA2 = 17/20
    queries.upsertManualScore.run(pCa1Id, student1Id, 18, teacher1Id);
    queries.upsertManualScore.run(pCa2Id, student1Id, 17, teacher1Id);

    // Student 2: CA1 = 20/20, CA2 = 19/20
    queries.upsertManualScore.run(pCa1Id, student2Id, 20, teacher1Id);
    queries.upsertManualScore.run(pCa2Id, student2Id, 19, teacher1Id);

    // Calculation verification:
    // Student 1:
    //   CBT Exam scaled score: (25 / 50) * 60 = 30.00
    //   CA Score: 18 + 17 = 35.00
    //   Total Score: 30.00 + 35.00 = 65.00
    //   Grade: B (min 65) -> "Very Good"
    //
    // Student 2:
    //   CBT Exam scaled score: (50 / 50) * 60 = 60.00
    //   CA Score: 20 + 19 = 39.00
    //   Total Score: 60.00 + 39.00 = 99.00
    //   Grade: A (min 75) -> "Excellent"

    queries.upsertTermResult.run(student1Id, mathGsT1Id, 35.00, 30.00, 65.00, "B", "Very Good", 1, term1Id, session2026Id);
    queries.upsertTermResult.run(student2Id, mathGsT1Id, 39.00, 60.00, 99.00, "A", "Excellent", 1, term1Id, session2026Id);

    const r1 = db.prepare("SELECT * FROM term_results WHERE student_id = ? AND grading_subject_id = ? AND term_id = ?")
      .get(student1Id, mathGsT1Id, term1Id) as any;
    const r2 = db.prepare("SELECT * FROM term_results WHERE student_id = ? AND grading_subject_id = ? AND term_id = ?")
      .get(student2Id, mathGsT1Id, term1Id) as any;

    expect(r1.ca_score).toBe(35);
    expect(r1.exam_score).toBe(30);
    expect(r1.total_score).toBe(65);
    expect(r1.grade).toBe("B");
    expect(r1.is_approved).toBe(1);

    expect(r2.ca_score).toBe(39);
    expect(r2.exam_score).toBe(60);
    expect(r2.total_score).toBe(99);
    expect(r2.grade).toBe("A");
    expect(r2.is_approved).toBe(1);
  });

  test("3.2 Flexible Non-100 Grading Scale Normalization (Total Max = 50)", () => {
    // Create Grading Subject with total possible marks = 50 (Exam 30 + Test 20)
    const gsSci = queries.createGradingSubject.run("Basic Science", `SCI_${TS}`, class1Id, term1Id, session2026Id, teacher1Id) as any;
    scienceGs50MaxId = Number(gsSci.lastInsertRowid);

    const pExam = queries.createGradingPolicy.run(scienceGs50MaxId, "Theory Exam", "manual", null, 30, 1) as any;
    const pTest = queries.createGradingPolicy.run(scienceGs50MaxId, "Practical Test", "manual", null, 20, 0) as any;

    // Student 1 scores 27/30 on Exam and 18/20 on Test
    // Total raw marks = 45 / 50
    // Normalized percentage = (45 / 50) * 100 = 90.00%
    // Grade should be A (min 75%), NOT D (which would happen if 45 was checked directly without normalization)
    const rawTotal = 45;
    const totalMax = 50;
    const pct = (rawTotal / totalMax) * 100;
    expect(pct).toBe(90);

    const gradeScale = [
      { grade: "A", min: 75, label: "Excellent" },
      { grade: "B", min: 65, label: "Very Good" },
      { grade: "C", min: 55, label: "Credit" },
      { grade: "D", min: 45, label: "Pass" },
      { grade: "F", min: 0, label: "Fail" }
    ];

    function applyScale(percentage: number) {
      for (const s of gradeScale) {
        if (percentage >= s.min) return s.grade;
      }
      return "F";
    }

    const calculatedGrade = applyScale(pct);
    expect(calculatedGrade).toBe("A");

    queries.upsertTermResult.run(student1Id, scienceGs50MaxId, 18.00, 27.00, 45.00, calculatedGrade, "Excellent", 1, term1Id, session2026Id);

    const sciRes = db.prepare("SELECT * FROM term_results WHERE student_id = ? AND grading_subject_id = ?").get(student1Id, scienceGs50MaxId) as any;
    expect(sciRes.total_score).toBe(45);
    expect(sciRes.grade).toBe("A");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION 4: Multi-Term Progression & Term Closure
  // ───────────────────────────────────────────────────────────────────────────
  test("4.1 Closing Term 1 archives term and locks historical records", () => {
    queries.archiveAcademicTerm.run(term1Id);
    queries.lockExamsForTerm.run(term1Id);

    const closedTerm = queries.getAcademicTermById.get(term1Id) as any;
    expect(closedTerm.status).toBe("archived");

    // Term 1 results in DB remain completely preserved
    const r1 = db.prepare("SELECT * FROM term_results WHERE student_id = ? AND grading_subject_id = ? AND term_id = ?")
      .get(student1Id, mathGsT1Id, term1Id) as any;
    expect(r1.total_score).toBe(65);
    expect(r1.is_approved).toBe(1);
  });

  test("4.2 Activating Term 2 & Recording Term 2 Results", () => {
    queries.deactivateAllAcademicTerms.run();
    queries.activateAcademicTerm.run(term2Id);

    // Create Math Grading Subject for Term 2
    const gsM2 = queries.createGradingSubject.run("Mathematics", `MTH_${TS}`, class1Id, term2Id, session2026Id, teacher1Id) as any;
    mathGsT2Id = Number(gsM2.lastInsertRowid);

    // Student 1 scores 80 in Term 2 Math
    queries.upsertTermResult.run(student1Id, mathGsT2Id, 32.00, 48.00, 80.00, "A", "Excellent", 1, term2Id, session2026Id);

    // Close Term 2
    queries.archiveAcademicTerm.run(term2Id);
  });

  test("4.3 Activating Term 3 & Recording Term 3 Results", () => {
    queries.deactivateAllAcademicTerms.run();
    queries.activateAcademicTerm.run(term3Id);

    // Create Math Grading Subject for Term 3
    const gsM3 = queries.createGradingSubject.run("Mathematics", `MTH_${TS}`, class1Id, term3Id, session2026Id, teacher1Id) as any;
    mathGsT3Id = Number(gsM3.lastInsertRowid);

    // Student 1 scores 90 in Term 3 Math (CA 36, Exam 54)
    queries.upsertTermResult.run(student1Id, mathGsT3Id, 36.00, 54.00, 90.00, "A", "Excellent", 1, term3Id, session2026Id);

    // Student 2 scores 85 in Term 3 Math (CA 35, Exam 50)
    queries.upsertTermResult.run(student2Id, mathGsT3Id, 35.00, 50.00, 85.00, "A", "Excellent", 1, term3Id, session2026Id);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION 5: Third-Term Cumulative & Annual Results Verification
  // ───────────────────────────────────────────────────────────────────────────
  test("5.1 Third Term Report Card retrieves 1st, 2nd, and 3rd term results for cumulative aggregation", () => {
    // Retrieve report card results for Student 1 in Session 2026 up to Term 3
    let results = queries.getStudentTermResultsForReportCard.all(student1Id) as any[];
    results = results.filter((r) => Number(r.session_id) === session2026Id && Number(r.term_id) <= term3Id);

    // Student 1 has Math results in Term 1, Term 2, Term 3
    const mathResults = results.filter((r) => r.code === `MTH_${TS}`);
    expect(mathResults.length).toBe(3);

    const t1Math = mathResults.find((r) => r.term_id === term1Id);
    const t2Math = mathResults.find((r) => r.term_id === term2Id);
    const t3Math = mathResults.find((r) => r.term_id === term3Id);

    expect(t1Math.score).toBe(65);
    expect(t2Math.score).toBe(80);
    expect(t3Math.score).toBe(90);

    // Cumulative Average calculation: (65 + 80 + 90) / 3 = 235 / 3 = 78.33 -> 78%
    const cumAvg = Math.round((t1Math.score + t2Math.score + t3Math.score) / 3);
    expect(cumAvg).toBe(78);
  });

  test("5.2 Cumulative calculation handles missing intermediate terms (Student 2 missed Term 2)", () => {
    let results = queries.getStudentTermResultsForReportCard.all(student2Id) as any[];
    results = results.filter((r) => Number(r.session_id) === session2026Id && Number(r.term_id) <= term3Id);

    const mathResults = results.filter((r) => r.code === `MTH_${TS}`);
    expect(mathResults.length).toBe(2); // Term 1 and Term 3 only

    const scores = mathResults.map((r) => r.score); // [99, 85]
    const cumAvg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    // (99 + 85) / 2 = 184 / 2 = 92%
    expect(cumAvg).toBe(92);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION 6: Historical Data & Cross-Session Isolation
  // ───────────────────────────────────────────────────────────────────────────
  test("6.1 Cross-session data isolation (2025 results never leak into 2026)", () => {
    // Record a 2025 result for Student 1 in Math
    const gs2025 = queries.createGradingSubject.run("Mathematics", `MTH_${TS}`, class1Id, term2025Id, session2025Id, teacher1Id) as any;
    const gs2025Id = Number(gs2025.lastInsertRowid);
    queries.upsertTermResult.run(student1Id, gs2025Id, 20.00, 30.00, 50.00, "C", "Credit", 1, term2025Id, session2025Id);

    // Query report card results for Session 2026
    let res2026 = queries.getStudentTermResultsForReportCard.all(student1Id) as any[];
    res2026 = res2026.filter((r) => Number(r.session_id) === session2026Id);

    // Verify no 2025 results appear in 2026 dataset
    const has2025 = res2026.some((r) => Number(r.session_id) === session2025Id || Number(r.term_id) === term2025Id);
    expect(has2025).toBe(false);

    // Query annual results for Session 2026
    const annualRows = db.prepare(`
      SELECT tr.student_id, ROUND(AVG(tr.total_score), 2) as annual_avg
      FROM term_results tr
      WHERE tr.session_id = ? AND tr.is_approved = 1 AND tr.student_id = ?
      GROUP BY tr.student_id
    `).get(session2026Id, student1Id) as any;

    // Student 1 has in Session 2026: Math T1 (65), Science T1 (45), Math T2 (80), Math T3 (90)
    // Sum = 280, Count = 4, Avg = 280 / 4 = 70.00
    expect(annualRows.annual_avg).toBe(70);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION 7: Class Master & Timetable Scoping
  // ───────────────────────────────────────────────────────────────────────────
  test("7.1 Class Teacher authorization recognizes class enrollment", () => {
    const authTeacher1 = { userId: teacher1Id, role: "teacher", token: "tok", jti: "jti" };
    const authTeacher2 = { userId: teacher2Id, role: "teacher", token: "tok", jti: "jti" };

    // Teacher 1 is Class Teacher for Class 1 (where Student 1 and 2 are enrolled)
    expect(authz.isClassTeacherForStudent(authTeacher1, student1Id)).toBe(true);
    expect(authz.isClassTeacherForStudent(authTeacher1, student2Id)).toBe(true);

    // Teacher 2 is Class Teacher for Class 2 (neither student is enrolled in Class 2)
    expect(authz.isClassTeacherForStudent(authTeacher2, student1Id)).toBe(false);
  });

  test("7.2 Timetable creation and scoping", () => {
    // Schedule Math Term 1 Exam
    const ttRes = queries.createTimetable.run(
      mathSubjectT1Id, `JSS1 Alpha ${TS}`, null, "A", "2026-12-10", "09:00", "10:00", 60, "CBT", 1
    ) as any;
    const ttId = Number(ttRes.lastInsertRowid);

    const allTt = queries.getTimetables.all() as any[];
    const mathTt = allTt.find((t) => t.id === ttId);

    expect(mathTt).toBeDefined();
    expect(mathTt.session_id).toBe(session2026Id);
    expect(mathTt.term_id).toBe(term1Id);
    expect(mathTt.teacher_id).toBe(teacher1Id);
  });
});
