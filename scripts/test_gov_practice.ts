import db from "../db";

console.log("=== SIMULATING PRACTICE START, SUBMIT, REVEAL, AND REVIEW FOR GOV101 ===");

const practiceId = "JAMB_1978_GOV101";
const parts = practiceId.split("_");
const [exam_body, yearStr, ...rest] = parts;
const year = parseInt(yearStr, 10);
const subject_code = rest.join("_");

console.log(`Querying content_bank with: exam_body=${exam_body}, year=${year}, subject_code=${subject_code}`);

const questions = db.prepare(`
  SELECT id, question_text, options_json, correct_answer, solution_text, topic_tag, difficulty
  FROM content_bank.content_bank
  WHERE exam_body = ? AND year = ? AND subject_code = ?
`).all(exam_body, year, subject_code) as any[];

console.log(`Found ${questions.length} questions:`);
for (const q of questions) {
  console.log(`Q ID ${q.id}: ${q.question_text}`);
  console.log(`  Options: ${q.options_json}`);
  console.log(`  Correct: ${q.correct_answer}`);
  console.log(`  Solution: ${q.solution_text}`);
}

// Simulate user answering Q1 (correct "C" / index 2)
const answers = [
  { question_id: questions[0].id, selected_option: 2 }
];

console.log("\nSimulating submission with answers:", answers);
const correctOpt = questions[0].correct_answer;
const optLetter = typeof correctOpt === "string" && /^[A-E]$/i.test(correctOpt)
  ? correctOpt.toUpperCase().charCodeAt(0) - 65
  : Number(correctOpt);
const selectedNum = 2;
const isCorrect = (String(2) === String(correctOpt) || optLetter === selectedNum);
console.log(`Correct Answer = '${correctOpt}', optLetter = ${optLetter}, selectedNum = ${selectedNum}, isCorrect = ${isCorrect}`);

console.log("Test completed successfully.");
