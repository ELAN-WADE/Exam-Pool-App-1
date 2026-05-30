"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { scorePct, letterGrade, gradeBadgeClass } from "../../lib/gradeUtils";
import { DocumentIcon, CheckCircleIcon } from "../icons/Icons";
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

export function ReportCardModal({ student, onClose }: { student: any; onClose: () => void }) {
  const { user } = useAuth();
  const isOperator = user?.role === "operator";

  const [exams, setExams] = useState<ExamEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [config, setConfig] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [teacherRemarks, setTeacherRemarks] = useState<Record<number, string>>({});
  const [principalRemarks, setPrincipalRemarks] = useState<Record<number, string>>({});
  const [savingRemark, setSavingRemark] = useState<number | null>(null);
  const [savedRemarks, setSavedRemarks] = useState<Set<number>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadExams = () => {
    setLoading(true);
    setFetchError("");

    // Build URL with cache-buster
    const studentId = Number(student.id);
    const url = `/api/users/${studentId}/exams?_t=${Date.now()}`;

    // Use direct fetch to debug exactly what happens
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

        const tr: Record<number, string> = {};
        const pr: Record<number, string> = {};
        for (const e of list) {
          tr[e.exam_id] = e.teacher_remark ?? "";
          pr[e.exam_id] = e.principal_remark ?? "";
        }
        setTeacherRemarks(tr);
        setPrincipalRemarks(pr);
        setLoading(false);
      })
      .catch((err) => {
        setFetchError(err instanceof Error ? err.message : "Failed to load exam data");
        setLoading(false);
      });
  };

  useEffect(() => {
    // Load school config
    api.getConfig().then((c) => setConfig(c)).catch(() => {});
    loadExams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student.id]);

  let theme: any = {};
  try { theme = config?.theme_json ? JSON.parse(config.theme_json) : {}; } catch {}
  const logo = theme.school_logo as string | undefined;
  const schoolName = config?.school_name || "School Name";

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

  const saveRemark = async (examId: number, type: "teacher" | "principal") => {
    setSavingRemark(examId);
    try {
      if (type === "principal") {
        await api.savePrincipalRemark(examId, principalRemarks[examId] ?? "");
      } else {
        await api.saveTeacherRemark(examId, teacherRemarks[examId] ?? "");
      }
      setSavedRemarks((prev) => new Set([...prev, examId]));
      showToast("Remark saved successfully.");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to save remark.");
    } finally {
      setSavingRemark(null);
    }
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      {toast && (
        <div style={{
          position: "fixed", top: 24, right: 24, zIndex: 9999,
          background: "var(--color-success)", color: "#fff",
          padding: "0.625rem 1.25rem", borderRadius: 10, fontWeight: 600,
          boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
        }}>{toast}</div>
      )}

      <div className="modal" style={{ maxWidth: 680, maxHeight: "90vh", overflowY: "auto" }}>
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
            <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
          </div>

          {/* Loading */}
          {loading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "3rem 0", gap: "1rem" }}>
              <div className="spinner" />
              <p style={{ color: "var(--color-muted)", fontSize: "0.875rem" }}>Loading completed exams…</p>
            </div>
          )}

          {/* Error */}
          {!loading && fetchError && (
            <div style={{ background: "var(--color-danger-bg, #fef2f2)", border: "1px solid var(--color-danger)", borderRadius: 10, padding: "1.25rem", marginBottom: "1rem" }}>
              <p style={{ color: "var(--color-danger)", fontWeight: 600, margin: "0 0 0.5rem" }}>⚠ Failed to load exam data</p>
              <p style={{ color: "var(--color-muted)", fontSize: "0.875rem", margin: "0 0 1rem" }}>{fetchError}</p>
              <button className="btn btn-primary btn-sm" onClick={loadExams}>Retry</button>
            </div>
          )}

          {/* No exams */}
          {!loading && !fetchError && exams.length === 0 && (
            <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
              <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📋</div>
              <p style={{ fontWeight: 700, fontSize: "1rem", marginBottom: "0.5rem" }}>No completed exams found</p>
              <p style={{ color: "var(--color-muted)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
                {student.name} hasn't completed any exams yet. Once they submit an exam it will appear here.
              </p>
              <button className="btn btn-ghost btn-sm" onClick={loadExams}>
                ↻ Refresh
              </button>
            </div>
          )}

          {/* Exams found */}
          {!loading && !fetchError && exams.length > 0 && (
            <>
              {/* Exam selector */}
              <div style={{ marginBottom: "1.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
                  <label style={{ fontSize: "0.75rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-2)" }}>
                    Select Exams to Include ({selectedIds.size}/{exams.length})
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
                          background: checked ? "var(--color-primary-bg, rgba(79,124,255,0.06))" : "var(--color-surface)",
                          transition: "all 0.15s",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleExam(e.exam_id)}
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

              {/* ── Remarks Section ── */}
              {selectedList.length > 0 && (
                <div style={{ marginBottom: "1.5rem" }}>
                  <label style={{ fontSize: "0.75rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-2)", display: "block", marginBottom: "0.75rem" }}>
                    Remarks Per Subject
                  </label>
                  <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                    {selectedList.map((e) => {
                      const pct = scorePct(e.score, e.total_score);
                      const isSaved = savedRemarks.has(e.exam_id);
                      return (
                        <div key={e.exam_id} style={{ border: "1.5px solid var(--color-border)", borderRadius: 12, overflow: "hidden", background: "var(--color-surface)" }}>
                          {/* Subject header */}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.625rem 1rem", background: "var(--color-surface-2)", borderBottom: "1px solid var(--color-border)", gap: "0.75rem" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", minWidth: 0 }}>
                              <span style={{ fontWeight: 700, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.subject_name}</span>
                              <code style={{ fontSize: "0.69rem", color: "var(--color-muted)", background: "var(--color-surface-3, var(--color-surface))", padding: "0.1rem 0.4rem", borderRadius: 4, whiteSpace: "nowrap" }}>{e.code} · {e.term}</code>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                              <span className={`badge ${gradeBadgeClass(pct)}`}>{pct}% · {letterGrade(pct)}</span>
                              {isSaved && (
                                <span style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.72rem", color: "var(--color-success)", fontWeight: 700 }}>
                                  <CheckCircleIcon width="13" height="13" /> Saved
                                </span>
                              )}
                            </div>
                          </div>

                          <div style={{ padding: "0.875rem 1rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
                            {/* Teacher Remark */}
                            <div>
                              <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-muted)", marginBottom: "0.4rem" }}>
                                🖊 Teacher's Remark
                              </div>
                              <div style={{ display: "flex", gap: "0.625rem", alignItems: "flex-start" }}>
                                <textarea
                                  className="input"
                                  rows={2}
                                  style={{
                                    flex: 1, resize: "vertical", fontSize: "0.875rem", minHeight: 60,
                                    background: isOperator ? "var(--color-surface-2, #f4f4f5)" : "var(--color-surface)",
                                    opacity: isOperator ? 0.7 : 1,
                                  }}
                                  placeholder={isOperator ? "(Read-only — set by teacher)" : `Write teacher's remark for ${e.subject_name}…`}
                                  value={teacherRemarks[e.exam_id] ?? ""}
                                  readOnly={isOperator}
                                  onChange={(ev) => {
                                    if (!isOperator) setTeacherRemarks((prev) => ({ ...prev, [e.exam_id]: ev.target.value }));
                                  }}
                                />
                                {!isOperator && (
                                  <button
                                    className="btn btn-primary btn-sm"
                                    style={{ flexShrink: 0, alignSelf: "flex-end" }}
                                    disabled={savingRemark === e.exam_id}
                                    onClick={() => saveRemark(e.exam_id, "teacher")}
                                  >
                                    {savingRemark === e.exam_id ? "Saving…" : "Save"}
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Principal Remark - always shown, editable only for operator */}
                            <div style={{ paddingTop: "0.75rem", borderTop: "1px dashed var(--color-border)" }}>
                              <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-muted)", marginBottom: "0.4rem" }}>
                                🏫 Principal's Remark
                              </div>
                              <div style={{ display: "flex", gap: "0.625rem", alignItems: "flex-start" }}>
                                <textarea
                                  className="input"
                                  rows={2}
                                  style={{
                                    flex: 1, resize: "vertical", fontSize: "0.875rem", minHeight: 60,
                                    background: !isOperator ? "var(--color-surface-2, #f4f4f5)" : "var(--color-surface)",
                                    opacity: !isOperator ? 0.7 : 1,
                                  }}
                                  placeholder={!isOperator ? "(Read-only — set by principal)" : `Write principal's remark for ${e.subject_name}…`}
                                  value={principalRemarks[e.exam_id] ?? ""}
                                  readOnly={!isOperator}
                                  onChange={(ev) => {
                                    if (isOperator) setPrincipalRemarks((prev) => ({ ...prev, [e.exam_id]: ev.target.value }));
                                  }}
                                />
                                {isOperator && (
                                  <button
                                    className="btn btn-primary btn-sm"
                                    style={{ flexShrink: 0, alignSelf: "flex-end" }}
                                    disabled={savingRemark === e.exam_id}
                                    onClick={() => saveRemark(e.exam_id, "principal")}
                                  >
                                    {savingRemark === e.exam_id ? "Saving…" : "Save"}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "0.25rem", gap: "0.75rem", flexWrap: "wrap" }}>
                <button className="btn btn-ghost btn-sm" onClick={loadExams}>↻ Refresh</button>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                  <button
                    className="btn btn-primary"
                    onClick={() => window.print()}
                    disabled={selectedIds.size === 0}
                  >
                    <DocumentIcon width="16" height="16" />
                    Print Report Card
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── PRINT LAYOUT (only visible on print) ── */}
        <div className="print-only">
          <style dangerouslySetInnerHTML={{ __html: `
            @media print {
              body * { visibility: hidden !important; }
              .overlay  { position: absolute; left: 0; top: 0; margin: 0; padding: 0; background: transparent; }
              .modal    { box-shadow: none; border: none; max-width: none; margin: 0; padding: 0; width: 100%; height: 100%; }
              .print-only, .print-only * { visibility: visible !important; }
              .print-only { position: absolute; left: 0; top: 0; width: 100%; }
              .no-print { display: none !important; }
            }
          `}} />

          {/* Report Card Print Sheet */}
          <div style={{ fontFamily: "Georgia, serif", padding: "2.5rem 3rem", color: "#111", maxWidth: 750, margin: "0 auto" }}>
            {/* School Header */}
            <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", borderBottom: "3px double #111", paddingBottom: "1.25rem", marginBottom: "1.5rem" }}>
              {logo && (
                <img src={logo} alt="School Logo" style={{ width: 80, height: 80, objectFit: "contain", borderRadius: 8 }} />
              )}
              <div style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontSize: "1.5rem", fontWeight: 900, letterSpacing: "0.02em", textTransform: "uppercase" }}>{schoolName}</div>
                <div style={{ fontSize: "0.85rem", color: "#555", marginTop: "0.2rem" }}>Student Progress Report Card</div>
              </div>
              {logo && <div style={{ width: 80 }} />}
            </div>

            {/* Student Info */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem 2rem", marginBottom: "1.75rem", fontSize: "0.9rem", background: "#f9f9f9", padding: "1rem", borderRadius: 8, border: "1px solid #ddd" }}>
              <div><strong>Name:</strong> {student.name}</div>
              <div><strong>Reg. No:</strong> {student.reg_id || "—"}</div>
              <div><strong>Class / Grade:</strong> {student.grade || "—"}</div>
              <div><strong>Date Printed:</strong> {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</div>
            </div>

            {/* Subject Results Table */}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
              <thead>
                <tr style={{ background: "#1e293b", color: "#fff" }}>
                  <th style={{ padding: "0.6rem 0.75rem", textAlign: "left", fontWeight: 700 }}>Subject</th>
                  <th style={{ padding: "0.6rem 0.75rem", textAlign: "center", fontWeight: 700 }}>Score</th>
                  <th style={{ padding: "0.6rem 0.75rem", textAlign: "center", fontWeight: 700 }}>Total</th>
                  <th style={{ padding: "0.6rem 0.75rem", textAlign: "center", fontWeight: 700 }}>%</th>
                  <th style={{ padding: "0.6rem 0.75rem", textAlign: "center", fontWeight: 700 }}>Grade</th>
                  <th style={{ padding: "0.6rem 0.75rem", textAlign: "center", fontWeight: 700 }}>Term</th>
                </tr>
              </thead>
              <tbody>
                {selectedList.map((e, i) => {
                  const pct = scorePct(e.score, e.total_score);
                  const grade = letterGrade(pct);
                  return (
                    <tr key={e.exam_id} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                      <td style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid #e2e8f0", fontWeight: 600 }}>{e.subject_name}</td>
                      <td style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid #e2e8f0", textAlign: "center" }}>{e.score ?? 0}</td>
                      <td style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid #e2e8f0", textAlign: "center" }}>{e.total_score ?? 0}</td>
                      <td style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid #e2e8f0", textAlign: "center", fontWeight: 700 }}>{pct}%</td>
                      <td style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid #e2e8f0", textAlign: "center", fontWeight: 800, color: pct >= 70 ? "#16a34a" : pct >= 50 ? "#d97706" : "#dc2626" }}>{grade}</td>
                      <td style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid #e2e8f0", textAlign: "center", color: "#666" }}>{e.term}</td>
                    </tr>
                  );
                })}
              </tbody>
              {selectedList.length > 1 && (
                <tfoot>
                  <tr style={{ background: "#1e293b", color: "#fff" }}>
                    <td style={{ padding: "0.6rem 0.75rem", fontWeight: 700 }}>Average</td>
                    <td colSpan={3} style={{ padding: "0.6rem 0.75rem", textAlign: "center", fontWeight: 700 }}>—</td>
                    <td style={{ padding: "0.6rem 0.75rem", textAlign: "center", fontWeight: 900, fontSize: "1rem" }}>{avgPct}%</td>
                    <td style={{ padding: "0.6rem 0.75rem", textAlign: "center", fontWeight: 700 }}>{letterGrade(avgPct)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>

            {/* Remarks Section */}
            {selectedList.some(e => teacherRemarks[e.exam_id] || principalRemarks[e.exam_id]) && (
              <div style={{ marginBottom: "1.5rem" }}>
                <div style={{ fontWeight: 800, fontSize: "0.9rem", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "2px solid #111", paddingBottom: "0.4rem", marginBottom: "1rem" }}>
                  Remarks
                </div>
                {selectedList.map((e) => {
                  const tr = teacherRemarks[e.exam_id];
                  const pr = principalRemarks[e.exam_id];
                  if (!tr && !pr) return null;
                  return (
                    <div key={e.exam_id} style={{ marginBottom: "0.875rem" }}>
                      <div style={{ fontWeight: 700, fontSize: "0.85rem" }}>{e.subject_name}:</div>
                      {tr && <div style={{ fontSize: "0.85rem", color: "#333", marginTop: "0.2rem" }}>Teacher: {tr}</div>}
                      {pr && <div style={{ fontSize: "0.85rem", color: "#333", marginTop: "0.2rem" }}>Principal: {pr}</div>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Signature block */}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "3rem", gap: "2rem" }}>
              {["Class Teacher", "Vice Principal", "Principal"].map((role) => (
                <div key={role} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ borderTop: "1.5px solid #555", paddingTop: "0.5rem", fontSize: "0.8rem", color: "#555" }}>{role}</div>
                </div>
              ))}
            </div>

            {/* Stamp / watermark logo */}
            {logo && (
              <div style={{ position: "absolute", bottom: "3rem", right: "3rem", opacity: 0.08, pointerEvents: "none" }}>
                <img src={logo} alt="" style={{ width: 120, height: 120, objectFit: "contain" }} />
              </div>
            )}

            <div style={{ textAlign: "center", marginTop: "2rem", fontSize: "0.72rem", color: "#999" }}>
              Generated by ExamPool · {new Date().toISOString().slice(0, 10)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
