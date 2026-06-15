"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import { useMonotonicTimer } from "../../../hooks/useMonotonicTimer";
import { useSingleInstance } from "../../../hooks/useSingleInstance";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useToast } from "../../../hooks/useToast";
import { WarningIcon, ClockIcon, FlagIcon, CheckCircleIcon, DocumentIcon } from "../../../components/icons/Icons";
import styles from "./page.module.css";

import { Scratchpad } from "../../../components/student/Scratchpad";
import { Calculator } from "../../../components/student/Calculator";

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
  const [online,            setOnline]            = useState(true);
  const [timerSeed,         setTimerSeed]         = useState(0);
  const [isFocusMode,       setIsFocusMode]       = useState(false);
  const [showInstructions,  setShowInstructions]  = useState(false);
  const [saveStatus,        setSaveStatus]        = useState<"idle" | "syncing" | "saved" | "offline">("idle");
  const [cheatWarnings,     setCheatWarnings]     = useState(0);
  const [isTabFocused,      setIsTabFocused]      = useState(true);
  const [scoreResult,       setScoreResult]       = useState<{score: number, total_score: number} | null>(null);
  const [showScratchpad,    setShowScratchpad]    = useState(false);
  const [showCalculator,    setShowCalculator]    = useState(false);

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
      const res = await api.submitExamWithAnswers(examId, buildAnswerPayload());
      setScoreResult(res as any);
      showToast("Exam submitted successfully!", "success");
      setMode("completed");
      fireConfetti();
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

  const seedTimer = useCallback((startTimeIso: string, durationMins: number, serverTimeIso?: string) => {
    const now = serverTimeIso ? Date.parse(serverTimeIso) : Date.now();
    const elapsed = Math.max(0, Math.floor((now - Date.parse(startTimeIso)) / 1000));
    const seed    = Math.max(0, durationMins * 60 - elapsed);
    setTimerSeed(seed);
  }, []);

  const startExam = useCallback(async (subjectForStart: any) => {
    setMode("starting");
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen().catch(() => console.warn("Fullscreen denied"));
      }
      const start = await api.startExam(subjectForStart.id) as any;
      if (!start) throw new Error("Could not start exam — check that the exam window is open");
      const id = Number(start.examId ?? start.exam?.id);
      if (!id) throw new Error("Server did not return exam ID");
      setExamId(id);
      localStorage.removeItem(`exam_answers_${id}`);
      const qs = (start.questions as any[]) ?? [];
      if (qs.length > 0) {
        setQuestions(qs);
      } else {
        const fetched = ((await api.getQuestions(subjectForStart.id)) as any[]) ?? [];
        setQuestions(fetched);
      }
      seedTimer(start.startTime ?? new Date().toISOString(), Number(subjectForStart.duration), start.server_time);
      setMode("in-progress");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start exam. The exam window might be closed.");
      setMode("error" as any); // fallback mode, the render block catches `error` state regardless
    }
  }, [seedTimer]);

  useEffect(() => {
    if (!subjectId) { setError("Missing subjectId"); return; }
    let mounted = true;
    (async () => {
      setMode("loading");
      try {
        const [subjects, activeExams] = await Promise.all([
          api.getSubjects(),
          api.getActiveExams(),
        ]);
        if (!mounted) return;
        const s = ((subjects as any[]) ?? []).find((item) => Number(item.id) === subjectId);
        if (!s) throw new Error("Subject not found or you are not enrolled");
        setSubject(s);
        const activeExamsPayload = (activeExams as any)?.exams ?? activeExams;
        const serverTime = (activeExams as any)?.server_time;

        const inProgress = ((activeExamsPayload as any[]) ?? []).find(
          (item) => Number(item.subject_id) === subjectId,
        );
        if (inProgress) {
          setExamId(Number(inProgress.id));
          let mapped: Record<number, number | string> = {};
          try {
            let lsMapped: Record<number, number | string> = {};
            let serverMapped: Record<number, number | string> = {};

            const saved = JSON.parse(inProgress.answers_json || "[]") as Array<{
              question_id: number; selected_option?: number | null; essay_response?: string | null;
            }>;
            for (const entry of saved) {
              if (entry.selected_option !== null && entry.selected_option !== undefined) {
                serverMapped[entry.question_id] = entry.selected_option;
              } else if (entry.essay_response) {
                serverMapped[entry.question_id] = entry.essay_response;
              }
            }

            const ls = localStorage.getItem(`exam_answers_${inProgress.id}`);
            if (ls) {
              try { lsMapped = JSON.parse(ls); } catch {}
            }

            // Smart Merge: Prefer local state only if it contains MORE answers (i.e. student was offline and hasn't synced).
            // Otherwise, strictly rely on the server state to prevent a stale computer from wiping out progress.
            if (Object.keys(lsMapped).length > Object.keys(serverMapped).length) {
              mapped = { ...serverMapped, ...lsMapped };
            } else {
              mapped = serverMapped;
            }
            
            setAnswers(mapped);
          } catch { setAnswers({}); }
          const qs = ((await api.getQuestions(subjectId)) as any[]) ?? [];
          if (!mounted) return;
          setQuestions(qs);
          seedTimer(inProgress.start_time, Number(s.duration), serverTime);
          
          if (Object.keys(mapped).length === 0) {
            if (!document.fullscreenElement) {
              document.documentElement.requestFullscreen().catch(() => {});
            }
            setMode("in-progress");
          } else {
            setShowResume(true);
          }
        } else {
          setShowInstructions(true);
        }
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : "Failed to load exam");
      }
    })();
    return () => { mounted = false; };
  }, [subjectId, startExam, seedTimer]);

  useEffect(() => {
    if (!examId || mode !== "in-progress") return;
    localStorage.setItem(`exam_answers_${examId}`, JSON.stringify(answers));
  }, [answers, examId, mode]);

  useEffect(() => {
    if (mode !== "in-progress" || !examId) return;
    const id = setInterval(() => {
      if (!navigator.onLine) {
        setSaveStatus("offline");
        return;
      }
      setSaveStatus("syncing");
      api.saveExam(examId, buildAnswerPayload())
        .then(() => {
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus("idle"), 3000);
        })
        .catch(() => setSaveStatus("offline"));
    }, 30_000 + Math.floor(Math.random() * 5000));
    return () => clearInterval(id);
  }, [mode, examId, buildAnswerPayload]);

  useEffect(() => {
    if (mode !== "in-progress") return;
    const onBlur = () => {
      setIsTabFocused(false);
      setCheatWarnings((w) => {
        const next = w + 1;
        if (next >= 3) {
           handleSubmit();
        } else {
           showToast(`Warning: Please stay on the exam tab. (${next}/3 warnings)`, "error");
        }
        return next;
      });
    };
    const onFocus = () => setIsTabFocused(true);

    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setCheatWarnings((w) => {
          const next = w + 1;
          if (next >= 3) {
             handleSubmit();
          } else {
             showToast(`Warning: You exited fullscreen. (${next}/3 warnings)`, "error");
          }
          return next;
        });
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);

    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [mode, handleSubmit, showToast]);

  useEffect(() => {
    if (mode !== "in-progress") return;
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === "TEXTAREA" || document.activeElement?.tagName === "INPUT") return;
      const key = e.key.toLowerCase();
      const q   = questions[currentIndex];
      if (q && q.question_type !== "essay") {
        if (["1","2","3","4"].includes(key)) {
          if (q.question_type === "true_false" && ["3","4"].includes(key)) return;
          setAnswers((prev) => ({ ...prev, [q.id]: Number(key) - 1 }));
        } else if (q.question_type === "true_false") {
          if (key === "t") setAnswers((prev) => ({ ...prev, [q.id]: 0 }));
          if (key === "f") setAnswers((prev) => ({ ...prev, [q.id]: 1 }));
        }
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

  const handleResumeContinue = async () => { 
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen().catch(() => {});
    setShowResume(false); 
    setMode("in-progress"); 
  };
  const handleResumeReset    = async () => { 
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen().catch(() => {});
    setAnswers({}); 
    setFlags({}); 
    setShowResume(false); 
    setMode("in-progress"); 
  };

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
  if (showInstructions) {
    return (
      <main className={styles.page} style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "var(--color-bg)" }}>
        <div className="animate-enter" style={{ width: "100%", maxWidth: "700px", padding: "3rem", background: "var(--glass-bg)", backdropFilter: "var(--glass-blur)", borderRadius: "var(--radius-xl)", border: "1px solid var(--glass-border)", boxShadow: "0 20px 40px rgba(0,0,0,0.08)" }}>
          <div style={{ textAlign: "center", marginBottom: "2rem" }}>
            <div style={{ display: "inline-flex", background: "var(--color-primary-glow)", color: "var(--color-primary)", padding: "1rem", borderRadius: "50%", marginBottom: "1rem" }}>
              <DocumentIcon width="32" height="32" />
            </div>
            <h2 style={{ fontSize: "1.75rem", fontWeight: 800, color: "var(--color-text)", margin: 0 }}>Exam Instructions</h2>
            <p style={{ color: "var(--color-muted)", marginTop: "0.5rem" }}>{subject?.name || "Please read carefully before proceeding"}</p>
          </div>
          
          <div style={{ maxHeight: "40vh", overflowY: "auto", margin: "1.5rem 0", padding: "1.5rem", background: "#fff", borderRadius: "var(--radius-lg)", whiteSpace: "pre-wrap", fontSize: "1rem", color: "var(--color-text)", lineHeight: 1.7, border: "1px solid var(--color-border)", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.02)" }}>
            {subject?.instructions || "No specific instructions provided. Please read each question carefully and manage your time."}
          </div>
          
          <div style={{ display: "flex", gap: "1rem", justifyContent: "center", marginTop: "2.5rem" }}>
            <button className="btn btn-ghost" onClick={() => router.push("/student/dashboard")} style={{ padding: "0.75rem 2rem" }}>Cancel & Return</button>
            <button className="btn btn-primary" onClick={() => { setShowInstructions(false); startExam(subject); }} style={{ padding: "0.75rem 3rem", fontSize: "1.1rem", boxShadow: "0 8px 24px rgba(15,118,110,0.25)" }}>
              Start Exam →
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (showResume) {
    return (
      <main className={`${styles.page} ${styles.errorState}`}>
        <div className={styles.modalBox} style={{ background: "var(--color-surface)", padding: "2rem", borderRadius: "var(--radius-xl)", border: "1px solid var(--color-border)", boxShadow: "var(--shadow-lg)" }}>
          <h3 style={{ fontSize: "1.4rem", fontWeight: 800, marginBottom: "0.5rem" }}>Resume your exam?</h3>
          <p style={{ fontSize: "0.95rem", color: "var(--color-muted)", lineHeight: 1.6, marginBottom: "1.5rem" }}>
            You have <strong>{Object.keys(answers).length}</strong> answered question(s) saved.<br />
            Time remaining: <strong style={{ color: "var(--color-primary)" }}>{formatTime(remaining)}</strong>
          </p>
          <div style={{ display: "flex", gap: "1rem" }}>
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }} onClick={handleResumeContinue}>Continue</button>
            <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={handleResumeReset}>Start fresh</button>
          </div>
        </div>
      </main>
    );
  }

  if (mode === "loading" || mode === "starting") return (
    <main className={styles.errorState}>
      <div className="spinner" />
      <p style={{ color: "var(--color-muted)" }}>Preparing exam…</p>
    </main>
  );

  if (mode === "completed") return (
    <main className={styles.errorState}>
      <div style={{ textAlign: "center", padding: "3rem", background: "var(--color-surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--color-border)", boxShadow: "var(--shadow-md)", minWidth: "360px" }}>
        <h2 style={{ fontSize: "1.5rem", color: "var(--color-success)", marginBottom: "1.5rem" }}>Exam Completed Successfully</h2>
        {scoreResult && <DonutChart score={scoreResult.score} total={scoreResult.total_score} />}
        <p style={{ color: "var(--color-muted)", marginBottom: "2rem" }}>Your answers have been saved and graded.</p>
        <button className="btn btn-primary" onClick={() => router.replace("/student/dashboard")} style={{ width: "100%" }}>Return to Dashboard</button>
      </div>
    </main>
  );

  const current       = questions[currentIndex];
  const timerClass    = remaining > 300 ? styles.green : remaining > 60 ? styles.yellow : styles.red;
  const answeredCount = questions.filter((q) => answers[q.id] !== undefined).length;
  const flaggedCount  = questions.filter((q) => flags[q.id]).length;



  return (
    <main className={`${styles.page} ${!isTabFocused ? styles.blurred : ""}`}>
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




      {/* ── Top bar ── */}
      <header className={styles.topbar}>
        <h2>{subject?.name || "Exam"}</h2>
        <p className={timerClass} style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.95rem", flexShrink: 0 }}>
          <ClockIcon width="15" height="15" /> {formatTime(remaining)}
        </p>

        {/* Auto-Save Indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.75rem", flexShrink: 0, minWidth: "100px", justifyContent: "center" }}>
          {saveStatus === "syncing" && <><div className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> <span style={{ color: "var(--color-muted)" }}>Syncing...</span></>}
          {saveStatus === "saved" && <><CheckCircleIcon width="14" height="14" style={{ color: "var(--color-success)" }} /> <span style={{ color: "var(--color-success)" }}>Saved to Server</span></>}
          {saveStatus === "offline" && <><WarningIcon width="14" height="14" style={{ color: "var(--color-warning)" }} /> <span style={{ color: "var(--color-warning)" }}>Queued Offline</span></>}
        </div>

        <p style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem", flexShrink: 0 }}>
          <span style={{ color: online ? "#22c55e" : "#ef4444", fontSize: "1.1rem" }}>●</span>
          <span style={{ color: "var(--color-muted)" }}>{online ? "Live" : "Offline"}</span>
        </p>
        <div className={styles.topbarRight}>
          <button className="btn btn-ghost" style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }} onClick={() => setShowScratchpad(!showScratchpad)}>
            Scratchpad
          </button>
          <button className="btn btn-ghost" style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }} onClick={() => setShowCalculator(!showCalculator)}>
            Calculator
          </button>
          <button
            className="btn btn-ghost"
            style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem", marginLeft: "1rem" }}
            onClick={() => setIsFocusMode(!isFocusMode)}
          >
            {isFocusMode ? "Exit Focus" : "Focus Mode"}
          </button>
        </div>
      </header>

      {/* Tools Overlays */}
      {showScratchpad && <Scratchpad onClose={() => setShowScratchpad(false)} />}
      {showCalculator && <Calculator onClose={() => setShowCalculator(false)} />}

      {/* ── Main two-panel area ── */}
      <div className={`${styles.examBody} ${isFocusMode ? styles.focusMode : ""}`}>

        {/* ── Question panel ── */}
        <div className={styles.questionPanel}>
          <div className={styles.questionScrollArea}>
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

                <div className={current.image_url ? styles.questionSplitLayout : ""}>
                  {current.image_url && (
                    <div className={styles.imageWrapper}>
                      <img
                        src={current.image_url}
                        alt="Question diagram"
                        className={styles.questionImg}
                      />
                    </div>
                  )}

                  <div className={current.image_url ? styles.questionContentRight : ""}>
                    <p className={styles.questionText}>{current.question_text}</p>

                    {current.question_type === "essay" ? (
                      <textarea
                        className={styles.essayTextarea}
                        placeholder="Write your answer here…"
                        value={(answers[current.id] as string) || ""}
                        onChange={(e) => setAnswers((prev) => ({ ...prev, [current.id]: e.target.value }))}
                      />
                    ) : (
                      (() => {
                        const opts = current.question_type === "true_false" ? ["True", "False"] : safeOptions(current.options_json).slice(0, 4);
                        const validOpts = opts.filter(Boolean);
                        if (validOpts.length === 0) {
                          return (
                            <input
                              type="text"
                              className="input"
                              style={{ width: "100%", padding: "1rem", fontSize: "1rem", borderRadius: "var(--radius-lg)" }}
                              placeholder="Type your short answer..."
                              value={(answers[current.id] as string) || ""}
                              onChange={(e) => setAnswers((prev) => ({ ...prev, [current.id]: e.target.value }))}
                            />
                          );
                        }
                        return (
                          <div className={styles.options}>
                            {opts.map((option, idx) =>
                              option ? (
                                <button
                                  key={idx}
                                  className={answers[current.id] === idx ? styles.optionActive : styles.option}
                                  onClick={() => setAnswers((prev) => ({ ...prev, [current.id]: idx }))}
                                >
                                  <span className={styles.optionLabel}>
                                    {current.question_type === "true_false" ? (idx === 0 ? "T" : "F") : String.fromCharCode(65 + idx)}
                                  </span>
                                  {option}
                                </button>
                              ) : null
                            )}
                          </div>
                        );
                      })()
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className={styles.questionCard}>
                <p style={{ color: "var(--color-danger)" }}>No questions found. Please contact your teacher.</p>
              </div>
            )}
          </div>

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
              onClick={() => handleSubmit()}
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
              <div className={styles.sideStatVal} style={{ color: "var(--color-primary)" }}>{answeredCount}</div>
              <div className={styles.sideStatLbl}>Answered</div>
            </div>
            <div className={styles.sideStat}>
              <div className={styles.sideStatVal} style={{ color: "var(--color-text)" }}>{questions.length - answeredCount}</div>
              <div className={styles.sideStatLbl}>Remaining</div>
            </div>
            <div className={styles.sideStat}>
              <div className={styles.sideStatVal} style={{ color: "var(--color-text)" }}>{flaggedCount}</div>
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
              { label: "Answered",  color: "var(--color-primary)" },
              { label: "Flagged",   color: "var(--color-text)" },
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

function fireConfetti() {
  const script = document.createElement("script");
  script.src = "https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js";
  script.onload = () => {
    (window as any).confetti({ particleCount: 150, spread: 80, origin: { y: 0.6 } });
  };
  document.body.appendChild(script);
}

function DonutChart({ score, total }: { score: number; total: number }) {
  const [value, setValue] = useState(0);
  const percentage = total > 0 ? (score / total) * 100 : 0;
  
  useEffect(() => {
    const timer = setTimeout(() => setValue(percentage), 100);
    return () => clearTimeout(timer);
  }, [percentage]);

  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (value / 100) * circumference;

  return (
    <div style={{ position: "relative", width: "160px", height: "160px", margin: "0 auto 2rem" }}>
      <svg width="160" height="160" viewBox="0 0 160 160" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="80" cy="80" r={radius} fill="none" stroke="var(--color-border)" strokeWidth="12" />
        <circle cx="80" cy="80" r={radius} fill="none" stroke="var(--color-primary)" strokeWidth="12"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{ transition: "stroke-dashoffset 1.5s cubic-bezier(0.25, 1, 0.5, 1)" }}
          strokeLinecap="round"
        />
      </svg>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: "1.75rem", fontWeight: 800, color: "var(--color-primary)", lineHeight: 1 }}>{Math.round(value)}%</span>
        <span style={{ fontSize: "0.75rem", color: "var(--color-muted)", marginTop: "4px" }}>{score} / {total} marks</span>
      </div>
    </div>
  );
}
