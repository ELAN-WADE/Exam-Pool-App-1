"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useState, useRef } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { ReportCardModal } from "../../../components/teacher/ReportCardModal";
import { api } from "../../../lib/api";
import type { Subject, ExamResult, User } from "../../../lib/types";
import { SubjectIcon, WarningIcon, EmptyBoxIcon, CalendarIcon, ClockIcon, BookIcon, UsersIcon, DocumentIcon, ClipboardIcon, PlusIcon } from "../../../components/icons/Icons";
import { Skeleton } from "../../../components/ui/Skeleton";
import { EmptyState } from "../../../components/ui/EmptyState";
import { useToast } from "../../../hooks/useToast";
import dynamic from "next/dynamic";
import styles from "./page.module.css";

const Modal = dynamic(() => import("../../../components/ui/Modal").then(mod => mod.Modal), { ssr: false });

export default function TeacherDashboardPage() {
  return (
    <RequireRole role="teacher">
      <TeacherDashboard />
    </RequireRole>
  );
}

function TeacherDashboard() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [questionCounts, setQuestionCounts] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Report card quick-launch: show all students with completed exams
  const [reportStudents, setReportStudents] = useState<ExamResult[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportCardStudent, setReportCardStudent] = useState<ExamResult | null>(null);

  // ── Create Assessment State ─────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", term: "", duration: "60", mode: "test", is_assignment: false });
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  const handleCreateAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createSubject({
        name: form.name,
        code: form.code,
        term: form.term,
        duration: Number(form.duration),
        exam_datetime: "", 
        teacher_id: 0, 
        mode: form.mode,
        is_assignment: form.is_assignment ? 1 : 0,
        can_retake: 1,
      });
      showToast("Successfully created assessment", "success");
      setModalOpen(false);
      setForm({ name: "", code: "", term: "", duration: "60", mode: "test", is_assignment: false });
      
      const subs = await api.getSubjects();
      if (subs) {
        subjectsRef.current = subs;
        setSubjects(subs);
      }
    } catch (err: any) {
      showToast(err.message || "Failed to create assessment", "error");
    } finally {
      setSaving(false);
    }
  };

  // ── Fetch report-card students (re-used on live refresh) ──────────────
  const loadReportStudents = useCallback(async (subs: Subject[], signal?: AbortSignal) => {
    setReportLoading(true);
    const allStudentMap: Record<number, ExamResult> = {};
    await Promise.all(
      subs.map(async (s) => {
        try {
          if (signal?.aborted) return;
          const students = await api.getSubjectStudents(Number(s.id));
          if (signal?.aborted) return;
          for (const st of students ?? []) {
            if (st.exam_status === "completed" && st.student_user_id && !allStudentMap[st.student_user_id]) {
              allStudentMap[st.student_user_id] = st as any;
            }
          }
        } catch { /* ignore */ }
      })
    );
    if (signal?.aborted) return;
    setReportStudents(Object.values(allStudentMap));
    setReportLoading(false);
  }, []);

  // ── Initial data load ──────────────────────────────────────────────
  const subjectsRef = useRef<Subject[]>([]);

  useEffect(() => {
    const abortController = new AbortController();
    const signal = abortController.signal;

    (async () => {
      try {
        const subs = await api.getSubjects() ?? [];
        if (signal.aborted) return;
        
        subjectsRef.current = subs;
        setSubjects(subs);
        const counts: Record<number, number> = {};
        await Promise.all(
          subs.map(async (s) => {
            try {
              if (signal.aborted) return;
              const qs = await api.getQuestions(Number(s.id));
              if (signal.aborted) return;
              counts[Number(s.id)] = Array.isArray(qs) ? qs.length : 0;
            } catch {
              counts[Number(s.id)] = 0;
            }
          })
        );
        if (signal.aborted) return;
        setQuestionCounts(counts);
        await loadReportStudents(subs, signal);
      } catch (err: any) {
        if (!signal.aborted) setError(err.message || "Failed to load subjects");
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    })();
    return () => abortController.abort();
  }, [loadReportStudents]);

  // ── Live-update: listen for exam_submitted SSE events ─────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const notif = (e as CustomEvent).detail;
      if (notif?.type === "exam_submitted") {
        // Silently refresh the report card section
        loadReportStudents(subjectsRef.current);
      }
    };
    window.addEventListener("notification_received", handler);
    return () => window.removeEventListener("notification_received", handler);
  }, [loadReportStudents]);

  if (loading) return (
    <>
      <div className="pageHeader animate-enter">
        <Skeleton width={200} height={36} />
        <div className={styles.pills}>
          <Skeleton width={72} height={28} borderRadius={999} />
          <Skeleton width={72} height={28} borderRadius={999} />
          <Skeleton width={72} height={28} borderRadius={999} />
        </div>
      </div>
      <div className={styles.grid}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={300} borderRadius="var(--radius-xl)" className="animate-enter" style={{ animationDelay: `${i * 50}ms` }} />
        ))}
      </div>
    </>
  );

  if (error) return (
    <div className={styles.errorState}>
      <WarningIcon width="40" height="40" />
      <p>{error}</p>
    </div>
  );

  if (subjects.length === 0) {
    return (
      <div className="animate-enter">
        <EmptyState
          title="No Subjects Assigned"
          description="You don't have any subjects yet. Contact your operator to get assigned."
          icon={<EmptyBoxIcon width="32" height="32" />}
        />
      </div>
    );
  }

  const published = subjects.filter((s) => s.is_published).length;
  const drafts = subjects.filter((s) => !s.is_published).length;

  return (
    <>
      {/* Report Card Modal */}
      {reportCardStudent && (
        <ReportCardModal
          student={reportCardStudent}
          onClose={() => setReportCardStudent(null)}
        />
      )}

      <div className="pageHeader">
        <div>
          <h1 className="pageTitle">My Subjects & Assessments</h1>
          <p className="pageSubtitle">Manage your exam content and student results</p>
        </div>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <div className={styles.pills}>
            <span className={styles.pill}><span className={styles.pillNum}>{subjects.length}</span> Total</span>
            <span className={styles.pill} style={{ '--accent': 'var(--color-success)' } as React.CSSProperties}><span className={styles.pillNum} style={{ color: "var(--color-success)" }}>{published}</span> Live</span>
            <span className={styles.pill} style={{ '--accent': 'var(--color-primary)' } as React.CSSProperties}><span className={styles.pillNum} style={{ color: "var(--color-primary)" }}>{drafts}</span> Draft</span>
          </div>
          <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
            <PlusIcon width="16" height="16" /> Create Assessment
          </button>
        </div>
      </div>

      <div className={styles.grid}>
        {subjects.map((s, i: number) => {
          const qCount = questionCounts[Number(s.id)] ?? "…";
          const isLive = Boolean(s.is_published);
          return (
            <div key={s.id} className={`${styles.card} ${isLive ? styles.cardLive : styles.cardDraft} animate-enter`} style={{ animationDelay: `${i * 50}ms` }}>
              {/* Top Status Strip */}
              <div className={styles.cardTopStrip} />

              {/* Card Header */}
              <div className={styles.cardHeader}>
                <div className={styles.subjectIconBox}>
                  <SubjectIcon width="18" height="18" />
                </div>
                <span className={`badge ${isLive ? "badge-success" : "badge-muted"}`}>
                  {isLive ? "● Live" : "Draft"}
                </span>
                {s.is_assignment === 1 ? (
                   <span className="badge badge-info" style={{ marginLeft: "0.5rem", background: "rgba(14, 165, 233, 0.1)", color: "var(--color-info)" }}>Assignment</span>
                ) : s.mode === "test" || s.mode === "quiz" ? (
                   <span className="badge badge-warning" style={{ marginLeft: "0.5rem", background: "rgba(245, 158, 11, 0.1)", color: "var(--color-warning)" }}>{s.mode.charAt(0).toUpperCase() + s.mode.slice(1)}</span>
                ) : (
                   <span className="badge badge-primary" style={{ marginLeft: "0.5rem", background: "rgba(79, 124, 255, 0.1)", color: "var(--color-primary)" }}>Exam</span>
                )}
              </div>

              {/* Card Body */}
              <div className={styles.cardBody}>
                <h3 className={styles.subjectName}>{s.name}</h3>
                <div className={styles.codeRow}>
                  <code className={styles.code}>{s.code}</code>
                  <code className={styles.code}>Term {s.term}</code>
                </div>

                <div className={styles.meta}>
                  <div className={styles.metaRow}>
                    <CalendarIcon width="12" height="12" />
                    {s.exam_datetime
                      ? new Date(s.exam_datetime).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
                      : "Date TBA"}
                  </div>
                  <div className={styles.metaRow}>
                    <ClockIcon width="12" height="12" />
                    {s.duration} min duration
                  </div>
                </div>

                <div className={styles.metaBadges}>
                  <span className={styles.metaBadge}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    {qCount} Qs
                  </span>
                  <span className={styles.metaBadge}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    {s.total_score ?? 0} Marks
                  </span>
                  {isLive && (
                    <span className={styles.metaBadge} style={{ color: "var(--color-warning)" }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                      Locked
                    </span>
                  )}
                </div>
              </div>

              {/* Card Actions */}
              <div className={styles.cardActions}>
                <Link
                  href={`/teacher/questions?subjectId=${s.id}${!isLive ? "&action=create" : ""}`}
                  className={`btn btn-primary ${styles.actionBtn}`}
                >
                  {isLive ? "View Questions" : "Manage Questions"}
                </Link>
                <div className={styles.actionRow}>
                  <Link href={`/teacher/students?subjectId=${s.id}`} className={`btn btn-ghost ${styles.actionBtnSm}`}>
                    <UsersIcon width="12" height="12" /> Students
                  </Link>
                  <Link href="/teacher/results" className={`btn btn-ghost ${styles.actionBtnSm}`}>
                    <BookIcon width="12" height="12" /> Results
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Report Cards Section ── */}
      <div style={{ marginTop: "2.5rem" }}>
        <div className="pageHeader" style={{ marginBottom: "1rem" }}>
          <div>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 800, margin: 0 }}>Report Cards</h2>
            <p style={{ color: "var(--color-muted)", fontSize: "0.875rem", marginTop: "0.25rem" }}>
              Generate and print report cards for students who have completed exams
            </p>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => loadReportStudents(subjectsRef.current)}
            title="Refresh to see newly completed exams"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 12a9 9 0 009-9 9 9 0 015.657 2.343"/>
              <polyline points="21 3 21 9 15 9"/>
              <path d="M21 12a9 9 0 01-9 9 9 9 0 01-5.657-2.343"/>
            </svg>
            Refresh
          </button>
        </div>

        {reportLoading ? (
          <div style={{ display: "flex", gap: "1rem" }}>
            {[1, 2, 3].map((i) => <Skeleton key={i} width={200} height={80} borderRadius={12} />)}
          </div>
        ) : reportStudents.length === 0 ? (
          <div style={{
            background: "var(--color-surface)",
            border: "1.5px dashed var(--color-border)",
            borderRadius: 12,
            padding: "2.5rem",
            textAlign: "center",
            color: "var(--color-muted)",
          }}>
            <div style={{ marginBottom: "0.75rem", color: "var(--color-muted)" }}>
              <ClipboardIcon width="40" height="40" style={{ margin: "0 auto", opacity: 0.5 }} />
            </div>
            <p style={{ fontWeight: 600, margin: "0 0 0.25rem" }}>No completed exams yet</p>
            <p style={{ fontSize: "0.875rem", margin: 0 }}>Students who have submitted exams will appear here for report card generation.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.875rem" }}>
            {reportStudents.map((st) => (
              <div
                key={st.student_user_id}
                style={{
                  background: "var(--color-surface)",
                  border: "1.5px solid var(--color-border)",
                  borderRadius: 12,
                  padding: "1rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.875rem",
                  cursor: "pointer",
                  transition: "border-color 0.15s, box-shadow 0.15s",
                }}
                onClick={() => setReportCardStudent(st)}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-primary)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 16px rgba(79,124,255,0.12)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-border)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "none"; }}
              >
                <div style={{
                  width: 42, height: 42, borderRadius: "50%",
                  background: "var(--color-primary)", color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 800, fontSize: "1rem", flexShrink: 0,
                }}>
                  {String(st.student_name || "?").charAt(0).toUpperCase()}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.875rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{st.student_name}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>{st.grade || "—"} · {st.reg_id || ""}</div>
                </div>
                <DocumentIcon width="16" height="16" style={{ color: "var(--color-primary)", flexShrink: 0 }} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Create Assessment Modal ── */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} size="md">
        <h2>Create Assessment</h2>
        <p style={{ color: "var(--color-muted)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>Create a class test, quiz, or a take-home assignment.</p>
        <form onSubmit={handleCreateAssessment} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div className="field">
              <label>Name *</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Week 1 Quiz" required />
            </div>
            <div className="field">
              <label>Code *</label>
              <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. MTH101-Q1" required />
            </div>
            <div className="field">
              <label>Term *</label>
              <input className="input" value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} placeholder="e.g. 2026-T1" required />
            </div>
            <div className="field">
              <label>Duration (mins) *</label>
              <input className="input" type="number" min={1} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} required />
            </div>
          </div>
          
          <div className="field">
            <label>Assessment Type *</label>
            <select className="select" value={form.is_assignment ? "assignment" : form.mode} onChange={(e) => {
              const val = e.target.value;
              if (val === "assignment") {
                setForm({ ...form, mode: "test", is_assignment: true });
              } else {
                setForm({ ...form, mode: val, is_assignment: false });
              }
            }}>
              <option value="test">Class Test (Tier 2)</option>
              <option value="quiz">Class Quiz (Tier 2)</option>
              <option value="assignment">Take-Home Assignment (Tier 3)</option>
            </select>
            <div style={{ padding: "0.75rem", marginTop: "0.75rem", background: "var(--color-surface-2)", borderRadius: "var(--radius-md)", fontSize: "0.85rem", color: "var(--color-muted)" }}>
              {form.is_assignment 
                ? "📚 Students will download this assignment to their app and complete it offline at home." 
                : "💻 Students will take this assessment in class using the school Wi-Fi network."}
            </div>
          </div>

          <div className="modal-actions" style={{ marginTop: "1rem" }}>
            <button type="button" className="btn btn-ghost" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Creating..." : "Create Assessment"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
