import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";

// Locate databases
const dbPath = path.join(import.meta.dir, "..", "exampool.db");
const cbPath = path.join(import.meta.dir, "..", "content_bank.db");

if (!fs.existsSync(dbPath)) {
  console.error(`Main database not found at ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath);
db.run("PRAGMA foreign_keys = ON");
db.run(`ATTACH DATABASE '${cbPath.replace(/'/g, "''")}' AS cb`);

console.log("Connected to databases. Seeding additional JAMB past questions...");

const jambQuestions = [
  // PHYSICS 1984
  {
    subject: "Physics",
    code: "PHY101",
    year: 1984,
    questions: [
      {
        text: "The distance travelled by a particle starting from rest is plotted against the square of the time elapsed from the commencement of motion. The resulting graph is linear. The slope of this graph is a measure of:",
        options: ["Initial displacement", "Initial velocity", "Acceleration", "Half the acceleration"],
        answer: 3, // Half the acceleration (s = 1/2 a t^2)
        difficulty: 3,
        topic: "Motion"
      },
      {
        text: "For which of the underlisted quantities is the derived unit ML^2T^-2 correct? I. Moment of a force II. Work III. Acceleration",
        options: ["I only", "II only", "III only", "I and II"],
        answer: 3, // I and II (Moment = Force * distance = MLT^-2 * L = ML^2T^-2, Work = Force * distance = ML^2T^-2)
        difficulty: 2,
        topic: "Units and Dimensions"
      },
      {
        text: "For a concave mirror to form a real diminished image, the object must be placed:",
        options: ["Behind the mirror", "Between the mirror and in focus", "Between the focus and the center of curvature", "At a distance greater than the radius of curvature"],
        answer: 3, // Beyond C
        difficulty: 2,
        topic: "Optics"
      },
      {
        text: "The unit quantity of electricity is called:",
        options: ["The ampere", "The volt", "The coulomb", "The ammeter"],
        answer: 2, // The coulomb
        difficulty: 1,
        topic: "Electricity"
      },
      {
        text: "The resistance of a wire depends on:",
        options: ["The length of the wire", "The diameter of the wire", "The temperature of the wire", "All of the above"],
        answer: 3, // All of the above
        difficulty: 1,
        topic: "Electricity"
      }
    ]
  },
  // MATHEMATICS 1984
  {
    subject: "Mathematics",
    code: "MTH101",
    year: 1984,
    questions: [
      {
        text: "If 263 + 441 = 714, what number base has been used?",
        options: ["12", "11", "10", "9"],
        answer: 3, // 9
        difficulty: 2,
        topic: "Number Bases"
      },
      {
        text: "A man invested a total of #50,000 in two companies. If these companies pay dividend of 6% and 8% respectively, how much did he invest at 8% if the total yield is #3,700?",
        options: ["#15,000", "#29,600", "#21,400", "#35,000"],
        answer: 3, // #35,000
        difficulty: 3,
        topic: "Commercial Arithmetic"
      },
      {
        text: "Find without using logarithm tables, the value of (Log3 27 - Log1/4 64) / Log3 (1/81)",
        options: ["7/4", "-7/4", "-3/2", "7/3"],
        answer: 2, // -3/2
        difficulty: 3,
        topic: "Logarithms"
      },
      {
        text: "Factorise 6x^2 - 14x - 12",
        options: ["2(x + 3)(3x - 2)", "6(x - 2)(x + 1)", "2(x - 3)(3x + 2)", "6(x + 2)(x - 1)"],
        answer: 2, // 2(x - 3)(3x + 2)
        difficulty: 2,
        topic: "Algebra"
      }
    ]
  }
];

db.transaction(() => {
  let operator = db.prepare("SELECT id FROM users WHERE role = 'operator' LIMIT 1").get() as any;
  
  for (const s of jambQuestions) {
    const subjectName = `JAMB ${s.subject} ${s.year}`;
    const subjectCode = `${s.code}-${s.year}`;
    
    let subject = db.prepare("SELECT id FROM subjects WHERE code = ?").get(subjectCode) as any;
    if (!subject) {
      const subResult = db.prepare(`
        INSERT INTO subjects (name, code, term, duration, total_score, exam_datetime, is_published, teacher_id, created_by, class, session, mode)
        VALUES (?, ?, '2026-T1', 60, ?, datetime('now', '+1 day'), 1, ?, ?, 'SS3', '2025/2026', 'exam')
      `).run(subjectName, subjectCode, s.questions.length * 10, operator.id, operator.id) as { lastInsertRowid: number | bigint };
      subject = { id: Number(subResult.lastInsertRowid) };
      console.log(`Created new CBT Subject: ${subjectName} (ID: ${subject.id})`);
    }

    db.prepare("DELETE FROM questions WHERE subject_id = ?").run(subject.id);

    let orderIndex = 0;
    for (const q of s.questions) {
      db.prepare(`
        INSERT INTO questions (subject_id, question_text, options_json, correct_answer, marks, order_index, question_type, session, term, mode)
        VALUES (?, ?, ?, ?, 10, ?, 'objective', '2025/2026', '2026-T1', 'exam')
      `).run(subject.id, q.text, JSON.stringify(q.options), q.answer, orderIndex++);

      const optionLetters = ["A", "B", "C", "D"];
      db.prepare(`
        INSERT OR REPLACE INTO cb.content_bank (
          exam_body, year, subject_code, paper_type, question_text, options_json, correct_answer, difficulty, topic_tag
        ) VALUES ('JAMB', ?, ?, 'CBT', ?, ?, ?, ?, ?)
      `).run(s.year, s.code, q.text, JSON.stringify(q.options), optionLetters[q.answer] ?? "A", q.difficulty, q.topic);
    }
    
    const students = db.prepare("SELECT id FROM users WHERE role = 'student'").all() as any[];
    for (const stud of students) {
      db.prepare("INSERT OR IGNORE INTO subject_enrollments (subject_id, student_id, enrolled_by) VALUES (?, ?, ?)")
        .run(subject.id, stud.id, operator.id);
    }
    console.log(`Seeded ${s.questions.length} questions for ${subjectName}.`);
  }
})();

console.log("Additional seeding complete!");
process.exit(0);
