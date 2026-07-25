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

// Ensure content_bank is attached
db.run(`ATTACH DATABASE '${cbPath.replace(/'/g, "''")}' AS cb`);

console.log("Connected to databases. Seeding JAMB past questions...");

// 1. Define the past questions data (restricted to max 4 options due to DB CHECK constraint)
const jambQuestions = [
  // CHEMISTRY
  {
    subject: "Chemistry",
    code: "CHM101",
    year: 1983,
    questions: [
      {
        text: "X is a crystalline salt of sodium. A solution of X in water turns litmus red and produces a gas which turns lime water milky when added to sodium carbonate. With barium chloride solution, X gives a white precipitate which is insoluble in dilute hydrochloric acid. X is:",
        options: ["Na2CO3", "NaHCO3", "NaHSO4", "Na2SO4"],
        answer: 2, // NaHSO4
        difficulty: 3,
        topic: "Qualitative Analysis"
      },
      {
        text: "The alkanol obtained from the production of soap is:",
        options: ["ethanol", "glycerol", "methanol", "propanol"],
        answer: 1, // glycerol
        difficulty: 2,
        topic: "Organic Chemistry"
      },
      {
        text: "The flame used by welders in cutting and welding metals is:",
        options: ["butane gas flame", "acetylene flame", "kerosene flame", "oxy-acetylene flame"],
        answer: 3, // oxy-acetylene
        difficulty: 2,
        topic: "Gases & Industrial Applications"
      },
      {
        text: "Consecutive members of an alkane homologous series differ by:",
        options: ["CH", "CH2", "CH3", "CnHn"],
        answer: 1, // CH2
        difficulty: 1,
        topic: "Organic Chemistry"
      },
      {
        text: "If an element has the electronic configuration 1s2 2s2 2p6 3s2 3p2, it is:",
        options: ["a metal", "an alkaline earth metal", "an s-block element", "a p-block element"],
        answer: 3, // p-block
        difficulty: 2,
        topic: "Atomic Structure"
      }
    ]
  },
  // BIOLOGY
  {
    subject: "Biology",
    code: "BIO101",
    year: 2010,
    questions: [
      {
        text: "Which of the following characterizes a mature plant cell?",
        options: [
          "the cytoplasm fills up the entire cell space",
          "the nucleus is pushed to the centre of the cell",
          "the cell wall is made up of cellulose",
          "the nucleus is small and irregular in shape"
        ],
        answer: 2, // cell wall of cellulose
        difficulty: 1,
        topic: "Cell Structure"
      },
      {
        text: "Which of the following is NOT a function of the nucleus of a cell?",
        options: [
          "it controls the life processes of the cell",
          "it translates genetic information for the manufacture of proteins",
          "it stores and carries hereditary information",
          "it is a reservoir of energy for the cell"
        ],
        answer: 3, // reservoir of energy
        difficulty: 2,
        topic: "Cell Biology"
      },
      {
        text: "The dominant phase in the life cycle of a fern is the:",
        options: ["gametophyte", "prothallus", "sporophyte", "antheridium"],
        answer: 2, // sporophyte
        difficulty: 3,
        topic: "Plant Kingdom"
      },
      {
        text: "Parental care is exhibited by:",
        options: ["toads", "snails", "earthworms", "birds"],
        answer: 3, // birds
        difficulty: 1,
        topic: "Behavior & Adaptation"
      },
      {
        text: "Which of the following groups of cells is devoid of true nuclei?",
        options: ["algae", "monera", "fungi", "viruses"],
        answer: 1, // monera
        difficulty: 2,
        topic: "Classification"
      }
    ]
  },
  // GOVERNMENT
  {
    subject: "Government",
    code: "GOV101",
    year: 1978,
    questions: [
      {
        text: "When did Nigeria gain her Independence?",
        options: ["1st October 1963", "1st October 2012", "1st October 1960", "12th October 1992"],
        answer: 2, // 1st October 1960
        difficulty: 1,
        topic: "Nigerian History"
      },
      {
        text: "Democracy means a system of government in which:",
        options: ["the majority rules", "the minority rules", "there is no party system", "the people rule"],
        answer: 0, // majority rules (key indicates A)
        difficulty: 1,
        topic: "Political Concepts"
      },
      {
        text: "A constitution is federal if:",
        options: [
          "it provides for a presidential system",
          "it is unwritten",
          "the central and component units are co-ordinate and equal",
          "there is division of powers between a central and other component authorities"
        ],
        answer: 3, // division of powers
        difficulty: 2,
        topic: "Constitutions"
      },
      {
        text: "The Executive is:",
        options: [
          "a committee of the legislature",
          "the body that makes laws",
          "the body that executes the policies of government",
          "the highest organ of government"
        ],
        answer: 2, // executes policies
        difficulty: 1,
        topic: "Organs of Government"
      },
      {
        text: "The Judiciary is:",
        options: [
          "an arm of the Executive",
          "the body which makes the law",
          "a body of lawyers",
          "the body which interprets the law"
        ],
        answer: 3, // interprets law
        difficulty: 1,
        topic: "Organs of Government"
      }
    ]
  },
  // PHYSICS
  {
    subject: "Physics",
    code: "PHY101",
    year: 1983,
    questions: [
      {
        text: "Which of the following is NOT a vector quantity?",
        options: ["Force", "Altitude", "Weight", "Displacement"],
        answer: 1, // Altitude
        difficulty: 1,
        topic: "Mechanics"
      },
      {
        text: "The force with which an object is attracted to the earth is called its:",
        options: ["Acceleration", "Mass", "Gravity", "Weight"],
        answer: 3, // Weight
        difficulty: 1,
        topic: "Gravitational Fields"
      },
      {
        text: "The refractive index of a liquid is 1.5. If the velocity of light in vacuum is 3.0 x 10^8 m/s, the velocity of light in the liquid is:",
        options: ["1.5 x 10^8 m/s", "2.0 x 10^8 m/s", "3.0 x 10^8 m/s", "4.5 x 10^8 m/s"],
        answer: 1, // 2.0 x 10^8
        difficulty: 2,
        topic: "Optics"
      }
    ]
  },
  // MATHEMATICS
  {
    subject: "Mathematics",
    code: "MTH101",
    year: 1983,
    questions: [
      {
        text: "If M represents the median and D the mode of the measurements 5, 9, 3, 5, 8 then (M,D) is:",
        options: ["(6,5)", "(5,8)", "(5,7)", "(5,5)"],
        answer: 3, // (5,5)
        difficulty: 2,
        topic: "Statistics"
      },
      {
        text: "Given a regular hexagon, calculate each interior angle of the hexagon.",
        options: ["60°", "30°", "120°", "45°"],
        answer: 2, // 120°
        difficulty: 2,
        topic: "Geometry"
      },
      {
        text: "The scores of a set of final year students in the first semester examination in a paper are: 41, 29, 55, 21, 47, 70, 70, 40, 43, 56, 73, 23, 50, 50. Find the median of the scores.",
        options: ["47", "48 1/2", "50", "48"],
        answer: 2, // 50
        difficulty: 2,
        topic: "Statistics"
      }
    ]
  }
];

// Perform seeding in a transaction
db.transaction(() => {
  // Ensure we have a default operator user to assign as creator
  let operator = db.prepare("SELECT id FROM users WHERE role = 'operator' LIMIT 1").get() as any;
  if (!operator) {
    // Create one if none exists
    const result = db.prepare(`
      INSERT INTO users (name, email, role, password_hash, is_active)
      VALUES ('Admin Operator', 'operator@exampool.com', 'operator', '$argon2id$v=19$m=65536,t=3,p=4$24hNlhVbHcxN2M4$c4hNlhVbHcxN2M4', 1)
    `).run() as { lastInsertRowid: number | bigint };
    operator = { id: Number(result.lastInsertRowid) };
  }

  for (const s of jambQuestions) {
    // 1. Create or Find Subject in main DB
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
    } else {
      console.log(`Using existing CBT Subject: ${subjectName} (ID: ${subject.id})`);
    }

    // Clear old questions for this subject to prevent duplicates during re-runs
    db.prepare("DELETE FROM questions WHERE subject_id = ?").run(subject.id);

    // 2. Insert questions
    let orderIndex = 0;
    for (const q of s.questions) {
      // A. Insert into main DB questions table
      db.prepare(`
        INSERT INTO questions (subject_id, question_text, options_json, correct_answer, marks, order_index, question_type, session, term, mode)
        VALUES (?, ?, ?, ?, 10, ?, 'objective', '2025/2026', '2026-T1', 'exam')
      `).run(subject.id, q.text, JSON.stringify(q.options), q.answer, orderIndex++);

      // B. Insert into content_bank DB
      const optionLetters = ["A", "B", "C", "D"];
      db.prepare(`
        INSERT OR REPLACE INTO cb.content_bank (
          exam_body, year, subject_code, paper_type, question_text, options_json, correct_answer, difficulty, topic_tag
        ) VALUES ('JAMB', ?, ?, 'CBT', ?, ?, ?, ?, ?)
      `).run(s.year, s.code, q.text, JSON.stringify(q.options), optionLetters[q.answer] ?? "A", q.difficulty, q.topic);
    }
    
    // Auto-enroll all students in this subject so it shows up on their dashboards
    const students = db.prepare("SELECT id FROM users WHERE role = 'student'").all() as any[];
    for (const stud of students) {
      db.prepare("INSERT OR IGNORE INTO subject_enrollments (subject_id, student_id, enrolled_by) VALUES (?, ?, ?)")
        .run(subject.id, stud.id, operator.id);
    }
    
    console.log(`Successfully seeded ${s.questions.length} questions for ${subjectName} and enrolled all ${students.length} students.`);
  }
})();

console.log("Seeding complete!");
process.exit(0);
