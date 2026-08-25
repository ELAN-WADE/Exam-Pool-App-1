/**
 * tests/academic_api.test.ts
 * ─────────────────────────────────────────────────────────────────
 * HTTP API LEVEL AUDIT TESTS FOR ACADEMIC & GRADING SYSTEM
 *
 * Tests:
 * 1. GET /api/users/:id/report-card-results (Cumulative 3rd term multi-term results)
 * 2. POST /api/grading/scores/:id & POST /api/grading/approve/:id (Normalization & Grade Scale)
 * 3. POST /api/academic/activate-session & POST /api/academic/activate-term
 * 4. POST /api/academic/end-term
 * 5. GET /api/timetables (session & term scoping)
 *
 * Run: bun test tests/academic_api.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { apiGet, apiPost, extractToken, json } from "./helpers";
import db, { queries } from "../db";
import { hashPassword } from "../auth";

describe("Academic & Grading HTTP API Level Audit", () => {
  const TS = Date.now();
  let operatorToken = "";
  let teacherToken = "";
  let teacherId = 0;
  let studentId = 0;
  let sessionId = 0;
  let term1Id = 0;
  let term2Id = 0;
  let term3Id = 0;
  let classId = 0;
  let gradingSubjectT1Id = 0;
  let gradingSubjectT2Id = 0;
  let gradingSubjectT3Id = 0;

  beforeAll(async () => {
    // Create fresh operator with known password
    const opEmail = `op_${TS}@exampool.test`;
    const opHash = await hashPassword("Operator@123");
    db.prepare("INSERT INTO users (name, email, role, password_hash, is_active) VALUES ('Audit Operator', ?, 'operator', ?, 1)").run(opEmail, opHash);
    const lRes = await apiPost("/api/auth/login", { email: opEmail, password: "Operator@123" });
    operatorToken = extractToken(lRes, await json(lRes));

    // Register Teacher & Student
    const tEmail = `teacher_${TS}@exampool.test`;
    const sEmail = `student_${TS}@exampool.test`;
    const pHash = await hashPassword("Password@123");

    const tRow = db.prepare("INSERT INTO users (name, email, role, password_hash, is_active) VALUES (?, ?, 'teacher', ?, 1)").run(`Audit Teacher ${TS}`, tEmail, pHash) as any;
    teacherId = Number(tRow.lastInsertRowid);

    const sRow = db.prepare("INSERT INTO users (name, email, role, password_hash, reg_id, grade, is_active) VALUES (?, ?, 'student', ?, ?, 'JSS1', 1)")
      .run(`Audit Student ${TS}`, sEmail, pHash, `REG_HTTP_${TS}`) as any;
    studentId = Number(sRow.lastInsertRowid);

    const tLoginRes = await apiPost("/api/auth/login", { email: tEmail, password: "Password@123" });
    teacherToken = extractToken(tLoginRes, await json(tLoginRes));

    // Create Academic Session
    const sRes = queries.createAcademicSession.run(`Session_${TS}`, 1, "active") as any;
    sessionId = Number(sRes.lastInsertRowid);

    // Create 3 Terms
    const t1 = queries.createAcademicTerm.run(sessionId, "First Term", "2026-09-01", "2026-12-15", 1, "active") as any;
    term1Id = Number(t1.lastInsertRowid);
    db.prepare("INSERT OR IGNORE INTO terms (id, session, name, start_date, end_date, is_active, registration_open) VALUES (?, ?, ?, ?, ?, 1, 1)")
      .run(term1Id, `Session_${TS}`, "First Term", "2026-09-01", "2026-12-15");

    const t2 = queries.createAcademicTerm.run(sessionId, "Second Term", "2027-01-10", "2027-04-10", 0, "active") as any;
    term2Id = Number(t2.lastInsertRowid);
    db.prepare("INSERT OR IGNORE INTO terms (id, session, name, start_date, end_date, is_active, registration_open) VALUES (?, ?, ?, ?, ?, 0, 1)")
      .run(term2Id, `Session_${TS}`, "Second Term", "2027-01-10", "2027-04-10");

    const t3 = queries.createAcademicTerm.run(sessionId, "Third Term", "2027-05-02", "2027-07-25", 0, "active") as any;
    term3Id = Number(t3.lastInsertRowid);
    db.prepare("INSERT OR IGNORE INTO terms (id, session, name, start_date, end_date, is_active, registration_open) VALUES (?, ?, ?, ?, ?, 0, 1)")
      .run(term3Id, `Session_${TS}`, "Third Term", "2027-05-02", "2027-07-25");

    // Create Class and enroll student
    const cRow = db.prepare("INSERT INTO classes (name, section, level, class_teacher_id) VALUES (?, 'A', 'junior', ?)")
      .run(`Class_${TS}`, teacherId) as any;
    classId = Number(cRow.lastInsertRowid);

    db.prepare("INSERT INTO class_enrollments (student_id, class_id, term_id) VALUES (?, ?, ?)").run(studentId, classId, term1Id);
    db.prepare("INSERT INTO class_enrollments (student_id, class_id, term_id) VALUES (?, ?, ?)").run(studentId, classId, term2Id);
    db.prepare("INSERT INTO class_enrollments (student_id, class_id, term_id) VALUES (?, ?, ?)").run(studentId, classId, term3Id);
  });

  test("API-1: Session and Term Activation via HTTP", async () => {
    const actTermRes = await apiPost("/api/academic/activate-term", { termId: term2Id }, operatorToken);
    expect(actTermRes.status).toBe(200);

    const activeTerm = queries.getActiveAcademicTerm.get() as any;
    const activeSession = queries.getActiveAcademicSession.get() as any;

    expect(activeTerm.id).toBe(term2Id);
    expect(activeSession.id).toBe(sessionId);

    // Switch back to term 1
    await apiPost("/api/academic/activate-term", { termId: term1Id }, operatorToken);
  });

  test("API-2: Grading Subject Score Entry, Percentage Normalization & Approval", async () => {
    // Create Grading Subject for 50-max subject (Exam 30 + CA 20 = 50)
    const gs = queries.createGradingSubject.run("Chemistry", `CHM_${TS}`, classId, term1Id, sessionId, teacherId) as any;
    gradingSubjectT1Id = Number(gs.lastInsertRowid);

    const pExam = queries.createGradingPolicy.run(gradingSubjectT1Id, "Exam", "manual", null, 30, 1) as any;
    const pCa = queries.createGradingPolicy.run(gradingSubjectT1Id, "Continuous Assessment", "manual", null, 20, 0) as any;

    const pExamId = Number(pExam.lastInsertRowid);
    const pCaId = Number(pCa.lastInsertRowid);

    // Enter manual scores via HTTP API: Exam = 25/30, CA = 18/20 -> Raw total = 43/50 (86%)
    const scoreRes = await apiPost(`/api/grading/scores/${gradingSubjectT1Id}`, [
      { grading_policy_id: pExamId, student_id: studentId, score: 25 },
      { grading_policy_id: pCaId, student_id: studentId, score: 18 }
    ], teacherToken);
    expect(scoreRes.status).toBe(200);

    // Verify draft result in database: raw total = 43.00, percentage = (43/50)*100 = 86% -> Grade A (min 75)
    const draftRes = db.prepare("SELECT * FROM term_results WHERE student_id = ? AND grading_subject_id = ?").get(studentId, gradingSubjectT1Id) as any;
    expect(draftRes.ca_score).toBe(18);
    expect(draftRes.exam_score).toBe(25);
    expect(draftRes.total_score).toBe(43);
    expect(draftRes.grade).toBe("A");
    expect(draftRes.is_approved).toBe(0);

    // Approve results via HTTP API
    const approveRes = await apiPost(`/api/grading/approve/${gradingSubjectT1Id}`, {}, teacherToken);
    expect(approveRes.status).toBe(200);

    const finalRes = db.prepare("SELECT * FROM term_results WHERE student_id = ? AND grading_subject_id = ?").get(studentId, gradingSubjectT1Id) as any;
    expect(finalRes.is_approved).toBe(1);
    expect(finalRes.grade).toBe("A");
  });

  test("API-3: Third-Term Cumulative Results Query via HTTP (No Data Loss)", async () => {
    // Record Term 2 result for Chemistry: 40/50 (80%) -> Grade A
    const gs2 = queries.createGradingSubject.run("Chemistry", `CHM_${TS}`, classId, term2Id, sessionId, teacherId) as any;
    gradingSubjectT2Id = Number(gs2.lastInsertRowid);
    queries.upsertTermResult.run(studentId, gradingSubjectT2Id, 16.00, 24.00, 40.00, "A", "Excellent", 1, term2Id, sessionId);

    // Record Term 3 result for Chemistry: 46/50 (92%) -> Grade A
    const gs3 = queries.createGradingSubject.run("Chemistry", `CHM_${TS}`, classId, term3Id, sessionId, teacherId) as any;
    gradingSubjectT3Id = Number(gs3.lastInsertRowid);
    queries.upsertTermResult.run(studentId, gradingSubjectT3Id, 18.00, 28.00, 46.00, "A", "Excellent", 1, term3Id, sessionId);

    // Query report card results for Term 3 via HTTP endpoint
    const res = await apiGet(`/api/users/${studentId}/report-card-results?sessionId=${sessionId}&termId=${term3Id}`, teacherToken);
    expect(res.status).toBe(200);

    const data = (await json(res)).data as any[];
    expect(Array.isArray(data)).toBe(true);

    const chmResults = data.filter((r) => r.code === `CHM_${TS}`);
    // All 3 terms must be present so cumulative analysis can calculate 1st, 2nd, and 3rd term averages!
    expect(chmResults.length).toBe(3);

    const t1 = chmResults.find((r) => r.term_id === term1Id);
    const t2 = chmResults.find((r) => r.term_id === term2Id);
    const t3 = chmResults.find((r) => r.term_id === term3Id);

    expect(t1.score).toBe(43);
    expect(t2.score).toBe(40);
    expect(t3.score).toBe(46);
  });

  test("API-4: Timetables API Scoping by Session & Term", async () => {
    // Create Subject and Timetable
    const sub = queries.createSubject.run("Physics", `PHY_${TS}`, "First Term", 60, teacherId, 1, "Physics", `Class_${TS}`, null, `Session_${TS}`, "exam", "None", 1, sessionId, term1Id) as any;
    const subId = Number(sub.lastInsertRowid);

    queries.createTimetable.run(subId, `Class_${TS}`, null, "A", "2026-12-11", "10:00", "11:00", 60, "CBT", 1);

    // Query with session and term filter
    const res = await apiGet(`/api/timetables?sessionId=${sessionId}&termId=${term1Id}`, teacherToken);
    expect(res.status).toBe(200);

    const data = (await json(res)).data as any[];
    const phy = data.find((t) => t.subject_id === subId);
    expect(phy).toBeDefined();
    expect(phy.subject_code).toBe(`PHY_${TS}`);
  });

  test("API-5: End Term Lifecycle via HTTP", async () => {
    const endRes = await apiPost("/api/academic/end-term", { termId: term1Id }, operatorToken);
    expect(endRes.status).toBe(200);

    const closedTerm = queries.getAcademicTermById.get(term1Id) as any;
    expect(closedTerm.status).toBe("archived");
  });
});
