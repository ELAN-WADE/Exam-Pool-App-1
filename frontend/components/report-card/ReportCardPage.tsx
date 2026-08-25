"use client";

import React, { useEffect, useState, useCallback, Suspense, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { useAcademic } from "../context/AcademicContext";
import { scorePct, letterGrade, gradeBadgeClass } from "../../lib/gradeUtils";
import {
  SearchIcon, UsersIcon, DocumentIcon,
  CheckCircleIcon, WarningIcon, EditIcon,
  SchoolIcon, ClipboardIcon, RefreshIcon,
  ChevronRightIcon, TrophyIcon, ShieldCheckIcon,
  LayersIcon, ActivityIcon, SparklesIcon,
  CrownIcon, BookIcon,
} from "../icons/Icons";
import { ActiveGoldBadge } from "../ui/ActiveGoldBadge";
import styles from "./ReportCardPage.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

type Settings = {
  school_name: string;
  current_term: string;
  admin_name: string;
  theme_json: string;
};

type Student = {
  id: number;
  name: string;
  email: string;
  reg_id: string | null;
  grade: string | null;
  role: string;
};

type ExamEntry = {
  exam_id: number;
  score: number;
  total_score: number;
  ca_score?: number | null;
  exam_score?: number | null;
  grade?: string | null;
  end_time: string;
  subject_name: string;
  code: string;
  term: string;
  term_id?: number;
  session_id?: number;
  session_name?: string;
  term_order_in_session?: number; // 1 = First Term, 2 = Second Term, 3 = Third Term
  term_teacher_remark?: string | null;
  teacher_id?: number;
};

type TermRemark = {
  teacher_remark: string | null;
  principal_remark: string | null;
};

type CumulativeSubjectRow = {
  code: string;
  subject_name: string;
  teacher_id?: number;
  term1_total: number | null;   // 1st Term total score (out of 100)
  term2_total: number | null;   // 2nd Term total score (out of 100)
  term3_ca: number | null;      // 3rd Term CA score
  term3_exam: number | null;    // 3rd Term Exam score
  term3_total: number | null;   // 3rd Term total
  term3_grade: string | null;
  cumulative_avg: number | null; // Average across all terms with scores
};

type Toast = { msg: string; type: "success" | "error" };

// ── Quick Suggestion Chips ──
const TEACHER_REMARK_SUGGESTIONS = [
  "An outstanding performance. Demonstrates remarkable intellectual curiosity, discipline, and consistent excellence.",
  "Very good result. Maintained commendable focus and diligent academic effort throughout the term.",
  "Good progress shown. Encouraged to participate more actively and refine problem-solving techniques.",
  "Fair academic standing. Needs to allocate more study time towards continuous assessment and core subjects.",
  "Satisfactory effort, but has untapped potential. A structured daily revision routine is recommended.",
];

const PRINCIPAL_REMARK_SUGGESTIONS = [
  "Promoted to the next academic level with distinction. Exemplary academic conduct!",
  "A highly commendable term report. Keep striving for the highest standards of scholarship.",
  "Promoted. Encouraged to sustain this commendable momentum in the upcoming academic session.",
  "Promoted on trial. Requires dedicated academic reinforcement and closer supervision.",
  "Results reflect steady improvement. Maintain commitment to all academic requirements.",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectIs3rdTerm(exams: ExamEntry[], activeTermName?: string): boolean {
  if (activeTermName) {
    const t = activeTermName.toLowerCase();
    if (t.includes("third") || t.includes("3rd") || t.endsWith("-t3") || t.endsWith("_t3")) {
      return true;
    }
  }
  if (!exams.length) return false;
  const hasOrderInfo = exams.some((e) => e.term_order_in_session !== undefined);
  if (hasOrderInfo) {
    const latestSessionId = Math.max(...exams.map((e) => e.session_id || 0));
    const latestSessionExams = exams.filter((e) => e.session_id === latestSessionId);
    const maxOrder = Math.max(...latestSessionExams.map((e) => e.term_order_in_session || 0));
    return maxOrder >= 3;
  }
  const termNames = [...new Set(exams.map((e) => (e.term || "").toLowerCase()))];
  return termNames.some((t) => t.includes("third") || t.includes("3rd") || t.endsWith("-t3") || t.endsWith("_t3"));
}

function buildCumulativeRows(exams: ExamEntry[]): CumulativeSubjectRow[] {
  if (!exams.length) return [];
  const subjectMap = new Map<string, CumulativeSubjectRow>();

  const enriched = exams.map((e) => {
    let order = e.term_order_in_session || 0;
    if (!order && e.term) {
      const t = e.term.toLowerCase();
      if (t.includes("first") || t.includes("1st") || t.includes("term 1") || t.endsWith("-t1") || t.endsWith("_t1")) order = 1;
      else if (t.includes("second") || t.includes("2nd") || t.includes("term 2") || t.endsWith("-t2") || t.endsWith("_t2")) order = 2;
      else if (t.includes("third") || t.includes("3rd") || t.includes("term 3") || t.endsWith("-t3") || t.endsWith("_t3")) order = 3;
    }
    return { ...e, computed_order: order };
  });

  const sorted = [...enriched].sort((a, b) => a.computed_order - b.computed_order);

  for (const e of sorted) {
    const key = (e.code || e.subject_name || "SUBJ").toUpperCase();
    if (!subjectMap.has(key)) {
      subjectMap.set(key, {
        code: e.code || key,
        subject_name: e.subject_name || key,
        teacher_id: e.teacher_id as number | undefined,
        term1_total: null,
        term2_total: null,
        term3_ca: null,
        term3_exam: null,
        term3_total: null,
        term3_grade: null,
        cumulative_avg: null,
      });
    }
    const row = subjectMap.get(key)!;
    const order = e.computed_order;
    const termScore = e.score ?? 0;

    if (order === 1) {
      row.term1_total = termScore;
    } else if (order === 2) {
      row.term2_total = termScore;
    } else {
      row.term3_ca = e.ca_score ?? null;
      row.term3_exam = e.exam_score ?? null;
      row.term3_total = termScore;
      row.term3_grade = e.grade ?? letterGrade(scorePct(e.score, e.total_score));
    }
  }

  for (const row of subjectMap.values()) {
    const vals = [row.term1_total, row.term2_total, row.term3_total].filter((v) => v !== null) as number[];
    if (vals.length > 0) {
      row.cumulative_avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
  }

  return Array.from(subjectMap.values());
}

// ─── Export Wrapper ───────────────────────────────────────────────────────────

export function ReportCardPage() {
  return (
    <Suspense fallback={
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "400px" }}>
        <div className="spinner" />
      </div>
    }>
      <ReportCardPageInner />
    </Suspense>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

function ReportCardPageInner() {
  const { user } = useAuth();
  const isOperator = user?.role === "operator";
  const isStudent = user?.role === "student";
  const isClassTeacher = (user as any)?.is_class_teacher === true;
  const assignedClassId: number | null = (user as any)?.assigned_class_id ?? null;
  const assignedClassName: string | null = (user as any)?.assigned_class_name ?? null;

  const searchParams = useSearchParams();
  const preselectedStudentId = Number(searchParams?.get("studentId") ?? 0);
  const preselectedSessionId = Number(searchParams?.get("sessionId") ?? 0);
  const preselectedTermId = Number(searchParams?.get("termId") ?? 0);

  const { sessions, terms, selectedSession, selectedTerm, activeSession, activeTerm, setSelectedSession, setSelectedTerm } = useAcademic();
  const isCurrentSessionActive = Boolean(selectedSession?.is_active || (activeSession && selectedSession?.id === activeSession?.id));
  const isCurrentTermActive = Boolean(selectedTerm?.is_active || (activeTerm && selectedTerm?.id === activeTerm?.id));

  // App-level state
  const [settings, setSettings] = useState<Settings | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [loadingInit, setLoadingInit] = useState(true);

  // Filters
  const [query, setQuery] = useState("");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [remarkFilter, setRemarkFilter] = useState<"all" | "pending" | "completed">("all");

  // Report card state
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [exams, setExams] = useState<ExamEntry[]>([]);
  const [remarks, setRemarks] = useState<TermRemark>({ teacher_remark: null, principal_remark: null });
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loadingCard, setLoadingCard] = useState(false);
  const [cardError, setCardError] = useState("");
  const [isCumulativeMode, setIsCumulativeMode] = useState<boolean>(true);
  const [showLivePreview, setShowLivePreview] = useState(true);

  // Remarks drafts
  const [teacherDraft, setTeacherDraft] = useState("");
  const [principalDraft, setPrincipalDraft] = useState("");
  const [savingRemark, setSavingRemark] = useState(false);
  const [remarkSaved, setRemarkSaved] = useState(false);

  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Derived settings
  let theme: Record<string, unknown> = {};
  try { theme = settings?.theme_json ? JSON.parse(settings.theme_json) : {}; } catch {}
  const logo = (theme.school_logo as string) || null;
  const schoolName = settings?.school_name || "Academic Institution";
  const adminName = settings?.admin_name || "Principal / Head of School";
  const currentTerm = settings?.current_term || "2026-T1";

  const activeSessionName = selectedSession?.name || "";
  const activeTermName = selectedTerm?.name || "";
  const currentAcademicDisplay = activeSessionName && activeTermName
    ? `${activeSessionName} · ${activeTermName}`
    : activeTermName || activeSessionName || currentTerm;

  // ── Load settings & student list on mount ──
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let studentList: Student[] = [];
        let cfg: Settings | null = null;
        if (isStudent && user) {
          const cfgRes = await api.getPublicSettings() as Settings;
          cfg = cfgRes;
          const self: Student = { id: (user as any).id, name: (user as any).name, email: (user as any).email || "", reg_id: (user as any).reg_id ?? null, grade: (user as any).grade ?? null, role: "student" } as any;
          studentList = [self];
          if (alive) {
            setSettings(cfg);
            setStudents(studentList);
            selectStudent(self);
            setLoadingInit(false);
            return;
          }
        } else if (isClassTeacher && assignedClassId) {
          const [cfgRes, rosterRes] = await Promise.all([
            api.getPublicSettings() as Promise<Settings>,
            api.getClassRoster(assignedClassId, selectedTerm?.id),
          ]);
          cfg = cfgRes;
          studentList = (Array.isArray(rosterRes) ? rosterRes : []).map((s: any) => ({
            id: s.id, name: s.name, email: s.email || "",
            reg_id: s.reg_id ?? null, grade: s.grade ?? null, role: "student",
          }));
        } else if (isOperator) {
          const [cfgRes, allUsers] = await Promise.all([
            api.getPublicSettings() as Promise<Settings>,
            api.getUsers() as Promise<Student[]>,
          ]);
          cfg = cfgRes;
          studentList = Array.isArray(allUsers)
            ? allUsers.filter((u: Student) => u.role === "student")
            : [];
        } else {
          const cfgRes = await api.getPublicSettings() as Settings;
          cfg = cfgRes;
          studentList = [];
        }
        if (!alive) return;
        if (cfg) setSettings(cfg);
        setStudents(studentList);

        if (preselectedStudentId > 0 && studentList.length > 0) {
          const found = studentList.find((s: Student) => Number(s.id) === preselectedStudentId);
          if (found) selectStudent(found);
        }
      } catch (err) {
        if (alive) showToast("ReportCard init error: " + (err instanceof Error ? err.message : String(err)), "error");
      } finally {
        if (alive) setLoadingInit(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOperator, isStudent, isClassTeacher, assignedClassId, preselectedStudentId]);

  // URL sync
  useEffect(() => {
    if (preselectedSessionId > 0 && sessions.length > 0) {
      const matchS = sessions.find((s) => s.id === preselectedSessionId);
      if (matchS && selectedSession?.id !== matchS.id) {
        setSelectedSession(matchS);
      }
    }
  }, [preselectedSessionId, sessions, selectedSession?.id, setSelectedSession]);

  useEffect(() => {
    if (preselectedTermId > 0 && terms.length > 0) {
      const matchT = terms.find((t) => t.id === preselectedTermId);
      if (matchT && selectedTerm?.id !== matchT.id) {
        setSelectedTerm(matchT);
      }
    }
  }, [preselectedTermId, terms, selectedTerm?.id, setSelectedTerm]);

  // ── Load individual student report card data ──
  const selectStudent = useCallback(async (student: Student) => {
    setSelectedStudent(student);
    setLoadingCard(true);
    setCardError("");
    setExams([]);
    setRemarks({ teacher_remark: null, principal_remark: null });
    setTeacherDraft("");
    setPrincipalDraft("");
    setRemarkSaved(false);

    try {
      const sessionId = selectedSession?.id;
      const termId = selectedTerm?.id;
      const resolvedTerm = activeTermName || currentTerm;

      const [examsRes, remarkRes] = await Promise.all([
        (api.getStudentReportCardResults(Number(student.id), sessionId, termId) as unknown) as Promise<ExamEntry[]>,
        api.getTermRemark(Number(student.id), resolvedTerm, sessionId, termId) as Promise<TermRemark>,
      ]);

      let examList: ExamEntry[] = Array.isArray(examsRes) ? examsRes : [];

      if (sessionId) {
        examList = examList.filter((e) => Number(e.session_id) === Number(sessionId));
      } else if (activeSessionName) {
        examList = examList.filter((e) => !e.session_name || e.session_name === activeSessionName);
      }

      const is3rd = activeTermName ? (
        activeTermName.toLowerCase().includes("third") ||
        activeTermName.toLowerCase().includes("3rd") ||
        activeTermName.endsWith("-T3") ||
        activeTermName.endsWith("_T3")
      ) : detectIs3rdTerm(examList, currentTerm);

      if (!is3rd && termId) {
        examList = examList.filter((e) => Number(e.term_id) === Number(termId));
      } else if (!is3rd && activeTermName) {
        examList = examList.filter((e) => (e.term || "").toLowerCase() === activeTermName.toLowerCase());
      }

      setExams(examList);
      setSelectedIds(new Set(examList.map((e) => e.exam_id)));
      setIsCumulativeMode(is3rd);

      if (remarkRes) {
        setRemarks(remarkRes);
        setTeacherDraft(remarkRes.teacher_remark || "");
        setPrincipalDraft(remarkRes.principal_remark || "");
      }
    } catch (err) {
      setCardError(err instanceof Error ? err.message : "Failed to load report card data");
    } finally {
      setLoadingCard(false);
    }
  }, [selectedSession, selectedTerm, activeSessionName, activeTermName, currentTerm]);

  // Re-fetch on session/term switch
  const studentRef = useRef(selectedStudent);
  studentRef.current = selectedStudent;
  useEffect(() => {
    if (studentRef.current) {
      selectStudent(studentRef.current);
    }
  }, [selectedSession, selectedTerm, selectStudent]);

  // ── Save term remark ──
  const saveRemark = async () => {
    if (!selectedStudent) return;
    setSavingRemark(true);
    try {
      const sessionId = selectedSession?.id;
      const termId = selectedTerm?.id;
      const termName = activeTermName || currentTerm;
      const remarkText = isOperator ? principalDraft : teacherDraft;
      await api.saveTermRemark(Number(selectedStudent.id), termName, remarkText, sessionId, termId);

      const updated = await api.getTermRemark(Number(selectedStudent.id), termName, sessionId, termId) as TermRemark;
      if (updated) {
        setRemarks(updated);
        setTeacherDraft(updated.teacher_remark || "");
        setPrincipalDraft(updated.principal_remark || "");
      }

      setRemarkSaved(true);
      setTimeout(() => setRemarkSaved(false), 3000);
      showToast(isOperator ? "Principal's endorsement saved" : "Class teacher's remark saved", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save remark", "error");
    } finally {
      setSavingRemark(false);
    }
  };

  // ── Exam selection helpers ──
  const toggleExam = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };
  const selectAll = () => setSelectedIds(new Set(exams.map((e) => e.exam_id)));
  const clearAll = () => setSelectedIds(new Set());

  const selectedList = exams.filter((e) => selectedIds.has(e.exam_id));
  const totalPct = selectedList.reduce((acc, e) => acc + scorePct(e.score, e.total_score), 0);
  const avgPct = selectedList.length > 0 ? Math.round(totalPct / selectedList.length) : 0;
  const overallLetterGrade = letterGrade(avgPct);

  // ── Print handler ──
  const handlePrint = () => {
    const frame = document.getElementById("rc-print-frame");
    if (!frame) return;
    const clone = frame.cloneNode(true) as HTMLElement;
    clone.id = "rc-print-clone";
    document.body.appendChild(clone);
    window.print();
    setTimeout(() => {
      if (clone.parentNode) clone.parentNode.removeChild(clone);
    }, 1000);
  };

  // ── Filtered student directory ──
  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      const q = query.toLowerCase();
      const matchesSearch =
        (s.name || "").toLowerCase().includes(q) ||
        (s.reg_id || "").toLowerCase().includes(q) ||
        (s.grade || "").toLowerCase().includes(q);

      const matchesGrade = gradeFilter === "all" || s.grade === gradeFilter;

      return matchesSearch && matchesGrade;
    });
  }, [students, query, gradeFilter]);

  // Unique grade options
  const uniqueGrades = useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => { if (s.grade) set.add(s.grade); });
    return Array.from(set).sort();
  }, [students]);

  // ── Student Switcher (Prev / Next) ──
  const currentStudentIndex = useMemo(() => {
    if (!selectedStudent) return -1;
    return filteredStudents.findIndex((s) => s.id === selectedStudent.id);
  }, [selectedStudent, filteredStudents]);

  const handlePrevStudent = () => {
    if (currentStudentIndex > 0) {
      selectStudent(filteredStudents[currentStudentIndex - 1]);
    }
  };

  const handleNextStudent = () => {
    if (currentStudentIndex < filteredStudents.length - 1) {
      selectStudent(filteredStudents[currentStudentIndex + 1]);
    }
  };

  return (
    <div className={styles.container}>
      <style>{`
        @media print {
          @page { margin: 0; size: A4 portrait; }
          body > *:not(#rc-print-clone) { display: none !important; }
          #rc-print-clone {
            display: block !important;
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 210mm !important;
            height: 297mm !important;
            box-sizing: border-box !important;
            background: #FFFFFF !important;
            z-index: 999999 !important;
            color: #0F172A !important;
            overflow: hidden !important;
          }
        }
        #rc-print-frame { display: none; }
      `}</style>
      {/* Toast Feedback */}
      {toast && (
        <div className={`${styles.toast} ${toast.type === "success" ? styles.toastSuccess : styles.toastError}`}>
          {toast.type === "success" ? <CheckCircleIcon width="16" height="16" /> : <WarningIcon width="16" height="16" />}
          <span>{toast.msg}</span>
        </div>
      )}

      {/* ── SCREEN UI ── */}
      <div className="no-print" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

        {/* ── Access Guard for non-class teachers (students get own report) ── */}
        {!loadingInit && !isOperator && !isClassTeacher && !isStudent && (
          <div className="card" style={{ padding: "4rem 2rem", textAlign: "center", maxWidth: 580, margin: "2rem auto" }}>
            <SchoolIcon width="48" height="48" style={{ margin: "0 auto 1.25rem", color: "var(--color-primary, #4F46E5)", opacity: 0.8 }} />
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.5rem", color: "var(--color-text, #0F172A)" }}>
              Class Teacher Assignment Required
            </h2>
            <p style={{ color: "var(--color-muted, #64748B)", lineHeight: 1.6, fontSize: "0.875rem", margin: "0 0 1.25rem" }}>
              You are currently signed in as a subject teacher without a designated class roster assignment.
              The Cumulative Report Card &amp; Grading Center is restricted to designated Class Teachers and Academic Administrators.
            </p>
            <div style={{ fontSize: "0.8125rem", color: "var(--color-muted, #64748B)", background: "var(--color-surface-2, #F8FAFC)", padding: "0.75rem", borderRadius: "8px", border: "1px solid var(--color-border, #E2E8F0)" }}>
              Please contact the school administrator to assign you as a Class Teacher (e.g. JSS 1, SS 2, Primary 4).
            </div>
          </div>
        )}

        {/* ── View 1: Roster Directory (hidden for students — they see own card directly) ── */}
        {(isOperator || isClassTeacher) && !selectedStudent && !isStudent && (
          <>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <h1 style={{ fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.02em", margin: 0, color: "var(--color-text, #0F172A)" }}>
                    {isClassTeacher ? "Class Teacher Grading Center" : "Report Cards & Academic Records"}
                  </h1>
                  {assignedClassName && (
                    <span className="badge badge-primary" style={{ fontSize: "0.8125rem", padding: "0.2rem 0.6rem" }}>
                      {assignedClassName}
                    </span>
                  )}
                </div>
                <p style={{ color: "var(--color-muted, #64748B)", fontSize: "0.875rem", margin: "0.35rem 0 0" }}>
                  {isClassTeacher
                    ? `Review academic performance, continuous assessment, and endorse official term report cards for ${assignedClassName || "your class"}.`
                    : "School-wide student report cards, multi-term cumulative evaluations, and administrative endorsements."}
                </p>
              </div>
            </div>

            {/* Academic Session & Term Control Strip */}
            {sessions.length > 0 && (
              <div className={styles.academicBar}>
                <div className={styles.academicControls}>
                  <div className={styles.controlGroup}>
                    <span className={styles.controlLabel}>Academic Session:</span>
                    <select
                      className={styles.selectInput}
                      value={selectedSession?.id || ""}
                      onChange={(e) => {
                        const s = sessions.find((x) => x.id === Number(e.target.value));
                        if (s) {
                          setSelectedSession(s);
                          const firstTerm = terms.find((t) => t.session_id === s.id);
                          setSelectedTerm(firstTerm || null);
                        }
                      }}
                    >
                      {sessions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} {s.is_active ? "(Active)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.controlGroup}>
                    <span className={styles.controlLabel}>Term:</span>
                    <select
                      className={styles.selectInput}
                      value={selectedTerm?.id || ""}
                      onChange={(e) => {
                        const t = terms.find((x) => x.id === Number(e.target.value));
                        setSelectedTerm(t || null);
                      }}
                    >
                      <option value="">All Terms in Session</option>
                      {terms.filter((t) => t.session_id === selectedSession?.id).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} {t.is_active ? "(Active)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className={styles.academicActiveBadge}>
                  <span>Viewing:</span>
                  <strong className={styles.academicActiveStrong}>{currentAcademicDisplay}</strong>
                </div>
              </div>
            )}

            {/* KPI Metrics Row */}
            <div className={styles.metricsGrid}>
              <div className={styles.metricCard}>
                <div className={styles.metricHeader}>
                  <span className={styles.metricLabel}>Total Students</span>
                  <div className={styles.metricIcon} style={{ color: "#4F46E5" }}><UsersIcon width="15" height="15" /></div>
                </div>
                <div className={styles.metricValue}>{students.length}</div>
                <div className={styles.metricSubtext}>
                  {isClassTeacher ? `Enrolled in ${assignedClassName || "Class"}` : "School-wide student directory"}
                </div>
              </div>

              <div className={styles.metricCard}>
                <div className={styles.metricHeader}>
                  <span className={styles.metricLabel}>Active Evaluation</span>
                  <div className={styles.metricIcon} style={{ color: "#F97316" }}><ActivityIcon width="15" height="15" /></div>
                </div>
                <div className={styles.metricValue}>{selectedTerm?.name || "All Terms"}</div>
                <div className={styles.metricSubtext}>
                  {selectedSession?.name || "Current Academic Session"}
                </div>
              </div>

              <div className={styles.metricCard}>
                <div className={styles.metricHeader}>
                  <span className={styles.metricLabel}>Evaluation Mode</span>
                  <div className={styles.metricIcon} style={{ color: "#10B981" }}><TrophyIcon width="15" height="15" /></div>
                </div>
                <div className={styles.metricValue} style={{ fontSize: "1.125rem" }}>
                  {activeTermName.toLowerCase().includes("3rd") || activeTermName.toLowerCase().includes("third")
                    ? "3rd Term Cumulative"
                    : "Standard Term (C.A. + Exam)"}
                </div>
                <div className={styles.metricSubtext}>Computed from official grade policies</div>
              </div>
            </div>

            {/* Filter Strip */}
            <div className={styles.filterStrip}>
              <div className={styles.searchBox}>
                <span className={styles.searchIconWrapper}>
                  <SearchIcon width="14" height="14" />
                </span>
                <input
                  type="text"
                  className={styles.searchInput}
                  placeholder="Search students by name, registration ID, or grade…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              {uniqueGrades.length > 1 && (
                <div className={styles.filterSelectGroup}>
                  <span className={styles.controlLabel}>Class:</span>
                  <select
                    className={styles.selectInput}
                    value={gradeFilter}
                    onChange={(e) => setGradeFilter(e.target.value)}
                  >
                    <option value="all">All Classes ({students.length})</option>
                    {uniqueGrades.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Roster Table */}
            <div className={styles.rosterCard}>
              {loadingInit ? (
                <div style={{ padding: "4rem", textAlign: "center" }}>
                  <div className="spinner" style={{ margin: "0 auto 1rem" }} />
                  <p style={{ color: "var(--color-muted, #64748B)", fontSize: "0.875rem" }}>Loading student roster…</p>
                </div>
              ) : filteredStudents.length === 0 ? (
                <div style={{ padding: "3.5rem 1.5rem", textAlign: "center", color: "var(--color-muted, #64748B)" }}>
                  <UsersIcon width="40" height="40" style={{ opacity: 0.35, margin: "0 auto 0.75rem" }} />
                  <p style={{ fontWeight: 600, fontSize: "0.9375rem", margin: "0 0 0.25rem", color: "var(--color-text, #0F172A)" }}>
                    {query || gradeFilter !== "all" ? "No matching students found" : "No students in this class roster"}
                  </p>
                  <p style={{ fontSize: "0.8125rem", margin: 0 }}>
                    {query || gradeFilter !== "all" ? "Try adjusting your search criteria or class filter." : "Students enrolled in this class will appear here automatically."}
                  </p>
                </div>
              ) : (
                <table className="tbl" style={{ width: "100%", margin: 0 }}>
                  <thead>
                    <tr>
                      <th style={{ width: "40%" }}>Student</th>
                      <th style={{ width: "25%" }}>Registration ID</th>
                      <th style={{ width: "20%" }}>Class / Grade</th>
                      <th style={{ textAlign: "right", width: "15%" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                            <div className={styles.studentAvatar}>
                              {(row.name || "?").charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className={styles.studentName}>{row.name}</div>
                              <div className={styles.studentEmail}>{row.email || "No email"}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={styles.regCode}>{row.reg_id || "—"}</span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 500, fontSize: "0.8125rem" }}>{row.grade || "—"}</span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => selectStudent(row)}
                            style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
                          >
                            <DocumentIcon width="14" height="14" />
                            Open Report
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {/* ── View 2: Student Report Card Workspace ── */}
        {selectedStudent && (
          <>
            {/* Sticky Workspace Header */}
            <div className={styles.workspaceHeader}>
              <div className={styles.navBreadcrumb}>
                <button
                  type="button"
                  className={styles.backBtn}
                  onClick={() => setSelectedStudent(null)}
                >
                  ← Back to Roster
                </button>

                <div className={styles.studentMetaGroup}>
                  <div className={styles.studentMetaTitle}>
                    {selectedStudent.name}
                    {selectedStudent.grade && (
                      <span className="badge badge-primary" style={{ fontSize: "0.75rem", padding: "0.15rem 0.5rem" }}>
                        {selectedStudent.grade}
                      </span>
                    )}
                  </div>
                  <div className={styles.studentMetaDetails}>
                    {selectedStudent.reg_id && (
                      <span>Reg: <code className={styles.regCode}>{selectedStudent.reg_id}</code></span>
                    )}
                    <span>·</span>
                    <span>Evaluation: <strong style={{ color: "var(--color-primary, #4F46E5)" }}>{currentAcademicDisplay}</strong></span>
                  </div>
                </div>
              </div>

              {/* Student Switcher + Print Actions */}
              <div className={styles.actionButtonGroup}>
                {filteredStudents.length > 1 && currentStudentIndex !== -1 && (
                  <div className={styles.studentSwitcher}>
                    <button
                      type="button"
                      className={styles.switcherBtn}
                      onClick={handlePrevStudent}
                      disabled={currentStudentIndex === 0}
                      title="Previous Student"
                    >
                      ←
                    </button>
                    <span className={styles.switcherIndex}>
                      {currentStudentIndex + 1} of {filteredStudents.length}
                    </span>
                    <button
                      type="button"
                      className={styles.switcherBtn}
                      onClick={handleNextStudent}
                      disabled={currentStudentIndex === filteredStudents.length - 1}
                      title="Next Student"
                    >
                      →
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => selectStudent(selectedStudent)}
                  title="Reload exam records"
                >
                  <RefreshIcon width="14" height="14" />
                </button>

                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handlePrint}
                  disabled={selectedIds.size === 0 || loadingCard}
                  style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
                >
                  <DocumentIcon width="14" height="14" />
                  Print / Save PDF
                </button>
              </div>
            </div>

            {/* Academic Controls & Mode Switcher in Detail View */}
            <div className={styles.academicBar} style={{ padding: "0.5rem 1rem" }}>
              <div className={styles.academicControls}>
                {sessions.length > 0 && (
                  <>
                    <div className={styles.controlGroup}>
                      <span className={styles.controlLabel}>Session:</span>
                      <select
                        className={styles.selectInput}
                        value={selectedSession?.id || ""}
                        onChange={(e) => {
                          const s = sessions.find((x) => x.id === Number(e.target.value));
                          if (s) {
                            setSelectedSession(s);
                            const firstTerm = terms.find((t) => t.session_id === s.id);
                            setSelectedTerm(firstTerm || null);
                          }
                        }}
                      >
                        {sessions.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className={styles.controlGroup}>
                      <span className={styles.controlLabel}>Term:</span>
                      <select
                        className={styles.selectInput}
                        value={selectedTerm?.id || ""}
                        onChange={(e) => {
                          const t = terms.find((x) => x.id === Number(e.target.value));
                          setSelectedTerm(t || null);
                        }}
                      >
                        <option value="">All Terms</option>
                        {terms.filter((t) => t.session_id === selectedSession?.id).map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                <div className={styles.modeToggle}>
                  <button
                    type="button"
                    className={`${styles.modeBtn} ${!isCumulativeMode ? styles.modeBtnActive : ""}`}
                    onClick={() => setIsCumulativeMode(false)}
                  >
                    Single Term (C.A. + Exam)
                  </button>
                  <button
                    type="button"
                    className={`${styles.modeBtn} ${isCumulativeMode ? styles.modeBtnActive : ""}`}
                    onClick={() => setIsCumulativeMode(true)}
                  >
                    3rd Term Cumulative
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <button
                  type="button"
                  className={styles.textBtn}
                  onClick={() => setShowLivePreview(!showLivePreview)}
                >
                  {showLivePreview ? "Hide Preview Sheet" : "Show Preview Sheet"}
                </button>
              </div>
            </div>

            {/* Loading State */}
            {loadingCard && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "4rem 0", gap: "0.75rem" }}>
                <div className="spinner" />
                <p style={{ color: "var(--color-muted, #64748B)", fontSize: "0.875rem" }}>Loading report card evaluation…</p>
              </div>
            )}

            {/* Error State */}
            {!loadingCard && cardError && (
              <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: "10px", padding: "1.25rem" }}>
                <p style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "#DC2626", fontWeight: 700, margin: "0 0 0.5rem", fontSize: "0.9375rem" }}>
                  <WarningIcon width="16" height="16" /> Failed to load exam performance records
                </p>
                <p style={{ color: "#7F1D1D", fontSize: "0.8125rem", margin: "0 0 1rem" }}>{cardError}</p>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => selectStudent(selectedStudent)}
                >
                  Retry Loading
                </button>
              </div>
            )}

            {/* No exams State */}
            {!loadingCard && !cardError && exams.length === 0 && (
              <div className="card" style={{ textAlign: "center", padding: "3.5rem 1.5rem" }}>
                <ClipboardIcon width="40" height="40" style={{ margin: "0 auto 0.75rem", opacity: 0.35, color: "var(--color-muted, #64748B)" }} />
                <p style={{ fontWeight: 700, fontSize: "1rem", marginBottom: "0.25rem", color: "var(--color-text, #0F172A)" }}>
                  No completed exams found for this academic period
                </p>
                <p style={{ color: "var(--color-muted, #64748B)", fontSize: "0.8125rem", margin: 0 }}>
                  {selectedStudent.name} does not have any recorded exam scores for {currentAcademicDisplay}.
                </p>
              </div>
            )}

            {/* Main Scorecard + Remarks Grid */}
            {!loadingCard && !cardError && exams.length > 0 && (
              <div className={styles.workspaceGrid}>

                {/* Left Column: Subjects & Score Breakdown */}
                <div className={styles.sectionCard}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <h3 className={styles.sectionTitle}>
                        <span className={styles.metricIconCyan}><LayersIcon width="16" height="16" /></span>
                        Subjects &amp; Continuous Assessment
                      </h3>
                      <div className={styles.sectionSubtitle}>
                        {selectedIds.size} of {exams.length} subjects included in report computation
                      </div>
                    </div>
                    <div className={styles.selectionPills}>
                      <button type="button" className={styles.textBtn} onClick={selectAll}>Select All</button>
                      <button type="button" className={styles.textBtn} onClick={clearAll}>Deselect All</button>
                    </div>
                  </div>

                  <div className={styles.subjectList}>
                    {exams.map((e) => {
                      const pct = scorePct(e.score, e.total_score);
                      const checked = selectedIds.has(e.exam_id);
                      return (
                        <label
                          key={e.exam_id}
                          className={`${styles.subjectRow} ${checked ? styles.subjectRowChecked : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleExam(e.exam_id)}
                            style={{ width: 16, height: 16, accentColor: "#0F172A", cursor: "pointer", flexShrink: 0 }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: "0.875rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text, #0F172A)" }}>
                              {e.subject_name}
                            </div>
                            <div style={{ fontSize: "0.75rem", color: "var(--color-muted, #64748B)", marginTop: 2, display: "flex", alignItems: "center", gap: "0.35rem" }}>
                              <span className={styles.subjectCode}>{e.code}</span>
                              <span>·</span>
                              <span>{e.term}</span>
                              {e.term_order_in_session && (
                                <span style={{ padding: "0.1rem 0.35rem", borderRadius: 4, background: "var(--color-surface-2, #F1F5F9)", fontWeight: 600, fontSize: "0.6875rem" }}>
                                  Term {e.term_order_in_session}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className={styles.scorePill}>
                            <div className={styles.scoreValue}>
                              {e.score ?? 0} <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--color-muted, #64748B)" }}>/ {e.total_score ?? 100}</span>
                            </div>
                            <div className={styles.scoreBreakdown}>
                              CA: {e.ca_score ?? "—"} | Exam: {e.exam_score ?? "—"}
                            </div>
                            <span className={`badge ${gradeBadgeClass(pct)}`} style={{ fontSize: "0.6875rem", padding: "0.1rem 0.4rem" }}>
                              {pct}% · {e.grade || letterGrade(pct)}
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  {selectedList.length > 1 && (
                    <div className={styles.summaryBar}>
                      <span className={styles.summaryLabel}>Term Aggregate Average</span>
                      <div className={styles.summaryScore}>
                        <span>{avgPct}%</span>
                        <span className={`badge ${gradeBadgeClass(avgPct)}`} style={{ fontSize: "0.75rem" }}>
                          {overallLetterGrade}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Right Column: Dual Remarks & Endorsements */}
                <div className={styles.remarksContainer}>
                  <div className={styles.sectionCard}>
                    <div className={styles.sectionHeader}>
                      <h3 className={styles.sectionTitle}>
                        <span className={styles.metricIconViolet}><EditIcon width="15" height="15" /></span>
                        Academic Remarks &amp; Endorsement
                      </h3>
                    </div>

                    {/* Teacher Remark Section */}
                    <div className={styles.remarkBox}>
                      <div className={styles.remarkLabelRow}>
                        <label className={styles.remarkLabel}>
                          <span className={styles.metricIconViolet}><EditIcon width="12" height="12" /></span> Class Teacher's Remark
                        </label>
                        {teacherDraft && (
                          <span className="badge badge-success" style={{ fontSize: "0.6875rem", padding: "0.15rem 0.45rem" }}>
                            Recorded
                          </span>
                        )}
                      </div>

                      {isOperator || isStudent ? (
                        <div className={`${styles.remarkReadOnly} ${!teacherDraft ? styles.remarkReadOnlyEmpty : ""}`}>
                          {teacherDraft || "No teacher remark entered yet."}
                        </div>
                      ) : (
                        <>
                          <textarea
                            className={styles.remarkTextarea}
                            rows={3}
                            placeholder="Write the class teacher's official term assessment…"
                            value={teacherDraft}
                            onChange={(e) => setTeacherDraft(e.target.value)}
                          />

                          {/* Quick Suggestions Chips for Teachers */}
                          <div style={{ marginTop: "0.25rem" }}>
                            <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "var(--color-muted, #94A3B8)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.3rem" }}>
                              Suggested Feedback:
                            </div>
                            <div className={styles.suggestionChips}>
                              {TEACHER_REMARK_SUGGESTIONS.map((chip, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  className={styles.chipBtn}
                                  onClick={() => setTeacherDraft(chip)}
                                >
                                  {chip.slice(0, 48)}…
                                </button>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Principal Remark Section */}
                    <div className={styles.remarkBox} style={{ paddingTop: "0.75rem", borderTop: "1px dashed var(--color-border, #E2E8F0)" }}>
                      <div className={styles.remarkLabelRow}>
                        <label className={styles.remarkLabel}>
                          <span className={styles.metricIconIndigo}><SchoolIcon width="12" height="12" /></span>
                          Principal / Proprietor's Endorsement
                        </label>
                        {principalDraft && (
                          <span className="badge badge-primary" style={{ fontSize: "0.6875rem", padding: "0.15rem 0.45rem" }}>
                            Endorsed
                          </span>
                        )}
                      </div>

                      {isStudent || !isOperator ? (
                        <div className={`${styles.remarkReadOnly} ${!principalDraft ? styles.remarkReadOnlyEmpty : ""}`}>
                          {principalDraft || "No principal endorsement entered yet."}
                        </div>
                      ) : (
                        <>
                          <textarea
                            className={styles.remarkTextarea}
                            rows={3}
                            placeholder="Write the principal's official promotion / executive assessment…"
                            value={principalDraft}
                            onChange={(e) => setPrincipalDraft(e.target.value)}
                          />

                          {/* Quick Suggestions Chips for Principals */}
                          <div style={{ marginTop: "0.25rem" }}>
                            <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "var(--color-muted, #94A3B8)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.3rem" }}>
                              Suggested Executive Endorsements:
                            </div>
                            <div className={styles.suggestionChips}>
                              {PRINCIPAL_REMARK_SUGGESTIONS.map((chip, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  className={styles.chipBtn}
                                  onClick={() => setPrincipalDraft(chip)}
                                >
                                  {chip.slice(0, 48)}…
                                </button>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Save Action Button — hidden for students (read-only view) */}
                    {!isStudent && (
                      <button
                        type="button"
                        className={styles.saveRemarkBtn}
                        disabled={savingRemark}
                        onClick={saveRemark}
                      >
                        {savingRemark ? "Saving…" : remarkSaved ? "✓ Remark Saved" : (isOperator ? "Save Principal's Endorsement" : "Save Class Teacher's Remark")}
                      </button>
                    )}
                  </div>
                </div>

              </div>
            )}

            {/* ── Live On-Screen Report Card Preview Sheet ── */}
            {showLivePreview && !loadingCard && !cardError && selectedStudent && selectedList.length > 0 && (
              <div className={styles.livePreviewSheet}>
                <div className={styles.previewHeader}>
                  <div>
                    <h3 style={{ fontSize: "1rem", fontWeight: 800, margin: 0, color: "#0F172A", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span className={styles.metricIconCyan}><SparklesIcon width="16" height="16" /></span>
                      {isCumulativeMode ? "3rd Term Cumulative Annual Record Preview" : "Official Report Card Preview"}
                    </h3>
                    <p style={{ fontSize: "0.75rem", color: "#64748B", margin: "0.2rem 0 0" }}>
                      High-fidelity preview of official academic transcript for {currentAcademicDisplay}
                    </p>
                  </div>
                  <span className="badge" style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem", background: "#F1F5F9", color: "#0F172A", border: "1px solid #E2E8F0" }}>
                    {currentAcademicDisplay}
                  </span>
                </div>

                {/* Table Preview */}
                {(() => {
                  if (isCumulativeMode) {
                    const cumRows = buildCumulativeRows(selectedList);
                    const overallCumAvg = cumRows.length > 0
                      ? Math.round(cumRows.reduce((acc, r) => acc + (r.cumulative_avg ?? 0), 0) / (cumRows.filter(r => r.cumulative_avg !== null).length || 1))
                      : 0;
                    const overallCumGrade = letterGrade(overallCumAvg);

                    return (
                      <div>
                        <div className={styles.previewTableWrap}>
                          <table className={styles.previewTable}>
                            <thead>
                              <tr>
                                <th>Subject</th>
                                <th>Code</th>
                                <th style={{ textAlign: "center" }}>1st Term (100)</th>
                                <th style={{ textAlign: "center" }}>2nd Term (100)</th>
                                <th style={{ textAlign: "center" }}>3rd CA (40)</th>
                                <th style={{ textAlign: "center" }}>3rd Exam (60)</th>
                                <th style={{ textAlign: "center" }}>3rd Total (100)</th>
                                <th style={{ textAlign: "center" }}>Cumulative Avg</th>
                                <th style={{ textAlign: "center" }}>Grade</th>
                              </tr>
                            </thead>
                            <tbody>
                              {cumRows.map((r) => {
                                const cumPct = r.cumulative_avg ?? 0;
                                const cumGrade = letterGrade(cumPct);
                                return (
                                  <tr key={r.code}>
                                    <td style={{ fontWeight: 600 }}>{r.subject_name}</td>
                                    <td><code className={styles.regCode}>{r.code}</code></td>
                                    <td style={{ textAlign: "center", fontFamily: "var(--font-mono)" }}>{r.term1_total ?? "—"}</td>
                                    <td style={{ textAlign: "center", fontFamily: "var(--font-mono)" }}>{r.term2_total ?? "—"}</td>
                                    <td style={{ textAlign: "center", fontFamily: "var(--font-mono)" }}>{r.term3_ca ?? "—"}</td>
                                    <td style={{ textAlign: "center", fontFamily: "var(--font-mono)" }}>{r.term3_exam ?? "—"}</td>
                                    <td style={{ textAlign: "center", fontWeight: 700, fontFamily: "var(--font-mono)" }}>{r.term3_total ?? "—"}</td>
                                    <td style={{ textAlign: "center", fontWeight: 800, fontFamily: "var(--font-mono)", color: cumPct >= 75 ? "#16A34A" : cumPct >= 45 ? "#0F172A" : "#DC2626" }}>
                                      {r.cumulative_avg !== null ? `${r.cumulative_avg}%` : "—"}
                                    </td>
                                    <td style={{ textAlign: "center" }}>
                                      <span className={`badge ${gradeBadgeClass(cumPct)}`}>{cumGrade}</span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            {cumRows.length > 1 && (
                              <tfoot>
                                <tr>
                                  <td colSpan={7} style={{ textTransform: "uppercase", fontSize: "0.75rem", letterSpacing: "0.04em" }}>Cumulative Overall Performance</td>
                                  <td style={{ textAlign: "center", fontSize: "0.9375rem", color: "#0F172A" }}>{overallCumAvg}%</td>
                                  <td style={{ textAlign: "center" }}>
                                    <span className={`badge ${gradeBadgeClass(overallCumAvg)}`}>{overallCumGrade}</span>
                                  </td>
                                </tr>
                              </tfoot>
                            )}
                          </table>
                        </div>
                      </div>
                    );
                  }

                  // Standard 6-column Layout
                  return (
                    <div className={styles.previewTableWrap}>
                      <table className={styles.previewTable}>
                        <thead>
                          <tr>
                            <th>Subject</th>
                            <th>Code</th>
                            <th style={{ textAlign: "center" }}>C.A. Score (40)</th>
                            <th style={{ textAlign: "center" }}>Exam Score (60)</th>
                            <th style={{ textAlign: "center" }}>Total Score (100)</th>
                            <th style={{ textAlign: "center" }}>Letter Grade</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedList.map((e) => {
                            const pct = scorePct(e.score, e.total_score);
                            return (
                              <tr key={e.exam_id}>
                                <td style={{ fontWeight: 600 }}>{e.subject_name}</td>
                                <td><code className={styles.regCode}>{e.code}</code></td>
                                <td style={{ textAlign: "center", fontFamily: "var(--font-mono)" }}>{e.ca_score ?? "—"}</td>
                                <td style={{ textAlign: "center", fontFamily: "var(--font-mono)" }}>{e.exam_score ?? "—"}</td>
                                <td style={{ textAlign: "center", fontWeight: 700, fontFamily: "var(--font-mono)" }}>{e.score ?? 0} / {e.total_score ?? 100}</td>
                                <td style={{ textAlign: "center" }}>
                                  <span className={`badge ${gradeBadgeClass(pct)}`}>{e.grade || letterGrade(pct)}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        {selectedList.length > 1 && (
                          <tfoot>
                            <tr>
                              <td colSpan={4} style={{ textTransform: "uppercase", fontSize: "0.75rem", letterSpacing: "0.04em" }}>Term Performance Average</td>
                              <td style={{ textAlign: "center", fontSize: "0.9375rem", color: "#0F172A" }}>{avgPct}%</td>
                              <td style={{ textAlign: "center" }}>
                                <span className={`badge ${gradeBadgeClass(avgPct)}`}>{overallLetterGrade}</span>
                              </td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── HIGH-FIDELITY PRINT FRAME (@media print) ── */}
      {selectedStudent && (
        <div id="rc-print-frame" style={{ display: "none" }}>
          <div style={{
            fontFamily: "var(--font-system, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
            padding: "8mm",
            color: "#0F172A",
            width: "210mm",
            height: "297mm",
            overflow: "hidden",
            margin: "0 auto",
            background: "#FFFFFF",
            boxSizing: "border-box",
            position: "relative",
          }}>
            {/* Outer Certificate Frame */}
            <div style={{
              position: "absolute", inset: "6mm",
              border: "1.5pt solid #0F172A",
              borderRadius: "4mm",
              pointerEvents: "none",
              zIndex: 1,
            }}>
              <div style={{
                position: "absolute", inset: "1.5mm",
                border: "1pt solid #CBD5E1",
                borderRadius: "2.5mm",
              }} />
            </div>

            <div style={{ position: "relative", zIndex: 10, padding: "6mm 10mm", height: "100%", display: "flex", flexDirection: "column" }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", gap: "12mm", paddingBottom: "4mm", marginBottom: "4mm", borderBottom: "2pt solid #E2E8F0" }}>
                <div style={{ flexShrink: 0, width: "26mm", height: "26mm", display: "flex", alignItems: "center", justifyContent: "center", background: "#F8FAFC", borderRadius: "3mm", border: "1pt solid #E2E8F0" }}>
                  {logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logo} alt="School Logo" style={{ width: "22mm", height: "22mm", objectFit: "contain" }} />
                  ) : (
                    <div style={{ fontSize: "7.5pt", color: "#64748B", fontWeight: 700 }}>EXAMPOOL</div>
                  )}
                </div>

                <div style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: "18pt", fontWeight: 900, color: "#0F172A", letterSpacing: "0.01em", textTransform: "uppercase", lineHeight: 1.15 }}>
                    {schoolName}
                  </div>
                  <div style={{ fontSize: "9.5pt", color: "#475569", marginTop: "2mm", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700 }}>
                    {isCumulativeMode ? "3rd Term Cumulative Academic Record" : "Official Student Term Report"}
                  </div>
                  <div style={{ fontSize: "8pt", color: "#64748B", marginTop: "1mm", fontWeight: 500 }}>
                    Academic Session: {currentAcademicDisplay}
                  </div>
                </div>

                <div style={{ width: "26mm", flexShrink: 0 }} />
              </div>

              {/* Student Info Matrix */}
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr",
                gap: "2.5mm 10mm", marginBottom: "4mm",
                fontSize: "9pt", background: "#F8FAFC",
                padding: "4mm 6mm", borderRadius: "2.5mm",
                border: "1pt solid #E2E8F0",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1pt dashed #CBD5E1", paddingBottom: "1.5mm" }}>
                  <span style={{ color: "#64748B" }}>Student Name:</span>
                  <strong style={{ color: "#0F172A" }}>{selectedStudent.name}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1pt dashed #CBD5E1", paddingBottom: "1.5mm" }}>
                  <span style={{ color: "#64748B" }}>Registration ID:</span>
                  <strong style={{ fontFamily: "monospace", color: "#0F172A" }}>{selectedStudent.reg_id || "—"}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1pt dashed #CBD5E1", paddingBottom: "1.5mm" }}>
                  <span style={{ color: "#64748B" }}>Class / Level:</span>
                  <strong style={{ color: "#0F172A" }}>{selectedStudent.grade || "—"}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1pt dashed #CBD5E1", paddingBottom: "1.5mm" }}>
                  <span style={{ color: "#64748B" }}>Issue Date:</span>
                  <strong style={{ color: "#0F172A" }}>{new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</strong>
                </div>
              </div>

              {/* Results Table */}
              {(() => {
                if (isCumulativeMode) {
                  const cumRows = buildCumulativeRows(selectedList);
                  const overallCumAvg = cumRows.length > 0
                    ? Math.round(cumRows.reduce((acc, r) => acc + (r.cumulative_avg ?? 0), 0) / (cumRows.filter(r => r.cumulative_avg !== null).length || 1))
                    : 0;
                  const overallCumGrade = letterGrade(overallCumAvg);
                  return (
                    <div style={{ borderRadius: "2.5mm", border: "1pt solid #E2E8F0", overflow: "hidden", marginBottom: "4mm" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8pt" }}>
                        <thead>
                          <tr style={{ background: "#0F172A", color: "#FFFFFF" }}>
                            <th style={{ padding: "2mm 2.5mm", textAlign: "left", fontWeight: 700, fontSize: "7.5pt", textTransform: "uppercase" }}>Subject</th>
                            <th style={{ padding: "2mm 2.5mm", textAlign: "left", fontWeight: 700, fontSize: "7.5pt", textTransform: "uppercase" }}>Code</th>
                            <th style={{ padding: "2mm 2.5mm", textAlign: "center", fontWeight: 700, fontSize: "7pt", textTransform: "uppercase" }}>1st Term (100)</th>
                            <th style={{ padding: "2mm 2.5mm", textAlign: "center", fontWeight: 700, fontSize: "7pt", textTransform: "uppercase" }}>2nd Term (100)</th>
                            <th style={{ padding: "2mm 2.5mm", textAlign: "center", fontWeight: 700, fontSize: "7pt", textTransform: "uppercase" }}>3rd CA (40)</th>
                            <th style={{ padding: "2mm 2.5mm", textAlign: "center", fontWeight: 700, fontSize: "7pt", textTransform: "uppercase" }}>3rd Exam (60)</th>
                            <th style={{ padding: "2mm 2.5mm", textAlign: "center", fontWeight: 700, fontSize: "7pt", textTransform: "uppercase" }}>3rd Total</th>
                            <th style={{ padding: "2mm 2.5mm", textAlign: "center", fontWeight: 700, fontSize: "7pt", textTransform: "uppercase" }}>Cum. Avg</th>
                            <th style={{ padding: "2mm 2.5mm", textAlign: "center", fontWeight: 700, fontSize: "7.5pt", textTransform: "uppercase" }}>Grade</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cumRows.map((r, i) => {
                            const cumPct = r.cumulative_avg ?? 0;
                            const cumGrade = letterGrade(cumPct);
                            const gradeCol = cumPct >= 75 ? "#16A34A" : cumPct >= 45 ? "#0F172A" : "#DC2626";
                            return (
                              <tr key={r.code} style={{ background: i % 2 === 0 ? "#FFFFFF" : "#F8FAFC" }}>
                                <td style={{ padding: "2mm 2.5mm", borderBottom: "1pt solid #E2E8F0", fontWeight: 600 }}>{r.subject_name}</td>
                                <td style={{ padding: "2mm 2.5mm", borderBottom: "1pt solid #E2E8F0", fontSize: "7pt", color: "#64748B", fontFamily: "monospace" }}>{r.code}</td>
                                <td style={{ padding: "2mm 2.5mm", borderBottom: "1pt solid #E2E8F0", textAlign: "center", fontFamily: "monospace" }}>{r.term1_total ?? "—"}</td>
                                <td style={{ padding: "2mm 2.5mm", borderBottom: "1pt solid #E2E8F0", textAlign: "center", fontFamily: "monospace" }}>{r.term2_total ?? "—"}</td>
                                <td style={{ padding: "2mm 2.5mm", borderBottom: "1pt solid #E2E8F0", textAlign: "center", fontFamily: "monospace" }}>{r.term3_ca ?? "—"}</td>
                                <td style={{ padding: "2mm 2.5mm", borderBottom: "1pt solid #E2E8F0", textAlign: "center", fontFamily: "monospace" }}>{r.term3_exam ?? "—"}</td>
                                <td style={{ padding: "2mm 2.5mm", borderBottom: "1pt solid #E2E8F0", textAlign: "center", fontWeight: 700, fontFamily: "monospace" }}>{r.term3_total ?? "—"}</td>
                                <td style={{ padding: "2mm 2.5mm", borderBottom: "1pt solid #E2E8F0", textAlign: "center", fontWeight: 800, color: gradeCol, fontFamily: "monospace" }}>
                                  {r.cumulative_avg !== null ? `${r.cumulative_avg}%` : "—"}
                                </td>
                                <td style={{ padding: "2mm 2.5mm", borderBottom: "1pt solid #E2E8F0", textAlign: "center", fontWeight: 800, color: gradeCol }}>{cumGrade}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        {cumRows.length > 1 && (
                          <tfoot>
                            <tr style={{ background: "#F1F5F9", color: "#0F172A" }}>
                              <td colSpan={7} style={{ padding: "2mm 2.5mm", fontWeight: 800, textTransform: "uppercase", fontSize: "7.5pt" }}>Cumulative Overall Performance Average</td>
                              <td style={{ padding: "2mm 2.5mm", textAlign: "center", fontWeight: 900, fontSize: "9pt", color: "#0F172A", fontFamily: "monospace" }}>{overallCumAvg}%</td>
                              <td style={{ padding: "2mm 2.5mm", textAlign: "center", fontWeight: 900, fontSize: "9pt", color: overallCumAvg >= 75 ? "#16A34A" : overallCumAvg >= 45 ? "#0F172A" : "#DC2626" }}>{overallCumGrade}</td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  );
                }

                // Standard Single Term Layout
                return (
                  <div style={{ borderRadius: "2.5mm", border: "1pt solid #E2E8F0", overflow: "hidden", marginBottom: "4mm" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8.5pt" }}>
                      <thead>
                        <tr style={{ background: "#0F172A", color: "#FFFFFF" }}>
                          {["Subject", "Code", "C.A. (40)", "Exam (60)", "Total (100)", "Grade"].map((h) => (
                            <th key={h} style={{ padding: "2.5mm 3mm", textAlign: h === "Subject" || h === "Code" ? "left" : "center", fontWeight: 700, fontSize: "8pt", letterSpacing: "0.04em", textTransform: "uppercase" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedList.map((e, i) => {
                          const pct = scorePct(e.score, e.total_score);
                          const grade = e.grade || letterGrade(pct);
                          const gradeCol = pct >= 75 ? "#16A34A" : pct >= 45 ? "#0F172A" : "#DC2626";
                          return (
                            <tr key={e.exam_id} style={{ background: i % 2 === 0 ? "#FFFFFF" : "#F8FAFC" }}>
                              <td style={{ padding: "2.5mm 3mm", borderBottom: "1pt solid #E2E8F0", fontWeight: 600 }}>{e.subject_name}</td>
                              <td style={{ padding: "2.5mm 3mm", borderBottom: "1pt solid #E2E8F0", fontSize: "7.5pt", color: "#64748B", fontFamily: "monospace" }}>{e.code}</td>
                              <td style={{ padding: "2.5mm 3mm", borderBottom: "1pt solid #E2E8F0", textAlign: "center", fontFamily: "monospace" }}>{e.ca_score ?? "—"}</td>
                              <td style={{ padding: "2.5mm 3mm", borderBottom: "1pt solid #E2E8F0", textAlign: "center", fontFamily: "monospace" }}>{e.exam_score ?? "—"}</td>
                              <td style={{ padding: "2.5mm 3mm", borderBottom: "1pt solid #E2E8F0", textAlign: "center", fontWeight: 700, fontFamily: "monospace" }}>{e.score ?? 0}</td>
                              <td style={{ padding: "2.5mm 3mm", borderBottom: "1pt solid #E2E8F0", textAlign: "center", fontWeight: 800, color: gradeCol }}>{grade}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {selectedList.length > 1 && (
                        <tfoot>
                          <tr style={{ background: "#F1F5F9", color: "#0F172A" }}>
                            <td colSpan={4} style={{ padding: "2.5mm 3mm", fontWeight: 800, textTransform: "uppercase", fontSize: "8pt" }}>Overall Performance Average</td>
                            <td style={{ padding: "2.5mm 3mm", textAlign: "center", fontWeight: 900, fontSize: "10pt", color: "#0F172A", fontFamily: "monospace" }}>{avgPct}%</td>
                            <td style={{ padding: "2.5mm 3mm", textAlign: "center", fontWeight: 900, fontSize: "10pt", color: avgPct >= 75 ? "#16A34A" : avgPct >= 45 ? "#0F172A" : "#DC2626" }}>{overallLetterGrade}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                );
              })()}

              {/* Remarks Section */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4mm", marginBottom: "5mm" }}>
                <div style={{ border: "1pt solid #CBD5E1", borderRadius: "2mm", padding: "3mm 4mm", minHeight: "18mm", background: "#FFFFFF" }}>
                  <div style={{ fontSize: "7.5pt", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "#0F172A", marginBottom: "1.5mm" }}>
                    Class Teacher's Remark
                  </div>
                  <div style={{ fontSize: "8.5pt", color: "#334155", lineHeight: 1.45, fontStyle: remarks.teacher_remark ? "normal" : "italic" }}>
                    {remarks.teacher_remark || "—"}
                  </div>
                </div>

                <div style={{ border: "1.5pt solid #0F172A", borderRadius: "2mm", padding: "3mm 4mm", minHeight: "18mm", background: "#FFFFFF" }}>
                  <div style={{ fontSize: "7.5pt", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "#0F172A", marginBottom: "1.5mm" }}>
                    Principal's Official Endorsement
                  </div>
                  <div style={{ fontSize: "8.5pt", color: "#334155", lineHeight: 1.45, fontStyle: remarks.principal_remark ? "normal" : "italic" }}>
                    {remarks.principal_remark || "—"}
                  </div>
                </div>
              </div>

              {/* Signatures Row */}
              <div style={{ display: "flex", justifyContent: "space-between", gap: "8mm", marginTop: "auto", padding: "0 6mm" }}>
                {["Class Teacher", "Vice Principal", "Principal / Proprietor"].map((role) => (
                  <div key={role} style={{ flex: 1, textAlign: "center" }}>
                    <div style={{ height: "8mm", borderBottom: "1pt solid #94A3B8", marginBottom: "1.5mm" }} />
                    <div style={{ fontSize: "7.5pt", color: "#64748B", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{role}</div>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div style={{ textAlign: "center", fontSize: "7.5pt", color: "#94A3B8", borderTop: "1pt solid #E2E8F0", paddingTop: "2.5mm", marginTop: "4mm" }}>
                {schoolName} · Official Academic Record · Powered by ExamPool
              </div>

              {/* Watermark Seal */}
              {logo && (
                <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", opacity: 0.035, pointerEvents: "none", zIndex: 0 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logo} alt="" style={{ width: "100mm", height: "100mm", objectFit: "contain" }} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
