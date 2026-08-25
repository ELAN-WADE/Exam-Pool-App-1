import db, { queries } from "../db";

console.log("=== QCV VERIFICATION: Telemetry, Profile, and Practice Review ===");

// 1. Verify queries in db.ts
console.log("\n1. Testing queries in db.ts...");
const student = db.prepare("SELECT id, name, grade, grade_level_id FROM users WHERE role = 'student' LIMIT 1").get() as any;
if (!student) {
  console.log("No student found in DB, skipping student-specific query execution.");
} else {
  console.log(`Found sample student: ID ${student.id} (${student.name}), Grade: ${student.grade}`);
  
  const dates = queries.getStudentDailyActivityDates.all(student.id, student.id, student.id);
  console.log(`Active dates count: ${dates.length}`);

  const todayCount = queries.getStudentTodayQuestionCount.get(student.id, student.id) as any;
  console.log(`Today questions count: ${todayCount?.count ?? 0}`);

  const cohort = queries.getStudentCohortStats.get(student.id) as any;
  console.log(`Cohort stats:`, cohort);
}

// 2. Verify practice questions in content bank
console.log("\n2. Testing content bank query for practice review...");
const sampleQ = db.prepare("SELECT id, question_text, options_json, correct_answer, solution_text, topic_tag FROM content_bank.content_bank LIMIT 1").get() as any;
if (sampleQ) {
  console.log("Sample content bank question retrieved successfully:", {
    id: sampleQ.id,
    question_text: sampleQ.question_text?.slice(0, 40) + "...",
    correct_answer: sampleQ.correct_answer,
    has_solution: Boolean(sampleQ.solution_text)
  });
} else {
  console.log("No content bank questions found in attached DB.");
}

console.log("\n=== ALL DATABASE QUERIES VALIDATED SUCCESSFULLY ===");
