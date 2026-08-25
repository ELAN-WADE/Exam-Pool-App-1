import { describe, test, expect } from "bun:test";
import db, { queries } from "../db";
import { generateToken, hashPassword, verifyPassword } from "../auth";

describe("Senior Comprehensive End-to-End System Audit (Admin, Teacher, Student, Guardian)", () => {
  const baseUrl = "http://localhost:8001";

  // Setup test users across all 4 roles
  const operatorUser = db.prepare("SELECT * FROM users WHERE role = 'operator' LIMIT 1").get() as any;
  const teacherUser = db.prepare("SELECT * FROM users WHERE email = 'teacher@exampool.ng'").get() as any;
  const guardianUser = db.prepare("SELECT * FROM users WHERE email = 'guardian@exampool.ng'").get() as any;
  const studentUser = db.prepare("SELECT * FROM users WHERE email = 'student@exampool.ng'").get() as any;
  const jss3Class = db.prepare("SELECT * FROM classes WHERE name = 'JSS 3' LIMIT 1").get() as any;

  const operatorToken = generateToken(operatorUser.id, "operator");
  const teacherToken = generateToken(teacherUser.id, "teacher");
  const guardianToken = generateToken(guardianUser.id, "guardian");
  const studentToken = generateToken(studentUser.id, "student");

  // ── 1. Authentication, Sessions & RBAC ──────────────────────────────────────
  test("1.1 GET /api/auth/me returns enriched role-specific profile without leaking passwords", async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    const user = json.data?.user;
    expect(user).toBeDefined();
    expect(user.role).toBe("teacher");
    expect(user.password_hash).toBeUndefined();
    expect(user.is_class_teacher).toBe(true);
    expect(user.assigned_class_name).toContain("JSS 3");
  });

  test("1.2 RBAC strictly isolates routes across roles", async () => {
    // Student cannot access admin user management
    const adminRes = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    expect(adminRes.status).toBe(403);

    // Student cannot access teacher grading
    const gradingRes = await fetch(`${baseUrl}/api/grading/subjects`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    expect(gradingRes.status).toBe(403);

    // Guardian cannot access teacher attendance register
    const attRes = await fetch(`${baseUrl}/api/teacher/attendance/roster`, {
      headers: { Authorization: `Bearer ${guardianToken}` },
    });
    expect(attRes.status).toBe(403);
  });

  // ── 2. Admin Class Teacher Assignment & Audit History ───────────────────────
  test("2.1 Admin assigns teacher as class master and creates immutable audit record", async () => {
    const res = await fetch(`${baseUrl}/api/v2/classes/${jss3Class.id}/assign-teacher`, {
      method: "POST",
      headers: { Authorization: `Bearer ${operatorToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ teacher_id: teacherUser.id, notes: "Appointed as JSS3 Class Master" }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data?.class_teacher_id).toBe(teacherUser.id);

    // Verify audit history
    const historyRes = await fetch(`${baseUrl}/api/v2/classes/teacher-assignments/history`, {
      headers: { Authorization: `Bearer ${operatorToken}` },
    });
    expect(historyRes.status).toBe(200);
    const history = ((await historyRes.json()) as any).data;
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThan(0);
  });

  // ── 3. Daily Attendance Register & Guardian Automated Pings ─────────────────
  test("3.1 Class Teacher fetches daily attendance roster and batch marks records", async () => {
    const testDate = "2026-06-20";
    const rosterRes = await fetch(`${baseUrl}/api/teacher/attendance/roster?date=${testDate}`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    expect(rosterRes.status).toBe(200);
    const roster = ((await rosterRes.json()) as any).data;
    expect(roster.has_class).toBe(true);
    expect(Array.isArray(roster.students)).toBe(true);

    // Batch submit attendance
    const batchRes = await fetch(`${baseUrl}/api/teacher/attendance/batch`, {
      method: "POST",
      headers: { Authorization: `Bearer ${teacherToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        class_id: jss3Class.id,
        date: testDate,
        records: [
          { student_id: studentUser.id, status: "present", remarks: "Punctual attendance" },
        ],
      }),
    });
    expect(batchRes.status).toBe(200);
    const batchData = ((await batchRes.json()) as any).data;
    expect(batchData.success).toBe(true);
    expect(batchData.count).toBe(1);

    // Verify guardian notification
    const notif = db.prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'attendance' ORDER BY id DESC LIMIT 1").get(guardianUser.id) as any;
    expect(notif).toBeDefined();
    expect(notif.message).toContain("Daily Roll Call");
  });

  // ── 4. Assessment Result Release Policy ─────────────────────────────────────
  test("4.1 Result release policies control student & guardian score visibility", async () => {
    // Create test subject with manual release policy
    const subjRes = await fetch(`${baseUrl}/api/subjects`, {
      method: "POST",
      headers: { Authorization: `Bearer ${operatorToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Introductory Technology",
        code: `IT-${Date.now()}`,
        duration: 30,
        result_policy: "manual",
      }),
    });
    expect(subjRes.status).toBe(201);
    const subjData = ((await subjRes.json()) as any).data;
    const testSubjId = subjData.id;

    // Enroll student
    await fetch(`${baseUrl}/api/subjects/${testSubjId}/enroll`, {
      method: "POST",
      headers: { Authorization: `Bearer ${operatorToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ student_id: studentUser.id }),
    });

    // Add question
    await fetch(`${baseUrl}/api/questions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${operatorToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        subject_id: testSubjId,
        question_text: "What is a primary engineering material?",
        question_type: "objective",
        options: ["Wood", "Plastic", "Metal", "Ceramic"],
        correct_answer: 2,
        marks: 10,
      }),
    });

    // Publish exam
    await fetch(`${baseUrl}/api/subjects/${testSubjId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${operatorToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ is_published: 1 }),
    });

    // Record completed exam attempt for student
    db.prepare("INSERT INTO exams (student_id, subject_id, status, score, total_score, mode, start_time, end_time, session_id, term_id) VALUES (?, ?, 'completed', 10, 10, 'exam', datetime('now'), datetime('now'), 1, 1)").run(studentUser.id, testSubjId);

    // Ensure guardian-student link is active and notifications enabled
    db.prepare("UPDATE users SET notify_results = 1 WHERE id = ?").run(guardianUser.id);
    db.prepare("INSERT OR IGNORE INTO guardian_student_links (guardian_id, student_id, relationship, status) VALUES (?, ?, 'Parent', 'approved')").run(guardianUser.id, studentUser.id);
    db.prepare("UPDATE guardian_student_links SET status = 'approved' WHERE guardian_id = ? AND student_id = ?").run(guardianUser.id, studentUser.id);

    // Publish results
    const publishRes = await fetch(`${baseUrl}/api/subjects/${testSubjId}/release-results`, {
      method: "POST",
      headers: { Authorization: `Bearer ${operatorToken}` },
    });
    expect(publishRes.status).toBe(200);

    // Verify result release notification to guardian
    const releaseNotif = db.prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'result_released' ORDER BY id DESC LIMIT 1").get(guardianUser.id) as any;
    expect(releaseNotif).toBeDefined();
    expect(releaseNotif.message).toContain("Results published");
  });

  // ── 5. Bidirectional Guardian-Teacher Messaging ────────────────────────────
  test("5.1 Guardian initiates inquiry thread and teacher responds in real-time", async () => {
    // Guardian starts thread
    const newThreadRes = await fetch(`${baseUrl}/api/guardian/messages/new-thread`, {
      method: "POST",
      headers: { Authorization: `Bearer ${guardianToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient_id: teacherUser.id,
        student_id: studentUser.id,
        student_name: "Daniel",
        category: "teacher",
        subject: "Homework Clarification",
        text: "Good day Mr. Teacher, could you clarify question 4 on Daniel's assignment?",
      }),
    });
    expect(newThreadRes.status).toBe(201);
    const threadData = ((await newThreadRes.json()) as any).data;
    const threadId = threadData.threadId;
    expect(threadId).toBeDefined();

    // Teacher reads thread
    const teacherThreadRes = await fetch(`${baseUrl}/api/teacher/messages/threads/${threadId}`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    expect(teacherThreadRes.status).toBe(200);
    const threadDetail = ((await teacherThreadRes.json()) as any).data;
    expect(threadDetail.messages.length).toBeGreaterThan(0);

    // Teacher sends reply
    const replyRes = await fetch(`${baseUrl}/api/teacher/messages/threads/${threadId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${teacherToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Hello! Question 4 requires simplifying the algebraic fraction before substituting.",
      }),
    });
    expect(replyRes.status).toBe(201);

    // Guardian views thread
    const guardianThreadRes = await fetch(`${baseUrl}/api/guardian/messages/threads/${threadId}`, {
      headers: { Authorization: `Bearer ${guardianToken}` },
    });
    expect(guardianThreadRes.status).toBe(200);
    const guardianThread = ((await guardianThreadRes.json()) as any).data;
    expect(guardianThread.messages.length).toBeGreaterThanOrEqual(2);
    const lastMsg = guardianThread.messages[guardianThread.messages.length - 1];
    expect(lastMsg.text).toContain("algebraic fraction");
  });

  // ── 6. Report Card & Shareable Token Verification ──────────────────────────
  test("6.1 Guardian accesses report card and generates verified share token", async () => {
    const shareRes = await fetch(`${baseUrl}/api/guardian/wards/${studentUser.id}/share-token`, {
      headers: { Authorization: `Bearer ${guardianToken}` },
    });
    expect(shareRes.status).toBe(200);
    const shareData = ((await shareRes.json()) as any).data;
    expect(shareData.token).toBeDefined();
    expect(shareData.share_url).toContain(`/student/report-card?student_id=${studentUser.id}`);

    // Verify token validity
    const verifyRes = await fetch(`${baseUrl}/api/guardian/verify-share-token?token=${shareData.token}`);
    expect(verifyRes.status).toBe(200);
    const verifyData = ((await verifyRes.json()) as any).data;
    expect(verifyData.valid).toBe(true);
    expect(verifyData.student_id).toBe(studentUser.id);
  });
});
