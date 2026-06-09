"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { ReportCardModal } from "../../../components/teacher/ReportCardModal";
import { api } from "../../../lib/api";
import { SubjectIcon, WarningIcon, EmptyBoxIcon, CalendarIcon, ClockIcon, BookIcon, UsersIcon, DocumentIcon, ClipboardIcon } from "../../../components/icons/Icons";
import { Skeleton } from "../../../components/ui/Skeleton";
import { EmptyState } from "../../../components/ui/EmptyState";
import styles from "./page.module.css";

export default function TeacherDashboardPage() {
  return (
    <RequireRole role="teacher">
      <TeacherDashboard />
    </RequireRole>
  );
}

function TeacherDashboard() {
  const [subjects, setSubjects] = useState<any[]>([]);
  const [questionCounts, setQuestionCounts] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Report card quick-launch: show all students with completed exams
  const [reportStudents, setReportStudents] = useState<any[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportCardStudent, setReportCardStudent] = useState<any | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = (await api.getSubjects()) as any[];
        const subs = data ?? [];
        setSubjects(subs);
        const counts: Record<number, number> = {};
        await Promise.all(
          subs.map(async (s: any) => {
            try {
              const qs = (await api.getQuestions(Number(s.id))) as any[];
              counts[Number(s.id)] = Array.isArray(qs) ? qs.length : 0;
            } catch {
              counts[Number(s.id)] = 0;
            }
          })
        );
        setQuestionCounts(counts);

        // Load students with completed exams across all subjects
        setReportLoading(true);
        const allStudentMap: Record<number, any> = {};
        await Promise.all(
          subs.map(async (s: any) => {
            try {
              const students = (await api.getSubjectStudents(Number(s.id))) as any[];
              for (const st of students ?? []) {
                if (st.exam_status === "completed" && !allStudentMap[st.id]) {
                  allStudentMap[st.id] = st;
                }
              }
            } catch { /* ignore */ }
          })
        );
        setReportStudents(Object.values(allStudentMap));
        setReportLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load subjects");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
          <h1 className="pageTitle">My Subjects</h1>
          <p className="pageSubtitle">Manage your exam content and student results</p>
        </div>
        <div className={styles.pills}>
          <span className={styles.pill}><span className={styles.pillNum}>{subjects.length}</span> Total</span>
          <span className={styles.pill} style={{ '--accent': 'var(--color-success)' } as React.CSSProperties}><span className={styles.pillNum} style={{ color: "var(--color-success)" }}>{published}</span> Live</span>
          <span className={styles.pill} style={{ '--accent': 'var(--color-primary)' } as React.CSSProperties}><span className={styles.pillNum} style={{ color: "var(--color-primary)" }}>{drafts}</span> Draft</span>
        </div>
      </div>

      <div className={styles.grid}>
        {subjects.map((s: any, i: number) => {
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
            onClick={() => window.location.reload()}
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
                key={st.id}
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
                  {String(st.name || "?").charAt(0).toUpperCase()}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.875rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{st.name}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>{st.grade || "—"} · {st.reg_id || ""}</div>
                </div>
                <DocumentIcon width="16" height="16" style={{ color: "var(--color-primary)", flexShrink: 0 }} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
