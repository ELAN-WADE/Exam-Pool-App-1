"use client";

import { useEffect, useState } from "react";
import { api, fetchWithAuth } from "../../lib/api";
import { scorePct, letterGrade, gradeBadgeClass, gradeColor } from "../../lib/gradeUtils";
import { DocumentIcon, CheckCircleIcon, WarningIcon, EditIcon, SchoolIcon, ClipboardIcon, RefreshIcon, CloseIcon } from "../icons/Icons";
import { useAuth } from "../../hooks/useAuth";
import { useAcademic } from "../context/AcademicContext";

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
  teacher_remark: string | null;
  principal_remark: string | null;
  term_id?: number;
  session_id?: number;
  session_name?: string;
  term_order_in_session?: number;
  term_teacher_remark?: string | null;
  teacher_id?: number;
};

type CumulativeSubjectRow = {
  code: string;
  subject_name: string;
  term1_total: number | null;
  term2_total: number | null;
  term3_ca: number | null;
  term3_exam: number | null;
  term3_total: number | null;
  term3_grade: string | null;
  cumulative_avg: number | null;
};

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
    const latestExams = exams.filter((e) => e.session_id === latestSessionId);
    const maxOrder = Math.max(...latestExams.map((e) => e.term_order_in_session || 0));
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
      subjectMap.set(key, { code: e.code || key, subject_name: e.subject_name || key, term1_total: null, term2_total: null, term3_ca: null, term3_exam: null, term3_total: null, term3_grade: null, cumulative_avg: null });
    }
    const row = subjectMap.get(key)!;
    const order = e.computed_order;
    const termScore = e.score ?? 0;
    if (order === 1) { row.term1_total = termScore; }
    else if (order === 2) { row.term2_total = termScore; }
    else { row.term3_ca = e.ca_score ?? null; row.term3_exam = e.exam_score ?? null; row.term3_total = termScore; row.term3_grade = e.grade ?? letterGrade(scorePct(e.score, e.total_score)); }
  }
  for (const row of subjectMap.values()) {
    const vals = [row.term1_total, row.term2_total, row.term3_total].filter((v) => v !== null) as number[];
    if (vals.length > 0) row.cumulative_avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  return Array.from(subjectMap.values());
}
type Toast = { msg: string; type: "success" | "error" };

export function ReportCardModal({ student, onClose }: { student: any; onClose: () => void }) {
  const { user } = useAuth();
  const { selectedSession, selectedTerm, activeSession, activeTerm } = useAcademic();
  const currentAcademicSession = selectedSession || activeSession;
  const currentAcademicTerm = selectedTerm || activeTerm;
  const isOperator = user?.role === "operator";

  const [exams, setExams] = useState<ExamEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [config, setConfig] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isCumulativeMode, setIsCumulativeMode] = useState<boolean>(true);

  // Per-exam remarks (teacher edits all; operator edits principal)
  const [teacherRemarks, setTeacherRemarks] = useState<Record<number, string>>({});
  const [principalRemarks, setPrincipalRemarks] = useState<Record<number, string>>({});
  const [savingRemark, setSavingRemark] = useState<number | null>(null);
  const [savedRemarks, setSavedRemarks] = useState<Set<number>>(new Set());
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadExams = () => {
    setLoading(true);
    setFetchError("");
    const studentId = Number(student.id);
    const sessionParam = currentAcademicSession?.id ? `&sessionId=${currentAcademicSession.id}` : "";
    const termParam = currentAcademicTerm?.id ? `&termId=${currentAcademicTerm.id}` : "";
    const url = `/api/users/${studentId}/report-card-results?_t=${Date.now()}${sessionParam}${termParam}`;
    fetchWithAuth(url)
      .then((body) => {
        const rawList = Array.isArray(body) ? body : (body?.data ?? []);
        let list: ExamEntry[] = Array.isArray(rawList) ? rawList : [];

        // Check if 3rd term or single isolated term
        const is3rd = currentAcademicTerm?.name ? (
          currentAcademicTerm.name.toLowerCase().includes("third") ||
          currentAcademicTerm.name.toLowerCase().includes("3rd") ||
          currentAcademicTerm.name.endsWith("-T3") ||
          currentAcademicTerm.name.endsWith("_T3")
        ) : detectIs3rdTerm(list, config?.current_term);

        if (!is3rd && currentAcademicTerm?.id) {
          list = list.filter((e) => Number(e.term_id) === Number(currentAcademicTerm.id));
        } else if (!is3rd && currentAcademicTerm?.name) {
          list = list.filter((e) => (e.term || "").toLowerCase() === currentAcademicTerm.name.toLowerCase());
        }

        setExams(list);
        setSelectedIds(new Set(list.map((e) => e.exam_id)));
        setIsCumulativeMode(is3rd);
        setLoading(false);
      })
      .catch((err) => {
        setFetchError(err instanceof Error ? err.message : "Failed to load exam data");
        setLoading(false);
      });

    // Also load term remarks
    const activeTermResolved = currentAcademicTerm?.name || config?.current_term || "2026-T1";
    api.getTermRemark(studentId, activeTermResolved, currentAcademicSession?.id, currentAcademicTerm?.id)
      .then((res: any) => {
        if (res) {
          setTeacherRemarks({ 0: res.teacher_remark || "" });
          setPrincipalRemarks({ 0: res.principal_remark || "" });
        } else {
          setTeacherRemarks({ 0: "" });
          setPrincipalRemarks({ 0: "" });
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    api.getPublicSettings().then((c) => {
      setConfig(c);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadExams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student.id, config?.current_term, currentAcademicSession?.id, currentAcademicTerm?.id]);

  let theme: any = {};
  try { theme = config?.theme_json ? JSON.parse(config.theme_json) : {}; } catch {}
  const logo = theme.school_logo as string | undefined;
  const schoolName = config?.org_name || config?.school_name || "School Name";
  const adminName = config?.admin_name || "Principal";
  const currentTerm = currentAcademicTerm?.name || config?.current_term || "2026-T1";

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

  const saveRemark = async (type: "teacher" | "principal") => {
    setSavingRemark(0);
    const term = currentAcademicTerm?.name || currentTerm;
    try {
      if (type === "principal") {
        await api.saveTermRemark(student.id, term, principalRemarks[0] ?? "", currentAcademicSession?.id, currentAcademicTerm?.id);
      } else {
        await api.saveTermRemark(student.id, term, teacherRemarks[0] ?? "", currentAcademicSession?.id, currentAcademicTerm?.id);
      }
      setSavedRemarks((prev) => new Set([...prev, 0]));
      showToast("Remark saved successfully.", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to save remark.", "error");
    } finally {
      setSavingRemark(null);
    }
  };

  // Consolidated overall remark for print
  const overallTeacherRemark = teacherRemarks[0] ?? "";
  const overallPrincipalRemark = principalRemarks[0] ?? "";

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: "fixed", top: 24, right: 24, zIndex: 9999,
          background: toast.type === "success" ? "var(--color-success)" : "var(--color-danger, #dc2626)",
          color: "#fff",
          padding: "0.75rem 1.25rem", borderRadius: 10, fontWeight: 600,
          boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
          display: "flex", alignItems: "center", gap: "0.5rem",
          fontSize: "0.9rem", maxWidth: 360,
          animation: "slideInRight 0.25s ease",
        }}>
          {toast.type === "success" ? <CheckCircleIcon width="18" height="18" /> : <WarningIcon width="18" height="18" />}
          {toast.msg}
        </div>
      )}

      {/* ── Print CSS (injected globally) ── */}
      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @media print {
          body > *:not(#rc-print-clone) { display: none !important; }
          #rc-print-clone { display: block !important; position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; background: #fff !important; z-index: 999999 !important; }
        }
        #rc-print-frame { display: none; }
      `}</style>

      <div className="modal" style={{ maxWidth: 700, maxHeight: "90vh", overflowY: "auto" }}>

        {/* ── Screen UI (hidden on print) ── */}
        <div className="no-print">
          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.5rem", gap: "1rem" }}>
            <div>
              <h2 style={{ fontSize: "1.2rem", fontWeight: 800, margin: 0 }}>Report Card</h2>
              <p style={{ margin: "0.25rem 0 0", color: "var(--color-muted)", fontSize: "0.875rem" }}>
                {student.name} · <code style={{ fontSize: "0.8rem" }}>{student.reg_id || "N/A"}</code> · {student.grade || ""}
              </p>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>
              <CloseIcon width="18" height="18" />
            </button>
          </div>

          {loading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "3rem 0", gap: "1rem" }}>
              <div className="spinner" />
              <p style={{ color: "var(--color-muted)", fontSize: "0.875rem" }}>Loading completed exams…</p>
            </div>
          )}

          {!loading && fetchError && (
            <div style={{ background: "var(--color-danger-bg, #fef2f2)", border: "1px solid var(--color-danger, #dc2626)", borderRadius: 10, padding: "1.25rem", marginBottom: "1rem" }}>
              <p style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "var(--color-danger, #dc2626)", fontWeight: 600, margin: "0 0 0.5rem" }}>
                <WarningIcon width="18" height="18" /> Failed to load exam data
              </p>
              <p style={{ color: "var(--color-muted)", fontSize: "0.875rem", margin: "0 0 1rem" }}>{fetchError}</p>
              <button className="btn btn-primary btn-sm" onClick={loadExams}>Retry</button>
            </div>
          )}

          {!loading && !fetchError && exams.length === 0 && (
            <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
              <div style={{ marginBottom: "1rem", color: "var(--color-muted)" }}>
                <ClipboardIcon width="48" height="48" style={{ margin: "0 auto", opacity: 0.5 }} />
              </div>
              <p style={{ fontWeight: 700, fontSize: "1rem", marginBottom: "0.5rem" }}>No completed exams found</p>
              <p style={{ color: "var(--color-muted)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
                {student.name} hasn't completed any exams yet.
              </p>
              <button className="btn btn-ghost btn-sm" onClick={loadExams} style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                <RefreshIcon width="16" height="16" /> Refresh
              </button>
            </div>
          )}

          {!loading && !fetchError && exams.length > 0 && (
            <>
              {/* Layout Mode Selector Toggle */}
              <div style={{ marginBottom: "1.25rem", background: "var(--color-surface-2)", padding: "0.5rem 0.75rem", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--color-muted)", textTransform: "uppercase" }}>Report Card Layout:</span>
                <div style={{ display: "flex", gap: "0.25rem" }}>
                  <button
                    type="button"
                    className={`btn btn-sm ${!isCumulativeMode ? "btn-primary" : "btn-ghost"}`}
                    onClick={() => setIsCumulativeMode(false)}
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
                  >
                    Standard (1st/2nd Term)
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

              {/* Exam selector */}
              <div style={{ marginBottom: "1.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
                  <label style={{ fontSize: "0.75rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-muted)" }}>
                    Select Exams ({selectedIds.size}/{exams.length})
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button className="btn btn-ghost btn-sm" onClick={selectAll}>All</button>
                    <button className="btn btn-ghost btn-sm" onClick={clearAll}>None</button>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {exams.map((e) => {
                    const pct = scorePct(e.score, e.total_score);
                    const checked = selectedIds.has(e.exam_id);
                    return (
                      <label
                        key={e.exam_id}
                        style={{
                          display: "flex", alignItems: "center", gap: "0.75rem",
                          padding: "0.625rem 1rem", borderRadius: 10, cursor: "pointer",
                          border: `2px solid ${checked ? "var(--color-primary)" : "var(--color-border)"}`,
                          background: checked ? "rgba(20,184,166,0.06)" : "var(--color-surface)",
                          transition: "all 0.15s",
                        }}
                      >
                        <input
                          type="checkbox" checked={checked} onChange={() => toggleExam(e.exam_id)}
                          style={{ width: 16, height: 16, accentColor: "var(--color-primary)", cursor: "pointer" }}
                        />
                        <span style={{ flex: 1, fontWeight: 600, fontSize: "0.9rem" }}>{e.subject_name}</span>
                        <code style={{ fontSize: "0.72rem", color: "var(--color-muted)", background: "var(--color-surface-2)", padding: "0.1rem 0.4rem", borderRadius: 4 }}>{e.term}</code>
                        <span className={`badge ${gradeBadgeClass(pct)}`}>{pct}%</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Remarks Section */}
              {selectedList.length > 0 && (
                <div style={{ marginBottom: "1.5rem" }}>
                  <label style={{ fontSize: "0.75rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-muted)", display: "block", marginBottom: "0.75rem" }}>
                    Overall Term Remarks
                  </label>
                  <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                    <div style={{ border: "1.5px solid var(--color-border)", borderRadius: 12, overflow: "hidden", background: "var(--color-surface)" }}>
                      <div style={{ padding: "0.875rem 1rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
                        {/* Teacher Remark */}
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-muted)", marginBottom: "0.4rem" }}>
                            <EditIcon width="14" height="14" /> Teacher's Remark
                          </div>
                          <div style={{ display: "flex", gap: "0.625rem", alignItems: "flex-start" }}>
                            <textarea
                              className="input"
                              rows={2}
                              style={{
                                flex: 1, resize: "vertical", fontSize: "0.875rem", minHeight: 60,
                                background: isOperator ? "var(--color-surface-2)" : "var(--color-surface)",
                                opacity: isOperator ? 0.7 : 1,
                                cursor: isOperator ? "not-allowed" : "text",
                              }}
                              placeholder={isOperator ? "(Read-only — set by teacher)" : `Write overall teacher's remark…`}
                              value={teacherRemarks[0] ?? ""}
                              readOnly={isOperator}
                              onChange={(ev) => {
                                if (!isOperator) setTeacherRemarks((prev) => ({ ...prev, 0: ev.target.value }));
                              }}
                            />
                            {!isOperator && (
                              <button
                                className="btn btn-primary btn-sm"
                                style={{ flexShrink: 0, alignSelf: "flex-end" }}
                                disabled={savingRemark === 0}
                                onClick={() => saveRemark("teacher")}
                              >
                                {savingRemark === 0 ? "Saving…" : "Save"}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Principal Remark */}
                        <div style={{ paddingTop: "0.75rem", borderTop: "1px dashed var(--color-border)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-muted)", marginBottom: "0.4rem" }}>
                            <SchoolIcon width="14" height="14" /> Principal's Remark
                            {logo && <img src={logo} alt="" style={{ width: 14, height: 14, marginLeft: "auto", borderRadius: 2 }} />}
                          </div>
                          <div style={{ display: "flex", gap: "0.625rem", alignItems: "flex-start" }}>
                            <textarea
                              className="input"
                              rows={2}
                              style={{
                                flex: 1, resize: "vertical", fontSize: "0.875rem", minHeight: 60,
                                background: !isOperator ? "var(--color-surface-2)" : "var(--color-surface)",
                                opacity: !isOperator ? 0.7 : 1,
                                cursor: !isOperator ? "not-allowed" : "text",
                              }}
                              placeholder={!isOperator ? "(Read-only — set by principal)" : `Write overall principal's remark…`}
                              value={principalRemarks[0] ?? ""}
                              readOnly={!isOperator}
                              onChange={(ev) => {
                                if (isOperator) setPrincipalRemarks((prev) => ({ ...prev, 0: ev.target.value }));
                              }}
                            />
                            {isOperator && (
                              <button
                                className="btn btn-primary btn-sm"
                                style={{ flexShrink: 0, alignSelf: "flex-end" }}
                                disabled={savingRemark === 0}
                                onClick={() => saveRemark("principal")}
                              >
                                {savingRemark === 0 ? "Saving…" : "Save"}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Live On-Screen Report Card Preview in Modal ── */}
              {selectedList.length > 0 && (
                <div style={{ marginBottom: "1.5rem", borderRadius: 12, border: "1px solid var(--color-border)", padding: "1.25rem", background: "var(--color-surface)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
                    <h4 style={{ fontWeight: 800, fontSize: "0.95rem", color: "var(--color-primary)", margin: 0 }}>
                      {isCumulativeMode ? "3rd Term Cumulative Report Card Preview" : "Report Card Preview"}
                    </h4>
                    <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--color-muted)" }}>{currentTerm}</span>
                  </div>

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
                          <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid var(--color-border)", marginBottom: "0.75rem" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                              <thead>
                                <tr style={{ background: "var(--color-surface-2)", color: "var(--color-text)" }}>
                                  <th style={{ padding: "0.5rem", textAlign: "left" }}>Subject</th>
                                  <th style={{ padding: "0.5rem", textAlign: "left" }}>Code</th>
                                  <th style={{ padding: "0.5rem", textAlign: "center" }}>1st Term</th>
                                  <th style={{ padding: "0.5rem", textAlign: "center" }}>2nd Term</th>
                                  <th style={{ padding: "0.5rem", textAlign: "center" }}>3rd C.A.</th>
                                  <th style={{ padding: "0.5rem", textAlign: "center" }}>3rd Exam</th>
                                  <th style={{ padding: "0.5rem", textAlign: "center" }}>3rd Total</th>
                                  <th style={{ padding: "0.5rem", textAlign: "center" }}>Cum. Avg.</th>
                                  <th style={{ padding: "0.5rem", textAlign: "center" }}>Grade</th>
                                </tr>
                              </thead>
                              <tbody>
                                {cumRows.map((r, i) => {
                                  const cumPct = r.cumulative_avg ?? 0;
                                  const cumGrade = letterGrade(cumPct);
                                  return (
                                    <tr key={r.code} style={{ borderTop: "1px solid var(--color-border)", background: i % 2 === 0 ? "transparent" : "var(--color-surface-2)" }}>
                                      <td style={{ padding: "0.5rem", fontWeight: 600 }}>{r.subject_name}</td>
                                      <td style={{ padding: "0.5rem", color: "var(--color-muted)", fontSize: "0.75rem" }}>{r.code}</td>
                                      <td style={{ padding: "0.5rem", textAlign: "center" }}>{r.term1_total ?? "—"}</td>
                                      <td style={{ padding: "0.5rem", textAlign: "center" }}>{r.term2_total ?? "—"}</td>
                                      <td style={{ padding: "0.5rem", textAlign: "center" }}>{r.term3_ca ?? "—"}</td>
                                      <td style={{ padding: "0.5rem", textAlign: "center" }}>{r.term3_exam ?? "—"}</td>
                                      <td style={{ padding: "0.5rem", textAlign: "center", fontWeight: 700 }}>{r.term3_total ?? "—"}</td>
                                      <td style={{ padding: "0.5rem", textAlign: "center", fontWeight: 800 }}>{r.cumulative_avg !== null ? `${r.cumulative_avg}%` : "—"}</td>
                                      <td style={{ padding: "0.5rem", textAlign: "center" }}>
                                        <span className={`badge ${gradeBadgeClass(cumPct)}`}>{cumGrade}</span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.6rem 0.8rem", borderRadius: 8, background: "var(--color-surface-2)" }}>
                            <span style={{ fontWeight: 700, fontSize: "0.8rem" }}>Overall Cumulative Avg</span>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "var(--color-primary)" }}>{overallCumAvg}%</span>
                              <span className={`badge ${gradeBadgeClass(overallCumAvg)}`}>{overallCumGrade}</span>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    // Standard Layout
                    return (
                      <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid var(--color-border)" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                          <thead>
                            <tr style={{ background: "var(--color-surface-2)", color: "var(--color-text)" }}>
                              <th style={{ padding: "0.5rem", textAlign: "left" }}>Subject</th>
                              <th style={{ padding: "0.5rem", textAlign: "center" }}>C.A. Score</th>
                              <th style={{ padding: "0.5rem", textAlign: "center" }}>Exam Score</th>
                              <th style={{ padding: "0.5rem", textAlign: "center" }}>Total</th>
                              <th style={{ padding: "0.5rem", textAlign: "center" }}>Grade</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedList.map((e, i) => {
                              const pct = scorePct(e.score, e.total_score);
                              return (
                                <tr key={e.exam_id} style={{ borderTop: "1px solid var(--color-border)", background: i % 2 === 0 ? "transparent" : "var(--color-surface-2)" }}>
                                  <td style={{ padding: "0.5rem", fontWeight: 600 }}>{e.subject_name}</td>
                                  <td style={{ padding: "0.5rem", textAlign: "center" }}>{e.ca_score ?? "—"}</td>
                                  <td style={{ padding: "0.5rem", textAlign: "center" }}>{e.exam_score ?? "—"}</td>
                                  <td style={{ padding: "0.5rem", textAlign: "center", fontWeight: 700 }}>{e.score ?? 0} / {e.total_score ?? 100}</td>
                                  <td style={{ padding: "0.5rem", textAlign: "center" }}>
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

              {/* Actions */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "0.25rem", gap: "0.75rem", flexWrap: "wrap" }}>
                <button className="btn btn-ghost btn-sm" onClick={loadExams} style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <RefreshIcon width="16" height="16" /> Refresh
                </button>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      const frame = document.getElementById("rc-print-frame");
                      if (!frame) return;
                      const clone = frame.cloneNode(true) as HTMLElement;
                      clone.id = "rc-print-clone";
                      document.body.appendChild(clone);
                      window.print();
                      setTimeout(() => {
                        if (clone.parentNode) clone.parentNode.removeChild(clone);
                      }, 1000);
                    }}
                    disabled={selectedIds.size === 0}
                  >
                    <DocumentIcon width="16" height="16" />
                    Download PDF
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── PDF / Print Frame (rendered outside modal, shown only on print) ── */}
      <div id="rc-print-frame" style={{ display: "none" }}>
        <div style={{
          fontFamily: "'Inter', 'Segoe UI', sans-serif",
          padding: "20mm",
          color: "#0f172a",
          width: "210mm",
          minHeight: "297mm",
          margin: "0 auto",
          background: "#fff",
          boxSizing: "border-box",
          position: "relative",
        }}>
          {/* Outer decorative border */}
          <div style={{
            position: "absolute", inset: "12mm",
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

          <div style={{ position: "relative", zIndex: 10, padding: "10mm 14mm" }}>
            {/* ── Header: Logo left, School name centre ── */}
            <div style={{ display: "flex", alignItems: "center", gap: "16mm", paddingBottom: "8mm", marginBottom: "8mm", borderBottom: "1.5pt solid #e2e8f0" }}>
              {/* Logo seal */}
              <div style={{ flexShrink: 0, width: "26mm", height: "26mm", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", borderRadius: "3mm", border: "1pt solid #e2e8f0" }}>
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt="School Logo" style={{ width: "22mm", height: "22mm", objectFit: "contain" }} />
                ) : (
                  <div style={{ fontSize: "8pt", color: "#94a3b8", fontWeight: 700 }}>LOGO</div>
                )}
              </div>

              {/* School name & title */}
              <div style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontSize: "20pt", fontWeight: 900, color: "#0f766e", letterSpacing: "0.02em", textTransform: "uppercase", lineHeight: 1.15 }}>
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
              gap: "4mm 12mm", marginBottom: "8mm",
              fontSize: "10pt", background: "#f8fafc",
              padding: "6mm 8mm", borderRadius: "3mm",
              border: "1pt solid #e2e8f0",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1pt dashed #cbd5e1", paddingBottom: "2mm" }}>
                <strong style={{ color: "#475569" }}>Student Name:</strong> <span style={{ fontWeight: 700 }}>{student.name}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1pt dashed #cbd5e1", paddingBottom: "2mm" }}>
                <strong style={{ color: "#475569" }}>Registration No:</strong> <span style={{ fontWeight: 700 }}>{student.reg_id || "—"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1pt dashed #cbd5e1", paddingBottom: "2mm" }}>
                <strong style={{ color: "#475569" }}>Class / Grade:</strong> <span style={{ fontWeight: 700 }}>{student.grade || "—"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1pt dashed #cbd5e1", paddingBottom: "2mm" }}>
                <strong style={{ color: "#475569" }}>Date Issued:</strong> <span style={{ fontWeight: 700 }}>{new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</span>
              </div>
            </div>

            {/* ── Subject Results Table ── */}
            {(() => {
              const is3rd = isCumulativeMode;
              if (is3rd) {
                const cumRows = buildCumulativeRows(selectedList);
                const overallCumAvg = cumRows.length > 0
                  ? Math.round(cumRows.reduce((acc, r) => acc + (r.cumulative_avg ?? 0), 0) / cumRows.filter(r => r.cumulative_avg !== null).length)
                  : 0;
                const overallCumGrade = letterGrade(overallCumAvg);
                return (
                  <div style={{ borderRadius: "3mm", border: "1pt solid #e2e8f0", overflow: "hidden", marginBottom: "8mm" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8.5pt" }}>
                      <thead>
                        <tr style={{ background: "#0f766e", color: "#fff" }}>
                          <th style={{ padding: "2mm 3mm", textAlign: "left", fontWeight: 700, fontSize: "7.5pt", textTransform: "uppercase" }}>Subject</th>
                          <th style={{ padding: "2mm 3mm", textAlign: "left", fontWeight: 700, fontSize: "7.5pt", textTransform: "uppercase" }}>Code</th>
                          <th style={{ padding: "2mm 3mm", textAlign: "center", fontWeight: 700, fontSize: "7pt", textTransform: "uppercase" }}>1st Term</th>
                          <th style={{ padding: "2mm 3mm", textAlign: "center", fontWeight: 700, fontSize: "7pt", textTransform: "uppercase" }}>2nd Term</th>
                          <th style={{ padding: "2mm 3mm", textAlign: "center", fontWeight: 700, fontSize: "7pt", textTransform: "uppercase" }}>3rd C.A.</th>
                          <th style={{ padding: "2mm 3mm", textAlign: "center", fontWeight: 700, fontSize: "7pt", textTransform: "uppercase" }}>3rd Exam</th>
                          <th style={{ padding: "2mm 3mm", textAlign: "center", fontWeight: 700, fontSize: "7pt", textTransform: "uppercase" }}>3rd Total</th>
                          <th style={{ padding: "2mm 3mm", textAlign: "center", fontWeight: 700, fontSize: "7pt", textTransform: "uppercase" }}>Cum. Avg.</th>
                          <th style={{ padding: "2mm 3mm", textAlign: "center", fontWeight: 700, fontSize: "7.5pt", textTransform: "uppercase" }}>Grade</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cumRows.map((r, i) => {
                          const cumPct = r.cumulative_avg ?? 0;
                          const cumGrade = letterGrade(cumPct);
                          const gradeCol = cumPct >= 70 ? "#059669" : cumPct >= 40 ? "#d97706" : "#dc2626";
                          return (
                            <tr key={r.code} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                              <td style={{ padding: "2mm 3mm", borderBottom: "1pt solid #e2e8f0", fontWeight: 600, fontSize: "8pt" }}>{r.subject_name}</td>
                              <td style={{ padding: "2mm 3mm", borderBottom: "1pt solid #e2e8f0", fontSize: "7pt", color: "#64748b" }}>{r.code}</td>
                              <td style={{ padding: "2mm 3mm", borderBottom: "1pt solid #e2e8f0", textAlign: "center" }}>{r.term1_total ?? "—"}</td>
                              <td style={{ padding: "2mm 3mm", borderBottom: "1pt solid #e2e8f0", textAlign: "center" }}>{r.term2_total ?? "—"}</td>
                              <td style={{ padding: "2mm 3mm", borderBottom: "1pt solid #e2e8f0", textAlign: "center" }}>{r.term3_ca ?? "—"}</td>
                              <td style={{ padding: "2mm 3mm", borderBottom: "1pt solid #e2e8f0", textAlign: "center" }}>{r.term3_exam ?? "—"}</td>
                              <td style={{ padding: "2mm 3mm", borderBottom: "1pt solid #e2e8f0", textAlign: "center", fontWeight: 700 }}>{r.term3_total ?? "—"}</td>
                              <td style={{ padding: "2mm 3mm", borderBottom: "1pt solid #e2e8f0", textAlign: "center", fontWeight: 800, color: gradeCol }}>{r.cumulative_avg !== null ? `${r.cumulative_avg}%` : "—"}</td>
                              <td style={{ padding: "2mm 3mm", borderBottom: "1pt solid #e2e8f0", textAlign: "center", fontWeight: 900, color: gradeCol }}>{cumGrade}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {cumRows.length > 1 && (
                        <tfoot>
                          <tr style={{ background: "#f1f5f9", color: "#0f172a" }}>
                            <td colSpan={7} style={{ padding: "2mm 3mm", fontWeight: 800, textTransform: "uppercase", fontSize: "8pt" }}>Cumulative Average</td>
                            <td style={{ padding: "2mm 3mm", textAlign: "center", fontWeight: 900, fontSize: "9pt", color: "#0f766e" }}>{overallCumAvg}%</td>
                            <td style={{ padding: "2mm 3mm", textAlign: "center", fontWeight: 900, fontSize: "9pt", color: overallCumAvg >= 70 ? "#059669" : overallCumAvg >= 40 ? "#d97706" : "#dc2626" }}>{overallCumGrade}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                );
              }
              // Standard Layout
              return (
                <div style={{ borderRadius: "3mm", border: "1pt solid #e2e8f0", overflow: "hidden", marginBottom: "8mm" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10pt" }}>
                    <thead>
                      <tr style={{ background: "#0f766e", color: "#fff" }}>
                        {["Subject", "Score", "Total", "%", "Grade", "Term"].map((h) => (
                          <th key={h} style={{ padding: "3mm 4mm", textAlign: h === "Subject" ? "left" : "center", fontWeight: 700, fontSize: "9pt", letterSpacing: "0.05em", textTransform: "uppercase" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedList.map((e, i) => {
                        const pct = scorePct(e.score, e.total_score);
                        const grade = letterGrade(pct);
                        const gradeCol = pct >= 70 ? "#059669" : pct >= 40 ? "#d97706" : "#dc2626";
                        return (
                          <tr key={e.exam_id} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                            <td style={{ padding: "3mm 4mm", borderBottom: "1pt solid #e2e8f0", fontWeight: 600 }}>{e.subject_name}</td>
                            <td style={{ padding: "3mm 4mm", borderBottom: "1pt solid #e2e8f0", textAlign: "center" }}>{e.score ?? 0}</td>
                            <td style={{ padding: "3mm 4mm", borderBottom: "1pt solid #e2e8f0", textAlign: "center", color: "#64748b" }}>{e.total_score ?? 0}</td>
                            <td style={{ padding: "3mm 4mm", borderBottom: "1pt solid #e2e8f0", textAlign: "center", fontWeight: 700 }}>{pct}%</td>
                            <td style={{ padding: "3mm 4mm", borderBottom: "1pt solid #e2e8f0", textAlign: "center", fontWeight: 900, color: gradeCol }}>{grade}</td>
                            <td style={{ padding: "3mm 4mm", borderBottom: "1pt solid #e2e8f0", textAlign: "center", color: "#64748b", fontSize: "9pt" }}>{e.term}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {selectedList.length > 1 && (
                      <tfoot>
                        <tr style={{ background: "#f1f5f9", color: "#0f172a" }}>
                          <td colSpan={3} style={{ padding: "3mm 4mm", fontWeight: 800, textTransform: "uppercase", fontSize: "9pt" }}>Overall Average</td>
                          <td style={{ padding: "3mm 4mm", textAlign: "center", fontWeight: 900, fontSize: "11pt", color: "#0f766e" }}>{avgPct}%</td>
                          <td style={{ padding: "3mm 4mm", textAlign: "center", fontWeight: 900, fontSize: "11pt", color: avgPct >= 70 ? "#059669" : avgPct >= 40 ? "#d97706" : "#dc2626" }}>{letterGrade(avgPct)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              );
            })()}

            {/* ── Remarks Block ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6mm", marginBottom: "12mm" }}>
              {/* Teacher remark */}
              <div style={{ border: "1pt solid #cbd5e1", borderRadius: "2mm", padding: "4mm 5mm", minHeight: "22mm", position: "relative", background: "#fff" }}>
                <div style={{ fontSize: "8pt", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "#0f766e", marginBottom: "2mm" }}>
                  Class Teacher's Remark
                </div>
                <div style={{ fontSize: "9.5pt", color: "#334155", lineHeight: 1.6, fontStyle: overallTeacherRemark ? "normal" : "italic" }}>
                  {overallTeacherRemark || "—"}
                </div>
              </div>

              {/* Principal remark */}
              <div style={{ border: "1.5pt solid #0f766e", borderRadius: "2mm", padding: "4mm 5mm", minHeight: "22mm", position: "relative", background: "#fff" }}>
                <div style={{ fontSize: "8pt", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "#0f766e", marginBottom: "2mm", display: "flex", alignItems: "center", gap: "2mm" }}>
                  Principal's Remark
                  {logo && <img src={logo} alt="" style={{ width: "4mm", height: "4mm", opacity: 0.5 }} />}
                </div>
                <div style={{ fontSize: "9.5pt", color: "#334155", lineHeight: 1.6, fontStyle: overallPrincipalRemark ? "normal" : "italic" }}>
                  {overallPrincipalRemark || "—"}
                </div>
              </div>
            </div>

            {/* ── Signature Block ── */}
            <div style={{ display: "flex", justifyContent: "space-between", gap: "10mm", marginTop: "16mm", padding: "0 10mm" }}>
              {["Class Teacher", "Vice Principal", "Principal / Proprietor"].map((role) => (
                <div key={role} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ height: "10mm", borderBottom: "1pt solid #94a3b8", marginBottom: "2mm" }} />
                  <div style={{ fontSize: "8.5pt", color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{role}</div>
                </div>
              ))}
            </div>

            {/* ── Footer ── */}
            <div style={{ position: "absolute", bottom: "10mm", left: "14mm", right: "14mm", textAlign: "center", fontSize: "8pt", color: "#94a3b8", borderTop: "1pt solid #e2e8f0", paddingTop: "3mm" }}>
              {schoolName} &nbsp;·&nbsp; Generated {new Date().toISOString().slice(0, 10)} &nbsp;·&nbsp; Powered by ExamPool
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
    </div>
  );
}
