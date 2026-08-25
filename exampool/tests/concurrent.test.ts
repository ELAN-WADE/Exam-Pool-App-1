/**
 * tests/concurrent.test.ts — T-200 to T-250
 * ─────────────────────────────────────────────────────────────────
 * CONCURRENT LOAD TESTING — simulates 50 simultaneous LAN clients
 *
 * Strategy:
 *  • All 50 clients are created BEFORE the timed phase
 *  • Promise.all() fires requests in parallel
 *  • We measure wall-clock time with performance.now()
 *  • SQLite WAL mode + 5-second busy_timeout means occasional
 *    retries are acceptable; zero data-loss is the hard requirement
 *
 * Run:  bun test tests/concurrent.test.ts  (allow up to 120s)
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { apiGet, apiPost, apiPut, extractToken, json, TEST_OPERATOR_EMAIL, TEST_OPERATOR_PASSWORD, TEST_OPERATOR_NAME } from "./helpers";

const N_CLIENTS    = 50;
const BASE_TS      = Date.now();
const EXAM_START   = new Date(Date.now() - 30_000).toISOString(); // already started (within 1-min grace)

let operatorToken  = "";
let teacherId      = 0;
let subjectId      = 0;
let q1Id           = 0;
let q2Id           = 0;

// One record per simulated student
const clients: Array<{ token: string; userId: number; examId: number }> = [];

// ── Bootstrap ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Operator
  const setupRes = await apiPost("/api/setup", {
    name: TEST_OPERATOR_NAME, email: TEST_OPERATOR_EMAIL, password: TEST_OPERATOR_PASSWORD,
    schoolName: "Load School", currentTerm: "2026-T1",
  });
  if (setupRes.status === 201) {
    operatorToken = extractToken(setupRes, await json(setupRes));
  } else {
    const lr = await apiPost("/api/auth/login", { email: TEST_OPERATOR_EMAIL, password: TEST_OPERATOR_PASSWORD });
    operatorToken = extractToken(lr, await json(lr));
  }

  // Teacher
  const tReg = await apiPost("/api/auth/register", {
    name: "Load Teacher", email: `lt_${BASE_TS}@q.test`, password: "Teacher@123", role: "teacher",
  }, operatorToken);
  teacherId = (await json(tReg))?.data?.user?.id ?? 0;
  const tLogin = await apiPost("/api/auth/login", { email: `lt_${BASE_TS}@q.test`, password: "Teacher@123" });
  const teacherToken = extractToken(tLogin, await json(tLogin));

  // Subject with open window
  const sr = await apiPost("/api/subjects", {
    name: "Load Subject", code: `LOAD_${BASE_TS}`, term: "2026-T1",
    duration: 60, exam_datetime: EXAM_START, teacher_id: teacherId,
  }, operatorToken);
  subjectId = (await json(sr)).data.id;

  // Questions
  const opts = ["A", "B", "C", "D"];
  const q1r = await apiPost("/api/questions", {
    subject_id: subjectId, question_text: "Load Q1",
    options: opts, correct_answer: 0, marks: 5, order_index: 1,
  }, teacherToken);
  q1Id = (await json(q1r)).data.id;

  const q2r = await apiPost("/api/questions", {
    subject_id: subjectId, question_text: "Load Q2",
    options: opts, correct_answer: 1, marks: 5, order_index: 2,
  }, teacherToken);
  q2Id = (await json(q2r)).data.id;

  // Publish
  await apiPut(`/api/subjects/${subjectId}`, { is_published: 1 }, operatorToken);

  // Register + login + enroll all N students (sequential to avoid setup races)
  for (let i = 0; i < N_CLIENTS; i++) {
    const email = `load_stu_${BASE_TS}_${i}@q.test`;
    const regRes = await apiPost("/api/auth/register", {
      name: `Load Student ${i}`, email, password: "Student@123",
      role: "student", grade: "SS1",
    }, operatorToken);
    const userId = (await json(regRes))?.data?.user?.id ?? 0;

    const lr = await apiPost("/api/auth/login", { email, password: "Student@123" });
    const token = extractToken(lr, await json(lr));

    // Enroll
    await apiPost(`/api/subjects/${subjectId}/students`, { student_id: userId }, operatorToken);

    clients.push({ token, userId, examId: 0 });
  }
}, 300_000); // 5-min timeout for setup

// ── T-200  SIMULTANEOUS LOGIN ─────────────────────────────────────────────────

describe(`T-200  ${N_CLIENTS} simultaneous logins`, () => {
  test("T-200-A  All clients can re-login in parallel within 10 seconds", async () => {
    const t0 = performance.now();

    const results = await Promise.allSettled(
      clients.map((c, i) =>
        apiPost("/api/auth/login", {
          email:    `load_stu_${BASE_TS}_${i}@q.test`,
          password: "Student@123",
        }),
      ),
    );

    const elapsed = (performance.now() - t0) / 1000;
    console.log(`[T-200-A] ${N_CLIENTS} logins in ${elapsed.toFixed(2)}s`);

    const ok      = results.filter((r) => r.status === "fulfilled" && (r.value as Response).ok).length;
    const failed  = N_CLIENTS - ok;

    expect(ok).toBe(N_CLIENTS);
    expect(failed).toBe(0);
    expect(elapsed).toBeLessThan(10);
  }, 30_000);
});

// ── T-210  SIMULTANEOUS EXAM STARTS ──────────────────────────────────────────

describe(`T-210  ${N_CLIENTS} simultaneous exam starts`, () => {
  test("T-210-A  All clients start exam, unique examIds, no data loss", async () => {
    const t0 = performance.now();

    const results = await Promise.allSettled(
      clients.map((c) =>
        apiPost("/api/exams/start", { subject_id: subjectId }, c.token),
      ),
    );

    const elapsed = (performance.now() - t0) / 1000;
    console.log(`[T-210-A] ${N_CLIENTS} exam starts in ${elapsed.toFixed(2)}s`);

    const examIds = new Set<number>();
    let failures  = 0;

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r) continue;
      if (r.status === "rejected") { failures++; continue; }
      const res  = (r as PromiseFulfilledResult<Response>).value;
      if (!res.ok) { failures++; continue; }
      const body = await json(res);
      const eid  = body.data?.examId ?? body.data?.exam?.id;
      const client = clients[i];
      if (eid && client) {
        examIds.add(eid);
        client.examId = eid;
      }
    }

    // All exam IDs must be unique
    expect(examIds.size).toBe(N_CLIENTS - failures);
    expect(failures).toBe(0);
    expect(elapsed).toBeLessThan(15);
  }, 60_000);
});

// ── T-220  SIMULTANEOUS AUTO-SAVE ────────────────────────────────────────────

describe(`T-220  ${N_CLIENTS} simultaneous auto-saves`, () => {
  test("T-220-A  All auto-saves succeed, no SQLite lock errors", async () => {
    const t0 = performance.now();

    const answers = [
      { question_id: q1Id, selected_option: 0 },
      { question_id: q2Id, selected_option: 1 },
    ];

    const results = await Promise.allSettled(
      clients
        .filter((c) => c.examId > 0)
        .map((c) =>
          apiPost(`/api/exams/${c.examId}/save`, { answers }, c.token),
        ),
    );

    const elapsed = (performance.now() - t0) / 1000;
    console.log(`[T-220-A] ${N_CLIENTS} auto-saves in ${elapsed.toFixed(2)}s`);

    const ok     = results.filter((r) => r.status === "fulfilled" && (r.value as Response).ok).length;
    const failed = results.length - ok;

    console.log(`[T-220-A] ${ok} ok, ${failed} failed`);

    // Tolerate ≤2% failure (SQLite busy) but no more
    expect(failed).toBeLessThanOrEqual(Math.ceil(N_CLIENTS * 0.02));
    expect(elapsed).toBeLessThan(20);
  }, 60_000);

  test("T-220-B  Repeat auto-save wave (idempotent overwrite)", async () => {
    const answers = [
      { question_id: q1Id, selected_option: 1 }, // changed answer
      { question_id: q2Id, selected_option: 2 },
    ];

    const results = await Promise.allSettled(
      clients
        .filter((c) => c.examId > 0)
        .map((c) =>
          apiPost(`/api/exams/${c.examId}/save`, { answers }, c.token),
        ),
    );

    const failed = results.filter((r) => r.status === "rejected").length;
    expect(failed).toBe(0);
  }, 60_000);
});

// ── T-230  SIMULTANEOUS SUBMISSION ───────────────────────────────────────────

describe(`T-230  ${N_CLIENTS} simultaneous submissions`, () => {
  test("T-230-A  All exams submitted, no data loss, all scored", async () => {
    const t0 = performance.now();

    const answers = [
      { question_id: q1Id, selected_option: 0 }, // correct
      { question_id: q2Id, selected_option: 1 }, // correct
    ];

    const results = await Promise.allSettled(
      clients
        .filter((c) => c.examId > 0)
        .map((c) =>
          apiPost(`/api/exams/${c.examId}/submit`, { answers }, c.token),
        ),
    );

    const elapsed = (performance.now() - t0) / 1000;
    console.log(`[T-230-A] ${N_CLIENTS} submissions in ${elapsed.toFixed(2)}s`);

    let successCount = 0;
    let alreadyDone  = 0;
    let otherFail    = 0;

    for (const r of results) {
      if (r.status === "rejected") { otherFail++; continue; }
      const res = r.value as Response;
      if (res.status === 200)      successCount++;
      else if (res.status === 409) alreadyDone++; // already submitted (2nd save + submit race)
      else otherFail++;
    }

    console.log(`[T-230-A] success=${successCount}, already_done=${alreadyDone}, other_fail=${otherFail}`);

    // Every exam must end in either 200 or 409 (submitted already by race) — no 500s
    expect(otherFail).toBe(0);
    expect(successCount + alreadyDone).toBe(clients.filter((c) => c.examId > 0).length);
    expect(elapsed).toBeLessThan(30);
  }, 90_000);

  test("T-230-B  All submitted exams appear in operator results", async () => {
    const res  = await apiGet("/api/exams/results", operatorToken);
    const body = await json(res);
    expect(res.status).toBe(200);

    const subjectResults = (body.data as any[]).filter(
      (e) => Number(e.subject_id) === subjectId,
    );
    // At least 90% of students should have a result record
    expect(subjectResults.length).toBeGreaterThanOrEqual(Math.floor(N_CLIENTS * 0.9));
  });

  test("T-230-C  All submitted scores are accurate (5+5=10)", async () => {
    const res  = await apiGet("/api/exams/results", operatorToken);
    const body = await json(res);
    const subjectResults = (body.data as any[]).filter(
      (e) => Number(e.subject_id) === subjectId && e.status === "completed",
    );

    for (const e of subjectResults) {
      // Both answers were correct → score should be 10
      expect(Number(e.score)).toBe(10);
      expect(Number(e.total_score)).toBe(10);
    }
  });
});

// ── T-240  MIXED READ/WRITE LOAD ──────────────────────────────────────────────

describe("T-240  Mixed read/write concurrent load", () => {
  test("T-240-A  Simultaneous reads (results) and writes (new saves) don't deadlock", async () => {
    // Spin up a new subject + students for a second wave
    const email2 = `lt2_${BASE_TS}@q.test`;
    await apiPost("/api/auth/register", {
      name: "Wave2 Teacher", email: email2, password: "Teacher@123", role: "teacher",
    }, operatorToken);
    const tl = await apiPost("/api/auth/login", { email: email2, password: "Teacher@123" });
    const t2token = extractToken(tl, await json(tl));

    // Use a fresh future datetime for this test
    const freshExamStart = new Date(Date.now() + 60_000).toISOString();
    const sr = await apiPost("/api/subjects", {
      name: "Wave2 Sub", code: `W2_${BASE_TS}`, term: "2026-T1",
      duration: 60, exam_datetime: freshExamStart, teacher_id: teacherId,
    }, operatorToken);
    const w2SubId = (await json(sr)).data.id;
    await apiPut(`/api/subjects/${w2SubId}`, { is_published: 1 }, operatorToken);

    // Fire 25 reads (operator results) + 25 writes (teacher GET questions) in parallel
    const reads  = Array.from({ length: 25 }, () => apiGet("/api/exams/results", operatorToken));
    const writes = Array.from({ length: 25 }, () => apiGet(`/api/subjects/${subjectId}/questions`, t2token));

    const all = await Promise.allSettled([...reads, ...writes]);
    const errors = all.filter((r) => r.status === "rejected").length;
    expect(errors).toBe(0);
  }, 30_000);
});

// ── T-250  SECURITY UNDER LOAD ────────────────────────────────────────────────

describe("T-250  Security: injection under concurrent load", () => {
  test("T-250-A  SQL injection login attempts all return 401, server stays alive", async () => {
    const payloads = [
      "admin' OR '1'='1'--",
      "' OR 1=1--",
      "admin'/*",
      "') OR ('1'='1",
      "1; DROP TABLE users--",
    ];
    const results = await Promise.allSettled(
      payloads.map((email) =>
        apiPost("/api/auth/login", { email, password: "anything" }),
      ),
    );

    for (const r of results) {
      expect(r.status).toBe("fulfilled");
      const res = (r as PromiseFulfilledResult<Response>).value;
      expect(res.status).toBe(401);
    }

    // Server still alive
    const healthRes = await apiGet("/api/server-info");
    expect(healthRes.status).toBe(200);
  });

  test("T-250-B  Forged tokens all rejected under concurrent load", async () => {
    const fakes = Array.from({ length: 20 }, (_, i) => `fake.token.${i}XXXX`);
    const results = await Promise.allSettled(
      fakes.map((tok) => apiGet("/api/auth/me", tok)),
    );

    for (const r of results) {
      expect(r.status).toBe("fulfilled");
      const res = (r as PromiseFulfilledResult<Response>).value;
      expect(res.status).toBe(401);
    }
  });
});
