"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { scorePct, letterGrade, gradeBadgeClass, gradeColor } from "../../lib/gradeUtils";
import { DocumentIcon, CheckCircleIcon, WarningIcon, EditIcon, SchoolIcon, ClipboardIcon, RefreshIcon, CloseIcon } from "../icons/Icons";
import { useAuth } from "../../hooks/useAuth";

type ExamEntry = {
  exam_id: number;
  score: number;
  total_score: number;
  end_time: string;
  subject_name: string;
  code: string;
  term: string;
  teacher_remark: string | null;
  principal_remark: string | null;
};

type Toast = { msg: string; type: "success" | "error" };

export function ReportCardModal({ student, onClose }: { student: any; onClose: () => void }) {
  const { user } = useAuth();
  const isOperator = user?.role === "operator";

  const [exams, setExams] = useState<ExamEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [config, setConfig] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

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
    const url = `/api/users/${studentId}/exams?_t=${Date.now()}`;
    fetch((process.env.NEXT_PUBLIC_API_URL || "") + url, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((body) => {
        const rawList = Array.isArray(body) ? body : (body?.data ?? []);
        const list: ExamEntry[] = Array.isArray(rawList) ? rawList : [];
        setExams(list);
        setSelectedIds(new Set(list.map((e) => e.exam_id)));
        setLoading(false);
      })
      .catch((err) => {
        setFetchError(err instanceof Error ? err.message : "Failed to load exam data");
        setLoading(false);
      });

    // Also load term remarks
    const term = "2026-T1"; // Using default for now
    api.getTermRemark(studentId, term)
      .then((res: any) => {
        if (res) {
          setTeacherRemarks({ 0: res.teacher_remark || "" });
          setPrincipalRemarks({ 0: res.principal_remark || "" });
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    api.getConfig().then((c) => setConfig(c)).catch(() => {});
    loadExams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student.id]);

  let theme: any = {};
  try { theme = config?.theme_json ? JSON.parse(config.theme_json) : {}; } catch {}
  const logo = theme.school_logo as string | undefined;
  const schoolName = config?.org_name || config?.school_name || "School Name";
  const adminName = config?.admin_name || "Principal";

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
    const term = "2026-T1"; // Using default for now
    try {
      if (type === "principal") {
        await api.saveTermRemark(student.id, term, principalRemarks[0] ?? "");
      } else {
        await api.saveTermRemark(student.id, term, teacherRemarks[0] ?? "");
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
                <div style={{ fontSize: "10pt", color: "#64748b", marginTop: "2mm", letterSpacing: "0.15em", textTransform: "uppercase", fontWeight: 600 }}>
                  Official Student Report Card
                </div>
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
