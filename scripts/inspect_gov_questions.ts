import db from "../db";

console.log("=== CHECKING CONTENT BANK ===");
try {
  const cbCols = db.prepare("PRAGMA content_bank.table_info(content_bank)").all();
  console.log("CB columns:", cbCols.map((c: any) => c.name));
  
  const cbDistinct = db.prepare("SELECT DISTINCT exam_body, year, subject_code FROM content_bank.content_bank").all();
  console.log("CB packages:", cbDistinct);

  const govCb = db.prepare("SELECT * FROM content_bank.content_bank WHERE subject_code LIKE '%GOV%' OR exam_body LIKE '%GOV%' OR question_text LIKE '%government%' LIMIT 5").all();
  console.log("Government CB rows count:", govCb.length);
  if (govCb.length > 0) {
    console.log("Sample CB row:", govCb[0]);
  }
} catch (e) {
  console.error("CB check error:", e);
}

console.log("=== CHECKING SUBJECTS ===");
const govSubjects = db.prepare("SELECT * FROM subjects WHERE name LIKE '%Gov%' OR code LIKE '%GOV%'").all();
console.log("Government subjects:", govSubjects);

const govQuestions = db.prepare("SELECT q.* FROM questions q JOIN subjects s ON s.id = q.subject_id WHERE s.name LIKE '%Gov%' OR s.code LIKE '%GOV%'").all();
console.log("Government questions count in 'questions' table:", govQuestions.length);
if (govQuestions.length > 0) {
  console.log("Sample question:", govQuestions[0]);
}
