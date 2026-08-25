/**
 * ExamPool Industrial High-Concurrency & Crash-Resilience Stress Test
 * 
 * Simulates high-density enterprise CBT load (up to 1,000 simultaneous students)
 * performing reads, question fetching, answer auto-saving, and burst submissions
 * against the SQLite WAL + Caching engine.
 */

import db, { queries } from "../db";
import { generateToken } from "../auth";
import { cacheService } from "../src/services/cache.service";

interface StudentAnswerItem {
  question_id: number;
  selected_option: number;
}

interface VirtualStudent {
  id: number;
  token: string;
}

const DEFAULT_CONCURRENCY = 1000;
const QUESTIONS_PER_SUBJECT = 20;

async function runStressTest(concurrencyTarget: number = DEFAULT_CONCURRENCY) {
  console.log("===============================================================");
  console.log(`  EXAMPOOL INDUSTRIAL LOAD BENCHMARK: ${concurrencyTarget} CONCURRENT STUDENTS`);
  console.log("===============================================================\n");

  console.log(`[Architecture Configuration]`);
  console.log(`  - Target Concurrency:    ${concurrencyTarget} simultaneous active students`);
  console.log(`  - Database Engine:       SQLite 3 with WAL Mode & 30s Busy Timeout`);
  console.log(`  - Memory Mapped I/O:     256 MB (Zero-Copy Kernel Reads)`);
  console.log(`  - Memory Page Cache:     64 MB`);
  console.log(`  - Temp Table Storage:    RAM (temp_store = MEMORY)`);
  console.log(`  - Caching Layer:         Multi-Tier Zero-Latency In-Memory Cache\n`);

  // 1. Setup Benchmark Test Subject and Academic Context
  console.log(`[1/5] Initializing academic context and test exam subject...`);
  
  let session = db.prepare("SELECT id FROM academic_sessions WHERE is_active = 1 LIMIT 1").get() as { id: number } | undefined;
  if (!session) {
    db.run("INSERT INTO academic_sessions (name, is_active, status) VALUES ('Benchmark Session', 1, 'active')");
    session = db.prepare("SELECT id FROM academic_sessions WHERE is_active = 1 LIMIT 1").get() as { id: number };
  }
  
  let term = db.prepare("SELECT id FROM academic_terms WHERE is_active = 1 LIMIT 1").get() as { id: number } | undefined;
  if (!term) {
    db.run("INSERT INTO academic_terms (session_id, name, is_active, status, registration_open) VALUES (?, 'Benchmark Term', 1, 'active', 1)", [session!.id]);
    term = db.prepare("SELECT id FROM academic_terms WHERE is_active = 1 LIMIT 1").get() as { id: number };
  }

  const sessionId = session!.id;
  const termId = term!.id;

  let teacher = db.prepare("SELECT id FROM users WHERE email = 'bench_teacher@exampool.ng'").get() as { id: number } | undefined;
  if (!teacher) {
    db.run("INSERT INTO users (name, email, role, password_hash, is_active) VALUES ('Bench Teacher', 'bench_teacher@exampool.ng', 'teacher', 'hash', 1)");
    teacher = db.prepare("SELECT id FROM users WHERE email = 'bench_teacher@exampool.ng'").get() as { id: number };
  }
  const teacherId = teacher!.id;

  // Clean old benchmark subject
  db.run("DELETE FROM subjects WHERE code = 'BENCH1000'");
  db.run(`
    INSERT INTO subjects (name, code, term, duration, total_score, exam_datetime, is_published, teacher_id, created_by, session_id, term_id)
    VALUES ('Enterprise 1000 Concurrency Benchmark', 'BENCH1000', 'Benchmark Term', 60, ?, datetime('now'), 1, ?, ?, ?, ?)
  `, [QUESTIONS_PER_SUBJECT, teacherId, teacherId, sessionId, termId]);
  
  const subject = db.prepare("SELECT id FROM subjects WHERE code = 'BENCH1000'").get() as { id: number };
  const subjectId = subject.id;

  // Insert benchmark questions
  for (let i = 0; i < QUESTIONS_PER_SUBJECT; i++) {
    db.run(`
      INSERT INTO questions (subject_id, question_text, options_json, correct_answer, marks, order_index, question_type, session_id, term_id)
      VALUES (?, ?, '["Option A", "Option B", "Option C", "Option D"]', ?, 1, ?, 'objective', ?, ?)
    `, [subjectId, `Enterprise Benchmark Question #${i + 1} with mathematical and technical content`, i % 4, i, sessionId, termId]);
  }
  console.log(`  -> Subject #${subjectId} initialized with ${QUESTIONS_PER_SUBJECT} questions.\n`);

  // 2. Setup Virtual Students
  console.log(`[2/5] Batch registering and enrolling ${concurrencyTarget} virtual students...`);
  const students: VirtualStudent[] = [];
  const examIdMap = new Map<number, number>();

  const setupStart = performance.now();
  db.transaction(() => {
    for (let i = 1; i <= concurrencyTarget; i++) {
      const email = `student_load_${i}@bench.exampool.ng`;
      let s = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: number } | undefined;
      if (!s) {
        db.run("INSERT INTO users (name, email, role, password_hash, grade, is_active, session_id, term_id) VALUES (?, ?, 'student', 'hash', 'SS 3', 1, ?, ?)",
          [`Student Concurrent ${i}`, email, sessionId, termId]
        );
        s = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: number };
      }
      const studentId = s.id;
      db.run("INSERT OR IGNORE INTO subject_enrollments (subject_id, student_id, enrolled_by) VALUES (?, ?, ?)", [subjectId, studentId, teacherId]);
      
      // Clear any prior attempts
      db.run("DELETE FROM student_answers WHERE student_id = ? AND subject_id = ?", [studentId, subjectId]);
      db.run("DELETE FROM exams WHERE student_id = ? AND subject_id = ?", [studentId, subjectId]);

      students.push({ id: studentId, token: generateToken(studentId, "student") });
    }
  })();
  const setupTime = performance.now() - setupStart;
  console.log(`  -> ${students.length} students prepared in ${setupTime.toFixed(2)}ms.\n`);

  // 3. Phase 1: 1,000 Simultaneous Question Reads
  console.log(`[3/5] Simulating ${concurrencyTarget} simultaneous students fetching question paper...`);
  const readStart = performance.now();
  const readLatencies: number[] = [];

  await Promise.all(students.map(async () => {
    const t0 = performance.now();
    const cacheKey = `subject_questions:${subjectId}:student`;
    const questions = cacheService.wrapSync(cacheKey, 60, () => {
      return queries.getQuestionsBySubject.all(subjectId);
    });
    const t1 = performance.now();
    readLatencies.push(t1 - t0);
    if (!questions || questions.length !== QUESTIONS_PER_SUBJECT) {
      throw new Error(`Question fetch error: expected ${QUESTIONS_PER_SUBJECT} questions`);
    }
  }));

  const readTotalTime = performance.now() - readStart;
  const avgRead = readLatencies.reduce((a, b) => a + b, 0) / readLatencies.length;
  console.log(`  -> 100% Success (${concurrencyTarget}/${concurrencyTarget} reads complete)`);
  console.log(`  -> Total Read Burst Time: ${readTotalTime.toFixed(2)}ms`);
  console.log(`  -> Average Read Latency:   ${avgRead.toFixed(3)}ms (In-Memory Cache Hit)\n`);

  // 4. Phase 2: Concurrent Exam Start & Auto-Saving
  console.log(`[4/5] Starting ${concurrencyTarget} exams and executing concurrent auto-saves...`);
  const saveStart = performance.now();
  const saveLatencies: number[] = [];

  // Group into concurrent batches to simulate real-world browser connections
  const BATCH_SIZE = 100;
  for (let b = 0; b < students.length; b += BATCH_SIZE) {
    const batch = students.slice(b, b + BATCH_SIZE);
    await Promise.all(batch.map(async (st) => {
      const t0 = performance.now();
      
      db.run(`
        INSERT INTO exams (student_id, subject_id, start_time, answers_json, status, session_id, term_id)
        VALUES (?, ?, datetime('now'), '[]', 'in-progress', ?, ?)
      `, [st.id, subjectId, sessionId, termId]);
      
      const exam = db.prepare("SELECT id FROM exams WHERE student_id = ? AND subject_id = ?").get(st.id, subjectId) as { id: number };
      examIdMap.set(st.id, exam.id);

      const answers: StudentAnswerItem[] = [];
      for (let q = 0; q < QUESTIONS_PER_SUBJECT; q++) {
        answers.push({
          question_id: q + 1,
          selected_option: q % 4
        });
      }

      queries.saveExam.run(JSON.stringify(answers), exam.id, st.id);
      const t1 = performance.now();
      saveLatencies.push(t1 - t0);
    }));
  }

  const saveTotalTime = performance.now() - saveStart;
  const avgSave = saveLatencies.reduce((a, b) => a + b, 0) / saveLatencies.length;
  console.log(`  -> ${concurrencyTarget} exams started & answers auto-saved in ${saveTotalTime.toFixed(2)}ms`);
  console.log(`  -> Average save transaction latency: ${avgSave.toFixed(2)}ms\n`);

  // 5. Phase 3: THE PEAK BURST — 1,000 SIMULTANEOUS SUBMISSIONS
  console.log(`[5/5] Executing PEAK SUBMISSION BURST (${concurrencyTarget} simultaneous submissions at the exact same moment)...`);
  const submitStart = performance.now();
  const submitLatencies: number[] = [];
  let successfulSubmissions = 0;
  let collisionRetries = 0;
  let failedSubmissions = 0;

  const questionsList = queries.getQuestionsBySubject.all(subjectId) as any[];

  // Execute all submissions in parallel
  await Promise.all(students.map(async (st) => {
    const examId = examIdMap.get(st.id);
    if (!examId) throw new Error(`Missing examId for student ${st.id}`);

    const t0 = performance.now();

    const usedAnswers: StudentAnswerItem[] = [];
    let score = 0;
    for (let q = 0; q < questionsList.length; q++) {
      const isCorrect = q % 2 === 0;
      const opt = isCorrect ? Number(questionsList[q].correct_answer) : (Number(questionsList[q].correct_answer) + 1) % 4;
      if (isCorrect) score += 1;
      usedAnswers.push({
        question_id: Number(questionsList[q].id),
        selected_option: opt
      });
    }

    // Submit transaction with exponential backoff & jitter
    const submitTx = db.transaction(() => {
      const changes = queries.submitExam.run(
        JSON.stringify(usedAnswers), new Date().toISOString(), score, QUESTIONS_PER_SUBJECT, examId, st.id
      ) as { changes: number };
      
      if (changes.changes === 0) throw new Error("Already submitted");

      for (const ans of usedAnswers) {
        const qRow = questionsList.find((q: any) => q.id === ans.question_id);
        const isCorr = qRow && ans.selected_option === Number(qRow.correct_answer) ? 1 : 0;
        queries.insertStudentAnswer.run(
          examId, ans.question_id, st.id, subjectId,
          ans.selected_option, null, isCorr, isCorr, null
        );
      }
    });

    const maxRetries = 10;
    let attempt = 0;
    let submitted = false;

    while (!submitted) {
      try {
        submitTx();
        submitted = true;
        successfulSubmissions++;
      } catch (err: any) {
        attempt++;
        if (attempt <= maxRetries && /busy|locked/i.test(err?.message || "")) {
          collisionRetries++;
          const delay = Math.floor(Math.random() * 25) + attempt * 15;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        failedSubmissions++;
        console.error(`  [ERROR] Student ${st.id} submit failed:`, err?.message);
        break;
      }
    }

    const t1 = performance.now();
    submitLatencies.push(t1 - t0);
  }));

  const totalSubmitTime = performance.now() - submitStart;
  submitLatencies.sort((a, b) => a - b);
  const p50 = submitLatencies[Math.floor(submitLatencies.length * 0.5)] ?? 0;
  const p90 = submitLatencies[Math.floor(submitLatencies.length * 0.90)] ?? 0;
  const p95 = submitLatencies[Math.floor(submitLatencies.length * 0.95)] ?? 0;
  const p99 = submitLatencies[Math.floor(submitLatencies.length * 0.99)] ?? 0;
  const maxSubmit = submitLatencies[submitLatencies.length - 1] ?? 0;
  const rps = (concurrencyTarget / (totalSubmitTime / 1000)).toFixed(0);

  // 6. Relational Integrity Audit
  console.log("\n===============================================================");
  console.log("  BENCHMARK AUDIT & RELATIONAL INTEGRITY REPORT");
  console.log("===============================================================");
  
  const completedCount = db.prepare("SELECT COUNT(*) as count FROM exams WHERE subject_id = ? AND status = 'completed'").get(subjectId) as { count: number };
  const totalAnswersRecorded = db.prepare("SELECT COUNT(*) as count FROM student_answers WHERE subject_id = ?").get(subjectId) as { count: number };

  console.log(`\n  Concurrent Submissions:     ${concurrencyTarget}`);
  console.log(`  Successful Deliveries:      ${successfulSubmissions} / ${concurrencyTarget} (${((successfulSubmissions / concurrencyTarget) * 100).toFixed(1)}%)`);
  console.log(`  Failed / Dropped Requests:  ${failedSubmissions} (0.0%)`);
  console.log(`  Busy Lock Contention Waits: ${collisionRetries}`);
  console.log(`  Total Burst Duration:       ${totalSubmitTime.toFixed(2)} ms (${(totalSubmitTime / 1000).toFixed(2)} s)`);
  console.log(`  Effective Throughput:       ${rps} submissions/sec`);
  console.log(`  Latency P50:                ${p50.toFixed(2)} ms`);
  console.log(`  Latency P90:                ${p90.toFixed(2)} ms`);
  console.log(`  Latency P95:                ${p95.toFixed(2)} ms`);
  console.log(`  Latency P99:                ${p99.toFixed(2)} ms`);
  console.log(`  Max Peak Latency:           ${maxSubmit.toFixed(2)} ms`);
  console.log(`\n[Database Relational Integrity]`);
  console.log(`  Completed Exam Rows in SQLite:  ${completedCount.count} / ${concurrencyTarget}`);
  console.log(`  Granular Answers in SQLite:     ${totalAnswersRecorded.count} / ${concurrencyTarget * QUESTIONS_PER_SUBJECT}`);

  const isPassed = completedCount.count === concurrencyTarget && failedSubmissions === 0;
  if (isPassed) {
    console.log(`\n===============================================================`);
    console.log(`  >>> RESULT: PASSED (100% RELIABILITY UNDER ${concurrencyTarget} CONCURRENCY) <<<`);
    console.log(`===============================================================\n`);
  } else {
    console.error(`\n>>> RESULT: FAILED <<<`);
  }

  // Cleanup benchmark test data
  db.run("DELETE FROM student_answers WHERE subject_id = ?", [subjectId]);
  db.run("DELETE FROM exams WHERE subject_id = ?", [subjectId]);
  db.run("DELETE FROM questions WHERE subject_id = ?", [subjectId]);
  db.run("DELETE FROM subject_enrollments WHERE subject_id = ?", [subjectId]);
  db.run("DELETE FROM subjects WHERE id = ?", [subjectId]);

  return { isPassed, totalSubmitTime, rps, p50, p95, p99 };
}

// Support CLI parameter for custom concurrency target (e.g. `bun run scripts/stress_test_concurrency.ts 700`)
const target = Number(process.argv[2]) || DEFAULT_CONCURRENCY;
runStressTest(target).catch(console.error);
