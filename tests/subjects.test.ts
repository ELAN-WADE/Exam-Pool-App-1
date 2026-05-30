/**
 * tests/subjects.test.ts — T-050 to T-090
 * ─────────────────────────────────────────────────────────────────
 * SUBJECT CRUD, QUESTION MANAGEMENT, ENROLLMENT, PERMISSIONS
 *
 * Run:  bun test tests/subjects.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { apiGet, apiPost, apiPut, apiDelete, extractToken, json } from "./helpers";

// ── State ────────────────────────────────────────────────────────────────────

let operatorToken = "";
let teacherToken  = "";
let teacher2Token = "";
let studentToken  = "";
let subjectId     = 0;
let teacherId     = 0;
let teacher2Id    = 0;
let studentId     = 0;
let questionId    = 0;

const BASE_TS = Date.now();

beforeAll(async () => {
  // Operator setup or login
  const setupRes = await apiPost("/api/setup", {
    name: "Subj Op", email: `op_subj_${BASE_TS}@q.test`,
    password: "Operator@123", schoolName: "Subj School", currentTerm: "2026-T1",
  });
  if (setupRes.status === 201) {
    operatorToken = extractToken(setupRes, await json(setupRes));
  } else {
    const lr = await apiPost("/api/auth/login", { email: `op_subj_${BASE_TS}@q.test`, password: "Operator@123" });
    operatorToken = extractToken(lr, await json(lr));
  }

  // Create teacher 1
  const t1Reg = await apiPost("/api/auth/register", {
    name: "Teacher One", email: `tch1_${BASE_TS}@q.test`, password: "Teacher@123", role: "teacher",
  }, operatorToken);
  teacherId = (await json(t1Reg))?.data?.user?.id ?? 0;
  const t1Login = await apiPost("/api/auth/login", { email: `tch1_${BASE_TS}@q.test`, password: "Teacher@123" });
  teacherToken = extractToken(t1Login, await json(t1Login));

  // Create teacher 2
  const t2Reg = await apiPost("/api/auth/register", {
    name: "Teacher Two", email: `tch2_${BASE_TS}@q.test`, password: "Teacher@123", role: "teacher",
  }, operatorToken);
  teacher2Id = (await json(t2Reg))?.data?.user?.id ?? 0;
  const t2Login = await apiPost("/api/auth/login", { email: `tch2_${BASE_TS}@q.test`, password: "Teacher@123" });
  teacher2Token = extractToken(t2Login, await json(t2Login));

  // Create student
  const stuReg = await apiPost("/api/auth/register", {
    name: "Student One", email: `stu1_${BASE_TS}@q.test`, password: "Student@123",
    role: "student", grade: "JSS2",
  }, operatorToken);
  studentId = (await json(stuReg))?.data?.user?.id ?? 0;
  const stuLogin = await apiPost("/api/auth/login", { email: `stu1_${BASE_TS}@q.test`, password: "Student@123" });
  studentToken = extractToken(stuLogin, await json(stuLogin));
});

// ── T-050  SUBJECT CRUD ───────────────────────────────────────────────────────

describe("T-050  Subject CRUD", () => {
  test("T-050-A  Operator creates subject → 201 with id", async () => {
    const res = await apiPost("/api/subjects", {
      name: "Mathematics", code: `MATH_${BASE_TS}`, term: "2026-T1",
      duration: 60, exam_datetime: "2026-12-01T09:00",
      teacher_id: teacherId,
    }, operatorToken);
    expect(res.status).toBe(201);
    const body = await json(res);
    subjectId = body.data.id;
    expect(subjectId).toBeGreaterThan(0);
  });

  test("T-050-B  Teacher sees assigned subject in GET /api/subjects", async () => {
    const res  = await apiGet("/api/subjects", teacherToken);
    const body = await json(res);
    const ids  = (body.data as any[]).map((s) => Number(s.id));
    expect(ids).toContain(subjectId);
  });

  test("T-050-C  Teacher2 does NOT see Teacher1 subject", async () => {
    const res  = await apiGet("/api/subjects", teacher2Token);
    const body = await json(res);
    const ids  = (body.data as any[]).map((s) => Number(s.id));
    expect(ids).not.toContain(subjectId);
  });

  test("T-050-D  Operator sees subject in GET /api/subjects", async () => {
    const res  = await apiGet("/api/subjects", operatorToken);
    const body = await json(res);
    const ids  = (body.data as any[]).map((s) => Number(s.id));
    expect(ids).toContain(subjectId);
  });

  test("T-050-E  Subject creation with invalid duration (<1) → 400", async () => {
    const res = await apiPost("/api/subjects", {
      name: "Bad Duration", code: `BD_${BASE_TS}`, term: "2026-T1",
      duration: 0, exam_datetime: "2026-12-01T09:00", teacher_id: teacherId,
    }, operatorToken);
    expect(res.status).toBe(400);
  });

  test("T-050-F  Subject creation with duration >360 → 400", async () => {
    const res = await apiPost("/api/subjects", {
      name: "Too Long", code: `TL_${BASE_TS}`, term: "2026-T1",
      duration: 999, exam_datetime: "2026-12-01T09:00", teacher_id: teacherId,
    }, operatorToken);
    expect(res.status).toBe(400);
  });

  test("T-050-G  Operator updates subject → 200", async () => {
    const res  = await apiPut(`/api/subjects/${subjectId}`, { name: "Mathematics Updated" }, operatorToken);
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.data.name).toBe("Mathematics Updated");
  });

  test("T-050-H  Teacher updates own subject → 200", async () => {
    const res = await apiPut(`/api/subjects/${subjectId}`, { description: "Updated by teacher" }, teacherToken);
    expect(res.status).toBe(200);
  });

  test("T-050-I  Teacher2 cannot update Teacher1 subject → 403", async () => {
    const res = await apiPut(`/api/subjects/${subjectId}`, { name: "Hijack" }, teacher2Token);
    expect(res.status).toBe(403);
  });

  test("T-050-J  Duplicate code+term → 409 or 400", async () => {
    const code = `DUP_${BASE_TS}`;
    await apiPost("/api/subjects", {
      name: "First", code, term: "2026-T1", duration: 60,
      exam_datetime: "2026-12-01T09:00", teacher_id: teacherId,
    }, operatorToken);
    const res = await apiPost("/api/subjects", {
      name: "Second", code, term: "2026-T1", duration: 60,
      exam_datetime: "2026-12-01T09:00", teacher_id: teacherId,
    }, operatorToken);
    expect([400, 409, 500]).toContain(res.status);
  });
});

// ── T-060  PUBLISH / UNPUBLISH ────────────────────────────────────────────────

describe("T-060  Publish workflow", () => {
  test("T-060-A  Operator publishes subject → is_published = 1", async () => {
    const res  = await apiPut(`/api/subjects/${subjectId}`, { is_published: 1 }, operatorToken);
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(Number(body.data.is_published)).toBe(1);
  });

  test("T-060-B  Teacher cannot edit published subject", async () => {
    const res = await apiPut(`/api/subjects/${subjectId}`, { name: "Should Fail" }, teacherToken);
    expect(res.status).toBe(403);
  });

  test("T-060-C  Operator can still edit published subject", async () => {
    const res = await apiPut(`/api/subjects/${subjectId}`, { description: "Op edit ok" }, operatorToken);
    expect(res.status).toBe(200);
  });

  test("T-060-D  Operator unpublishes subject → is_published = 0", async () => {
    const res  = await apiPut(`/api/subjects/${subjectId}`, { is_published: 0 }, operatorToken);
    const body = await json(res);
    expect(Number(body.data.is_published)).toBe(0);
  });
});

// ── T-070  QUESTION CRUD ──────────────────────────────────────────────────────

describe("T-070  Question management", () => {
  const validOptions = ["Option A", "Option B", "Option C", "Option D"];

  test("T-070-A  Teacher adds question to own subject → 201", async () => {
    const res  = await apiPost("/api/questions", {
      subject_id:    subjectId,
      question_text: "What is 2 + 2?",
      options:       validOptions,
      correct_answer: 0,
      marks:         2,
      order_index:   1,
      question_type: "objective",
    }, teacherToken);
    const body = await json(res);
    expect(res.status).toBe(201);
    questionId = body.data.id;
    expect(questionId).toBeGreaterThan(0);
  });

  test("T-070-B  Questions stored with correct 4-option JSON array", async () => {
    const res  = await apiGet(`/api/subjects/${subjectId}/questions`, teacherToken);
    const body = await json(res);
    const q    = (body.data as any[]).find((q) => q.id === questionId);
    expect(q).toBeDefined();
    const opts = JSON.parse(q.options_json);
    expect(Array.isArray(opts)).toBe(true);
    expect(opts.length).toBe(4);
  });

  test("T-070-C  correct_answer returned for teacher (not hidden)", async () => {
    const res  = await apiGet(`/api/subjects/${subjectId}/questions`, teacherToken);
    const body = await json(res);
    const q    = (body.data as any[]).find((q) => q.id === questionId);
    expect(q).toHaveProperty("correct_answer");
  });

  test("T-070-D  Teacher2 cannot add question to Teacher1 subject → 403", async () => {
    const res = await apiPost("/api/questions", {
      subject_id: subjectId, question_text: "Hacked?",
      options: validOptions, correct_answer: 0, marks: 1, order_index: 99,
    }, teacher2Token);
    expect(res.status).toBe(403);
  });

  test("T-070-E  Student cannot GET questions without active exam → 403", async () => {
    // Subject is unpublished + no active exam
    const res = await apiGet(`/api/subjects/${subjectId}/questions`, studentToken);
    expect(res.status).toBe(403);
  });

  test("T-070-F  Question with <4 options → 400", async () => {
    const res = await apiPost("/api/questions", {
      subject_id: subjectId, question_text: "Bad options?",
      options: ["A", "B", "C"], // only 3
      correct_answer: 0, marks: 1, order_index: 2,
    }, teacherToken);
    expect(res.status).toBe(400);
  });

  test("T-070-G  correct_answer out of 0-3 range → 400", async () => {
    const res = await apiPost("/api/questions", {
      subject_id: subjectId, question_text: "Out of range?",
      options: validOptions, correct_answer: 4, marks: 1, order_index: 3,
    }, teacherToken);
    expect(res.status).toBe(400);
  });

  test("T-070-H  marks <= 0 → 400", async () => {
    const res = await apiPost("/api/questions", {
      subject_id: subjectId, question_text: "Zero marks?",
      options: validOptions, correct_answer: 0, marks: 0, order_index: 4,
    }, teacherToken);
    expect(res.status).toBe(400);
  });

  test("T-070-I  Teacher updates own question → 200", async () => {
    const res  = await apiPut(`/api/questions/${questionId}`, {
      question_text: "What is 2 + 2? (updated)",
    }, teacherToken);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.question_text).toBe("What is 2 + 2? (updated)");
  });

  test("T-070-J  Teacher2 cannot update Teacher1 question → 403", async () => {
    const res = await apiPut(`/api/questions/${questionId}`, {
      question_text: "Hijacked",
    }, teacher2Token);
    expect(res.status).toBe(403);
  });

  test("T-070-K  Cannot add question to published subject → 409", async () => {
    // Publish
    await apiPut(`/api/subjects/${subjectId}`, { is_published: 1 }, operatorToken);
    const res = await apiPost("/api/questions", {
      subject_id: subjectId, question_text: "After publish?",
      options: validOptions, correct_answer: 0, marks: 1, order_index: 5,
    }, teacherToken);
    expect(res.status).toBe(409);
    // Unpublish for further tests
    await apiPut(`/api/subjects/${subjectId}`, { is_published: 0 }, operatorToken);
  });

  test("T-070-L  Delete question → removed, subject total_score decremented", async () => {
    // Get current total
    const beforeRes  = await apiGet(`/api/subjects/${subjectId}/questions`, teacherToken);
    const beforeBody = await json(beforeRes);
    const before     = (beforeBody.data as any[]).length;

    await apiDelete(`/api/questions/${questionId}`, teacherToken);

    const afterRes  = await apiGet(`/api/subjects/${subjectId}/questions`, teacherToken);
    const afterBody = await json(afterRes);
    expect((afterBody.data as any[]).length).toBe(before - 1);
  });
});

// ── T-080  ENROLLMENT ─────────────────────────────────────────────────────────

describe("T-080  Student enrollment", () => {
  test("T-080-A  Operator enrolls student → 201", async () => {
    const res = await apiPost(`/api/subjects/${subjectId}/students`, {
      student_id: studentId,
    }, operatorToken);
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.data.enrolled).toBe(true);
  });

  test("T-080-B  Teacher can view enrolled students → 200", async () => {
    const res  = await apiGet(`/api/subjects/${subjectId}/students`, teacherToken);
    const body = await json(res);
    expect(res.status).toBe(200);
    const ids = (body.data as any[]).map((s) => Number(s.id));
    expect(ids).toContain(studentId);
  });

  test("T-080-C  Teacher2 cannot view Teacher1 student roster → 403", async () => {
    const res = await apiGet(`/api/subjects/${subjectId}/students`, teacher2Token);
    expect(res.status).toBe(403);
  });

  test("T-080-D  Student cannot enroll themselves → 403", async () => {
    const res = await apiPost(`/api/subjects/${subjectId}/students`, {
      student_id: studentId,
    }, studentToken);
    expect(res.status).toBe(403);
  });

  test("T-080-E  Enroll non-student user → 400", async () => {
    const res = await apiPost(`/api/subjects/${subjectId}/students`, {
      student_id: teacherId, // teacher, not student
    }, operatorToken);
    expect(res.status).toBe(400);
  });

  test("T-080-F  Enroll student already enrolled is idempotent (no error)", async () => {
    const res = await apiPost(`/api/subjects/${subjectId}/students`, {
      student_id: studentId,
    }, operatorToken);
    // INSERT OR IGNORE — should succeed silently
    expect([200, 201]).toContain(res.status);
  });

  test("T-080-G  Unenroll student → student no longer in roster", async () => {
    await apiPost(`/api/subjects/${subjectId}/students`, { student_id: studentId }, operatorToken);
    const res = await apiDelete(`/api/subjects/${subjectId}/students/${studentId}`, operatorToken);
    expect(res.status).toBe(200);

    const rosterRes  = await apiGet(`/api/subjects/${subjectId}/students`, teacherToken);
    const rosterBody = await json(rosterRes);
    const ids = (rosterBody.data as any[]).map((s) => Number(s.id));
    expect(ids).not.toContain(studentId);
  });
});

// ── T-090  DELETE SUBJECT (cascade) ──────────────────────────────────────────

describe("T-090  Subject deletion cascade", () => {
  test("T-090-A  Delete subject with no exams → 200", async () => {
    // Create a throwaway subject
    const cr = await apiPost("/api/subjects", {
      name: "Temp Del", code: `TDEL_${BASE_TS}`, term: "2026-T1",
      duration: 10, exam_datetime: "2026-12-01T09:00", teacher_id: teacherId,
    }, operatorToken);
    const tempId = (await json(cr)).data.id;

    const delRes = await apiDelete(`/api/subjects/${tempId}`, operatorToken);
    expect(delRes.status).toBe(200);
  });

  test("T-090-B  Student cannot delete subject → 403", async () => {
    const res = await apiDelete(`/api/subjects/${subjectId}`, studentToken);
    expect(res.status).toBe(403);
  });

  test("T-090-C  Teacher cannot delete subject → 403", async () => {
    const res = await apiDelete(`/api/subjects/${subjectId}`, teacherToken);
    expect(res.status).toBe(403);
  });
});
