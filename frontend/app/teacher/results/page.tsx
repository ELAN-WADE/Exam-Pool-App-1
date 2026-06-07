"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { ReviewModal } from "../../../components/Teacher/ReviewModal";
import { api } from "../../../lib/api";
import { scorePct, letterGrade, gradeBadgeClass, gradeColor, fmtDate } from "../../../lib/gradeUtils";
import { BarChartIcon, SearchIcon, EyeIcon, ArrowUpIcon, DocumentIcon } from "../../../components/icons/Icons";
import styles from "./page.module.css";

export default function TeacherResultsPage() {
  return (
    <RequireRole role="teacher">
      <TeacherResults />
    </RequireRole>
  );
}

const GRADE_OPTIONS = ["JSS1","JSS2","JSS3","SS1","SS2","SS3","Grade 1","Grade 2","Grade 3","Grade 4","Grade 5","Grade 6","Grade 7","Grade 8","Grade 9","Grade 10","Grade 11","Grade 12"];

function TeacherResults() {
  const [rows,            setRows]            = useState<any[]>([]);
  const [query,           setQuery]           = useState("");
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState("");
  const [toast,           setToast]           = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [gradeModal,      setGradeModal]      = useState<any | null>(null);   // row being promoted/demoted
  const [gradeValue,      setGradeValue]      = useState("");
  const [gradeSaving,     setGradeSaving]     = useState(false);
  const [reviewModal,     setReviewModal]     = useState<any | null>(null);   // row for exam review
  const [reviewData,      setReviewData]      = useState<any | null>(null);
  const [reviewLoading,   setReviewLoading]   = useState(false);
  const printRef                              = useRef<HTMLDivElement>(null);

  const showToast = (type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  };

  const load = async () => {
    try {
      const data = (await api.getResults()) as any[];
      setRows(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load results");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      String(r.student_name || "").toLowerCase().includes(q) ||
      String(r.subject_name || "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const stats = useMemo(() => {
    if (!rows.length) return { total: 0, avg: 0, highest: 0, pass: 0 };
    const scores = rows.map((r) => scorePct(r.score, r.total_score));
    const avg     = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const highest = scores.length > 0 ? Math.round(Math.max(...scores)) : 0;
    const pass    = scores.filter((s) => s >= 50).length;
    return { total: rows.length, avg, highest, pass };
  }, [rows]);

  // PDF print — uses browser print dialog on the result table only
  const handlePdfExport = () => {
    window.print();
  };

  // CSV download
  const handleCsvExport = () => {
    api.exportResultsCsv();
  };

  // Open review
  const openReview = async (row: any) => {
    setReviewModal(row);
    setReviewData(null);
    setReviewLoading(true);
    try {
      const data = await api.getExamReview(Number(row.id)) as any;
      setReviewData(data);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to load review");
      setReviewModal(null);
    } finally {
      setReviewLoading(false);
    }
  };

  // Promote / demote
  const openGradeModal = (row: any) => {
    setGradeModal(row);
    setGradeValue(row.grade || "");
  };

  const saveGrade = async () => {
    if (!gradeModal || !gradeValue.trim()) return;
    setGradeSaving(true);
    try {
      await api.updateStudentGrade(Number(gradeModal.student_user_id), gradeValue.trim());
      showToast("success", `${gradeModal.student_name} moved to ${gradeValue}`);
      setGradeModal(null);
      await load();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to update grade");
    } finally {
      setGradeSaving(false);
    }
  };

  if (loading) return <div className="loadingWrap"><div className="spinner" /></div>;
  if (error)   return <div className={styles.errorBanner}>{error}</div>;

  return (
    <>
      {toast && <div className={`toast ${toast.type === "success" ? "toast-success" : "toast-error"}`}>{toast.text}</div>}

      <div className="pageHeader" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
        <h1 className="pageTitle">Exam Results</h1>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
          <button className="btn btn-ghost" onClick={handleCsvExport}>
            <DocumentIcon width="14" height="14" />
            Export CSV
          </button>
          <button className="btn btn-ghost" onClick={handlePdfExport}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
            Print / PDF
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className={styles.statsRow}>
        {[
          { label: "Total Exams",   value: stats.total,                                                                              color: "#4f7cff" },
          { label: "Average Score", value: `${stats.avg}%`,                                                                         color: "#22c55e" },
          { label: "Highest Score", value: `${stats.highest}%`,                                                                     color: "#f59e0b" },
          { label: "Pass Rate",     value: `${stats.total ? Math.round((stats.pass / stats.total) * 100) : 0}%`,                    color: "#38bdf8" },
        ].map((s) => (
          <div key={s.label} className={styles.statCard}>
            <div className={styles.statValue} style={{ color: s.color }}>{s.value}</div>
            <div className={styles.statLabel}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className={`searchBar ${styles.search}`}>
        <SearchIcon width="14" height="14" />
        <input placeholder="Search by student or subject…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div ref={printRef} className={`card ${styles.tableCard}`}>
        {filtered.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIconWrapper}>
              <BarChartIcon width="48" height="48" />
            </div>
            <p>{query ? "No results match your search." : "No exam results yet."}</p>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Student</th>
                <th>Reg ID</th>
                <th>Subject</th>
                <th>Submitted</th>
                <th>Score</th>
                <th>Grade</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const pct        = scorePct(r.score, r.total_score);
                const grade      = letterGrade(pct);
                const gradeClass = gradeBadgeClass(pct);
                return (
                  <tr key={r.id}>
                    <td>
                      <div className={styles.studentCell}>
                        <div className={styles.avatar}>{String(r.student_name || "?").charAt(0).toUpperCase()}</div>
                        <div>
                          <span style={{ fontWeight: 500 }}>{r.student_name || "—"}</span>
                          <div style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>{r.grade || "—"}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: "0.8rem", color: "var(--color-muted)", fontFamily: "monospace" }}>{r.reg_id || "—"}</td>
                    <td style={{ fontSize: "0.875rem" }}>{r.subject_name || `Subject #${r.subject_id}`}</td>
                    <td style={{ color: "var(--color-muted)", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                      {fmtDate(r.end_time)}
                    </td>
                    <td>
                      <div className={styles.scoreCell}>
                        <span style={{ fontWeight: 600 }}>{r.score ?? 0}</span>
                        <span style={{ color: "var(--color-muted)", fontSize: "0.8rem" }}>/ {Number(r.total_score ?? 0) || "?"}</span>
                        <div className={styles.pctBar}>
                          <div className={styles.pctFill} style={{ width: `${pct}%`, background: gradeColor(pct) }} />
                        </div>
                        <span style={{ fontSize: "0.8rem", color: "var(--color-muted)" }}>{pct}%</span>
                      </div>
                    </td>
                    <td><span className={`badge ${gradeClass}`}>{grade}</span></td>
                    <td>
                      <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => openReview(r)} title="View per-question review">
                          <EyeIcon width="14" height="14" />
                          Review
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => openGradeModal(r)} title="Promote / demote student">
                          <ArrowUpIcon width="14" height="14" />
                          Promote
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Grade / Promote modal */}
      {gradeModal && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setGradeModal(null)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <h2>Promote / Demote Student</h2>
            <p style={{ color: "var(--color-muted)", fontSize: "0.875rem", marginTop: "0.4rem" }}>
              Updating class grade for <strong>{gradeModal.student_name}</strong> (currently: <strong>{gradeModal.grade || "unset"}</strong>)
            </p>
            <div className="field" style={{ marginTop: "1rem" }}>
              <label>New Grade / Class *</label>
              <select className="select" value={gradeValue} onChange={(e) => setGradeValue(e.target.value)}>
                <option value="">Select grade…</option>
                {GRADE_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <input
                className="input"
                style={{ marginTop: "0.5rem" }}
                placeholder="Or type a custom grade…"
                value={gradeValue}
                onChange={(e) => setGradeValue(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", marginTop: "1.25rem" }}>
              <button className="btn btn-ghost" onClick={() => setGradeModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveGrade} disabled={gradeSaving || !gradeValue.trim()}>
                {gradeSaving ? "Saving…" : "Save Grade"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exam Review Modal */}
      {reviewModal && (
        <ReviewModal
          activeSubjectName={reviewModal.subject_name || `Subject #${reviewModal.subject_id}`}
          studentName={reviewModal.student_name}
          reviewData={reviewData}
          reviewLoading={reviewLoading}
          onClose={() => setReviewModal(null)}
          onGradeUpdate={(examId, newTotal) => {
            // Optimistically update the rows list with the new score
            setRows(rows.map(r => {
              if (r.id === examId) {
                return { ...r, score: newTotal };
              }
              return r;
            }));
          }}
        />
      )}
    </>
  );
}
