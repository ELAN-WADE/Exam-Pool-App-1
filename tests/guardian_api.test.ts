import { describe, test, expect } from "bun:test";
import db, { queries } from "../db";
import { generateToken } from "../auth";

describe("Guardian Portal & Hybrid Messaging API Tests", () => {
  const guardianUser = db.prepare("SELECT * FROM users WHERE email = 'guardian@exampool.ng'").get() as any;
  const teacherUser = db.prepare("SELECT * FROM users WHERE email = 'teacher@exampool.ng'").get() as any;
  const studentUser = db.prepare("SELECT * FROM users WHERE email = 'student@exampool.ng'").get() as any;

  const guardianToken = generateToken(guardianUser.id, "guardian");
  const teacherToken = generateToken(teacherUser.id, "teacher");

  const baseUrl = "http://127.0.0.1:8001";

  test("1. GET /api/guardian/wards returns rich ward data", async () => {
    const res = await fetch(`${baseUrl}/api/guardian/wards`, {
      headers: { Cookie: `__exampool_session=${guardianToken}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.wards).toBeDefined();
    expect(json.data.wards.length).toBeGreaterThan(0);
    
    const ward = json.data.wards[0];
    expect(ward.name).toBe("Default Student");
    expect(ward.grade).toBe("JSS 3");
    expect(ward.average_score).toBeGreaterThan(0);
    expect(ward.attendance).toBeDefined();
    expect(ward.attendance.percentage).toBeGreaterThan(0);
    expect(ward.fees).toBeDefined();
    expect(ward.fees.items.length).toBeGreaterThan(0);
    expect(ward.upcoming_events.length).toBeGreaterThan(0);
  });

  test("2. GET /api/guardian/wards/:id/performance returns breakdown", async () => {
    const res = await fetch(`${baseUrl}/api/guardian/wards/${studentUser.id}/performance`, {
      headers: { Cookie: `__exampool_session=${guardianToken}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.subjects_performance.length).toBe(4);
    expect(json.data.subjects_performance[0].grade).toBeDefined();
  });

  test("3. GET /api/guardian/wards/:id/attendance returns monthly calendar dots", async () => {
    const res = await fetch(`${baseUrl}/api/guardian/wards/${studentUser.id}/attendance`, {
      headers: { Cookie: `__exampool_session=${guardianToken}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.summary.present_days).toBeGreaterThan(0);
    expect(json.data.calendar.length).toBeGreaterThan(0);
  });

  test("4. GET /api/guardian/wards/:id/fees returns itemized ledger", async () => {
    const res = await fetch(`${baseUrl}/api/guardian/wards/${studentUser.id}/fees`, {
      headers: { Cookie: `__exampool_session=${guardianToken}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.structures.length).toBe(3);
    expect(json.data.payments.length).toBe(2);
  });

  test("5. GET /api/guardian/messages/contacts discovers Form Teacher and Subject Teachers", async () => {
    const res = await fetch(`${baseUrl}/api/guardian/messages/contacts?ward_id=${studentUser.id}`, {
      headers: { Cookie: `__exampool_session=${guardianToken}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBeGreaterThan(0);
    const formTeacher = json.data.find((c: any) => c.role_label.includes("Form Teacher"));
    expect(formTeacher).toBeDefined();
  });

  test("6. Guardian sends message to Teacher & Teacher replies", async () => {
    // 1. Guardian fetches threads
    const threadsRes = await fetch(`${baseUrl}/api/guardian/messages/threads`, {
      headers: { Cookie: `__exampool_session=${guardianToken}` },
    });
    expect(threadsRes.status).toBe(200);
    const threadsJson = await threadsRes.json();
    expect(threadsJson.data.length).toBeGreaterThan(0);
    const threadId = threadsJson.data[0].id;

    // 2. Guardian posts a message
    const sendRes = await fetch(`${baseUrl}/api/guardian/messages/threads/${threadId}`, {
      method: "POST",
      headers: {
        Cookie: `__exampool_session=${guardianToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "Hello Mr. Adeleke, testing real-time chat from Guardian!" }),
    });
    expect(sendRes.status).toBe(201);

    // 3. Teacher reads the thread
    const teacherReadRes = await fetch(`${baseUrl}/api/teacher/messages/threads/${threadId}`, {
      headers: { Cookie: `__exampool_session=${teacherToken}` },
    });
    expect(teacherReadRes.status).toBe(200);
    const threadDetails = await teacherReadRes.json();
    const lastMsg = threadDetails.data.messages[threadDetails.data.messages.length - 1];
    expect(lastMsg.text).toBe("Hello Mr. Adeleke, testing real-time chat from Guardian!");

    // 4. Teacher replies
    const replyRes = await fetch(`${baseUrl}/api/teacher/messages/threads/${threadId}`, {
      method: "POST",
      headers: {
        Cookie: `__exampool_session=${teacherToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "Received loud and clear, Chief Doe! Real-time messaging is online." }),
    });
    expect(replyRes.status).toBe(201);
  });
});
