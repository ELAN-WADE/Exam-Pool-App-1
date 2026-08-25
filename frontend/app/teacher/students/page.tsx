"use client";

import React, { useEffect, useMemo, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { RequireRole } from "../../../components/auth/RequireRole";
import { ReviewModal } from "../../../components/teacher/ReviewModal";
import { useAcademic } from "../../../components/context/AcademicContext";
import { api } from "../../../lib/api";
import type { EnrolledStudent, Subject } from "../../../lib/types";
import { scorePct, letterGrade } from "../../../lib/gradeUtils";
import {
  PageHeader,
  FilterBar,
  Table,
  type TableColumn,
  Button,
} from "../../../components/ui";
import {
  UsersIcon,
  CheckCircleIcon,
  ClockIcon,
  BookIcon,
} from "../../../components/icons/Icons";
import styles from "./page.module.css";

export default function TeacherStudentsPage() {
  return (
    <RequireRole role="teacher">
      <Suspense fallback={<div className="p-6">Loading student roster...</div>}>
        <StudentRoster />
      </Suspense>
    </RequireRole>
  );
}

function StudentRoster() {
  const params = useSearchParams();
  const subjectId = Number(params.get("subjectId") ?? 0);

  const [students, setStudents] = useState<EnrolledStudent[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const { selectedSession, selectedTerm, activeSession, activeTerm } = useAcademic();
  const currentSessionName = selectedSession?.name || activeSession?.name || "2026/2027";
  const currentTermName = selectedTerm?.name || activeTerm?.name || "First Term";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedSubjectId, setSelectedSubjectId] = useState<number>(0);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [reviewModal, setReviewModal] = useState<any | null>(null);
  const [reviewData, setReviewData] = useState<any | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  const showToast = (type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  };

  const loadStudents = useCallback(async (sid: number, signal?: AbortSignal) => {
    if (!sid) return;
    try {
      const data = (await api.getSubjectStudents(sid)) as EnrolledStudent[];
      if (signal?.aborted) return;
      setStudents(data ?? []);
    } catch (err) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : "Failed to load students");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;

    (async () => {
      try {
        setLoading(true);
        const subs = (await api.getSubjects(selectedSession?.id, selectedTerm?.id)) as Subject[];
        if (signal.aborted) return;
        setSubjects(subs ?? []);

        const sid = subjectId > 0 ? subjectId : Number(subs[0]?.id ?? 0);
        setSelectedSubjectId(sid);
        if (sid) await loadStudents(sid, signal);
      } catch (err) {
        if (!signal.aborted) setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [subjectId, selectedSession?.id, selectedTerm?.id, loadStudents]);

  const activeSubject = useMemo(() => {
    return subjects.find((s) => s.id === selectedSubjectId) || subjects[0];
  }, [subjects, selectedSubjectId]);

  const handleSubjectChange = (newId: number) => {
    setSelectedSubjectId(newId);
    loadStudents(newId);
  };

  const filteredStudents = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return students;
    return students.filter(
      (st) =>
        st.name?.toLowerCase().includes(q) ||
        st.email?.toLowerCase().includes(q) ||
        st.reg_id?.toLowerCase().includes(q) ||
        st.grade?.toLowerCase().includes(q)
    );
  }, [students, query]);

  const openReview = async (st: EnrolledStudent) => {
    setReviewModal(st);
    setReviewLoading(true);
    try {
      const res = await api.getExamByStudentSubject(st.id, selectedSubjectId);
      if (res?.id) {
        const detail = await api.getExamReview(res.id);
        setReviewData(detail);
      } else {
        setReviewData(null);
      }
    } catch {
      showToast("error", "Could not load exam attempt details");
    } finally {
      setReviewLoading(false);
    }
  };

  const completedCount = useMemo(() => students.filter((s) => s.exam_status === "completed").length, [students]);
  const inProgressCount = useMemo(() => students.filter((s) => s.exam_status === "in_progress").length, [students]);
  const notStartedCount = useMemo(() => students.filter((s) => !s.exam_status || s.exam_status === "not_started").length, [students]);

  const columns: TableColumn<EnrolledStudent>[] = [
    {
      key: "name",
      header: "Candidate Name",
      sortable: true,
      render: (st) => (
        <div className={styles.candidateCell}>
          <div className={styles.avatar}>{String(st.name || "?").charAt(0).toUpperCase()}</div>
          <div>
            <div style={{ fontWeight: 600, color: "var(--color-text)", fontSize: "0.8125rem" }}>{st.name}</div>
            <div style={{ fontSize: "0.6875rem", color: "var(--color-muted)", fontFamily: "var(--font-mono, monospace)" }}>
              {st.reg_id || st.email}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "grade",
      header: "Class / Cohort",
      render: (st) => (
        <span style={{ fontSize: "0.8125rem", color: "var(--color-text)" }}>
          {st.grade || "General"}
        </span>
      ),
    },
    {
      key: "exam_status",
      header: "Assessment Status",
      align: "center",
      width: "160px",
      render: (st) => {
        const status = st.exam_status || "not_started";
        const isCompleted = status === "completed";
        return (
          <span className={`${styles.statusTag} ${isCompleted ? styles.statusCompleted : styles.statusPending}`}>
            {isCompleted ? "Completed" : status === "in_progress" ? "In Progress" : "Not Started"}
          </span>
        );
      },
    },
    {
      key: "score",
      header: "Recorded Score",
      render: (st) => {
        if (st.exam_status !== "completed" || st.score === undefined || st.score === null) {
          return <span style={{ color: "var(--color-muted)", fontSize: "0.75rem" }}>—</span>;
        }
        const pct = scorePct(st.score, st.total_score || 100);
        const grade = letterGrade(pct);
        return (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600, color: "var(--color-text)" }}>
              {st.score}
            </span>
            <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.75rem", color: "var(--color-muted)" }}>
              ({pct}% · {grade})
            </span>
          </div>
        );
      },
    },
    {
      key: "actions",
      header: "Action",
      align: "right",
      width: "140px",
      render: (st) => {
        const isCompleted = st.exam_status === "completed";
        return isCompleted ? (
          <Button variant="secondary" size="xs" onClick={() => openReview(st)}>
            Review Submission
          </Button>
        ) : (
          <span style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>—</span>
        );
      },
    },
  ];

  return (
    <div className={styles.container}>
      {toast && (
        <div style={{ position: "fixed", bottom: "1.5rem", right: "1.5rem", padding: "0.65rem 1rem", borderRadius: "8px", background: "var(--color-text)", color: "#FFFFFF", fontSize: "0.8125rem", fontWeight: 600, zIndex: 1100 }}>
          {toast.text}
        </div>
      )}

      {/* ── Page Header ───────────────────────────────────── */}
      <PageHeader
        eyebrow="Roster & Enrolled Candidates"
        title="Student Directory"
        subtitle={`Session ${currentSessionName} · ${currentTermName}`}
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-muted)" }}>Course:</label>
            <select
              value={selectedSubjectId}
              onChange={(e) => handleSubjectChange(Number(e.target.value))}
              style={{
                padding: "0.4rem 0.65rem",
                borderRadius: "6px",
                border: "1px solid var(--color-border)",
                background: "#FFFFFF",
                fontSize: "0.8125rem",
                color: "var(--color-text)",
              }}
            >
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {error && (
        <div style={{ padding: "0.875rem 1rem", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: "8px", color: "var(--color-danger, #DC2626)", fontSize: "0.8125rem" }}>
          {error}
        </div>
      )}

      {/* ── Minimalist KPI Metrics Row ──────────────────────── */}
      <section className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Enrolled Roster</span>
            <div className={styles.statIcon} style={{ color: "#4F46E5" }}><UsersIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{students.length}</div>
            <div className={styles.statFootnote}>{activeSubject?.code || "Subject"} candidates</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Submitted Exams</span>
            <div className={styles.statIcon} style={{ color: "#10B981" }}><CheckCircleIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{completedCount}</div>
            <div className={styles.statFootnote}>Evaluations completed</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Active Attempts</span>
            <div className={styles.statIcon} style={{ color: "#F97316" }}><ClockIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{inProgressCount}</div>
            <div className={styles.statFootnote}>In-progress CBT sessions</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Pending Intake</span>
            <div className={styles.statIcon} style={{ color: "#06B6D4" }}><BookIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{notStartedCount}</div>
            <div className={styles.statFootnote}>Not yet commenced</div>
          </div>
        </div>
      </section>

      {/* ── Filter Bar ─────────────────────────────────────────── */}
      <FilterBar
        searchQuery={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search candidates by name, reg ID, class..."
        hasActiveFilters={Boolean(query)}
        onReset={() => setQuery("")}
      />

      {/* ── Students Table ─────────────────────────────────────── */}
      <div className={styles.tableContainer}>
        <Table
          columns={columns}
          data={filteredStudents}
          keyExtractor={(st) => st.id}
          loading={loading}
          emptyTitle="No Candidates Enrolled"
          emptySubtitle={query ? "No candidates match your search." : "No candidates enrolled in this subject yet."}
        />
      </div>

      {/* Review Modal */}
      {reviewModal && (
        <ReviewModal
          activeSubjectName={activeSubject?.name || "Exam Assessment"}
          studentName={reviewModal.name}
          reviewData={reviewData}
          reviewLoading={reviewLoading}
          onClose={() => setReviewModal(null)}
          onGradeUpdate={async () => {
            if (selectedSubjectId) await loadStudents(selectedSubjectId);
          }}
        />
      )}
    </div>
  );
}
