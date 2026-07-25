"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import { useMonotonicTimer } from "../../../hooks/useMonotonicTimer";
import { useSingleInstance } from "../../../hooks/useSingleInstance";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useToast } from "../../../hooks/useToast";
import { WarningIcon, ClockIcon, FlagIcon } from "../../../components/icons/Icons";
import styles from "./page.module.css";

type Mode = "loading" | "starting" | "in-progress" | "submitting" | "completed";

export default function StudentExamPage() {
  return (
    <RequireRole role="student">
      <Suspense fallback={<main className={styles.page} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}><div className="spinner" /></main>}>
        <ExamContent />
      </Suspense>
    </RequireRole>
  );
}

function ExamContent() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const subjectId    = Number(searchParams.get("subjectId") || 0);
  const { showToast } = useToast();

  const [mode,              setMode]              = useState<Mode>("loading");
  const [error,             setError]             = useState("");
  const [subject,           setSubject]           = useState<any>(null);
  const [examId,            setExamId]            = useState<number | null>(null);
  const [questions,         setQuestions]         = useState<any[]>([]);
  const [answers,           setAnswers]           = useState<Record<number, number | string>>({});
  const [flags,             setFlags]             = useState<Record<number, boolean>>({});
  const [currentIndex,      setCurrentIndex]      = useState(0);
  const [showResume,        setShowResume]        = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [online,            setOnline]            = useState(true);
  const [timerSeed,         setTimerSeed]         = useState(0);
  const [isFocusMode,       setIsFocusMode]       = useState(false);

  const answersRef = useRef(answers);
  useEffect(() => { answersRef.current = answers; }, [answers]);

  const { blocked } = useSingleInstance(`exam-${subjectId}`);

  const buildAnswerPayload = useCallback(() => {
    return Object.entries(answersRef.current).map(([question_id, ans]) => ({
      question_id:     Number(question_id),
      selected_option: typeof ans === "number" ? ans : null,
      essay_response:  typeof ans === "string" ? ans  : null,
    }));
  }, []);

  const isSubmittingRef = useRef(false);
  const handleSubmit = useCallback(async () => {
    if (!examId || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setMode("submitting");
    try {
      await api.submitExamWithAnswers(examId, buildAnswerPayload());
      showToast("Exam submitted successfully!", "success");
      setMode("completed");
      router.replace("/student/results");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Submit failed", "error");
      setError(err instanceof Error ? err.message : "Submit failed");
      setMode("in-progress");
      isSubmittingRef.current = false;
    }
  }, [examId, buildAnswerPayload, router]);

  const remaining = useMonotonicTimer(
    timerSeed,
    useCallback(() => { handleSubmit().catch(() => undefined); }, [handleSubmit]),
  );

  useEffect(() => {
    const id = setInterval(() => setOnline(navigator.onLine), 2000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (mode !== "in-progress") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Your exam is in progress. Are you sure you want to leave?";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [mode]);

  const seedTimer = useCallback((startTimeIso: string, durationMins: number) => {
    const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(startTimeIso)) / 1000));
    const seed    = Math.max(0, durationMins * 60 - elapsed);
    setTimerSeed(seed);
  }, []);

  const startExam = useCallback(async (subjectForStart: any) => {
    setMode("starting");
    const start = await api.startExam(subjectForStart.id) as any;
    if (!start) throw new Error("Could not start exam — check that the exam window is open");
    const id = Number(start.examId ?? start.exam?.id);
    if (!id) throw new Error("Server did not return exam ID");
    setExamId(id);
    const qs = (start.questions as any[]) ?? [];
    if (qs.length > 0) {
      setQuestions(qs);
    } else {
      const fetched = ((await api.getQuestions(subjectForStart.id)) as any[]) ?? [];
      setQuestions(fetched);
    }
    seedTimer(start.startTime ?? new Date().toISOString(), Number(subjectForStart.duration));
    setMode("in-progress");
  }, [seedTimer]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setMode("loading");
      try {
        const [subjects, activeExams] = await Promise.all([
          api.getSubjects(),
          api.getActiveExams(),
        ]);
        if (!mounted) return;

        const subjectsList = ((subjects as any[]) ?? []);
        const activeExamsPayload = (activeExams as any)?.exams ?? activeExams;

        let targetSubjectId = subjectId;
        if (!targetSubjectId) {
          const inProgressAny = ((activeExamsPayload as any[]) ?? [])[0];
          if (inProgressAny && inProgressAny.subject_id) {
            targetSubjectId = Number(inProgressAny.subject_id);
          } else if (subjectsList.length > 0) {
            targetSubjectId = Number(subjectsList[0].id);
          }
        }

        if (!targetSubjectId) {
          throw new Error("No active exam selected. Please select a subject from your student dashboard.");
        }

        const s = subjectsList.find((item) => Number(item.id) === targetSubjectId);
        if (!s) throw new Error("Subject not found or you are not enrolled");
        setSubject(s);
        const inProgress = ((activeExamsPayload as any[]) ?? []).find(
          (item) => Number(item.subject_id) === targetSubjectId,
        );
        if (inProgress) {
          setExamId(Number(inProgress.id));
          try {
            const saved = JSON.parse(inProgress.answers_json || "[]") as Array<{
              question_id: number; selected_option?: number | null; essay_response?: string | null;
            }>;
            const mapped: Record<number, number | string> = {};
            for (const entry of saved) {
              if (entry.selected_option !== null && entry.selected_option !== undefined) {
                mapped[entry.question_id] = entry.selected_option;
              } else if (entry.essay_response) {
                mapped[entry.question_id] = entry.essay_response;
              }
            }
            setAnswers(mapped);
          } catch { setAnswers({}); }
          const qs = ((await api.getQuestions(subjectId)) as any[]) ?? [];
          if (!mounted) return;
          setQuestions(qs);
          seedTimer(inProgress.start_time, Number(s.duration));
          setShowResume(true);
        } else {
          await startExam(s);
        }
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : "Failed to load exam");
      }
    })();
    return () => { mounted = false; };
  }, [subjectId, startExam, seedTimer]);

  useEffect(() => {
    if (mode !== "in-progress" || !examId) return;
    const id = setInterval(() => {
      api.saveExam(examId, buildAnswerPayload()).catch(() => undefined);
    }, 30_000);
    return () => clearInterval(id);
  }, [mode, examId, buildAnswerPayload]);

  useEffect(() => {
    if (mode !== "in-progress") return;
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === "TEXTAREA" || document.activeElement?.tagName === "INPUT") return;
      const key = e.key.toLowerCase();
      const q   = questions[currentIndex];
      if (q && q.question_type !== "essay" && ["1","2","3","4"].includes(key)) {
        if (q.question_type === "true_false" && ["3","4"].includes(key)) return;
        setAnswers((prev) => ({ ...prev, [q.id]: Number(key) - 1 }));
      } else if (e.key === "ArrowRight") {
        setCurrentIndex((v) => Math.min(questions.length - 1, v + 1));
      } else if (e.key === "ArrowLeft") {
        setCurrentIndex((v) => Math.max(0, v - 1));
      } else if (key === "f") {
        if (!q) return;
        setFlags((prev) => ({ ...prev, [q.id]: !prev[q.id] }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, questions, currentIndex]);

  const handleResumeContinue = () => { setShowResume(false); setMode("in-progress"); };
  const handleResumeReset    = () => { setAnswers({}); setFlags({}); setShowResume(false); setMode("in-progress"); };

  // ── Render gates ──────────────────────────────────
  if (blocked) {
    return (
      <main className={styles.errorState}>
        <div className={styles.modalBox} style={{ textAlign: "center" }}>
          <WarningIcon width="40" height="40" style={{ color: "var(--color-warning)", margin: "0 auto 1rem" }} />
          <h3>Another tab is open</h3>
          <p style={{ color: "var(--color-muted)", fontSize: "0.9rem", marginTop: "0.5rem" }}>Please close other tabs before continuing this exam.</p>
        </div>
      </main>
    );
  }
  if (error) return (
    <main className={styles.errorState}>
      <WarningIcon width="40" height="40" style={{ color: "var(--color-danger)" }} />
      <p style={{ color: "var(--color-danger)", fontWeight: 600 }}>{error}</p>
      <button className="btn btn-ghost" onClick={() => router.back()}>← Go back</button>
    </main>
  );
  if (mode === "loading" || mode === "starting") return (
    <main className={styles.errorState}>
      <div className="spinner" />
      <p style={{ color: "var(--color-muted)" }}>Preparing exam…</p>
    </main>
  );

  const current       = questions[currentIndex];
  const timerClass    = remaining > 300 ? styles.green : remaining > 120 ? styles.yellow : styles.red;
  const answeredCount = questions.filter((q) => answers[q.id] !== undefined).length;
  const flaggedCount  = questions.filter((q) => flags[q.id]).length;

  return (
    <main className={styles.page}>

      {/* ── Resume modal ── */}
      {showResume && (
        <div className={styles.modal}>
          <div className={styles.modalBox}>
            <h3>Resume your exam?</h3>
            <p style={{ fontSize: "0.875rem", color: "var(--color-muted)", lineHeight: 1.6 }}>
              You have <strong>{Object.keys(answers).length}</strong> answered question(s) saved.<br />
              Time remaining: <strong style={{ color: "var(--color-primary)" }}>{formatTime(remaining)}</strong>
            </p>
            <div className={styles.modalActions}>
              <button className="btn btn-primary" onClick={handleResumeContinue}>Continue</button>
              <button className="btn btn-ghost" onClick={handleResumeReset}>Start fresh</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Submit confirm modal ── */}
      {showSubmitConfirm && (
        <div className={styles.modal}>
          <div className={styles.modalBox}>
            <h3>Submit Exam?</h3>
            <p style={{ color: "var(--color-muted)", fontSize: "0.9rem", marginTop: "0.25rem" }}>
              Answered: <strong>{answeredCount}</strong> / {questions.length}
            </p>
            {questions.length - answeredCount > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.75rem", padding: "0.75rem 1rem", background: "var(--color-warning-bg)", borderRadius: "var(--radius-md)", color: "var(--color-warning)", fontSize: "0.875rem", fontWeight: 600 }}>
                <WarningIcon width="16" height="16" />
                {questions.length - answeredCount} question(s) unanswered
              </div>
            )}
            <div className={styles.modalActions}>
              <button className="btn btn-ghost" onClick={() => setShowSubmitConfirm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => { setShowSubmitConfirm(false); handleSubmit(); }}>
                Confirm Submit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Top bar ── */}
      <header className={styles.topbar}>
        <h2>{subject?.name || "Exam"}</h2>
        <p className={timerClass} style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.95rem", flexShrink: 0 }}>
          <ClockIcon width="15" height="15" /> {formatTime(remaining)}
        </p>
        <p style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem", flexShrink: 0 }}>
          <span style={{ color: online ? "#22c55e" : "#ef4444", fontSize: "1.1rem" }}>●</span>
          <span style={{ color: "var(--color-muted)" }}>{online ? "Live" : "Offline"}</span>
        </p>
        <button
          className="btn btn-ghost"
          style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem", marginLeft: "1rem" }}
          onClick={() => setIsFocusMode(!isFocusMode)}
        >
          {isFocusMode ? "Exit Focus" : "Focus Mode"}
        </button>
      </header>

      {/* ── Main two-panel area ── */}
      <div className={`${styles.examBody} ${isFocusMode ? styles.focusMode : ""}`}>

        {/* ── Question panel ── */}
        <div className={styles.questionPanel}>

          {/* Question card */}
          {current ? (
            <div className={styles.questionCard}>
              <div className={styles.questionMeta}>
                <span className={styles.questionNumber}>
                  Q{currentIndex + 1} of {questions.length}
                  {current.marks && <> · {current.marks} mark{current.marks > 1 ? "s" : ""}</>}
                </span>
                {flags[current.id] && (
                  <span style={{ display: "flex", alignItems: "center", gap: "0.3rem", color: "var(--color-warning)", fontSize: "0.8rem", fontWeight: 700 }}>
                    <FlagIcon width="13" height="13" /> Flagged
                  </span>
                )}
              </div>

              <p className={styles.questionText}>{current.question_text}</p>

              {current.image_url && (
                <img
                  src={current.image_url}
                  alt="Question diagram"
                  style={{ maxWidth: "100%", borderRadius: "var(--radius-md)", marginBottom: "1.25rem", border: "1px solid var(--color-border)" }}
                />
              )}

              {current.question_type === "essay" ? (
                <textarea
                  className={styles.essayTextarea}
                  placeholder="Write your answer here…"
                  value={(answers[current.id] as string) || ""}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [current.id]: e.target.value }))}
                />
              ) : (
                <div className={styles.options}>
                  {safeOptions(current.options_json)
                    .slice(0, current.question_type === "true_false" ? 2 : 4)
                    .map((option, idx) =>
                      option || current.question_type !== "objective" ? (
                        <button
                          key={idx}
                          className={answers[current.id] === idx ? styles.optionActive : styles.option}
                          onClick={() => setAnswers((prev) => ({ ...prev, [current.id]: idx }))}
                        >
                          <span className={styles.optionLabel}>
                            {current.question_type === "true_false" ? (idx === 0 ? "T" : "F") : String.fromCharCode(65 + idx)}
                          </span>
                          {current.question_type === "true_false"
                            ? ["True", "False"][idx]
                            : option}
                        </button>
                      ) : null
                    )}
                </div>
              )}
            </div>
          ) : (
            <div className={styles.questionCard}>
              <p style={{ color: "var(--color-danger)" }}>No questions found. Please contact your teacher.</p>
            </div>
          )}

          {/* Navigation row */}
          <div className={styles.navRow}>
            <button className="btn btn-ghost" onClick={() => setCurrentIndex((v) => Math.max(0, v - 1))}>← Prev</button>
            <button
              className="btn btn-ghost"
              onClick={() => current && setFlags((prev) => ({ ...prev, [current.id]: !prev[current.id] }))}
              style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}
            >
              <FlagIcon width="13" height="13" />
              {current && flags[current.id] ? "Unflag" : "Flag"}
            </button>
            <button className="btn btn-ghost" onClick={() => setCurrentIndex((v) => Math.min(questions.length - 1, v + 1))}>Next →</button>
            <button
              className="btn btn-primary"
              onClick={() => setShowSubmitConfirm(true)}
              disabled={mode === "submitting"}
              style={{ fontWeight: 700 }}
            >
              {mode === "submitting" ? "Submitting…" : `Submit (${answeredCount}/${questions.length})`}
            </button>
          </div>
        </div>

        {/* ── Right sidebar ── */}
        <aside className={styles.sidePanel}>
          <div className={styles.sidePanelHeader}>Question Navigator</div>

          {/* Stats row */}
          <div className={styles.sidePanelStats}>
            <div className={styles.sideStat}>
              <div className={styles.sideStatVal} style={{ color: "var(--color-success)" }}>{answeredCount}</div>
              <div className={styles.sideStatLbl}>Answered</div>
            </div>
            <div className={styles.sideStat}>
              <div className={styles.sideStatVal} style={{ color: "var(--color-danger)" }}>{questions.length - answeredCount}</div>
              <div className={styles.sideStatLbl}>Remaining</div>
            </div>
            <div className={styles.sideStat}>
              <div className={styles.sideStatVal} style={{ color: "var(--color-warning)" }}>{flaggedCount}</div>
              <div className={styles.sideStatLbl}>Flagged</div>
            </div>
            <div className={styles.sideStat}>
              <div className={styles.sideStatVal}>{questions.length}</div>
              <div className={styles.sideStatLbl}>Total</div>
            </div>
          </div>

          {/* Question grid */}
          <div className={styles.grid}>
            {questions.map((q, idx) => {
              const cls =
                idx === currentIndex        ? styles.current   :
                answers[q.id] !== undefined ? styles.answered  :
                flags[q.id]                 ? styles.flagged   :
                                              styles.unanswered;
              return (
                <button key={q.id} className={cls} onClick={() => setCurrentIndex(idx)} title={`Q${idx + 1}`}>
                  {idx + 1}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className={styles.gridLegend}>
            {[
              { label: "Answered",  color: "rgba(16,185,129,0.4)" },
              { label: "Flagged",   color: "rgba(245,158,11,0.4)" },
              { label: "Current",   color: "var(--color-primary)" },
              { label: "Skipped",   color: "var(--color-border)" },
            ].map((l) => (
              <span key={l.label} className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}

function safeOptions(optionsJson: string): string[] {
  try {
    const parsed = JSON.parse(optionsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}
