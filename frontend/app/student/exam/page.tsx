"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAcademic } from "../../../components/context/AcademicContext";
import { api } from "../../../lib/api";
import { useMonotonicTimer } from "../../../hooks/useMonotonicTimer";
import { useSingleInstance } from "../../../hooks/useSingleInstance";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useAuth } from "../../../hooks/useAuth";
import { useToast } from "../../../hooks/useToast";
import Link from "next/link";
import {
  WarningIcon,
  ClockIcon,
  FlagIcon,
  CheckCircleIcon,
  DocumentIcon,
  SparklesIcon,
  ArrowRightIcon,
} from "../../../components/icons/Icons";
import { saveOfflineSubmission, getPackage } from "../../../lib/idb";
import { Scratchpad } from "../../../components/student/Scratchpad";
import { Calculator } from "../../../components/student/Calculator";
import { ConfettiCelebration } from "../../../components/student/ConfettiCelebration";
import { StudentReviewModal } from "../../../components/student/StudentReviewModal";
import styles from "./page.module.css";

type Mode = "loading" | "starting" | "in-progress" | "submitting" | "completed" | "error";

export default function StudentExamPage() {
  return (
    <RequireRole role="student">
      <Suspense
        fallback={
          <main className={styles.page} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div className="spinner" style={{ width: 28, height: 28, borderColor: "#E2E8F0", borderTopColor: "#165AF6" }} />
          </main>
        }
      >
        <ExamContent />
      </Suspense>
    </RequireRole>
  );
}

function ExamContent() {
  const obfuscate = (data: string, key: number) => {
    let result = "";
    for (let i = 0; i < data.length; i++) {
      result += String.fromCharCode(data.charCodeAt(i) ^ (key & 0xff));
    }
    return btoa(result);
  };

  const deobfuscate = (data: string, key: number) => {
    try {
      const decoded = atob(data);
      let result = "";
      for (let i = 0; i < decoded.length; i++) {
        result += String.fromCharCode(decoded.charCodeAt(i) ^ (key & 0xff));
      }
      return result;
    } catch {
      return "";
    }
  };

  const router = useRouter();
  const searchParams = useSearchParams();
  const subjectId = Number(searchParams.get("subjectId") || 0);
  const practiceId = searchParams.get("practiceId");
  const { showToast } = useToast();
  const { selectedSession, selectedTerm } = useAcademic();
  const { user } = useAuth();

  const [mode, setMode] = useState<Mode>("loading");
  const [error, setError] = useState("");
  const [subject, setSubject] = useState<any>(null);
  const [examId, setExamId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [answers, setAnswers] = useState<Record<number, number | string>>({});
  const [flags, setFlags] = useState<Record<number, boolean>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showResume, setShowResume] = useState(false);
  const [online, setOnline] = useState(true);
  const [timerSeed, setTimerSeed] = useState(0);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "syncing" | "saved" | "offline">("idle");
  const [cheatWarnings, setCheatWarnings] = useState(0);
  const [isTabFocused, setIsTabFocused] = useState(true);
  const [showFocusWarning, setShowFocusWarning] = useState(false);
  const [scoreResult, setScoreResult] = useState<{
    score: number | null;
    total_score: number;
    answered_questions?: number;
    total_questions?: number;
    result_status?: string;
    result_policy?: string;
    result_release_time?: string | null;
    message?: string;
    review?: any[];
  } | null>(null);
  const [showScratchpad, setShowScratchpad] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);

  // Solution Reveal State (Learning Mode: Practice & Mock - Max 5 reveals per attempt)
  const [solutionRevealsRemaining, setSolutionRevealsRemaining] = useState<number>(5);
  const [revealedSolutions, setRevealedSolutions] = useState<number[]>([]);
  const [activeSolutionData, setActiveSolutionData] = useState<{
    question_id: number;
    explanation: string | null;
    solution: string | null;
  } | null>(null);
  const [showSolutionDrawer, setShowSolutionDrawer] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);

  const isLearningMode = useMemo(() => {
    return Boolean(
      practiceId ||
      ["practice", "mock"].includes(subject?.mode) ||
      ["learning_practice", "learning_mock"].includes(subject?.assessment_type)
    );
  }, [practiceId, subject]);

  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pillRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const { blocked } = useSingleInstance(`exam-${subjectId}`);

  const buildAnswerPayload = useCallback(() => {
    return Object.entries(answersRef.current).map(([question_id, ans]) => ({
      question_id: Number(question_id),
      selected_option: typeof ans === "number" ? ans : null,
      essay_response: typeof ans === "string" ? ans : null,
    }));
  }, []);

  const isSubmittingRef = useRef(false);
  const handleSubmit = useCallback(async () => {
    if ((!examId && !practiceId) || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    if (saveIntervalRef.current) {
      clearInterval(saveIntervalRef.current);
      saveIntervalRef.current = null;
    }
    setMode("submitting");
    try {
      let res;
      if (practiceId) {
        try {
          res = await api.submitPractice(practiceId, buildAnswerPayload());
        } catch (practiceErr) {
          console.warn("Online practice submit failed, saving locally:", practiceErr);
          await saveOfflineSubmission({ practiceId, answers: buildAnswerPayload(), timestamp: Date.now() });
          res = {
            score: 0,
            total_score: questions.length,
            answered_questions: Object.keys(answersRef.current).length,
            total_questions: questions.length,
            offline: true,
          };
          showToast("Submitted offline! Results saved locally.", "success");
        }
      } else {
        res = await api.submitExamWithAnswers(examId!, buildAnswerPayload());
      }
      setScoreResult(res as any);
      setShowSubmitConfirm(false);
      showToast("Exam submitted successfully", "success");
      setMode("completed");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Submit failed", "error");
      setError(err instanceof Error ? err.message : "Submit failed");
      setMode("in-progress");
      setShowSubmitConfirm(false);
    } finally {
      isSubmittingRef.current = false;
    }
  }, [examId, practiceId, buildAnswerPayload, questions.length, showToast]);

  const remaining = useMonotonicTimer(
    timerSeed,
    useCallback(() => {
      handleSubmit().catch(() => undefined);
    }, [handleSubmit])
  );

  // Online detection
  useEffect(() => {
    const id = setInterval(() => setOnline(navigator.onLine), 2000);
    return () => clearInterval(id);
  }, []);

  // Before unload safety
  useEffect(() => {
    if (mode !== "in-progress") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (examId && answersRef.current) {
        const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
        const payload = JSON.stringify({
          answers: Object.entries(answersRef.current).map(([qid, ans]) => ({
            question_id: Number(qid),
            selected_option: typeof ans === "number" ? ans : null,
            essay_response: typeof ans === "string" ? ans : null,
          })),
        });
        fetch(`${API_BASE}/api/exams/${examId}/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          credentials: "include",
          keepalive: true,
        }).catch(() => undefined);
      }
      e.preventDefault();
      e.returnValue = "Your exam is in progress. Are you sure you want to leave?";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [mode, examId]);

  const seedTimer = useCallback((startTimeIso: string, durationMins: number, serverTimeIso?: string) => {
    const now = serverTimeIso ? Date.parse(serverTimeIso) : Date.now();
    const elapsed = Math.max(0, Math.floor((now - Date.parse(startTimeIso)) / 1000));
    const seed = Math.max(0, durationMins * 60 - elapsed);
    setTimerSeed(seed);
  }, []);

  const startExam = useCallback(
    async (subjectForStart: any) => {
      setMode("starting");
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen().catch(() => console.warn("Fullscreen denied"));
        }

        if (practiceId) {
          let examData: any = null;
          try {
            const start = (await api.startPractice(practiceId)) as any;
            if (start && start.exam) examData = start.exam;
          } catch (netErr) {
            console.warn("Online practice start failed, checking local package:", netErr);
          }
          if (!examData) {
            const cached = await getPackage(practiceId);
            if (cached && Array.isArray(cached.questions) && cached.questions.length > 0) {
              const mockExamId = Math.floor(Math.random() * 100000) + 10000;
              examData = {
                id: mockExamId,
                subject: {
                  id: mockExamId,
                  title: `${cached.exam_body || "Practice"} ${cached.year || ""} - ${cached.subject || ""}`,
                  duration: 45,
                  duration_minutes: 45,
                },
                questions: cached.questions.map((q: any, i: number) => ({
                  id: i + 1,
                  question_text: q.question_text,
                  question_type: "multiple_choice",
                  options_json: JSON.stringify(q.options),
                  correct_answer: q.correct_answer,
                  marks: 1,
                })),
              };
            }
          }
          if (!examData) throw new Error("Could not start practice exam. Please check your network or download the package first.");
          setExamId(examData.id);
          localStorage.removeItem(`exam_answers_practice_${practiceId}`);
          setQuestions(examData.questions || []);
          seedTimer(new Date().toISOString(), examData.subject.duration || 45);
          setSubject(examData.subject);
          setMode("in-progress");
          return;
        }

        const start = (await api.startExam(subjectForStart.id)) as any;
        if (!start) throw new Error("Could not start exam — check that the exam window is open");
        const id = Number(start.examId ?? start.exam?.id);
        if (!id) throw new Error("Server did not return exam ID");
        setExamId(id);
        setSolutionRevealsRemaining(start.solution_reveals_remaining ?? 5);
        setRevealedSolutions(start.revealed_solutions ?? []);
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
        setMode("error");
      }
    },
    [practiceId, seedTimer]
  );

  // Initial load
  useEffect(() => {
    let mounted = true;
    (async () => {
      setMode("loading");
      try {
        if (practiceId) {
          const parts = practiceId.split("_");
          setSubject({
            name: `${parts[0]} ${parts[1]} - ${parts.slice(2).join(" ")}`,
            duration: 45,
            code: parts[0]?.toUpperCase() || "MOCK",
          });
          setShowInstructions(true);
          return;
        }

        const [subjects, activeExams] = await Promise.all([
          api.getSubjects(selectedSession?.id, selectedTerm?.id),
          api.getActiveExams(),
        ]);
        if (!mounted) return;

        const subjectsList = ((subjects as any[]) ?? []);
        const activeExamsPayload = (activeExams as any)?.exams ?? activeExams;

        let targetSubjectId = subjectId;

        // Auto-resolution if no subjectId in query
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
        const serverTime = (activeExams as any)?.server_time;

        const inProgress = ((activeExamsPayload as any[]) ?? []).find(
          (item) => Number(item.subject_id) === targetSubjectId
        );
        if (inProgress) {
          setExamId(Number(inProgress.id));
          setSolutionRevealsRemaining(inProgress.solution_reveals_remaining ?? 5);
          try {
            setRevealedSolutions(JSON.parse(inProgress.revealed_solutions_json || "[]"));
          } catch {
            setRevealedSolutions([]);
          }
          let mapped: Record<number, number | string> = {};
          try {
            let lsMapped: Record<number, number | string> = {};
            let serverMapped: Record<number, number | string> = {};

            const saved = JSON.parse(inProgress.answers_json || "[]") as Array<{
              question_id: number;
              selected_option?: number | null;
              essay_response?: string | null;
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
              try {
                const decrypted = deobfuscate(ls, Number(inProgress.id) || 42);
                if (decrypted) lsMapped = JSON.parse(decrypted);
              } catch {}
            }

            if (Object.keys(lsMapped).length > Object.keys(serverMapped).length) {
              mapped = { ...serverMapped, ...lsMapped };
            } else {
              mapped = serverMapped;
            }

            setAnswers(mapped);
          } catch {
            setAnswers({});
          }
          const qs = ((await api.getQuestions(targetSubjectId)) as any[]) ?? [];
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
    return () => {
      mounted = false;
    };
  }, [subjectId, practiceId, startExam, seedTimer]);

  // Local storage auto-backup
  useEffect(() => {
    if (!examId || mode !== "in-progress") return;
    localStorage.setItem(`exam_answers_${examId}`, obfuscate(JSON.stringify(answers), examId || 42));
  }, [answers, examId, mode]);

  // SSE Stream & Periodic Server Auto-Save
  useEffect(() => {
    if (mode !== "in-progress" || !examId) return;

    const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
    let abortController = new AbortController();

    const connectSSE = async (retryCount = 0) => {
      try {
        const response = await fetch(`${API_BASE}/api/exams/${examId}/stream`, {
          credentials: "include",
          signal: abortController.signal,
        });
        if (!response.ok) return;
        const reader = response.body?.getReader();
        const decoder = new TextDecoder("utf-8");
        if (reader) {
          let buffer = "";
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const messages = buffer.split("\n\n");
            buffer = messages.pop() || "";
            for (const chunk of messages) {
              if (chunk.includes("force_submit")) {
                handleSubmit();
                return;
              } else if (chunk.includes("sync")) {
                try {
                  const match = chunk.match(/data:\s*({.*})/);
                  if (match) {
                    const data = JSON.parse(match[1]);
                    if (typeof data.remaining === "number") {
                      setTimerSeed(data.remaining);
                    }
                  }
                } catch (e) {}
              }
            }
          }
          if (!abortController.signal.aborted && retryCount < 5) {
            const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
            setTimeout(() => connectSSE(retryCount + 1), delay);
          }
        }
      } catch (err) {
        if (!abortController.signal.aborted && retryCount < 5) {
          const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
          setTimeout(() => connectSSE(retryCount + 1), delay);
        }
      }
    };
    connectSSE();

    const id = setInterval(() => {
      if (!navigator.onLine) {
        setSaveStatus("offline");
        return;
      }
      setSaveStatus("syncing");
      api
        .saveExam(examId, buildAnswerPayload())
        .then(() => {
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus("idle"), 3000);
        })
        .catch(() => setSaveStatus("offline"));
    }, 30_000 + Math.floor(Math.random() * 5000));
    saveIntervalRef.current = id;

    return () => {
      clearInterval(id);
      abortController.abort();
    };
  }, [mode, examId, buildAnswerPayload]);

  // Tab visibility sync
  useEffect(() => {
    if (mode !== "in-progress" || !examId) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        api.saveExam(examId, buildAnswerPayload()).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [mode, examId, buildAnswerPayload]);

  // Anti-cheat focus & fullscreen monitors
  useEffect(() => {
    if (mode !== "in-progress") return;
    const onBlur = () => {
      setIsTabFocused(false);
      setShowFocusWarning(true);
      setCheatWarnings((w) => w + 1);
    };
    const onFocus = () => {
      setIsTabFocused(true);
      setShowFocusWarning(false);
    };

    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);

    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setCheatWarnings((w) => w + 1);
        setShowFocusWarning(true);
        showToast("Warning: You exited fullscreen. Return to fullscreen immediately.", "error");
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);

    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [mode, showToast]);

  // Keyboard navigation
  useEffect(() => {
    if (mode !== "in-progress") return;
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === "TEXTAREA" || document.activeElement?.tagName === "INPUT") return;
      const key = e.key.toLowerCase();
      const q = questions[currentIndex];
      if (q && q.question_type !== "essay") {
        if (["1", "2", "3", "4"].includes(key)) {
          if (q.question_type === "true_false" && ["3", "4"].includes(key)) return;
          setAnswers((prev) => ({ ...prev, [q.id]: Number(key) - 1 }));
        } else if (["a", "b", "c", "d"].includes(key)) {
          const mapIdx: Record<string, number> = { a: 0, b: 1, c: 2, d: 3 };
          if (mapIdx[key] !== undefined) {
            setAnswers((prev) => ({ ...prev, [q.id]: mapIdx[key] }));
          }
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

  // Auto-scroll navigator pill into center when currentIndex changes
  useEffect(() => {
    if (pillRefs.current[currentIndex]) {
      pillRefs.current[currentIndex]?.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    }
  }, [currentIndex]);
  const handleResumeContinue = async () => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen().catch(() => {});
    setShowResume(false);
    setMode("in-progress");
  };

  const handleResumeReset = async () => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen().catch(() => {});
    setAnswers({});
    setFlags({});
    setShowResume(false);
    setMode("in-progress");
  };

  const handleRevealSolution = useCallback(async () => {
    const currentQ = questions[currentIndex];
    if (!currentQ) return;
    const isAnswered = answers[currentQ.id] !== undefined;
    if (!isAnswered) {
      showToast("Please choose or enter an answer first before requesting the solution.", "error");
      return;
    }

    if (revealedSolutions.includes(currentQ.id)) {
      setActiveSolutionData({
        question_id: currentQ.id,
        explanation: currentQ.explanation || currentQ.teacher_answer || "No detailed explanation provided for this question.",
        solution: currentQ.solution || currentQ.teacher_answer || "No step-by-step solution provided.",
      });
      setShowSolutionDrawer(true);
      return;
    }

    if (solutionRevealsRemaining <= 0) {
      showToast("Maximum solution reveals (5/5) reached for this attempt.", "error");
      return;
    }

    if (practiceId) {
      const nextRemaining = Math.max(0, solutionRevealsRemaining - 1);
      setSolutionRevealsRemaining(nextRemaining);
      setRevealedSolutions((prev) => [...prev, currentQ.id]);
      setActiveSolutionData({
        question_id: currentQ.id,
        explanation: currentQ.explanation || currentQ.solution_text || currentQ.teacher_answer || (currentQ.correct_answer !== undefined ? `Correct Answer: Option ${currentQ.correct_answer}` : "Refer to learning material."),
        solution: currentQ.solution || currentQ.solution_text || currentQ.teacher_answer || "Standard worked method provided in syllabus.",
      });
      setShowSolutionDrawer(true);
      showToast(`Solution unlocked! (${nextRemaining} reveal${nextRemaining === 1 ? "" : "s"} remaining)`, "success");
      return;
    }

    if (examId) {
      setIsRevealing(true);
      try {
        const res = await api.revealExamSolution(examId, currentQ.id);
        if (res.success) {
          setSolutionRevealsRemaining(res.solution_reveals_remaining);
          setRevealedSolutions(res.revealed_solutions || [...revealedSolutions, currentQ.id]);
          setActiveSolutionData({
            question_id: currentQ.id,
            explanation: res.explanation || "No detailed explanation provided.",
            solution: res.solution || "No step-by-step solution provided.",
          });
          setShowSolutionDrawer(true);
          showToast(`Solution unlocked! (${res.solution_reveals_remaining} reveal${res.solution_reveals_remaining === 1 ? "" : "s"} remaining)`, "success");
        }
      } catch (err: any) {
        showToast(err?.message || "Failed to reveal solution", "error");
      } finally {
        setIsRevealing(false);
      }
    } else {
      const nextRemaining = Math.max(0, solutionRevealsRemaining - 1);
      setSolutionRevealsRemaining(nextRemaining);
      setRevealedSolutions((prev) => [...prev, currentQ.id]);
      setActiveSolutionData({
        question_id: currentQ.id,
        explanation: currentQ.explanation || currentQ.teacher_answer || (currentQ.correct_answer !== undefined ? `Correct Option: ${String.fromCharCode(65 + Number(currentQ.correct_answer))}` : "Refer to learning material."),
        solution: currentQ.solution || currentQ.teacher_answer || "Standard worked method provided in syllabus.",
      });
      setShowSolutionDrawer(true);
      showToast(`Solution unlocked! (${nextRemaining} reveal${nextRemaining === 1 ? "" : "s"} remaining)`, "success");
    }
  }, [questions, currentIndex, answers, revealedSolutions, solutionRevealsRemaining, examId, practiceId, showToast]);

  const answeredCount = Object.keys(answers).length;
  const flaggedCount = Object.values(flags).filter(Boolean).length;

  // ── Render Gates ──
  if (blocked) {
    return (
      <main className={styles.errorState}>
        <div className={styles.modalBox}>
          <WarningIcon width="40" height="40" style={{ color: "#D97706", margin: "0 auto 1rem" }} />
          <h3 style={{ fontSize: "1.25rem", fontWeight: 800, margin: "0 0 0.5rem", color: "#0F172A" }}>Another tab is open</h3>
          <p style={{ color: "#64748B", fontSize: "0.875rem", lineHeight: 1.5, margin: "0 0 1.5rem" }}>
            Please close other exam tabs or windows before continuing this examination session.
          </p>
          <button className={styles.preflightCancelBtn} style={{ width: "100%" }} onClick={() => router.push("/student/dashboard")}>
            ← Return to Dashboard
          </button>
        </div>
      </main>
    );
  }

  if (mode === "error") {
    return (
      <main className={styles.errorState}>
        <div className={styles.modalBox}>
          <WarningIcon width="40" height="40" style={{ color: "#DC2626", margin: "0 auto 1rem" }} />
          <h3 style={{ fontSize: "1.25rem", fontWeight: 800, margin: "0 0 0.5rem", color: "#0F172A" }}>Examination Error</h3>
          <p style={{ color: "#DC2626", fontSize: "0.875rem", fontWeight: 600, margin: "0 0 1.5rem" }}>{error}</p>
          <button className={styles.preflightCancelBtn} style={{ width: "100%" }} onClick={() => router.push("/student/dashboard")}>
            ← Return to Dashboard
          </button>
        </div>
      </main>
    );
  }

  // Preflight instructions modal
  if (showInstructions) {
    return (
      <main className={styles.preflightWrapper}>
        <div className={styles.preflightContainer}>
          <div className={styles.preflightTopNav}>
            <button
              type="button"
              className={styles.backBtn}
              onClick={() => router.push("/student/dashboard")}
            >
              <span>← Back to Dashboard</span>
            </button>
            <span style={{ fontSize: "0.8125rem", color: "#64748B", fontWeight: 500 }}>
              ACAD Examination Portal
            </span>
          </div>

          <div className={styles.preflightCard}>
            <div className={styles.preflightHeader}>
              <div className={styles.preflightBadge}>
                <DocumentIcon width="13" height="13" />
                <span>{isLearningMode ? "Learning Mode Assessment" : "Official Assessment Brief"}</span>
              </div>
              <h1 className={styles.preflightTitle}>{subject?.name || "Examination Paper"}</h1>
              <span className={styles.preflightSubjectCode}>
                Subject Code: {subject?.code || "EXAM"}
              </span>
            </div>

            <div className={styles.preflightMetaGrid}>
              <div className={styles.preflightMetaBox}>
                <div className={styles.preflightMetaLabel}>Time Allowed</div>
                <div className={styles.preflightMetaValue}>{subject?.duration || 120} Mins</div>
              </div>
              <div className={styles.preflightMetaBox}>
                <div className={styles.preflightMetaLabel}>Total Questions</div>
                <div className={styles.preflightMetaValue}>{questions.length || subject?.question_count || "40"} Questions</div>
              </div>
              <div className={styles.preflightMetaBox}>
                <div className={styles.preflightMetaLabel}>Assessment Type</div>
                <div className={styles.preflightMetaValue}>
                  {isLearningMode ? "Practice & Solution Review" : "School Supervised"}
                </div>
              </div>
            </div>

            <div className={styles.preflightCandidateBox}>
              <div>
                <span style={{ color: "#64748B", fontSize: "0.75rem", textTransform: "uppercase", fontWeight: 600, letterSpacing: "0.04em" }}>
                  Candidate:
                </span>{" "}
                <strong style={{ color: "#0F172A" }}>{user?.name || "Student Candidate"}</strong>
              </div>
              <div>
                <span style={{ color: "#64748B", fontSize: "0.75rem", textTransform: "uppercase", fontWeight: 600, letterSpacing: "0.04em" }}>
                  Cohort:
                </span>{" "}
                <strong style={{ color: "#0F172A" }}>{user?.grade || "General Class"}</strong>
              </div>
            </div>

            <div className={styles.preflightRulesContainer}>
              <div className={styles.preflightRulesTitle}>
                {isLearningMode ? "Learning & Practice Guidelines" : "Examination Guidelines & Rules"}
              </div>
              <div className={styles.rulesGrid}>
                {isLearningMode ? (
                  <>
                    <div className={styles.ruleItem}>
                      <span className={styles.ruleDot} style={{ background: "#7C3AED" }} />
                      <span><strong>Solution Reveals:</strong> Up to 5 step-by-step solution reveals available during your sitting.</span>
                    </div>
                    <div className={styles.ruleItem}>
                      <span className={styles.ruleDot} style={{ background: "#7C3AED" }} />
                      <span><strong>Answer First:</strong> Submit an attempt on a question to unlock its detailed worked explanation.</span>
                    </div>
                    <div className={styles.ruleItem}>
                      <span className={styles.ruleDot} />
                      <span><strong>Immediate Feedback:</strong> View full scores, breakdown, and explanations immediately after submission.</span>
                    </div>
                    <div className={styles.ruleItem}>
                      <span className={styles.ruleDot} />
                      <span><strong>Self-Paced Mastery:</strong> Move freely and retake whenever you need additional practice.</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={styles.ruleItem}>
                      <span className={styles.ruleDot} />
                      <span><strong>Fullscreen &amp; Focus:</strong> Keep your browser window focused to avoid session security flagging.</span>
                    </div>
                    <div className={styles.ruleItem}>
                      <span className={styles.ruleDot} />
                      <span><strong>Free Navigation:</strong> Move freely between questions and flag challenging items for later review.</span>
                    </div>
                    <div className={styles.ruleItem}>
                      <span className={styles.ruleDot} />
                      <span><strong>Instant Auto-Save:</strong> Responses are securely preserved and synced in real-time.</span>
                    </div>
                    <div className={styles.ruleItem}>
                      <span className={styles.ruleDot} />
                      <span><strong>Monotonic Countdown:</strong> Your assessment will auto-submit when the allocated timer expires.</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {subject?.instructions && (
              <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "12px", padding: "1rem 1.15rem", fontSize: "0.8125rem", color: "#334155", lineHeight: 1.5 }}>
                <strong style={{ color: "#0F172A" }}>Special Instructions: </strong>
                {subject.instructions}
              </div>
            )}

            <div className={styles.preflightActions}>
              <button className={styles.preflightCancelBtn} onClick={() => router.push("/student/dashboard")}>
                Cancel &amp; Return
              </button>
              <button
                className={styles.preflightStartBtn}
                onClick={() => {
                  setShowInstructions(false);
                  startExam(subject);
                }}
              >
                <span>Begin Assessment</span>
                <ArrowRightIcon width="16" height="16" />
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Resume dialog
  if (showResume) {
    return (
      <main className={styles.preflightWrapper}>
        <div className={styles.preflightContainer}>
          <div className={styles.preflightCard}>
            <div className={styles.preflightHeader}>
              <div className={styles.preflightBadge}>
                <SparklesIcon width="13" height="13" />
                <span>Active Sitting Detected</span>
              </div>
              <h1 className={styles.preflightTitle}>{subject?.name || "Examination Paper"}</h1>
              <span className={styles.preflightSubjectCode}>
                Subject Code: {subject?.code || "EXAM"}
              </span>
            </div>

            <p style={{ fontSize: "0.875rem", color: "#64748B", lineHeight: 1.6, margin: 0 }}>
              You have <strong style={{ color: "#165AF6" }}>{Object.keys(answers).length}</strong> answered question(s) securely restored from your session.
              {isLearningMode && (
                <>
                  <br />
                  Solution reveals remaining: <strong style={{ color: "#7C3AED" }}>{solutionRevealsRemaining} of 5</strong>
                </>
              )}
              <br />
              Time remaining: <strong style={{ color: "#0F172A", fontFamily: "var(--font-mono, monospace)" }}>{formatTime(remaining)}</strong>
            </p>

            <div className={styles.preflightActions}>
              <button className={styles.preflightCancelBtn} onClick={handleResumeReset}>
                Start Fresh
              </button>
              <button className={styles.preflightStartBtn} onClick={handleResumeContinue}>
                <span>Continue Assessment</span>
                <ArrowRightIcon width="16" height="16" />
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // ── Completion Screen with Result Release Policy Engine ──
  if (mode === "completed") {
    // 1. Manual Hold State
    if (scoreResult?.result_status === "hidden") {
      return (
        <main className={styles.completionWrapper}>
          <div className={styles.releaseHoldCard}>
            <div className={styles.releaseHoldBadgeManual}>
              <ClockIcon width="14" height="14" />
              <span>Results Pending Instructor Release</span>
            </div>

            <div>
              <h2 className={styles.celebrationTitle}>Assessment Submitted</h2>
              <p className={styles.celebrationSub}>
                Your responses have been securely submitted and stored. Result release for this assessment is managed by your course instructor.
              </p>
            </div>

            <div className={styles.breakdownGrid}>
              <div className={styles.breakdownItem}>
                <div className={styles.breakdownLabel}>Questions Answered</div>
                <div className={styles.breakdownValue}>
                  {scoreResult?.answered_questions ?? Object.keys(answers).length} / {scoreResult?.total_questions ?? questions.length}
                </div>
              </div>
              <div className={styles.breakdownItem}>
                <div className={styles.breakdownLabel}>Release Policy</div>
                <div className={styles.breakdownValue} style={{ color: "#D97706" }}>
                  Manual Release
                </div>
              </div>
            </div>

            <div className={styles.completionActions}>
              <button type="button" className={styles.returnHomeBtn} onClick={() => router.replace("/student/dashboard")}>
                <span>Return to Dashboard</span>
                <ArrowRightIcon width="14" height="14" />
              </button>
              <Link
                href="/student/results"
                style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#165AF6", textDecoration: "none", padding: "0.4rem" }}
              >
                View in Assessment Results →
              </Link>
            </div>
          </div>
        </main>
      );
    }

    // 2. Scheduled Hold State
    if (scoreResult?.result_status === "scheduled") {
      const releaseDateStr = scoreResult.result_release_time
        ? new Date(scoreResult.result_release_time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
        : "Scheduled Release Date";

      return (
        <main className={styles.completionWrapper}>
          <div className={styles.releaseHoldCard}>
            <div className={styles.releaseHoldBadgeScheduled}>
              <ClockIcon width="14" height="14" />
              <span>Results Scheduled</span>
            </div>

            <div>
              <h2 className={styles.celebrationTitle}>Assessment Submitted</h2>
              <p className={styles.celebrationSub}>
                Your submission was saved successfully. Scores will automatically unlock according to the academic schedule.
              </p>
            </div>

            <div className={styles.releaseScheduleBox}>
              <span style={{ fontSize: "0.75rem", color: "#64748B", fontWeight: 600, textTransform: "uppercase" }}>Scheduled Publication</span>
              <strong style={{ fontSize: "1.0625rem", color: "#165AF6" }}>{releaseDateStr}</strong>
            </div>

            <div className={styles.breakdownGrid}>
              <div className={styles.breakdownItem}>
                <div className={styles.breakdownLabel}>Questions Answered</div>
                <div className={styles.breakdownValue}>
                  {scoreResult?.answered_questions ?? Object.keys(answers).length} / {scoreResult?.total_questions ?? questions.length}
                </div>
              </div>
              <div className={styles.breakdownItem}>
                <div className={styles.breakdownLabel}>Release Policy</div>
                <div className={styles.breakdownValue} style={{ color: "#165AF6" }}>
                  Scheduled Release
                </div>
              </div>
            </div>

            <div className={styles.completionActions}>
              <button type="button" className={styles.returnHomeBtn} onClick={() => router.replace("/student/dashboard")}>
                <span>Return to Dashboard</span>
                <ArrowRightIcon width="14" height="14" />
              </button>
              <Link
                href="/student/results"
                style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#165AF6", textDecoration: "none", padding: "0.4rem" }}
              >
                View in Assessment Results →
              </Link>
            </div>
          </div>
        </main>
      );
    }

    // 3. Immediate / Released Result Screen
    const totalMarks = scoreResult?.total_score ?? questions.length;
    const scoredMarks = scoreResult?.score ?? 0;
    const pct = totalMarks > 0 ? Math.round((scoredMarks / totalMarks) * 100) : 0;
    const isMastery = pct >= 80;
    const isPass = pct >= 50;

    return (
      <main className={styles.completionWrapper}>
        <ConfettiCelebration trigger={true} durationMs={5000} particleCount={160} />

        <div className={styles.celebrationCard}>
          <div className={styles.celebrationBadge}>
            <SparklesIcon width="14" height="14" />
            <span>{isMastery ? "Mastery Achieved" : isPass ? "Assessment Passed" : "Attempt Recorded"}</span>
          </div>

          <div>
            <h2 className={styles.celebrationTitle}>
              {isMastery ? "Outstanding Mastery" : isPass ? "Assessment Passed" : "Examination Completed"}
            </h2>
            <p className={styles.celebrationSub}>
              Your responses have been recorded and graded by the assessment engine.
            </p>
          </div>

          <div className={styles.scoreRevealRing}>
            <span className={styles.scoreValueMain}>{pct}%</span>
            <span className={styles.scoreTotalSub}>
              {scoredMarks} / {totalMarks} Marks
            </span>
          </div>

          <div className={styles.breakdownGrid}>
            <div className={styles.breakdownItem}>
              <div className={styles.breakdownLabel}>Questions Answered</div>
              <div className={styles.breakdownValue}>
                {scoreResult?.answered_questions ?? Object.keys(answers).length} / {scoreResult?.total_questions ?? questions.length}
              </div>
            </div>
            <div className={styles.breakdownItem}>
              <div className={styles.breakdownLabel}>Academic Status</div>
              <div className={styles.breakdownValue} style={{ color: isPass ? "#059669" : "#DC2626" }}>
                {isPass ? "Passed" : "Under Review"}
              </div>
            </div>
          </div>

          <div className={styles.completionActions}>
            {(practiceId || scoreResult?.review || examId) && (
              <button
                type="button"
                onClick={() => setShowReviewModal(true)}
                className={styles.reviewBreakdownBtn}
              >
                <span>Review Question Breakdown</span>
              </button>
            )}

            <button type="button" className={styles.returnHomeBtn} onClick={() => router.replace("/student/dashboard")}>
              <span>Return to Dashboard</span>
              <ArrowRightIcon width="14" height="14" />
            </button>

            {practiceId ? (
              <Link href="/student/practice" className={styles.linkBtn}>
                Practice Another Topic →
              </Link>
            ) : (
              <Link href="/student/results" className={styles.linkBtn}>
                View Full Report Card →
              </Link>
            )}
          </div>
        </div>

        {showReviewModal && (
          <StudentReviewModal
            examId={practiceId ? undefined : (examId ?? undefined)}
            subjectName={practiceId ? (subject?.title || subject?.name || "Practice Session") : (subject?.name || "Examination")}
            practiceData={practiceId ? {
              score: scoredMarks,
              total_score: totalMarks,
              items: scoreResult?.review || []
            } : undefined}
            onClose={() => setShowReviewModal(false)}
          />
        )}
      </main>
    );
  }

  // Preflight submission confirmation dialog
  if (showSubmitConfirm) {
    return (
      <main className={styles.modalCenterWrapper}>
        <div className={styles.summaryModal}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <div
              style={{
                width: "38px",
                height: "38px",
                borderRadius: "10px",
                background: "#EFF4FF",
                border: "1px solid #DBEAFE",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#165AF6",
                flexShrink: 0,
              }}
            >
              <DocumentIcon width="20" height="20" />
            </div>
            <div>
              <h2 className={styles.summaryTitle}>Final Attempt Summary</h2>
              <p className={styles.summarySub}>Review your progress before committing final submission</p>
            </div>
          </div>

          <div className={styles.summaryStatsGrid}>
            <div className={styles.summaryStatItem}>
              <div className={styles.summaryStatLabel}>Answered</div>
              <div className={styles.summaryStatVal} style={{ color: "#059669" }}>
                {answeredCount} / {questions.length}
              </div>
            </div>
            <div className={styles.summaryStatItem}>
              <div className={styles.summaryStatLabel}>Unanswered</div>
              <div className={styles.summaryStatVal} style={{ color: questions.length - answeredCount > 0 ? "#DC2626" : "#64748B" }}>
                {questions.length - answeredCount}
              </div>
            </div>
            <div className={styles.summaryStatItem}>
              <div className={styles.summaryStatLabel}>Marked for Review</div>
              <div className={styles.summaryStatVal} style={{ color: "#D97706" }}>
                {flaggedCount}
              </div>
            </div>
            <div className={styles.summaryStatItem}>
              <div className={styles.summaryStatLabel}>Time Remaining</div>
              <div className={styles.summaryStatVal} style={{ color: "#0F172A" }}>
                {formatTime(remaining)}
              </div>
            </div>
          </div>

          {questions.length - answeredCount > 0 && (
            <div
              style={{
                padding: "0.75rem 1rem",
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: "10px",
                color: "#DC2626",
                fontSize: "0.8125rem",
                fontWeight: 600,
                textAlign: "center",
                lineHeight: 1.4,
              }}
            >
              You still have {questions.length - answeredCount} unanswered question{questions.length - answeredCount > 1 ? "s" : ""}. Unanswered questions will receive 0 marks.
            </div>
          )}

          <div className={styles.preflightActions}>
            <button className={styles.preflightCancelBtn} onClick={() => setShowSubmitConfirm(false)} disabled={mode === "submitting"}>
              Return to Exam
            </button>
            <button
              className={styles.preflightStartBtn}
              style={{ background: "#165AF6" }}
              onClick={() => handleSubmit()}
              disabled={mode === "submitting"}
            >
              {mode === "submitting" ? (
                <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                  Submitting…
                </span>
              ) : (
                <>
                  <span>Confirm &amp; Submit</span>
                  <ArrowRightIcon width="16" height="16" />
                </>
              )}
            </button>
          </div>
        </div>
      </main>
    );
  }

  const current = questions[currentIndex];
  const timerStyle =
    remaining > 300 ? styles.timerPillNormal : remaining > 60 ? styles.timerPillAttention : styles.timerPillCritical;

  return (
    <main className={styles.page}>
      {/* ── 1. Focus Warning Banner ── */}
      {showFocusWarning && (
        <div className={styles.focusWarningBanner} role="alert" aria-live="assertive">
          <div className={styles.focusWarningContent}>
            <WarningIcon width="18" height="18" />
            <span>Exam window lost focus. Stay on this tab to avoid security flagging of your attempt.</span>
            <button
              className={styles.reenterBtn}
              onClick={() => {
                if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
              }}
            >
              Re-enter Fullscreen
            </button>
          </div>
        </div>
      )}

      {/* ── 2. Compact Focused Header ── */}
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <span className={styles.brandBadge}>
            <SparklesIcon width="14" height="14" />
            <span>ACAD</span>
          </span>
          <div className={styles.examMetaGroup}>
            <h1 className={styles.examTitle}>{practiceId ? "MOCK EXAM ASSESSMENT" : subject?.name || "Examination Paper"}</h1>
            <p className={styles.examSubtitle}>
              {subject?.code ? `Course ${subject.code} · ` : ""}Question {currentIndex + 1} of {questions.length}
            </p>
          </div>
        </div>

        <div className={styles.topbarCenter}>
          <div className={timerStyle}>
            <ClockIcon width="14" height="14" />
            <span>{formatTime(remaining)}</span>
          </div>

          <div className={styles.statusIndicatorGroup}>
            <div className={styles.syncBadge}>
              {saveStatus === "syncing" && (
                <>
                  <div className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
                  <span>Syncing</span>
                </>
              )}
              {saveStatus === "saved" && (
                <>
                  <CheckCircleIcon width="12" height="12" style={{ color: "#059669" }} />
                  <span style={{ color: "#059669" }}>Saved</span>
                </>
              )}
              {saveStatus === "offline" && (
                <>
                  <WarningIcon width="12" height="12" style={{ color: "#D97706" }} />
                  <span style={{ color: "#D97706" }}>Local</span>
                </>
              )}
              {saveStatus === "idle" && (
                <>
                  <span
                    style={{
                      display: "inline-block",
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: online ? "#059669" : "#DC2626",
                    }}
                  />
                  <span>{online ? "Live" : "Offline"}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className={styles.topbarRight}>
          <button
            type="button"
            className={`${styles.toolBtn} ${showScratchpad ? styles.toolBtnActive : ""}`}
            onClick={() => setShowScratchpad(!showScratchpad)}
            title="Open Scratchpad"
          >
            Scratchpad
          </button>
          <button
            type="button"
            className={`${styles.toolBtn} ${showCalculator ? styles.toolBtnActive : ""}`}
            onClick={() => setShowCalculator(!showCalculator)}
            title="Open Calculator"
          >
            Calculator
          </button>
          <button
            type="button"
            className={`${styles.toolBtn} ${isFocusMode ? styles.toolBtnActive : ""}`}
            onClick={() => setIsFocusMode(!isFocusMode)}
            title="Toggle Focus Mode"
          >
            {isFocusMode ? "Exit Focus" : "Focus Mode"}
          </button>
          <button
            type="button"
            className={styles.headerSubmitBtn}
            onClick={() => setShowSubmitConfirm(true)}
            disabled={mode === "submitting"}
          >
            <span>Submit</span>
          </button>
        </div>
      </header>

      {/* Auxiliary Tools Overlays */}
      {showScratchpad && <Scratchpad onClose={() => setShowScratchpad(false)} />}
      {showCalculator && <Calculator onClose={() => setShowCalculator(false)} />}

      {/* ── 3. Horizontal Question Navigator Rail ── */}
      {!isFocusMode && (
        <nav className={styles.navigatorRail} aria-label="Question Navigation">
          <div className={styles.navigatorMeta}>
            <span>Questions:</span>
            <span className={styles.navigatorProgressText}>
              {answeredCount}/{questions.length}
            </span>
          </div>

          <div className={styles.navigatorScrollArea}>
            {questions.map((q, idx) => {
              const isCurrent = idx === currentIndex;
              const isAnswered = answers[q.id] !== undefined;
              const isFlagged = flags[q.id];

              let pillClass = styles.navPill;
              if (isCurrent) pillClass = `${styles.navPill} ${styles.navPillCurrent}`;
              else if (isAnswered) pillClass = `${styles.navPill} ${styles.navPillAnswered}`;
              else if (isFlagged) pillClass = `${styles.navPill} ${styles.navPillFlagged}`;

              return (
                <button
                  key={q.id}
                  ref={(el) => {
                    pillRefs.current[idx] = el;
                  }}
                  className={pillClass}
                  onClick={() => setCurrentIndex(idx)}
                  title={`Question ${idx + 1}${isAnswered ? " (Answered)" : ""}${isFlagged ? " (Flagged)" : ""}`}
                >
                  <span>{idx + 1}</span>
                  {isFlagged && !isCurrent && <span className={styles.navPillFlagDot} />}
                </button>
              );
            })}
          </div>

          <div className={styles.navigatorLegend}>
            <span className={styles.legendPill}>
              <span className={styles.legendDot} style={{ background: "#165AF6" }} />
              Current
            </span>
            <span className={styles.legendPill}>
              <span className={styles.legendDot} style={{ background: "#059669" }} />
              Answered
            </span>
            <span className={styles.legendPill}>
              <span className={styles.legendDot} style={{ background: "#D97706" }} />
              Flagged
            </span>
            <span className={styles.legendPill}>
              <span className={styles.legendDot} style={{ background: "#CBD5E1" }} />
              Unanswered
            </span>
          </div>
        </nav>
      )}

      {/* ── 4. Main Examination Stage ── */}
      <section className={styles.examStage}>
        <div className={styles.questionHeroContainer}>
          {current ? (
            <div className={styles.questionCard}>
              {/* Eyebrow metadata */}
              <div className={styles.questionEyebrowRow}>
                <div className={styles.questionEyebrowLeft}>
                  <span className={styles.questionNumberTag}>Question {currentIndex + 1} of {questions.length}</span>
                  {current.marks && <span className={styles.questionMarksTag}>{current.marks} Mark{current.marks > 1 ? "s" : ""}</span>}
                </div>

                <button
                  type="button"
                  className={`${styles.flagToggleBtn} ${flags[current.id] ? styles.flagToggleBtnActive : ""}`}
                  onClick={() => setFlags((prev) => ({ ...prev, [current.id]: !prev[current.id] }))}
                  title="Flag question to review later"
                >
                  <FlagIcon width="13" height="13" />
                  <span>{flags[current.id] ? "Flagged for Review" : "Flag for Review"}</span>
                </button>
              </div>

              {/* Question Text & Diagram */}
              <div className={current.image_url ? styles.questionSplitView : styles.questionTextContent}>
                {current.image_url && (
                  <div className={styles.questionMediaBox}>
                    <img src={current.image_url} alt="Question Diagram" className={styles.questionImg} />
                  </div>
                )}

                <div className={styles.questionTextContent}>
                  <p className={styles.questionPrompt}>{current.question_text}</p>

                  {/* Options / Answer Input */}
                  {current.question_type === "essay" ? (
                    <DebouncedTextarea
                      className={styles.essayTextarea}
                      placeholder="Type your response here…"
                      value={(answers[current.id] as string) || ""}
                      onChange={(val) => setAnswers((prev) => ({ ...prev, [current.id]: val }))}
                    />
                  ) : (
                    (() => {
                      const opts =
                        current.question_type === "true_false"
                          ? ["True", "False"]
                          : safeOptions(current.options_json).slice(0, 4);
                      const validOpts = opts.filter(Boolean);

                      if (validOpts.length === 0) {
                        return (
                          <DebouncedInput
                            className="input"
                            style={{
                              width: "100%",
                              padding: "1rem 1.25rem",
                              fontSize: "1rem",
                              borderRadius: "12px",
                              border: "1.5px solid #CBD5E1",
                            }}
                            placeholder="Type your short answer…"
                            value={(answers[current.id] as string) || ""}
                            onChange={(val) => setAnswers((prev) => ({ ...prev, [current.id]: val }))}
                          />
                        );
                      }

                      return (
                        <div className={styles.optionsList}>
                          {opts.map((option, idx) =>
                            option ? (
                              <button
                                key={idx}
                                type="button"
                                className={answers[current.id] === idx ? styles.optionButtonSelected : styles.optionButton}
                                onClick={() => setAnswers((prev) => ({ ...prev, [current.id]: idx }))}
                              >
                                <span className={styles.optionLetterBadge}>
                                  {current.question_type === "true_false"
                                    ? idx === 0
                                      ? "T"
                                      : "F"
                                    : String.fromCharCode(65 + idx)}
                                </span>
                                <span className={styles.optionText}>{option}</span>
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
              <p style={{ color: "#DC2626", fontWeight: 600 }}>No questions found in this assessment paper.</p>
            </div>
          )}

          {/* ── Aligned Action Row ── */}
          <div className={styles.actionRow}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <button
                type="button"
                className={styles.actionBtnSecondary}
                onClick={() => setCurrentIndex((v) => Math.max(0, v - 1))}
                disabled={currentIndex === 0}
              >
                <span>← Previous</span>
              </button>

              <button
                type="button"
                className={`${styles.actionBtnSecondary} ${flags[current?.id] ? styles.flagToggleBtnActive : ""}`}
                onClick={() => current && setFlags((prev) => ({ ...prev, [current.id]: !prev[current.id] }))}
              >
                <FlagIcon width="14" height="14" />
                <span>{current && flags[current.id] ? "Unflag" : "Flag"}</span>
              </button>

              {/* Learning Mode: Solution Reveal (Max 5 reveals per attempt) */}
              {isLearningMode && current && (
                <button
                  type="button"
                  className={`${styles.solutionActionBtn} ${revealedSolutions.includes(current.id) ? styles.solutionActionBtnActive : ""}`}
                  onClick={handleRevealSolution}
                  disabled={isRevealing}
                  title={
                    revealedSolutions.includes(current.id)
                      ? "View unlocked solution & explanation"
                      : answers[current.id] !== undefined
                      ? `Reveal solution (${solutionRevealsRemaining} of 5 remaining)`
                      : "Choose an answer first to unlock solution"
                  }
                >
                  <SparklesIcon width="14" height="14" />
                  <span>
                    {revealedSolutions.includes(current.id)
                      ? "View Solution"
                      : "Reveal Solution"}
                  </span>
                  {!revealedSolutions.includes(current.id) && (
                    <span className={styles.solutionCounterTag}>
                      {solutionRevealsRemaining}/5
                    </span>
                  )}
                </button>
              )}
            </div>

            {currentIndex < questions.length - 1 ? (
              <button
                type="button"
                className={styles.actionBtnPrimary}
                onClick={() => setCurrentIndex((v) => Math.min(questions.length - 1, v + 1))}
              >
                <span>Next Question →</span>
              </button>
            ) : (
              <button
                type="button"
                className={`${styles.actionBtnPrimary} ${styles.actionBtnSubmit}`}
                onClick={() => setShowSubmitConfirm(true)}
                disabled={mode === "submitting"}
              >
                <span>Review &amp; Submit</span>
                <ArrowRightIcon width="16" height="16" />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── 5. Solution & Step-by-Step Drawer (Learning Mode) ── */}
      {showSolutionDrawer && activeSolutionData && (
        <div className={styles.solutionDrawerOverlay} onClick={() => setShowSolutionDrawer(false)}>
          <div className={styles.solutionDrawerContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.solutionDrawerHeader}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                  <span className={styles.brandBadge} style={{ fontSize: "0.875rem", padding: "0.2rem 0.5rem" }}>
                    <SparklesIcon width="12" height="12" />
                    <span>Learning Mode Solution</span>
                  </span>
                  <span className={styles.solutionCounterTag}>
                    {solutionRevealsRemaining} reveals left
                  </span>
                </div>
                <h3 style={{ fontSize: "1.125rem", fontWeight: 800, color: "#0F172A", margin: 0 }}>
                  Question {currentIndex + 1} Solution
                </h3>
              </div>

              <button
                type="button"
                className={styles.solutionDrawerCloseBtn}
                onClick={() => setShowSolutionDrawer(false)}
                title="Close Drawer"
              >
                ✕
              </button>
            </div>

            {solutionRevealsRemaining <= 1 && (
              <div className={styles.solutionLimitWarning}>
                <WarningIcon width="16" height="16" />
                <span>
                  You have <strong>{solutionRevealsRemaining}</strong> solution reveal{solutionRevealsRemaining === 1 ? "" : "s"} left for this attempt.
                </span>
              </div>
            )}

            {/* Explanation Section */}
            <div className={styles.solutionSectionCard}>
              <div className={styles.solutionSectionTitle}>
                <DocumentIcon width="14" height="14" style={{ color: "#165AF6" }} />
                <span>Concept &amp; Explanation</span>
              </div>
              <div className={styles.solutionSectionBody}>
                {activeSolutionData.explanation || "No explanation provided for this question."}
              </div>
            </div>

            {/* Step-by-Step Worked Solution Section */}
            <div className={styles.solutionSectionCard} style={{ background: "#F5F3FF", borderColor: "#DDD6FE" }}>
              <div className={styles.solutionSectionTitle} style={{ color: "#6D28D9" }}>
                <SparklesIcon width="14" height="14" style={{ color: "#7C3AED" }} />
                <span>Step-by-Step Worked Solution</span>
              </div>
              <div className={styles.solutionSectionBody} style={{ color: "#4C1D95" }}>
                {activeSolutionData.solution || activeSolutionData.explanation || "Step-by-step solution provided by course instructor."}
              </div>
            </div>

            <button
              type="button"
              className={styles.actionBtnPrimary}
              style={{ width: "100%", justifyContent: "center", marginTop: "auto" }}
              onClick={() => setShowSolutionDrawer(false)}
            >
              Close &amp; Continue Attempt
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function safeOptions(jsonStr: string | null | undefined): string[] {
  if (!jsonStr) return [];
  try {
    return JSON.parse(jsonStr) as string[];
  } catch {
    return [];
  }
}

function DebouncedTextarea({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder: string;
  className?: string;
}) {
  const [text, setText] = useState(value);
  const timerRef = useRef<any>(null);
  const textRef = useRef(value);

  useEffect(() => {
    setText(value);
    textRef.current = value;
  }, [value]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        onChange(textRef.current);
      }
    };
  }, [onChange]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    textRef.current = val;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(val), 400);
  };

  return <textarea className={className} placeholder={placeholder} value={text} onChange={handleChange} />;
}

function DebouncedInput({
  value,
  onChange,
  placeholder,
  className,
  style,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder: string;
  className?: string;
  style?: any;
}) {
  const [text, setText] = useState(value);
  const timerRef = useRef<any>(null);
  const textRef = useRef(value);

  useEffect(() => {
    setText(value);
    textRef.current = value;
  }, [value]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        onChange(textRef.current);
      }
    };
  }, [onChange]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setText(val);
    textRef.current = val;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(val), 400);
  };

  return <input type="text" className={className} style={style} placeholder={placeholder} value={text} onChange={handleChange} />;
}

function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}
