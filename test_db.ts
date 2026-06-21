import { Database } from "bun:sqlite";
import fs from "fs";

async function testDb() {
  const fileText = fs.readFileSync("sample_jamb_pack.epkg", "utf-8");
  const epkg = JSON.parse(fileText);

  // Skip decryption since we already proved it works and just test the payload format
  const content = {
    exam_body: "JAMB",
    subject: "Mathematics",
    subject_code: "MTH",
    year: 2024,
    paper_type: "objective",
    questions: [
      {
        question_text: "Find the derivative of $y = x^2$.",
        options: ["$2x$", "$x$", "$x^2/2$", "$2$"],
        correct_answer: "0",
        solution_text: "Using the power rule, the derivative of $x^n$ is $nx^{n-1}$. Thus, for $x^2$, it is $2x$.",
        difficulty: 2,
        topic_tag: "Calculus"
      }
    ]
  };

  const db = new Database("exampool.db");
  db.run(`ATTACH DATABASE 'content_bank.db' AS content_bank`);

  const tx = db.transaction(() => {
    const insertStmt = db.prepare(`
      INSERT INTO content_bank.content_bank 
      (exam_body, year, subject_code, paper_type, question_text, options_json, correct_answer, solution_text, difficulty, topic_tag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const q of content.questions) {
      insertStmt.run(
        content.exam_body,
        content.year,
        content.subject_code,
        content.paper_type,
        q.question_text,
        JSON.stringify(q.options),
        q.correct_answer,
        q.solution_text,
        q.difficulty,
        q.topic_tag
      );
    }
  });
  
  try {
    tx();
    console.log("DB Insert success!");
  } catch (err) {
    console.error("DB Error:", err);
  }
}

testDb();
