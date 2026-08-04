"use client";

import { useEffect, useState, useCallback, Suspense, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { useAcademic } from "../context/AcademicContext";
import { scorePct, letterGrade, gradeBadgeClass } from "../../lib/gradeUtils";
import {
  SearchIcon, UsersIcon, DocumentIcon,
  CheckCircleIcon, WarningIcon, EditIcon,
  SchoolIcon, ClipboardIcon, RefreshIcon,
} from "../icons/Icons";

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

// ─── Multi-term subject row for cumulative 3rd Term report card ───────────────
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
  cumulative_avg: number | null; // Average across all 3 terms
};

/** Detect whether the current active/selected term results are a 3rd term  */
function detectIs3rdTerm(exams: ExamEntry[], activeTermName?: string): boolean {
  if (activeTermName) {
    const t = activeTermName.toLowerCase();
    if (t.includes("third") || t.includes("3rd") || t.endsWith("-t3") || t.endsWith("_t3")) {
      return true;
    }
  }
  if (!exams.length) return false;
  // Check term_order_in_session field first (most reliable)
  const hasOrderInfo = exams.some((e) => e.term_order_in_session !== undefined);
  if (hasOrderInfo) {
    // Get the max term order in the latest session
    const latestSessionId = Math.max(...exams.map((e) => e.session_id || 0));
    const latestSessionExams = exams.filter((e) => e.session_id === latestSessionId);
    const maxOrder = Math.max(...latestSessionExams.map((e) => e.term_order_in_session || 0));
    return maxOrder >= 3;
  }
  // Fallback: check term name
  const termNames = [...new Set(exams.map((e) => (e.term || "").toLowerCase()))];
  return termNames.some((t) => t.includes("third") || t.includes("3rd") || t.endsWith("-t3") || t.endsWith("_t3"));
}

/** Build cumulative rows from multi-term exam results */
function buildCumulativeRows(exams: ExamEntry[]): CumulativeSubjectRow[] {
  if (!exams.length) return [];

  // Group by subject code
  const subjectMap = new Map<string, CumulativeSubjectRow>();

  // Determine order for each exam entry
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

  // Sort by computed order ascending to process term 1 → 2 → 3
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

  // Compute cumulative average across all terms with data
  for (const row of subjectMap.values()) {
    const vals = [row.term1_total, row.term2_total, row.term3_total].filter((v) => v !== null) as number[];
    if (vals.length > 0) {
      row.cumulative_avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
  }

  return Array.from(subjectMap.values());
}

type Toast = { msg: string; type: "success" | "error" };

// ─── Export (wrapped in Suspense for useSearchParams) ─────────────────────────

export function ReportCardPage() {
  return (
    <Suspense fallback={<div className="loadingWrap"><div className="spinner" /></div>}>
      <ReportCardPageInner />
    </Suspense>
  );
}

// ─── Inner component ──────────────────────────────────────────────────────────

function ReportCardPageInner() {
  const { user } = useAuth();
  const isOperator = user?.role === "operator";
  const isClassTeacher = (user as any)?.is_class_teacher === true;
  const assignedClassId: number | null = (user as any)?.assigned_class_id ?? null;
  const assignedClassName: string | null = (user as any)?.assigned_class_name ?? null;
  const searchParams = useSearchParams();
  const preselectedStudentId = Number(searchParams?.get("studentId") ?? 0);
  const preselectedSessionId = Number(searchParams?.get("sessionId") ?? 0);
  const preselectedTermId = Number(searchParams?.get("termId") ?? 0);

  const { sessions, terms, selectedSession, selectedTerm, setSelectedSession, setSelectedTerm } = useAcademic();

  // ── App-level state ──
  const [settings, setSettings] = useState<Settings | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [loadingInit, setLoadingInit] = useState(true);
  const [query, setQuery] = useState("");

  // ── Report card state ──
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [exams, setExams] = useState<ExamEntry[]>([]);
  const [remarks, setRemarks] = useState<TermRemark>({ teacher_remark: null, principal_remark: null });
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loadingCard, setLoadingCard] = useState(false);
  const [cardError, setCardError] = useState("");
  const [isCumulativeMode, setIsCumulativeMode] = useState<boolean>(true);

  // ── Remark editing state ──
  const [teacherDraft, setTeacherDraft] = useState("");
  const [principalDraft, setPrincipalDraft] = useState("");
  const [savingRemark, setSavingRemark] = useState(false);
  const [remarkSaved, setRemarkSaved] = useState(false);

  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Derived values from settings ──
  let theme: Record<string, unknown> = {};
  try { theme = settings?.theme_json ? JSON.parse(settings.theme_json) : {}; } catch {}
  const logo = (theme.school_logo as string) || null;
  const schoolName = settings?.school_name || "School";
  const adminName = settings?.admin_name || "Principal";
  const currentTerm = settings?.current_term || "2026-T1";

  const activeSessionName = selectedSession?.name || "";
  const activeTermName = selectedTerm?.name || "";
  const currentAcademicDisplay = activeSessionName && activeTermName 
    ? `${activeSessionName} · ${activeTermName}`
    : activeTermName || activeSessionName || currentTerm;

  // ── Load settings + student list on mount ──
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let studentList: Student[] = [];
        let cfg: Settings | null = null;
        if (isClassTeacher && assignedClassId) {
          // Class teachers only see their assigned class roster
          const [cfgRes, rosterRes] = await Promise.all([
            api.getPublicSettings() as Promise<Settings>,
            api.getClassRoster(assignedClassId),
          ]);
          cfg = cfgRes;
          studentList = (Array.isArray(rosterRes) ? rosterRes : []).map((s: any) => ({
            id: s.id, name: s.name, email: s.email || "",
            reg_id: s.reg_id ?? null, grade: s.grade ?? null, role: "student",
          }));
        } else if (isOperator) {
          // Operators get all students
          const [cfgRes, allUsers] = await Promise.all([
            api.getPublicSettings() as Promise<Settings>,
            api.getUsers() as Promise<Student[]>,
          ]);
          cfg = cfgRes;
          studentList = Array.isArray(allUsers)
            ? allUsers.filter((u: Student) => u.role === "student")
            : [];
        } else {
          // Regular teacher with no class assignment -> no roster access
          const cfgRes = await api.getPublicSettings() as Settings;
          cfg = cfgRes;
          studentList = [];
        }
        if (!alive) return;
        if (cfg) setSettings(cfg);
        setStudents(studentList);

        // Auto-select student if ?studentId= is in the URL
        if (preselectedStudentId > 0 && studentList.length > 0) {
          const found = studentList.find((s: Student) => Number(s.id) === preselectedStudentId);
          if (found) selectStudent(found);
        }
      } catch (err) {
        console.error("ReportCardPage init error:", err);
      } finally {
        if (alive) setLoadingInit(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOperator, isClassTeacher, assignedClassId, preselectedStudentId]);

  // Sync URL preselectedSessionId and preselectedTermId if supplied
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

  // ── Load report card data for a student ──
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

      // Filter by session if a session is actively selected
      if (sessionId) {
        examList = examList.filter((e) => Number(e.session_id) === Number(sessionId));
      } else if (activeSessionName) {
        examList = examList.filter((e) => !e.session_name || e.session_name === activeSessionName);
      }

      // Check if 3rd term (cumulative progression) or single isolated term
      const is3rd = activeTermName ? (
        activeTermName.toLowerCase().includes("third") || 
        activeTermName.toLowerCase().includes("3rd") ||
        activeTermName.endsWith("-T3") ||
        activeTermName.endsWith("_T3")
      ) : detectIs3rdTerm(examList, currentTerm);

      if (!is3rd && termId) {
        // Isolate strictly to the selected term
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

  // Re-fetch report card when active session or term switches
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

      // Refresh remarks from server
      const updated = await api.getTermRemark(Number(selectedStudent.id), termName, sessionId, termId) as TermRemark;
      if (updated) {
        setRemarks(updated);
        setTeacherDraft(updated.teacher_remark || "");
        setPrincipalDraft(updated.principal_remark || "");
      }

      setRemarkSaved(true);
      setTimeout(() => setRemarkSaved(false), 3000);
      showToast("Remark saved successfully", "success");
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

  // ── Filtered students ──
  const filteredStudents = students.filter((s) => {
    const q = query.toLowerCase();
    return (
      (s.name || "").toLowerCase().includes(q) ||
      (s.reg_id || "").toLowerCase().includes(q) ||
      (s.grade || "").toLowerCase().includes(q)
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 24, right: 24, zIndex: 9999,
          background: toast.type === "success" ? "var(--color-success)" : "#dc2626",
          color: "#fff", padding: "0.75rem 1.25rem", borderRadius: 10, fontWeight: 600,
          boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
          display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.9rem", maxWidth: 360,
          animation: "slideInRight 0.25s ease",
        }}>
          {toast.type === "success"
            ? <CheckCircleIcon width="18" height="18" />
            : <WarningIcon width="18" height="18" />
          }
          {toast.msg}
        </div>
      )}

      <style>{`
        @keyframes slideInRight { from{opacity:0;transform:translateX(20px)} to{opacity:1;transform:translateX(0)} }
        @media print {
          @page { margin: 0; size: A4 portrait; }
          body > *:not(#rc-print-clone) { display: none !important; }
          #rc-print-clone { 
            display: block !important; position: absolute !important; 
            left: 0 !important; top: 0 !important; 
            width: 100% !important; height: 100% !important; 
            background: #fff !important; z-index: 999999 !important; 
            color: #000 !important;
            filter: grayscale(100%) !important;
            font-family: "Georgia", "Times New Roman", serif !important;
          }
          #rc-print-clone * {
            color: #000 !important;
            font-family: "Georgia", "Times New Roman", serif !important;
          }
        }
        #rc-print-frame { display: none; }
        .no-print { }
      `}</style>

      {/* ── SCREEN UI ──────────────────────────────────────────────────────── */}
      <div className="no-print">

        {/* ── Access Guard for non-class teachers ── */}
        {!loadingInit && !isOperator && !isClassTeacher && (
          <div className="card" style={{ padding: "4rem 2rem", textAlign: "center", maxWidth: 620, margin: "2.5rem auto" }}>
            <SchoolIcon width="56" height="56" style={{ margin: "0 auto 1.5rem", opacity: 0.6, color: "var(--color-primary)" }} />
            <h2 style={{ fontSize: "1.35rem", fontWeight: 800, marginBottom: "0.75rem" }}>Class Teacher Access Required</h2>
            <p style={{ color: "var(--color-muted)", lineHeight: 1.6, fontSize: "0.95rem", margin: "0 0 1.5rem" }}>
              You are currently not assigned as a Class Teacher. The cumulative Report Card / Grading Center is restricted to designated Class Teachers and Administrators.
            </p>
            <p style={{ fontSize: "0.85rem", color: "var(--color-muted)", margin: 0 }}>
              Please contact an administrator to assign you to your class (e.g. JSS 1, SS 2).
            </p>
          </div>
        )}

        {/* ── View 1: Student Selector ── */}
        {(isOperator || isClassTeacher) && !selectedStudent && (
          <>
            <div className="pageHeader">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                  <h1 className="pageTitle" style={{ margin: 0 }}>
                    {isClassTeacher ? "Class Teacher Grading Center" : "Report Cards"}
                  </h1>
                  {assignedClassName && (
                    <span className="badge badge-primary" style={{ fontSize: "0.85rem", padding: "0.25rem 0.65rem" }}>
                      {assignedClassName}
                    </span>
                  )}
                </div>
                <p className="pageSubtitle" style={{ marginTop: "0.4rem" }}>
                  {isClassTeacher
                    ? `Select a student from your assigned class (${assignedClassName || "Class"}) to generate, view, and print their report card for `
                    : `Select a student to generate, view, and print their report card for `}
                  <strong>{currentAcademicDisplay}</strong>.
                </p>
              </div>
            </div>

            {/* Session & Term Filter Controls */}
            {sessions.length > 0 && (
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1.25rem", padding: "0.75rem 1rem", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--color-muted)" }}>Session:</span>
                  <select
                    value={selectedSession?.id || ""}
                    onChange={(e) => {
                      const s = sessions.find(x => x.id === Number(e.target.value));
                      if (s) {
                        setSelectedSession(s);
                        const firstTerm = terms.find(t => t.session_id === s.id);
                        setSelectedTerm(firstTerm || null);
                      }
                    }}
                    style={{ fontSize: "0.85rem", padding: "0.35rem 0.75rem", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-surface-2)", color: "var(--color-text)", fontWeight: 600, outline: "none" }}
                  >
                    {sessions.map(s => (
                      <option key={s.id} value={s.id}>{s.name} {s.is_active ? "(Active Session)" : ""}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--color-muted)" }}>Term:</span>
                  <select
                    value={selectedTerm?.id || ""}
                    onChange={(e) => {
                      const t = terms.find(x => x.id === Number(e.target.value));
                      setSelectedTerm(t || null);
                    }}
                    style={{ fontSize: "0.85rem", padding: "0.35rem 0.75rem", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-surface-2)", color: "var(--color-text)", fontWeight: 600, outline: "none" }}
                  >
                    <option value="">All Terms in Session</option>
                    {terms.filter(t => t.session_id === selectedSession?.id).map(t => (
                      <option key={t.id} value={t.id}>{t.name} {t.is_active ? "(Active Term)" : ""}</option>
                    ))}
                  </select>
                </div>

                <div style={{ marginLeft: "auto", fontSize: "0.8rem", color: "var(--color-muted)" }}>
                  Active Filter: <strong style={{ color: "var(--color-primary)" }}>{currentAcademicDisplay}</strong>
                </div>
              </div>
            )}

            <div className="searchBar" style={{ marginBottom: "1.5rem" }}>
              <SearchIcon width="14" height="14" />
              <input
                placeholder="Search by name, Reg ID or grade…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <div className="card">
              {loadingInit ? (
                <div className="loadingWrap"><div className="spinner" /></div>
              ) : filteredStudents.length === 0 ? (
                <div style={{ padding: "3rem", textAlign: "center", color: "var(--color-muted)" }}>
                  <UsersIcon width="48" height="48" style={{ opacity: 0.4, margin: "0 auto 1rem" }} />
                  <p style={{ fontWeight: 600 }}>{query ? "No students match your search." : "No students found."}</p>
                </div>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Reg ID</th>
                      <th>Grade / Class</th>
                      <th style={{ textAlign: "right" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                            <div style={{
                              width: 34, height: 34, borderRadius: "50%",
                              background: "var(--color-primary-glow)", color: "var(--color-primary)",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontWeight: 700, fontSize: "0.95rem", flexShrink: 0,
                            }}>
                              {(row.name || "?").charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div style={{ fontWeight: 600 }}>{row.name}</div>
                              <div style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>{row.email}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <code style={{ fontSize: "0.8rem", color: "var(--color-muted)", background: "var(--color-surface-2)", padding: "0.15rem 0.5rem", borderRadius: 4 }}>
                            {row.reg_id || "—"}
                          </code>
                        </td>
                        <td>
                          <span style={{ fontWeight: 500 }}>{row.grade || "—"}</span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => selectStudent(row)}
                          >
                            <DocumentIcon width="14" height="14" />
                            View Report Card
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

        {/* ── View 2: Report Card Detail ── */}
        {selectedStudent && (
          <>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.5rem", gap: "1rem", flexWrap: "wrap" }}>
              <div>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ paddingLeft: 0, color: "var(--color-muted)", marginBottom: "0.4rem" }}
                  onClick={() => setSelectedStudent(null)}
                >
                  ← Back to Students
                </button>
                <h1 className="pageTitle" style={{ marginBottom: "0.25rem" }}>Report Card</h1>
                <p style={{ color: "var(--color-muted)", fontSize: "0.875rem", margin: 0 }}>
                  {selectedStudent.name}
                  {selectedStudent.reg_id && <> · <code style={{ fontSize: "0.8rem" }}>{selectedStudent.reg_id}</code></>}
                  {selectedStudent.grade && <> · {selectedStudent.grade}</>}
                  {" "}· <span style={{ color: "var(--color-primary)", fontWeight: 600 }}>{currentAcademicDisplay}</span>
                </p>
                {/* Session, Term & Layout Mode Selectors */}
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginTop: "0.6rem" }}>
                  {sessions.length > 0 && (
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <select
                        value={selectedSession?.id || ""}
                        onChange={(e) => {
                          const s = sessions.find(x => x.id === Number(e.target.value));
                          if (s) {
                            setSelectedSession(s);
                            const firstTerm = terms.find(t => t.session_id === s.id);
                            setSelectedTerm(firstTerm || null);
                          }
                        }}
                        style={{ fontSize: "0.78rem", padding: "0.3rem 0.6rem", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-surface-2)", color: "var(--color-text)", fontWeight: 600, outline: "none" }}
                      >
                        {sessions.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>

                      <select
                        value={selectedTerm?.id || ""}
                        onChange={(e) => {
                          const t = terms.find(x => x.id === Number(e.target.value));
                          setSelectedTerm(t || null);
                        }}
                        style={{ fontSize: "0.78rem", padding: "0.3rem 0.6rem", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-surface-2)", color: "var(--color-text)", fontWeight: 600, outline: "none" }}
                      >
                        <option value="">All Terms</option>
                        {terms.filter(t => t.session_id === selectedSession?.id).map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div style={{ display: "inline-flex", gap: "0.25rem", background: "var(--color-surface-2)", padding: "0.2rem", borderRadius: 8, border: "1px solid var(--color-border)" }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${!isCumulativeMode ? "btn-primary" : "btn-ghost"}`}
                      onClick={() => setIsCumulativeMode(false)}
                      style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
                    >
                      Standard Term
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${isCumulativeMode ? "btn-primary" : "btn-ghost"}`}
                      onClick={() => setIsCumulativeMode(true)}
                      style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
                    >
                      3rd Term Cumulative
                    </button>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <button className="btn btn-ghost" onClick={() => selectStudent(selectedStudent)}>
                  <RefreshIcon width="16" height="16" /> Refresh
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handlePrint}
                  disabled={selectedIds.size === 0 || loadingCard}
                >
                  <DocumentIcon width="16" height="16" /> Download / Print PDF
                </button>
              </div>
            </div>

            {/* Loading */}
            {loadingCard && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "4rem 0", gap: "1rem" }}>
                <div className="spinner" />
                <p style={{ color: "var(--color-muted)" }}>Loading report card…</p>
              </div>
            )}

            {/* Error */}
            {!loadingCard && cardError && (
              <div style={{ background: "#fef2f2", border: "1px solid #dc2626", borderRadius: 10, padding: "1.25rem", marginBottom: "1rem" }}>
                <p style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "#dc2626", fontWeight: 600, margin: "0 0 0.75rem" }}>
                  <WarningIcon width="18" height="18" /> Failed to load exam data
                </p>
                <p style={{ color: "var(--color-muted)", fontSize: "0.875rem", margin: "0 0 1rem" }}>{cardError}</p>
                <button className="btn btn-primary btn-sm" onClick={() => selectStudent(selectedStudent)}>Retry</button>
              </div>
            )}

            {/* No exams */}
            {!loadingCard && !cardError && exams.length === 0 && (
              <div style={{ textAlign: "center", padding: "4rem 1rem", background: "var(--color-surface)", borderRadius: 12 }}>
                <ClipboardIcon width="48" height="48" style={{ margin: "0 auto 1rem", opacity: 0.4 }} />
                <p style={{ fontWeight: 700, fontSize: "1rem", marginBottom: "0.5rem" }}>No completed exams for {currentTerm}</p>
                <p style={{ color: "var(--color-muted)", fontSize: "0.875rem" }}>
                  {selectedStudent.name} has not completed any exams in this term yet.
                </p>
              </div>
            )}

            {/* Main content: exams + remarks */}
            {!loadingCard && !cardError && exams.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: "1.5rem", alignItems: "start" }}>

                {/* Left: Subject list */}
                <div className="card" style={{ padding: "1.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
                    <h3 style={{ fontWeight: 700, fontSize: "1rem", margin: 0 }}>
                      Subjects Included
                      <span style={{ marginLeft: "0.5rem", fontWeight: 400, color: "var(--color-muted)", fontSize: "0.875rem" }}>
                        ({selectedIds.size} / {exams.length})
                      </span>
                    </h3>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button className="btn btn-ghost btn-sm" onClick={selectAll}>All</button>
                      <button className="btn btn-ghost btn-sm" onClick={clearAll}>None</button>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                    {exams.map((e) => {
                      const pct = scorePct(e.score, e.total_score);
                      const checked = selectedIds.has(e.exam_id);
                      return (
                        <label
                          key={e.exam_id}
                          style={{
                            display: "flex", alignItems: "center", gap: "0.75rem",
                            padding: "0.75rem 1rem", borderRadius: 10, cursor: "pointer",
                            border: `2px solid ${checked ? "var(--color-primary)" : "var(--color-border)"}`,
                            background: checked ? "rgba(20,184,166,0.06)" : "var(--color-surface)",
                            transition: "all 0.15s",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleExam(e.exam_id)}
                            style={{ width: 18, height: 18, accentColor: "var(--color-primary)", cursor: "pointer", flexShrink: 0 }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {e.subject_name}
                            </div>
                            <div style={{ fontSize: "0.72rem", color: "var(--color-muted)", marginTop: 2 }}>
                              {e.code} · {e.term}
                              {e.term_order_in_session && (
                                <span style={{ marginLeft: 6, padding: "0.1rem 0.35rem", borderRadius: 4, background: "var(--color-surface-2)", fontWeight: 700 }}>
                                  Term {e.term_order_in_session}
                                </span>
                              )}
                            </div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontWeight: 700 }}>{e.score ?? 0} / {e.total_score ?? 0}</div>
                            <div style={{ fontSize: "0.7rem", color: "var(--color-muted)" }}>C.A: {e.ca_score ?? "—"} | Exam: {e.exam_score ?? "—"}</div>
                            <span className={`badge ${gradeBadgeClass(pct)}`} style={{ fontSize: "0.72rem", marginTop: 2 }}>{pct}% · {e.grade || letterGrade(pct)}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  {selectedList.length > 1 && (
                    <div style={{ marginTop: "1rem", padding: "0.875rem 1rem", borderRadius: 10, background: "var(--color-surface-2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 600, color: "var(--color-muted)", fontSize: "0.875rem" }}>Overall Average</span>
                      <span style={{ fontWeight: 800, fontSize: "1.1rem", color: avgPct >= 55 ? "var(--color-success)" : avgPct >= 40 ? "var(--color-warning)" : "var(--color-danger)" }}>
                        {avgPct}% · {letterGrade(avgPct)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Right: Overall Remarks */}
                <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                  <div className="card" style={{ padding: "1.5rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 700, fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-primary)", marginBottom: "1.25rem" }}>
                      <EditIcon width="15" height="15" /> Overall Term Remarks
                    </div>

                    {/* Teacher Remark */}
                    <div style={{ marginBottom: "1rem" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", fontWeight: 700, color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.4rem" }}>
                        <EditIcon width="12" height="12" /> Class Teacher's Remark
                      </label>
                      {isOperator ? (
                        // Operator: read-only display of teacher remark
                        <div style={{
                          padding: "0.65rem 0.875rem", borderRadius: 8, fontSize: "0.875rem", minHeight: 64,
                          background: "var(--color-surface-2)", border: "1.5px solid var(--color-border)",
                          color: teacherDraft ? "var(--color-text)" : "var(--color-muted)",
                          fontStyle: teacherDraft ? "normal" : "italic",
                        }}>
                          {teacherDraft || "(No teacher remark yet)"}
                        </div>
                      ) : (
                        <textarea
                          className="input"
                          rows={3}
                          style={{ width: "100%", resize: "vertical", fontSize: "0.875rem", minHeight: 72 }}
                          placeholder="Write the overall teacher's remark for this student this term…"
                          value={teacherDraft}
                          onChange={(e) => setTeacherDraft(e.target.value)}
                        />
                      )}
                    </div>

                    {/* Principal Remark */}
                    <div style={{ paddingTop: "1rem", borderTop: "1px dashed var(--color-border)", marginBottom: "1.25rem" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", fontWeight: 700, color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.4rem" }}>
                        <SchoolIcon width="12" height="12" />
                        {logo && <img src={logo} alt="" style={{ width: 14, height: 14, objectFit: "contain", borderRadius: 2, marginLeft: 2 }} />}
                        Principal's Remark
                      </label>
                      {!isOperator ? (
                        // Teacher: read-only display of principal remark
                        <div style={{
                          padding: "0.65rem 0.875rem", borderRadius: 8, fontSize: "0.875rem", minHeight: 64,
                          background: "var(--color-surface-2)", border: "1.5px solid var(--color-border)",
                          color: principalDraft ? "var(--color-text)" : "var(--color-muted)",
                          fontStyle: principalDraft ? "normal" : "italic",
                        }}>
                          {principalDraft || "(No principal remark yet)"}
                        </div>
                      ) : (
                        <textarea
                          className="input"
                          rows={3}
                          style={{ width: "100%", resize: "vertical", fontSize: "0.875rem", minHeight: 72 }}
                          placeholder="Write the principal's overall remark for this student this term…"
                          value={principalDraft}
                          onChange={(e) => setPrincipalDraft(e.target.value)}
                        />
                      )}
                    </div>

                    {/* Save button */}
                    <button
                      className="btn btn-primary"
                      style={{ width: "100%", justifyContent: "center" }}
                      disabled={savingRemark}
                      onClick={saveRemark}
                    >
                      {savingRemark ? "Saving…" : remarkSaved ? "✓ Saved!" : (isOperator ? "Save Principal's Remark" : "Save Teacher's Remark")}
                    </button>
                  </div>
                </div>

              </div>
            )}

            {/* ── Live On-Screen Report Card Preview ── */}
            {!loadingCard && !cardError && selectedStudent && selectedList.length > 0 && (
              <div className="card" style={{ marginTop: "1.5rem", padding: "1.5rem", background: "var(--color-surface)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem", paddingBottom: "0.75rem", borderBottom: "1px solid var(--color-border)" }}>
                  <div>
                    <h3 style={{ fontWeight: 800, fontSize: "1.1rem", color: "var(--color-primary)", margin: 0 }}>
                      {detectIs3rdTerm(selectedList, currentTerm) ? "3rd Term Cumulative Report Card Preview" : "Report Card Preview"}
                    </h3>
                    <p style={{ fontSize: "0.8rem", color: "var(--color-muted)", margin: "0.2rem 0 0" }}>
                      Live preview of student performance record for {currentTerm}
                    </p>
                  </div>
                  <span className="badge badge-primary" style={{ fontSize: "0.8rem", padding: "0.3rem 0.75rem" }}>
                    {currentTerm}
                  </span>
                </div>

                {/* Table Preview */}
                {(() => {
                  const is3rd = isCumulativeMode;
                  if (is3rd) {
                    const cumRows = buildCumulativeRows(selectedList);
                    const overallCumAvg = cumRows.length > 0
                      ? Math.round(cumRows.reduce((acc, r) => acc + (r.cumulative_avg ?? 0), 0) / (cumRows.filter(r => r.cumulative_avg !== null).length || 1))
                      : 0;
                    const overallCumGrade = letterGrade(overallCumAvg);

                    return (
                      <div>
                        <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid var(--color-border)", marginBottom: "1.25rem" }}>
                          <table className="tbl" style={{ width: "100%", fontSize: "0.875rem" }}>
                            <thead>
                              <tr style={{ background: "var(--color-surface-2)" }}>
                                <th>Subject</th>
                                <th>Code</th>
                                <th style={{ textAlign: "center" }}>1st Term (100)</th>
                                <th style={{ textAlign: "center" }}>2nd Term (100)</th>
                                <th style={{ textAlign: "center" }}>3rd C.A. (40)</th>
                                <th style={{ textAlign: "center" }}>3rd Exam (60)</th>
                                <th style={{ textAlign: "center" }}>3rd Total (100)</th>
                                <th style={{ textAlign: "center" }}>Cum. Avg.</th>
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
                                    <td><code>{r.code}</code></td>
                                    <td style={{ textAlign: "center" }}>{r.term1_total ?? "—"}</td>
                                    <td style={{ textAlign: "center" }}>{r.term2_total ?? "—"}</td>
                                    <td style={{ textAlign: "center" }}>{r.term3_ca ?? "—"}</td>
                                    <td style={{ textAlign: "center" }}>{r.term3_exam ?? "—"}</td>
                                    <td style={{ textAlign: "center", fontWeight: 700 }}>{r.term3_total ?? "—"}</td>
                                    <td style={{ textAlign: "center", fontWeight: 800 }}>{r.cumulative_avg !== null ? `${r.cumulative_avg}%` : "—"}</td>
                                    <td style={{ textAlign: "center" }}>
                                      <span className={`badge ${gradeBadgeClass(cumPct)}`}>{cumGrade}</span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Summary Bar */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem", borderRadius: 10, background: "var(--color-surface-2)" }}>
                          <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>Overall Cumulative Performance</span>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                            <span style={{ fontWeight: 800, fontSize: "1.1rem", color: "var(--color-primary)" }}>{overallCumAvg}%</span>
                            <span className={`badge ${gradeBadgeClass(overallCumAvg)}`}>{overallCumGrade}</span>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // Standard 6-column Layout
                  return (
                    <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid var(--color-border)" }}>
                      <table className="tbl" style={{ width: "100%", fontSize: "0.875rem" }}>
                        <thead>
                          <tr style={{ background: "var(--color-surface-2)" }}>
                            <th>Subject</th>
                            <th>Code</th>
                            <th style={{ textAlign: "center" }}>C.A. Score</th>
                            <th style={{ textAlign: "center" }}>Exam Score</th>
                            <th style={{ textAlign: "center" }}>Total Score</th>
                            <th style={{ textAlign: "center" }}>Grade</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedList.map((e) => {
                            const pct = scorePct(e.score, e.total_score);
                            return (
                              <tr key={e.exam_id}>
                                <td style={{ fontWeight: 600 }}>{e.subject_name}</td>
                                <td><code>{e.code}</code></td>
                                <td style={{ textAlign: "center" }}>{e.ca_score ?? "—"}</td>
                                <td style={{ textAlign: "center" }}>{e.exam_score ?? "—"}</td>
                                <td style={{ textAlign: "center", fontWeight: 700 }}>{e.score ?? 0} / {e.total_score ?? 100}</td>
                                <td style={{ textAlign: "center" }}>
                                  <span className={`badge ${gradeBadgeClass(pct)}`}>{e.grade || letterGrade(pct)}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── PRINT FRAME ──────────────────────────────────────────────────────── */}
      {selectedStudent && (
        <div id="rc-print-frame" style={{ display: "none" }}>
          <div style={{
            fontFamily: "'Georgia', 'Times New Roman', serif",
            padding: "8mm",
            color: "#0f172a",
            width: "210mm",
            height: "296mm", /* Enforce 1 page A4 height exactly */
            overflow: "hidden", /* Prevent overflow onto 2nd page */
            margin: "0 auto",
            background: "#fff",
            boxSizing: "border-box",
            position: "relative",
          }}>
            {/* Outer decorative border */}
            <div style={{
              position: "absolute", inset: "8mm",
              border: "2pt solid #0f766e",
              borderRadius: "4mm",
              pointerEvents: "none",
              zIndex: 1
            }}>
              <div style={{
                position: "absolute", inset: "2mm",
                border: "1pt solid rgba(15, 118, 110, 0.3)",
                borderRadius: "2.5mm",
              }} />
            </div>

            <div style={{ position: "relative", zIndex: 10, padding: "8mm 12mm", height: "100%", display: "flex", flexDirection: "column" }}>
              {/* ── Header: Logo left, School name centre ── */}
              <div style={{ display: "flex", alignItems: "center", gap: "16mm", paddingBottom: "6mm", marginBottom: "6mm", borderBottom: "2pt solid #e2e8f0" }}>
                {/* Logo seal */}
                <div style={{ flexShrink: 0, width: "32mm", height: "32mm", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", borderRadius: "4mm", border: "1pt solid #e2e8f0" }}>
                  {logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logo} alt="School Logo" style={{ width: "28mm", height: "28mm", objectFit: "contain" }} />
                  ) : (
                    <div style={{ fontSize: "8pt", color: "#94a3b8", fontWeight: 700 }}>LOGO</div>
                  )}
                </div>

                {/* School name & title */}
                <div style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: "22pt", fontWeight: 900, color: "#0f766e", letterSpacing: "0.02em", textTransform: "uppercase", lineHeight: 1.15 }}>
                    {schoolName}
                  </div>
                  <div style={{ fontSize: "11pt", color: "#64748b", marginTop: "3mm", letterSpacing: "0.15em", textTransform: "uppercase", fontWeight: 700 }}>
                    {isCumulativeMode ? "3rd Term Cumulative Report Card" : "Official Student Report Card"}
                  </div>
                  <div style={{ fontSize: "8.5pt", color: "#94a3b8", marginTop: "1mm" }}>{currentTerm}</div>
                </div>

                {/* Spacer */}
                <div style={{ width: "26mm", flexShrink: 0 }} />
              </div>

              {/* ── Student Info Grid ── */}
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr",
                gap: "3mm 12mm", marginBottom: "6mm",
                fontSize: "10pt", background: "#f8fafc",
                padding: "6mm 8mm", borderRadius: "3mm",
                border: "1pt solid #e2e8f0",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1pt dashed #cbd5e1", paddingBottom: "2mm" }}>
                  <strong style={{ color: "#475569" }}>Student Name:</strong> <span style={{ fontWeight: 700 }}>{selectedStudent.name}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1pt dashed #cbd5e1", paddingBottom: "2mm" }}>
                  <strong style={{ color: "#475569" }}>Registration No:</strong> <span style={{ fontWeight: 700 }}>{selectedStudent.reg_id || "—"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1pt dashed #cbd5e1", paddingBottom: "2mm" }}>
                  <strong style={{ color: "#475569" }}>Class / Grade:</strong> <span style={{ fontWeight: 700 }}>{selectedStudent.grade || "—"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1pt dashed #cbd5e1", paddingBottom: "2mm" }}>
                  <strong style={{ color: "#475569" }}>Date Issued:</strong> <span style={{ fontWeight: 700 }}>{new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</span>
                </div>
              </div>

              {/* ── Subject Results Table ── */}
              {(() => {
                const is3rd = isCumulativeMode;
                if (is3rd) {
                  // Cumulative 3rd Term Layout
                  const cumRows = buildCumulativeRows(selectedList);
                  const overallCumAvg = cumRows.length > 0
                    ? Math.round(cumRows.reduce((acc, r) => acc + (r.cumulative_avg ?? 0), 0) / cumRows.filter(r => r.cumulative_avg !== null).length)
                    : 0;
                  const overallCumGrade = letterGrade(overallCumAvg);
                  return (
                    <div style={{ borderRadius: "3mm", border: "1pt solid #e2e8f0", overflow: "hidden", marginBottom: "6mm" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8.5pt" }}>
                        <thead>
                          <tr style={{ background: "#0f766e", color: "#fff" }}>
                            <th style={{ padding: "2.5mm 3mm", textAlign: "left", fontWeight: 700, fontSize: "8pt", textTransform: "uppercase" }}>Subject</th>
                            <th style={{ padding: "2.5mm 3mm", textAlign: "left", fontWeight: 700, fontSize: "8pt", textTransform: "uppercase" }}>Code</th>
                            <th style={{ padding: "2.5mm 3mm", textAlign: "center", fontWeight: 700, fontSize: "7.5pt", textTransform: "uppercase" }}>1st Term (100)</th>
                            <th style={{ padding: "2.5mm 3mm", textAlign: "center", fontWeight: 700, fontSize: "7.5pt", textTransform: "uppercase" }}>2nd Term (100)</th>
                            <th style={{ padding: "2.5mm 3mm", textAlign: "center", fontWeight: 700, fontSize: "7.5pt", textTransform: "uppercase" }}>3rd C.A. (40)</th>
                            <th style={{ padding: "2.5mm 3mm", textAlign: "center", fontWeight: 700, fontSize: "7.5pt", textTransform: "uppercase" }}>3rd Exam (60)</th>
                            <th style={{ padding: "2.5mm 3mm", textAlign: "center", fontWeight: 700, fontSize: "7.5pt", textTransform: "uppercase" }}>3rd Total (100)</th>
                            <th style={{ padding: "2.5mm 3mm", textAlign: "center", fontWeight: 700, fontSize: "7.5pt", textTransform: "uppercase" }}>Cum. Avg.</th>
                            <th style={{ padding: "2.5mm 3mm", textAlign: "center", fontWeight: 700, fontSize: "8pt", textTransform: "uppercase" }}>Grade</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cumRows.map((r, i) => {
                            const cumPct = r.cumulative_avg ?? 0;
                            const grade = r.term3_grade || letterGrade(r.term3_total ?? 0);
                            const cumGrade = letterGrade(cumPct);
                            const gradeCol = cumPct >= 70 ? "#059669" : cumPct >= 40 ? "#d97706" : "#dc2626";
                            return (
                              <tr key={r.code} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                                <td style={{ padding: "2.5mm 3mm", borderBottom: "1pt solid #e2e8f0", fontWeight: 600 }}>{r.subject_name}</td>
                                <td style={{ padding: "2.5mm 3mm", borderBottom: "1pt solid #e2e8f0", fontSize: "7.5pt", color: "#64748b" }}>{r.code}</td>
                                <td style={{ padding: "2.5mm 3mm", borderBottom: "1pt solid #e2e8f0", textAlign: "center" }}>{r.term1_total ?? "—"}</td>
                                <td style={{ padding: "2.5mm 3mm", borderBottom: "1pt solid #e2e8f0", textAlign: "center" }}>{r.term2_total ?? "—"}</td>
                                <td style={{ padding: "2.5mm 3mm", borderBottom: "1pt solid #e2e8f0", textAlign: "center" }}>{r.term3_ca ?? "—"}</td>
                                <td style={{ padding: "2.5mm 3mm", borderBottom: "1pt solid #e2e8f0", textAlign: "center" }}>{r.term3_exam ?? "—"}</td>
                                <td style={{ padding: "2.5mm 3mm", borderBottom: "1pt solid #e2e8f0", textAlign: "center", fontWeight: 700 }}>{r.term3_total ?? "—"}</td>
                                <td style={{ padding: "2.5mm 3mm", borderBottom: "1pt solid #e2e8f0", textAlign: "center", fontWeight: 800, color: gradeCol }}>{r.cumulative_avg !== null ? `${r.cumulative_avg}%` : "—"}</td>
                                <td style={{ padding: "2.5mm 3mm", borderBottom: "1pt solid #e2e8f0", textAlign: "center", fontWeight: 900, color: gradeCol }}>{cumGrade}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        {cumRows.length > 1 && (
                          <tfoot>
                            <tr style={{ background: "#f1f5f9", color: "#0f172a" }}>
                              <td colSpan={7} style={{ padding: "2.5mm 3mm", fontWeight: 800, textTransform: "uppercase", fontSize: "8pt" }}>Cumulative Overall Average</td>
                              <td style={{ padding: "2.5mm 3mm", textAlign: "center", fontWeight: 900, fontSize: "10pt", color: "#0f766e" }}>{overallCumAvg}%</td>
                              <td style={{ padding: "2.5mm 3mm", textAlign: "center", fontWeight: 900, fontSize: "10pt", color: overallCumAvg >= 70 ? "#059669" : overallCumAvg >= 40 ? "#d97706" : "#dc2626" }}>{overallCumGrade}</td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  );
                }

                // Standard 1st / 2nd Term Layout
                return (
                  <div style={{ borderRadius: "3mm", border: "1pt solid #e2e8f0", overflow: "hidden", marginBottom: "6mm" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10pt" }}>
                      <thead>
                        <tr style={{ background: "#0f766e", color: "#fff" }}>
                          {["Subject", "Code", "C.A. (40)", "Exam (60)", "Total (100)", "Grade"].map((h) => (
                            <th key={h} style={{ padding: "3mm 4mm", textAlign: h === "Subject" || h === "Code" ? "left" : "center", fontWeight: 700, fontSize: "9pt", letterSpacing: "0.05em", textTransform: "uppercase" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedList.map((e, i) => {
                          const pct = scorePct(e.score, e.total_score);
                          const grade = e.grade || letterGrade(pct);
                          const gradeCol = grade === "PASS" || pct >= 70 ? "#059669" : grade === "FAIL" || pct < 40 ? "#dc2626" : "#d97706";
                          return (
                            <tr key={e.exam_id} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                              <td style={{ padding: "3mm 4mm", borderBottom: "1pt solid #e2e8f0", fontWeight: 600 }}>{e.subject_name}</td>
                              <td style={{ padding: "3mm 4mm", borderBottom: "1pt solid #e2e8f0", fontSize: "8.5pt", color: "#64748b" }}>{e.code}</td>
                              <td style={{ padding: "3mm 4mm", borderBottom: "1pt solid #e2e8f0", textAlign: "center" }}>{e.ca_score ?? "—"}</td>
                              <td style={{ padding: "3mm 4mm", borderBottom: "1pt solid #e2e8f0", textAlign: "center" }}>{e.exam_score ?? "—"}</td>
                              <td style={{ padding: "3mm 4mm", borderBottom: "1pt solid #e2e8f0", textAlign: "center", fontWeight: 700 }}>{e.score ?? 0}</td>
                              <td style={{ padding: "3mm 4mm", borderBottom: "1pt solid #e2e8f0", textAlign: "center", fontWeight: 900, color: gradeCol }}>{grade}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {selectedList.length > 1 && (
                        <tfoot>
                          <tr style={{ background: "#f1f5f9", color: "#0f172a" }}>
                            <td colSpan={4} style={{ padding: "3mm 4mm", fontWeight: 800, textTransform: "uppercase", fontSize: "9pt" }}>Overall Average</td>
                            <td style={{ padding: "3mm 4mm", textAlign: "center", fontWeight: 900, fontSize: "11pt", color: "#0f766e" }}>{avgPct}%</td>
                            <td style={{ padding: "3mm 4mm", textAlign: "center", fontWeight: 900, fontSize: "11pt", color: avgPct >= 70 ? "#059669" : avgPct >= 40 ? "#d97706" : "#dc2626" }}>{letterGrade(avgPct)}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                );
              })()}

              {/* ── Remarks Block ── */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6mm", marginBottom: "8mm" }}>
                {/* Teacher remark */}
                <div style={{ border: "1pt solid #cbd5e1", borderRadius: "2mm", padding: "4mm 5mm", minHeight: "22mm", position: "relative", background: "#fff" }}>
                  <div style={{ fontSize: "8pt", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "#0f766e", marginBottom: "2mm" }}>
                    Class Teacher's Remark
                  </div>
                  <div style={{ fontSize: "9.5pt", color: "#334155", lineHeight: 1.6, fontStyle: remarks.teacher_remark ? "normal" : "italic" }}>
                    {remarks.teacher_remark || "—"}
                  </div>
                </div>

                {/* Principal remark */}
                <div style={{ border: "1.5pt solid #0f766e", borderRadius: "2mm", padding: "4mm 5mm", minHeight: "22mm", position: "relative", background: "#fff" }}>
                  <div style={{ fontSize: "8pt", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "#0f766e", marginBottom: "2mm", display: "flex", alignItems: "center", gap: "2mm" }}>
                    Principal's Remark
                    {logo && <img src={logo} alt="" style={{ width: "4mm", height: "4mm", opacity: 0.5 }} />}
                  </div>
                  <div style={{ fontSize: "9.5pt", color: "#334155", lineHeight: 1.6, fontStyle: remarks.principal_remark ? "normal" : "italic" }}>
                    {remarks.principal_remark || "—"}
                  </div>
                </div>
              </div>

              {/* ── Signature Block ── */}
              <div style={{ display: "flex", justifyContent: "space-between", gap: "10mm", marginTop: "auto", padding: "0 10mm" }}>
                {["Class Teacher", "Vice Principal", "Principal / Proprietor"].map((role) => (
                  <div key={role} style={{ flex: 1, textAlign: "center" }}>
                    <div style={{ height: "10mm", borderBottom: "1pt solid #94a3b8", marginBottom: "2mm" }} />
                    <div style={{ fontSize: "8.5pt", color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{role}</div>
                  </div>
                ))}
              </div>

              {/* ── Footer ── */}
              <div style={{ textAlign: "center", fontSize: "8pt", color: "#94a3b8", borderTop: "1pt solid #e2e8f0", paddingTop: "3mm", marginTop: "6mm" }}>
                {schoolName} &nbsp;·&nbsp; {currentTerm} &nbsp;·&nbsp; Generated {new Date().toISOString().slice(0, 10)} &nbsp;·&nbsp; Powered by ExamPool
              </div>

              {/* ── Watermark logo seal ── */}
              {logo && (
                <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", opacity: 0.04, pointerEvents: "none", zIndex: 0 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logo} alt="" style={{ width: "120mm", height: "120mm", objectFit: "contain" }} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
