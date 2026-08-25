"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { ReportCardModal } from "../../../components/teacher/ReportCardModal";
import { api } from "../../../lib/api";
import type { Subject, ExamResult } from "../../../lib/types";
import {
  PageHeader,
  Button,
  ActiveGoldBadge,
} from "../../../components/ui";
import {
  SubjectIcon,
  WarningIcon,
  BookIcon,
  UsersIcon,
  DocumentIcon,
  CheckCircleIcon,
  CrownIcon,
  SparklesIcon,
  ClockIcon,
  ActivityIcon,
  EyeIcon,
} from "../../../components/icons/Icons";
import { useAcademic } from "../../../components/context/AcademicContext";
import { useAuth } from "../../../hooks/useAuth";
import styles from "./page.module.css";

export default function TeacherDashboardPage() {
  return (
    <RequireRole role="teacher">
      <TeacherDashboard />
    </RequireRole>
  );
}

function TeacherDashboard() {
  const { user } = useAuth();
  const isClassTeacher = (user as any)?.is_class_teacher === true;
  const assignedClassName = (user as any)?.assigned_class_name;
  const { selectedSession, selectedTerm, activeSession, activeTerm } = useAcademic();
  const currentTermName = selectedTerm?.name || activeTerm?.name || "First Term";
  const currentSessionName = selectedSession?.name || activeSession?.name || "2026/2027";
  const isCurrentSessionActive = Boolean(selectedSession?.is_active || (activeSession && selectedSession?.id === activeSession?.id));
  const isCurrentTermActive = Boolean(selectedTerm?.is_active || (activeTerm && selectedTerm?.id === activeTerm?.id));

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [questionCounts, setQuestionCounts] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Report card quick-launch
  const [reportStudents, setReportStudents] = useState<ExamResult[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportCardStudent, setReportCardStudent] = useState<ExamResult | null>(null);

  const loadReportStudents = useCallback(async (subs: Subject[], signal?: AbortSignal) => {
    setReportLoading(true);
    const allStudentMap: Record<number, ExamResult> = {};
    if (isClassTeacher && (user as any)?.assigned_class_id) {
      try {
        const roster = await api.getClassRoster(Number((user as any).assigned_class_id), selectedTerm?.id);
        if (!signal?.aborted && Array.isArray(roster)) {
          for (const st of roster) {
            if (st.id && !allStudentMap[st.id]) {
              allStudentMap[st.id] = {
                student_user_id: st.id,
                student_name: st.name,
                grade: st.grade || assignedClassName,
                reg_id: st.reg_id,
                exam_status: "completed",
              } as any;
            }
          }
        }
      } catch { /* ignore */ }
    } else {
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
    }
    if (signal?.aborted) return;
    setReportStudents(Object.values(allStudentMap));
    setReportLoading(false);
  }, [isClassTeacher, (user as any)?.assigned_class_id, assignedClassName, selectedTerm?.id]);

  const subjectsRef = useRef<Subject[]>([]);

  useEffect(() => {
    const abortController = new AbortController();
    const signal = abortController.signal;

    (async () => {
      try {
        setLoading(true);
        const subs = (await api.getSubjectsWithCounts(selectedSession?.id, selectedTerm?.id)) ?? [];
        if (signal.aborted) return;

        const examSubs = subs.filter((s) => s.is_assignment !== 1);
        subjectsRef.current = examSubs;
        setSubjects(examSubs);

        const counts: Record<number, number> = {};
        examSubs.forEach((s) => {
          counts[Number(s.id)] = s.question_count ?? 0;
        });
        setQuestionCounts(counts);
        await loadReportStudents(examSubs, signal);
      } catch (err: any) {
        if (!signal.aborted) setError(err.message || "Failed to load courses");
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    })();
    return () => abortController.abort();
  }, [loadReportStudents, selectedSession?.id, selectedTerm?.id]);

  useEffect(() => {
    const handler = (e: Event) => {
      const notif = (e as CustomEvent).detail;
      if (notif?.type === "exam_submitted") {
        loadReportStudents(subjectsRef.current);
      }
    };
    window.addEventListener("notification_received", handler);
    return () => window.removeEventListener("notification_received", handler);
  }, [loadReportStudents]);

  const published = useMemo(() => subjects.filter((s) => s.is_published).length, [subjects]);
  const drafts = useMemo(() => subjects.filter((s) => !s.is_published).length, [subjects]);

  return (
    <div className={styles.container}>
      {reportCardStudent && (
        <ReportCardModal
          student={reportCardStudent}
          onClose={() => setReportCardStudent(null)}
        />
      )}

      {/* ── Page Header ───────────────────────────────────── */}
      <PageHeader
        eyebrow="Faculty Workspace"
        title="Teacher Dashboard"
        subtitle={`Academic Session ${currentSessionName} · ${currentTermName}`}
        actions={
          isClassTeacher ? (
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <Link href="/teacher/class-grading">
                <Button variant="secondary" size="sm">
                  Grading Center ({assignedClassName || "Class"})
                </Button>
              </Link>
              <Link href="/teacher/report-card">
                <Button variant="primary" size="sm">
                  Report Cards ({assignedClassName || "Class"})
                </Button>
              </Link>
            </div>
          ) : (
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <Link href="/teacher/grading">
                <Button variant="secondary" size="sm">
                  Subject Grading
                </Button>
              </Link>
              <Link href="/teacher/results">
                <Button variant="primary" size="sm">
                  Exam Results
                </Button>
              </Link>
            </div>
          )
        }
      />

      {error && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.875rem 1rem", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: "8px", color: "var(--color-danger, #DC2626)", fontSize: "0.8125rem" }}>
          <WarningIcon width="16" height="16" />
          {error}
        </div>
      )}

      {/* ── Minimalist KPI Metrics Row ──────────────────────── */}
      <section className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Assigned Subjects</span>
            <div className={styles.statIcon} style={{ color: "#06B6D4" }}><BookIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{subjects.length}</div>
            <div className={styles.statFootnote}>Active curriculum courses</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Published Exams</span>
            <div className={styles.statIcon} style={{ color: "#10B981" }}><CheckCircleIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{published}</div>
            <div className={styles.statFootnote}>Live for candidates</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Draft Assessments</span>
            <div className={styles.statIcon} style={{ color: "#6366F1" }}><SubjectIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{drafts}</div>
            <div className={styles.statFootnote}>Under authoring</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Faculty Assignment</span>
            <div className={styles.statIcon} style={{ color: "#8B5CF6" }}><UsersIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue} style={{ fontSize: "1.125rem", textTransform: "none" }}>
              {isClassTeacher ? assignedClassName : "Subject Teacher"}
            </div>
            <div className={styles.statFootnote}>{isClassTeacher ? "Class Teacher" : "Course Faculty"}</div>
          </div>
        </div>
      </section>

      {/* ── Operational Status Banner ──────────────────────────── */}
      <section className={styles.statusBanner}>
        <div className={styles.statusLeft}>
          <div className={styles.statusPillGroup}>
            <span className={styles.termTag}>{currentTermName}</span>
            <span className={styles.roleTag}>{isClassTeacher ? `Class Master: ${assignedClassName || "Assigned"}` : "Course Faculty"}</span>
          </div>
          <h2 className={styles.statusTitle}>Academic Cycle {currentSessionName}</h2>
          <p className={styles.statusSubtitle}>
            Manage question banks, verify candidate submissions, and process marks for scheduled evaluations.
          </p>
        </div>

        <div className={styles.bannerActions}>
          {isClassTeacher ? (
            <Link href="/teacher/class-grading">
              <Button variant="secondary" size="sm">
                Broadsheet Remarks
              </Button>
            </Link>
          ) : (
            <Link href="/teacher/grading">
              <Button variant="secondary" size="sm">
                Subject Gradebook
              </Button>
            </Link>
          )}
        </div>
      </section>

      {/* ── Assigned Courses Section ───────────────────────────── */}
      <section style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Assigned Subjects & Question Banks</h3>
          <span className={styles.sectionCount}>{subjects.length} courses</span>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "3rem", color: "var(--color-muted)", fontSize: "0.8125rem" }}>
            Loading course overview…
          </div>
        ) : subjects.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem", background: "var(--color-surface)", border: "1px dashed var(--color-border)", borderRadius: "12px", color: "var(--color-muted)", fontSize: "0.8125rem" }}>
            No subjects assigned yet. Contact your administrator for course allocation.
          </div>
        ) : (
          <div className={styles.courseGrid}>
            {subjects.map((s) => {
              const qCount = questionCounts[Number(s.id)] ?? 0;
              const isLive = Boolean(s.is_published);
              return (
                <div key={s.id} className={styles.courseCard}>
                  <div className={styles.courseCardTop}>
                    <div>
                      <div className={styles.courseName}>{s.name}</div>
                      <div style={{ marginTop: "0.25rem", display: "flex", gap: "0.35rem" }}>
                        <span className={styles.codeBadge}>{s.code}</span>
                        {s.class && <span className={styles.codeBadge}>{s.class}</span>}
                      </div>
                    </div>
                    <span className={`${styles.statusTag} ${isLive ? styles.statusLive : styles.statusDraft}`}>
                      {isLive ? "Live" : "Draft"}
                    </span>
                  </div>

                  <div className={styles.courseMetaGrid}>
                    <div className={styles.metaItem}>
                      <div className="flex items-center gap-1">
                        <BookIcon width="11" height="11" style={{ color: "#0891B2" }} />
                        <span className={styles.metaLabel}>Item Bank</span>
                      </div>
                      <span className={styles.metaValue}>{qCount} Questions</span>
                    </div>
                    <div className={styles.metaItem}>
                      <div className="flex items-center gap-1">
                        <CheckCircleIcon width="11" height="11" style={{ color: "#059669" }} />
                        <span className={styles.metaLabel}>Total Marks</span>
                      </div>
                      <span className={styles.metaValue}>{s.total_score ?? 0} Pts</span>
                    </div>
                    <div className={styles.metaItem}>
                      <div className="flex items-center gap-1">
                        <ClockIcon width="11" height="11" style={{ color: "#EA580C" }} />
                        <span className={styles.metaLabel}>Duration</span>
                      </div>
                      <span className={styles.metaValue}>{s.duration || 60} min</span>
                    </div>
                    <div className={styles.metaItem}>
                      <div className="flex items-center gap-1">
                        <ActivityIcon width="11" height="11" style={{ color: "#7C3AED" }} />
                        <span className={styles.metaLabel}>Assessment</span>
                      </div>
                      <span className={styles.metaValue}>{(s.mode || "exam").toUpperCase()}</span>
                    </div>
                  </div>

                  <div className={styles.courseActions}>
                    <Link
                      href={`/teacher/questions?subjectId=${s.id}${!isLive ? "&action=create" : ""}`}
                      className={styles.primaryActionBtn}
                    >
                      {isLive ? "View Questions" : "Manage Questions"}
                    </Link>
                    <Link
                      href={`/teacher/grading`}
                      className={styles.secondaryActionBtn}
                      title="Subject Gradebook"
                    >
                      <SubjectIcon width="13" height="13" style={{ color: "#06B6D4" }} />
                    </Link>
                    <Link
                      href={`/teacher/students?subjectId=${s.id}`}
                      className={styles.secondaryActionBtn}
                      title="Enrolled Candidates"
                    >
                      <UsersIcon width="13" height="13" style={{ color: "#7C3AED" }} />
                    </Link>
                    <Link
                      href={`/teacher/results?subjectId=${s.id}`}
                      className={styles.secondaryActionBtn}
                      title="Results & Analytics"
                    >
                      <EyeIcon width="13" height="13" style={{ color: "#0891B2" }} />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>


      {/* ── Recent Candidate Submissions / Report Cards ────────── */}
      <section className={styles.reportCardContainer}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
          <div>
            <h3 className={styles.sectionTitle}>Completed Submissions & Report Preview</h3>
            <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", marginTop: "0.15rem" }}>
              {isClassTeacher
                ? `Submitted examination results for ${assignedClassName || "your class"}. Click to inspect individual cards.`
                : "Recent exam submissions from your assigned subjects."}
            </div>
          </div>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => loadReportStudents(subjectsRef.current)}
          >
            Refresh
          </Button>
        </div>

        {reportLoading ? (
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--color-muted)", fontSize: "0.8125rem" }}>
            Checking submissions…
          </div>
        ) : reportStudents.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--color-muted)", fontSize: "0.8125rem", background: "var(--color-surface-2)", borderRadius: "8px" }}>
            No candidate submissions recorded yet for this session.
          </div>
        ) : (
          <div className={styles.studentGrid}>
            {reportStudents.map((st) => (
              <div
                key={st.student_user_id}
                className={styles.studentCard}
                onClick={() => setReportCardStudent(st)}
              >
                <div className={styles.studentAvatar}>
                  {String(st.student_name || "?").charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--color-text)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                    {st.student_name}
                  </div>
                  <div style={{ fontSize: "0.6875rem", color: "var(--color-muted)" }}>
                    {st.grade || "General"} · {st.reg_id || ""}
                  </div>
                </div>
                <DocumentIcon width="13" height="13" style={{ color: "var(--color-muted)" }} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
