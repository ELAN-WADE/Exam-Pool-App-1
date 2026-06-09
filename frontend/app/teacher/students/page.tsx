"use client";

import { useEffect, useMemo, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { RequireRole } from "../../../components/auth/RequireRole";
import { ReviewModal } from "../../../components/teacher/ReviewModal";
import { api } from "../../../lib/api";
import { scorePct, letterGrade, gradeBadgeClass, gradeColor } from "../../../lib/gradeUtils";
import { UsersIcon, SearchIcon, ArrowUpIcon, EyeIcon, DocumentIcon } from "../../../components/icons/Icons";
import styles from "./page.module.css";

const GRADE_OPTIONS = [
  "JSS1","JSS2","JSS3","SS1","SS2","SS3",
  "Grade 1","Grade 2","Grade 3","Grade 4","Grade 5","Grade 6",
  "Grade 7","Grade 8","Grade 9","Grade 10","Grade 11","Grade 12",
];

export default function TeacherStudentsPage() {
  return (
    <RequireRole role="teacher">
      <Suspense fallback={<div className="loadingWrap"><div className="spinner" /></div>}>
        <StudentRoster />
      </Suspense>
    </RequireRole>
  );
}

function StudentRoster() {
  const params = useSearchParams();
  const subjectId = Number(params.get("subjectId") ?? 0);

  const [students,    setStudents]    = useState<any[]>([]);
  const [subjects,    setSubjects]    = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState("");
  const [query,       setQuery]       = useState("");
  const [toast,       setToast]       = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [gradeModal,  setGradeModal]  = useState<any | null>(null);
  const [gradeValue,  setGradeValue]  = useState("");
  const [gradeSaving, setGradeSaving] = useState(false);
  const [reviewModal,   setReviewModal]   = useState<any | null>(null);
  const [reviewData,    setReviewData]    = useState<any | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  const activeSubjectId = subjectId > 0 ? subjectId : (subjects[0]?.id ?? 0);

  const showToast = (type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  };

  const loadStudents = useCallback(async (sid: number) => {
    if (!sid) return;
    try {
      const data = (await api.getSubjectStudents(sid)) as any[];
      setStudents(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load students");
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const subs = (await api.getSubjects()) as any[];
        if (!mounted) return;
        setSubjects(subs ?? []);
        const sid = subjectId > 0 ? subjectId : Number(subs[0]?.id ?? 0);
        if (sid) await loadStudents(sid);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [subjectId, loadStudents]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) => String(s.name || "").toLowerCase().includes(q) ||
             String(s.reg_id || "").toLowerCase().includes(q) ||
             String(s.grade || "").toLowerCase().includes(q),
    );
  }, [students, query]);

  const stats = useMemo(() => {
    const taken = students.filter((s) => s.exam_status === "completed");
    const pcts  = taken.map((s) => scorePct(s.score, s.total_score));
    const avg   = pcts.length === 0 ? 0 : Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
    const pass  = pcts.filter((p) => p >= 50).length;
    return { total: students.length, taken: taken.length, avg, pass };
  }, [students]);

  const openGrade = (row: any) => {
    setGradeModal(row);
    setGradeValue(row.grade || "");
  };

  const saveGrade = async () => {
    if (!gradeModal || !gradeValue.trim()) return;
    setGradeSaving(true);
    try {
      await api.updateStudentGrade(Number(gradeModal.id), gradeValue.trim());
      showToast("success", `${gradeModal.name} moved to ${gradeValue}`);
      setGradeModal(null);
      await loadStudents(activeSubjectId);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to update grade");
    } finally {
      setGradeSaving(false);
    }
  };

  const openReview = async (row: any) => {
    if (!row.exam_status || row.exam_status !== "completed") return;
    setReviewModal(row);
    setReviewData(null);
    setReviewLoading(true);
    try {
      // exam_id is now included directly in the roster row from the server
      const examId = Number(row.exam_id);
      if (!examId) { showToast("error", "Exam record not found"); setReviewModal(null); return; }
      const data = await api.getExamReview(examId) as any;
      setReviewData(data);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to load review");
      setReviewModal(null);
    } finally {
      setReviewLoading(false);
    }
  };

  if (loading) return <div className="loadingWrap"><div className="spinner" /></div>;
  if (error)   return <div style={{ padding: "2rem", color: "var(--color-danger)" }}>{error}</div>;

  const activeSubject = subjects.find((s) => Number(s.id) === activeSubjectId);

  return (
    <>
      {toast && <div className={`toast ${toast.type === "success" ? "toast-success" : "toast-error"}`}>{toast.text}</div>}

      {/* Header */}
      <div className="pageHeader" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h1 className="pageTitle">Student Roster</h1>
          {activeSubject && (
            <p style={{ color: "var(--color-muted)", fontSize: "0.875rem", marginTop: "0.25rem" }}>
              {activeSubject.name} · <code style={{ fontSize: "0.8rem" }}>{activeSubject.code}</code> · Term: {activeSubject.term}
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            className="btn btn-ghost"
            onClick={() => loadStudents(activeSubjectId)}
            title="Refresh to see newly completed exams"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 12a9 9 0 009-9 9 9 0 015.657 2.343"/>
              <polyline points="21 3 21 9 15 9"/>
              <path d="M21 12a9 9 0 01-9 9 9 9 0 01-5.657-2.343"/>
            </svg>
            Refresh
          </button>
          <Link href="/Teacher/dashboard" className="btn btn-ghost">← Back</Link>
        </div>
      </div>

      {/* Subject Tabs */}
      {subjects.length > 1 && (
        <div className={styles.tabs}>
          {subjects.map((s) => (
            <Link
              key={s.id}
              href={`/Teacher/students?subjectId=${s.id}`}
              className={`${styles.tab} ${Number(s.id) === activeSubjectId ? styles.tabActive : ""}`}
            >
              {s.name}
            </Link>
          ))}
        </div>
      )}

      {/* Stats */}
      <div className={styles.statsRow}>
        {[
          { label: "Enrolled",    value: stats.total, color: "#4f7cff" },
          { label: "Attempted",   value: stats.taken, color: "#a78bfa" },
          { label: "Avg Score",   value: `${stats.avg}%`, color: "#22c55e" },
          { label: "Pass Rate",   value: stats.taken > 0 ? `${Math.round((stats.pass / stats.taken) * 100)}%` : "—", color: "#f59e0b" },
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
        <input placeholder="Search by name, reg ID or grade…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {/* Table */}
      <div className={`card ${styles.tableCard}`}>
        {filtered.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIconWrapper}>
              <UsersIcon width="48" height="48" />
            </div>
            <p>{query ? "No students match your search." : "No students enrolled in this subject yet. Ask the operator to enroll students."}</p>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Student</th>
                <th>Reg ID</th>
                <th>Grade / Class</th>
                <th>Enrolled</th>
                <th>Score</th>
                <th>Letter</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const pct        = scorePct(row.score, row.total_score);
                const letter     = letterGrade(pct);
                const hasExam    = row.exam_status === "completed";
                const gradeClass = hasExam ? gradeBadgeClass(pct) : "badge-muted";
                return (
                  <tr key={row.id}>
                    <td>
                      <div className={styles.studentCell}>
                        <div className={styles.avatar}>{String(row.name || "?").charAt(0).toUpperCase()}</div>
                        <div>
                          <span style={{ fontWeight: 500 }}>{row.name || "—"}</span>
                          <div style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>{row.email || ""}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "var(--color-muted)" }}>{row.reg_id || "—"}</td>
                    <td>
                      <span style={{ fontWeight: 500 }}>{row.grade || "—"}</span>
                    </td>
                    <td style={{ color: "var(--color-muted)", fontSize: "0.8rem" }}>
                      {row.enrolled_at ? new Date(row.enrolled_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                    </td>
                    <td>
                      {hasExam ? (
                        <div className={styles.scoreCell}>
                          <span style={{ fontWeight: 600 }}>{row.score ?? 0}</span>
                          <span style={{ color: "var(--color-muted)", fontSize: "0.8rem" }}>/ {Number(row.total_score ?? 0) || "?"}</span>
                          <div className={styles.pctBar}>
                            <div className={styles.pctFill} style={{ width: `${pct}%`, background: gradeColor(pct) }} />
                          </div>
                          <span style={{ fontSize: "0.78rem", color: "var(--color-muted)" }}>{pct}%</span>
                        </div>
                      ) : (
                        <span style={{ color: "var(--color-muted)", fontSize: "0.8rem" }}>—</span>
                      )}
                    </td>
                    <td>
                      {hasExam
                        ? <span className={`badge ${gradeClass}`}>{letter}</span>
                        : <span className="badge badge-muted">—</span>
                      }
                    </td>
                    <td>
                      {hasExam
                        ? <span className="badge badge-success">Completed</span>
                        : <span className="badge badge-info">Pending</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Grade / Promote Modal */}
      {gradeModal && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setGradeModal(null)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <h2>Promote / Demote Student</h2>
            <p style={{ color: "var(--color-muted)", fontSize: "0.875rem", marginTop: "0.4rem" }}>
              Updating class grade for <strong>{gradeModal.name}</strong> (currently: <strong>{gradeModal.grade || "unset"}</strong>)
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
          activeSubjectName={activeSubject?.name || ""}
          studentName={reviewModal.name}
          reviewData={reviewData}
          reviewLoading={reviewLoading}
          onClose={() => setReviewModal(null)}
          onGradeUpdate={(examId, newTotal) => {
            // Optimistically update the students list with the new score
            setStudents(students.map(s => {
              if (s.exam_id === examId) {
                return { ...s, score: newTotal };
              }
              return s;
            }));
          }}
        />
      )}


    </>
  );
}
