"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { ReviewModal } from "../../../components/teacher/ReviewModal";
import { useAcademic } from "../../../components/context/AcademicContext";
import { api } from "../../../lib/api";
import type { ExamResult } from "../../../lib/types";
import { scorePct, letterGrade, fmtDate } from "../../../lib/gradeUtils";
import {
  PageHeader,
  Button,
  FilterBar,
  Table,
  type TableColumn,
} from "../../../components/ui";

import {
  BarChartIcon,
  CheckCircleIcon,
  DocumentIcon,
  SubjectIcon,
  UsersIcon,
} from "../../../components/icons/Icons";
import styles from "./page.module.css";

export default function TeacherResultsPage() {
  return (
    <RequireRole role="teacher">
      <TeacherResults />
    </RequireRole>
  );
}

function TeacherResults() {
  const [rows, setRows] = useState<ExamResult[]>([]);
  const [query, setQuery] = useState("");
  const { selectedSession, selectedTerm, activeSession, activeTerm } = useAcademic();
  const currentSessionName = selectedSession?.name || activeSession?.name || "2026/2027";
  const currentTermName = selectedTerm?.name || activeTerm?.name || "First Term";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [reviewModal, setReviewModal] = useState<any | null>(null);
  const [reviewData, setReviewData] = useState<any | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  const showToast = (type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      const data = (await api.getResults(selectedSession?.id, selectedTerm?.id)) as ExamResult[];
      if (signal?.aborted) return;
      setRows(data ?? []);
    } catch (err) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : "Failed to load results");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [selectedSession?.id, selectedTerm?.id]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, selectedSession?.id, selectedTerm?.id]);

  useEffect(() => {
    const handler = (e: Event) => {
      const notif = (e as CustomEvent).detail;
      if (notif?.type === "exam_submitted") {
        load();
      }
    };
    window.addEventListener("notification_received", handler);
    return () => window.removeEventListener("notification_received", handler);
  }, [load, selectedSession?.id, selectedTerm?.id]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        String(r.student_name || "").toLowerCase().includes(q) ||
        String(r.subject_name || "").toLowerCase().includes(q) ||
        String(r.reg_id || "").toLowerCase().includes(q)
    );
  }, [rows, query]);

  const stats = useMemo(() => {
    if (!rows.length) return { total: 0, avg: 0, highest: 0, passRate: 0 };
    const scores = rows.map((r) => scorePct(r.score, r.total_score));
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const highest = scores.length > 0 ? Math.round(Math.max(...scores)) : 0;
    const pass = scores.filter((s) => s >= 40).length;
    const passRate = Math.round((pass / scores.length) * 100);
    return { total: rows.length, avg, highest, passRate };
  }, [rows]);

  const handlePdfExport = () => {
    window.print();
  };

  const handleCsvExport = () => {
    api.exportResultsCsv();
  };

  const openReview = async (row: any) => {
    setReviewModal(row);
    setReviewData(null);
    setReviewLoading(true);
    try {
      const data = (await api.getExamReview(Number(row.id))) as any;
      setReviewData(data);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to load review");
      setReviewModal(null);
    } finally {
      setReviewLoading(false);
    }
  };

  const [publishing, setPublishing] = useState(false);

  const handlePublishResults = async (subjectId: number) => {
    try {
      setPublishing(true);
      const res = await api.releaseSubjectResults(subjectId);
      showToast("success", `Results published! ${res.count} student results are now live.`);
      load();
    } catch (err: any) {
      showToast("error", err?.message || "Failed to publish results");
    } finally {
      setPublishing(false);
    }
  };

  // Check if there are unpublished manual results
  const unpublishedSubjects = useMemo(() => {
    const unpubMap = new Map<number, { subject_name: string; count: number }>();
    for (const r of rows) {
      if (r.result_status === "hidden") {
        const sid = Number(r.subject_id);
        const existing = unpubMap.get(sid) || { subject_name: r.subject_name || `Subject #${sid}`, count: 0 };
        existing.count++;
        unpubMap.set(sid, existing);
      }
    }
    return Array.from(unpubMap.entries()).map(([id, data]) => ({ id, ...data }));
  }, [rows]);

  const columns: TableColumn<ExamResult>[] = [
    {
      key: "student_name",
      header: "Candidate",
      sortable: true,
      render: (r) => (
        <div className={styles.studentCell}>
          <div className={styles.avatar}>{String(r.student_name || "?").charAt(0).toUpperCase()}</div>
          <div>
            <div style={{ fontWeight: 600, color: "var(--color-text)", fontSize: "0.8125rem" }}>
              {r.student_name || "—"}
            </div>
            <div style={{ fontSize: "0.6875rem", color: "var(--color-muted)" }}>{r.grade || "General"}</div>
          </div>
        </div>
      ),
    },
    {
      key: "reg_id",
      header: "Reg Number",
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.75rem", color: "var(--color-muted)" }}>
          {r.reg_id || "—"}
        </span>
      ),
    },
    {
      key: "subject_name",
      header: "Subject / Assessment",
      sortable: true,
      render: (r) => (
        <div>
          <span style={{ fontWeight: 500, color: "var(--color-text)", fontSize: "0.8125rem", display: "block" }}>
            {r.subject_name || `Subject #${r.subject_id}`}
          </span>
          <span style={{ fontSize: "0.6875rem", color: r.result_status === "hidden" ? "#D97706" : "#059669", fontWeight: 600 }}>
            {r.result_status === "hidden" ? "● Unpublished" : "● Live"}
          </span>
        </div>
      ),
    },
    {
      key: "end_time",
      header: "Submitted",
      render: (r) => (
        <span style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>
          {fmtDate(r.end_time)}
        </span>
      ),
    },
    {
      key: "score",
      header: "Score & Performance",
      render: (r) => {
        const pct = scorePct(r.score, r.total_score);
        return (
          <div className={styles.scoreCell}>
            <span className={styles.scoreMono}>{r.score ?? 0}</span>
            <span className={styles.scoreTotalMono}>/ {Number(r.total_score ?? 0) || "?"}</span>
            <div className={styles.pctBar}>
              <div className={styles.pctFill} style={{ width: `${pct}%` }} />
            </div>
            <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.75rem", color: "var(--color-muted)" }}>
              {pct}%
            </span>
          </div>
        );
      },
    },
    {
      key: "grade",
      header: "Grade",
      align: "center",
      width: "90px",
      render: (r) => {
        const pct = scorePct(r.score, r.total_score);
        const grade = letterGrade(pct);
        return <span className={styles.gradeBadge}>{grade}</span>;
      },
    },
    {
      key: "actions",
      header: "Action",
      align: "right",
      width: "120px",
      render: (r) => (
        <div style={{ display: "flex", gap: "0.35rem", justifyContent: "flex-end" }}>
          <Button variant="secondary" size="xs" onClick={() => openReview(r)}>
            Review
          </Button>
        </div>
      ),
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
        eyebrow="Evaluation & Performance Analytics"
        title="Exam Results"
        subtitle={`Academic Session ${currentSessionName} · ${currentTermName}`}
        actions={
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Button variant="secondary" size="sm" leftIcon={<DocumentIcon width="13" height="13" />} onClick={handleCsvExport}>
              Export CSV
            </Button>
            <Button variant="secondary" size="sm" onClick={handlePdfExport}>
              Print Broadsheet
            </Button>
          </div>
        }
      />

      {/* Unpublished Results Banner */}
      {unpublishedSubjects.length > 0 && (
        <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: "12px", padding: "1rem 1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <strong style={{ color: "#92400E", fontSize: "0.875rem", display: "block" }}>
              Unpublished Student Results ({unpublishedSubjects.reduce((a, b) => a + b.count, 0)} pending)
            </strong>
            <span style={{ color: "#B45309", fontSize: "0.8125rem" }}>
              Students who took manual-release assessments cannot view their score until you publish.
            </span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {unpublishedSubjects.map((s) => (
              <Button
                key={s.id}
                variant="primary"
                size="sm"
                onClick={() => handlePublishResults(s.id)}
                disabled={publishing}
              >
                Publish {s.subject_name} ({s.count})
              </Button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div style={{ padding: "0.875rem 1rem", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: "8px", color: "var(--color-danger, #DC2626)", fontSize: "0.8125rem" }}>
          {error}
        </div>
      )}

      {/* ── Minimalist KPI Metrics Row ──────────────────────── */}
      <section className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Submissions</span>
            <div className={styles.statIcon} style={{ color: "#4F46E5" }}><UsersIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{stats.total}</div>
            <div className={styles.statFootnote}>Submitted examinations</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Average Score</span>
            <div className={styles.statIcon} style={{ color: "#06B6D4" }}><BarChartIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{stats.avg}%</div>
            <div className={styles.statFootnote}>Cohort mean performance</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Top Score</span>
            <div className={styles.statIcon} style={{ color: "#F97316" }}><SubjectIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{stats.highest}%</div>
            <div className={styles.statFootnote}>Highest recorded result</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Pass Rate</span>
            <div className={styles.statIcon} style={{ color: "#10B981" }}><CheckCircleIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{stats.passRate}%</div>
            <div className={styles.statFootnote}>Scored 40% and above</div>
          </div>
        </div>
      </section>

      {/* ── Filter Bar ─────────────────────────────────────────── */}
      <FilterBar
        searchQuery={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search candidates by name, reg ID, or subject..."
        hasActiveFilters={Boolean(query)}
        onReset={() => setQuery("")}
      />

      {/* ── Results Table ──────────────────────────────────────── */}
      <div className={styles.tableContainer}>
        <Table
          columns={columns}
          data={filtered}
          keyExtractor={(r) => r.id}
          loading={loading}
          emptyTitle="No Examination Results Found"
          emptySubtitle={query ? "No submissions match your search parameters." : "Submissions will appear here live as candidates complete their tests."}
        />
      </div>



      {/* Exam Question-by-Question Review Modal */}
      {reviewModal && (
        <ReviewModal
          activeSubjectName={reviewModal.subject_name || `Subject #${reviewModal.subject_id}`}
          studentName={reviewModal.student_name}
          reviewData={reviewData}
          reviewLoading={reviewLoading}
          onClose={() => setReviewModal(null)}
          onGradeUpdate={(examId, newTotal) => {
            setRows((prev) =>
              prev.map((r) => (r.id === examId ? { ...r, score: newTotal } : r))
            );
          }}
        />
      )}
    </div>
  );
}
