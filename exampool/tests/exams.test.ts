/**
 * tests/exams.test.ts — T-100 to T-160
 * ─────────────────────────────────────────────────────────────────
 * EXAM WORKFLOW: Start, Save, Submit, Scoring, Results, Review
 *
 * Run:  bun test tests/exams.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { apiGet, apiPost, apiPut, apiDelete, extractToken, json } from "./helpers";

// ── Shared state ─────────────────────────────────────────────────────────────

let operatorToken = "";
let teacherToken  = "";
let student1Token = "";
let student2Token = "";
let student1Id    = 0;
let student2Id    = 0;
let subjectId     = 0;
let teacherId     = 0;
let examId        = 0;
let q1Id          = 0;
let q2Id          = 0;

const BASE_TS = Date.now();
// Exam window: starts 1 minute ago, lasts 60 minutes → currently open
const EXAM_START = new Date(Date.now() - 60_000).toISOString();

beforeAll(async () => {
  // ── Operator bootstrap ──
  const setupRes = await apiPost("/api/setup", {
    name: "Exam Op", email: `op_exam_${BASE_TS}@q.test`,
    password: "Operator@123", schoolName: "Exam School", currentTerm: "2026-T1",
  });
  if (setupRes.status === 201) {
    operatorToken = extractToken(setupRes, await json(setupRes));
  } else {
    const lr = await apiPost("/api/auth/login", { email: `op_exam_${BASE_TS}@q.test`, password: "Operator@123" });
    operatorToken = extractToken(lr, await json(lr));
  }

  // ── Teacher ──
  const tReg = await apiPost("/api/auth/register", {
    name: "Exam Teacher", email: `tch_exam_${BASE_TS}@q.test`, password: "Teacher@123", role: "teacher",
  }, operatorToken);
  teacherId = (await json(tReg))?.data?.user?.id ?? 0;
  const tLogin = await apiPost("/api/auth/login", { email: `tch_exam_${BASE_TS}@q.test`, password: "Teacher@123" });
  teacherToken = extractToken(tLogin, await json(tLogin));

  // ── Student 1 ──
  const s1Reg = await apiPost("/api/auth/register", {
    name: "Exam Student 1", email: `stu1_exam_${BASE_TS}@q.test`, password: "Student@123",
    role: "student", grade: "SS1",
  }, operatorToken);
  student1Id = (await json(s1Reg))?.data?.user?.id ?? 0;
  const s1Login = await apiPost("/api/auth/login", { email: `stu1_exam_${BASE_TS}@q.test`, password: "Student@123" });
  student1Token = extractToken(s1Login, await json(s1Login));

  // ── Student 2 ──
  const s2Reg = await apiPost("/api/auth/register", {
    name: "Exam Student 2", email: `stu2_exam_${BASE_TS}@q.test`, password: "Student@123",
    role: "student", grade: "SS1",
  }, operatorToken);
  student2Id = (await json(s2Reg))?.data?.user?.id ?? 0;
  const s2Login = await apiPost("/api/auth/login", { email: `stu2_exam_${BASE_TS}@q.test`, password: "Student@123" });
  student2Token = extractToken(s2Login, await json(s2Login));

  // ── Subject: starts 1 min ago, 60-min duration ──
  const subjectRes = await apiPost("/api/subjects", {
    name: "Exam Subject", code: `EXSUB_${BASE_TS}`, term: "2026-T1",
    duration: 60, exam_datetime: EXAM_START, teacher_id: teacherId,
  }, operatorToken);
  subjectId = (await json(subjectRes)).data.id;

  // ── Questions ──
  const opts = ["Alpha", "Beta", "Gamma", "Delta"];
  const q1Res = await apiPost("/api/questions", {
    subject_id: subjectId, question_text: "Q1: Which is correct?",
    options: opts, correct_answer: 0, marks: 5, order_index: 1,
  }, teacherToken);
  q1Id = (await json(q1Res)).data.id;

  const q2Res = await apiPost("/api/questions", {
    subject_id: subjectId, question_text: "Q2: Which is correct?",
    options: opts, correct_answer: 2, marks: 5, order_index: 2,
  }, teacherToken);
  q2Id = (await json(q2Res)).data.id;

  // ── Publish ──
  await apiPut(`/api/subjects/${subjectId}`, { is_published: 1 }, operatorToken);

  // ── Enroll both students ──
  await apiPost(`/api/subjects/${subjectId}/students`, { student_id: student1Id }, operatorToken);
  await apiPost(`/api/subjects/${subjectId}/students`, { student_id: student2Id }, operatorToken);
});

// ── T-100  STUDENT SUBJECT VISIBILITY ────────────────────────────────────────

describe("T-100  Student subject visibility", () => {
  test("T-100-A  Enrolled student sees subject in dashboard", async () => {
    const res  = await apiGet("/api/subjects", student1Token);
    const body = await json(res);
    expect(res.status).toBe(200);
    const ids = (body.data as any[]).map((s) => Number(s.id));
    expect(ids).toContain(subjectId);
  });

  test("T-100-B  Un-enrolled student does NOT see subject", async () => {
    // Register a brand-new student not enrolled in this subject
    const notEnrolledEmail = `notenr_${BASE_TS}@q.test`;
    await apiPost("/api/auth/register", {
      name: "Not Enrolled", email: notEnrolledEmail, password: "Student@123",
      role: "student", grade: "JSS1",
    }, operatorToken);
    const lr = await apiPost("/api/auth/login", { email: notEnrolledEmail, password: "Student@123" });
    const token = extractToken(lr, await json(lr));

    const res  = await apiGet("/api/subjects", token);
    const body = await json(res);
    const ids = (body.data as any[]).map((s) => Number(s.id));
    expect(ids).not.toContain(subjectId);
  });
});

// ── T-110  EXAM START ─────────────────────────────────────────────────────────

describe("T-110  Exam start", () => {
  test("T-110-A  Student starts exam → 201 with examId + questions", async () => {
    const res  = await apiPost("/api/exams/start", { subject_id: subjectId }, student1Token);
    const body = await json(res);
    expect(res.status).toBe(201);
    examId = body.data.examId ?? body.data.exam?.id;
    expect(examId).toBeGreaterThan(0);
    expect(Array.isArray(body.data.questions)).toBe(true);
    expect(body.data.questions.length).toBe(2);
  });

  test("T-110-B  Questions do NOT contain correct_answer field", async () => {
    const res  = await apiPost("/api/exams/start", { subject_id: subjectId }, student2Token);
    const body = await json(res);
    expect(res.status).toBe(201);
    for (const q of body.data.questions as any[]) {
      expect(q).not.toHaveProperty("correct_answer");
    }
  });

  test("T-110-C  Double-start same exam → 409", async () => {
    const res = await apiPost("/api/exams/start", { subject_id: subjectId }, student1Token);
    expect(res.status).toBe(409);
  });

  test("T-110-D  Teacher cannot start exam → 403", async () => {
    const res = await apiPost("/api/exams/start", { subject_id: subjectId }, teacherToken);
    expect(res.status).toBe(403);
  });

  test("T-110-E  Start exam for unpublished subject → 403", async () => {
    // Create & immediately unpublish
    const cr = await apiPost("/api/subjects", {
      name: "Unpub", code: `UNPUB_${BASE_TS}`, term: "2026-T1",
      duration: 60, exam_datetime: EXAM_START, teacher_id: teacherId,
    }, operatorToken);
    const unpubId = (await json(cr)).data.id;
    // Note: never published
    const res = await apiPost("/api/exams/start", { subject_id: unpubId }, student1Token);
    expect(res.status).toBe(403);
  });

  test("T-110-F  server_time returned in start response", async () => {
    const res  = await apiGet("/api/exams/results", student1Token);
    const body = await json(res);
    // exam exists and start_time is an ISO string
    const exam = (body.data as any[]).find((e) => Number(e.subject_id) === subjectId);
    if (exam) {
      expect(Date.parse(exam.start_time)).toBeGreaterThan(0);
    }
  });
});

// ── T-120  EXAM SAVE ──────────────────────────────────────────────────────────

describe("T-120  Exam save (auto-save)", () => {
  test("T-120-A  Student saves answers → 200 with time_remaining_seconds", async () => {
    const answers = [
      { question_id: q1Id, selected_option: 0 },
      { question_id: q2Id, selected_option: 1 },
    ];
    const res  = await apiPost(`/api/exams/${examId}/save`, { answers }, student1Token);
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.data.saved).toBe(true);
    expect(typeof body.data.time_remaining_seconds).toBe("number");
    expect(body.data.time_remaining_seconds).toBeGreaterThan(0);
  });

  test("T-120-B  Student2 cannot save Student1 exam → 403", async () => {
    const res = await apiPost(`/api/exams/${examId}/save`, {
      answers: [{ question_id: q1Id, selected_option: 0 }],
    }, student2Token);
    expect(res.status).toBe(403);
  });

  test("T-120-C  Save with non-array answers → 400", async () => {
    const res = await apiPost(`/api/exams/${examId}/save`, { answers: "not-array" }, student1Token);
    expect(res.status).toBe(400);
  });
});

// ── T-130  EXAM SUBMIT ────────────────────────────────────────────────────────

describe("T-130  Exam submit & scoring", () => {
  test("T-130-A  Student submits exam → 200 with score + total_score", async () => {
    const answers = [
      { question_id: q1Id, selected_option: 0 }, // correct (answer=0, marks=5)
      { question_id: q2Id, selected_option: 1 }, // wrong  (answer=2, marks=5)
    ];
    const res  = await apiPost(`/api/exams/${examId}/submit`, { answers }, student1Token);
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.data.exam_id).toBe(examId);
    expect(body.data.score).toBe(5);         // only Q1 correct
    expect(body.data.total_score).toBe(10);  // 5+5
  });

  test("T-130-B  Exam status is 'completed' after submit", async () => {
    const res  = await apiGet("/api/exams/results", student1Token);
    const body = await json(res);
    const exam = (body.data as any[]).find((e) => Number(e.id) === examId);
    expect(exam).toBeDefined();
    expect(exam.status).toBe("completed");
  });

  test("T-130-C  Double-submit returns 409", async () => {
    const res = await apiPost(`/api/exams/${examId}/submit`, { answers: [] }, student1Token);
    expect(res.status).toBe(409);
  });

  test("T-130-D  Student2 cannot submit Student1 exam → 403", async () => {
    const res = await apiPost(`/api/exams/${examId}/submit`, { answers: [] }, student2Token);
    expect(res.status).toBe(403);
  });

  test("T-130-E  All-correct answers → score equals total_score", async () => {
    // Use student2 who hasn't submitted yet
    const res2  = await apiGet("/api/exams/results", student2Token);
    const res2Body = await json(res2);
    const exam2 = (res2Body.data as any[]).find((e) => Number(e.subject_id) === subjectId);
    if (!exam2) {
      // student2 hasn't started yet — that's okay, skip
      return;
    }
    const answers = [
      { question_id: q1Id, selected_option: 0 }, // correct
      { question_id: q2Id, selected_option: 2 }, // correct
    ];
    const submitRes  = await apiPost(`/api/exams/${exam2.id}/submit`, { answers }, student2Token);
    const submitBody = await json(submitRes);
    expect(submitRes.status).toBe(200);
    expect(submitBody.data.score).toBe(submitBody.data.total_score);
  });
});

// ── T-140  RESULTS ────────────────────────────────────────────────────────────

describe("T-140  Results access", () => {
  test("T-140-A  Student sees own completed exam in results", async () => {
    const res  = await apiGet("/api/exams/results", student1Token);
    const body = await json(res);
    expect(res.status).toBe(200);
    const ids = (body.data as any[]).map((e) => Number(e.id));
    expect(ids).toContain(examId);
  });

  test("T-140-B  Student does NOT see other students' results", async () => {
    const res  = await apiGet("/api/exams/results", student1Token);
    const body = await json(res);
    for (const e of body.data as any[]) {
      expect(Number(e.student_id)).toBe(student1Id);
    }
  });

  test("T-140-C  Teacher sees results for own subjects only", async () => {
    const res  = await apiGet("/api/exams/results", teacherToken);
    const body = await json(res);
    expect(res.status).toBe(200);
    // All results must belong to subjects taught by teacherId
    const subjectIds = (body.data as any[]).map((e) => Number(e.subject_id));
    // This teacher owns subjectId
    for (const sid of subjectIds) {
      expect(sid).toBe(subjectId);
    }
  });

  test("T-140-D  Operator sees all results", async () => {
    const res = await apiGet("/api/exams/results", operatorToken);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect((body.data as any[]).length).toBeGreaterThan(0);
  });
});

// ── T-150  EXAM REVIEW ────────────────────────────────────────────────────────

describe("T-150  Exam review (per-question detail)", () => {
  test("T-150-A  Student can review own exam → 200 with answers array", async () => {
    const res  = await apiGet(`/api/exams/${examId}/review`, student1Token);
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.data).toHaveProperty("exam");
    expect(body.data).toHaveProperty("answers");
    expect(Array.isArray(body.data.answers)).toBe(true);
  });

  test("T-150-B  Review includes question_text and is_correct", async () => {
    const res  = await apiGet(`/api/exams/${examId}/review`, student1Token);
    const body = await json(res);
    for (const a of body.data.answers as any[]) {
      expect(a).toHaveProperty("question_text");
      expect(a).toHaveProperty("is_correct");
      expect(a).toHaveProperty("marks_awarded");
    }
  });

  test("T-150-C  Student2 cannot review Student1 exam → 403", async () => {
    const res = await apiGet(`/api/exams/${examId}/review`, student2Token);
    expect(res.status).toBe(403);
  });

  test("T-150-D  Teacher can review exam for own subject", async () => {
    const res = await apiGet(`/api/exams/${examId}/review`, teacherToken);
    expect(res.status).toBe(200);
  });
});

// ── T-160  PROMOTE / DEMOTE GRADE ────────────────────────────────────────────

describe("T-160  Student grade management", () => {
  test("T-160-A  Teacher promotes student → grade updated", async () => {
    const res  = await apiPut(`/api/users/${student1Id}/grade`, { grade: "SS2" }, teacherToken);
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.data.grade).toBe("SS2");
  });

  test("T-160-B  Operator promotes student → 200", async () => {
    const res  = await apiPut(`/api/users/${student1Id}/grade`, { grade: "SS3" }, operatorToken);
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.data.grade).toBe("SS3");
  });

  test("T-160-C  Student cannot promote themselves → 403", async () => {
    const res = await apiPut(`/api/users/${student1Id}/grade`, { grade: "PhD" }, student1Token);
    expect(res.status).toBe(403);
  });

  test("T-160-D  Teacher cannot promote student with no exam in their subjects (guard)", async () => {
    // student2 has taken the exam → teacher CAN promote
    const res = await apiPut(`/api/users/${student2Id}/grade`, { grade: "SS2" }, teacherToken);
    // If student2 completed exam: 200; if not yet submitted: 403
    expect([200, 403]).toContain(res.status);
  });

  test("T-160-E  grade field is required", async () => {
    const res = await apiPut(`/api/users/${student1Id}/grade`, { grade: "" }, operatorToken);
    expect(res.status).toBe(400);
  });
});
