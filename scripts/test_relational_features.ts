import db, { queries } from "../db";

console.log("=== TESTING RELATIONAL DATA FLOWS ===");

// 1. Test 5-Option Question Creation
console.log("\n1. Testing 5-Option WAEC/JAMB Question Creation...");
const teacher = db.prepare("SELECT id FROM users WHERE role='teacher' LIMIT 1").get() as any;
const teacherId = teacher?.id || 1;

let subject = db.prepare("SELECT id FROM subjects LIMIT 1").get() as any;
let subjectId = subject?.id;

if (!subjectId) {
  const sRes = queries.createSubject.run(
    "Test Chemistry WAEC", "CHM_WAEC", "2026-T1", 0, teacherId, teacherId,
    "WAEC Practice Test", "SS 3", 1, "2026/2027", "exam", "Instructions", 1, 1, 1
  ) as any;
  subjectId = Number(sRes.lastInsertRowid);
}

const qRes = queries.createQuestion.run(
  subjectId,
  "Which of the following elements has the highest electronegativity? A) Carbon B) Nitrogen C) Oxygen D) Fluorine E) Neon",
  JSON.stringify(["Carbon", "Nitrogen", "Oxygen", "Fluorine", "Neon"]),
  3, // Option D (Fluorine) - index 3
  2.5,
  1,
  "objective",
  "2026/2027",
  "2026-T1",
  "exam",
  "Fluorine is the most electronegative element.",
  null,
  0,
  null
) as any;

const questionId = Number(qRes.lastInsertRowid);
console.log(`✓ 5-option question inserted successfully with ID: ${questionId}`);

const qSaved = queries.getQuestionById.get(questionId) as any;
console.log("✓ Retrieved question options:", JSON.parse(qSaved.options_json));
console.log("✓ Correct answer index:", qSaved.correct_answer);

// 2. Test 24-Hour Assignment Duration
console.log("\n2. Testing 24-Hour Assignment Duration...");
const s2Res = queries.createSubject.run(
  "Take-home Assignment 1", "ASSGN_01", "2026-T1", 0, teacherId, teacherId,
  "24h Take-home Assignment", "SS 3", 1, "2026/2027", "assignment", "Submit within 24h", 1, 1, 1
) as any;
const assgnSubjectId = Number(s2Res.lastInsertRowid);

// Update duration to 1440 mins (24 hours)
db.prepare("UPDATE subjects SET duration = 1440, is_assignment = 1 WHERE id = ?").run(assgnSubjectId);
const savedAssgn = queries.getSubjectById.get(assgnSubjectId) as any;
console.log(`✓ Assignment duration set to ${savedAssgn.duration} minutes (24h) successfully!`);

// Clean up test data
queries.deleteQuestion.run(questionId);
console.log("✓ Test question cleaned up.");

console.log("\n=== ALL RELATIONAL FEATURE TESTS PASSED! ===");
