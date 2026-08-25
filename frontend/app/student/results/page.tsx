"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useAcademic } from "../../../components/context/AcademicContext";
import { useToast } from "../../../hooks/useToast";
import { api } from "../../../lib/api";
import type { ExamResult, Subject } from "../../../lib/types";
import { Button } from "../../../components/ui";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { StudentReviewModal } from "../../../components/student/StudentReviewModal";
import { scorePct, letterGrade } from "../../../lib/gradeUtils";
import { AwardIcon, BookIcon, CheckCircleIcon, ClockIcon, TrendingUpIcon } from "../../../components/icons/Icons";
import styles from "./page.module.css";

export default function StudentResultsPage() {
  return (
    <RequireRole role="student">
      <StudentResults />
    </RequireRole>
  );
}

function StudentResults() {
  const [results, setResults] = useState<ExamResult[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const { selectedSession, selectedTerm } = useAcademic();
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState<"all" | "exams" | "practice">("all");
  const [retaking, setRetaking] = useState<number | null>(null);
  const [reviewingExam, setReviewingExam] = useState<{ id: number; subjectName: string } | null>(null);
  const [retakeTarget, setRetakeTarget] = useState<{ examId: number; subjectId: number } | null>(null);
  const router = useRouter();
  const { showToast } = useToast();

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    setLoading(true);

    Promise.all([
      api.getResults(selectedSession?.id, selectedTerm?.id),
      api.getSubjects(selectedSession?.id, selectedTerm?.id),
    ])
      .then(([resData, subData]) => {
        if (signal.aborted) return;
        setResults((resData as ExamResult[])?.filter((r) => r.status === "completed") ?? []);
        setSubjects((subData as Subject[]) ?? []);
      })
      .catch(() => {
        if (!signal.aborted) showToast("Failed to load assessment results.", "error");
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [selectedSession?.id, selectedTerm?.id, showToast]);

  const confirmRetake = async () => {
    if (!retakeTarget) return;
    setRetaking(retakeTarget.examId);
    setRetakeTarget(null);
    try {
      await api.retakeExam(retakeTarget.examId);
      localStorage.removeItem(`exam_answers_${retakeTarget.examId}`);
      router.push(`/student/exam?subjectId=${retakeTarget.subjectId}`);
    } catch (err: any) {
      showToast(err.message || "Failed to retake exam.", "error");
      setRetaking(null);
    }
  };

  const filteredResults = useMemo(() => {
    if (selectedTab === "exams") {
      return results.filter((r) => !r.practice_id && !r.subject_name?.includes("JAMB") && !r.subject_name?.includes("UTME"));
    }
    if (selectedTab === "practice") {
      return results.filter((r) => Boolean(r.practice_id) || r.subject_name?.includes("JAMB") || r.subject_name?.includes("UTME"));
    }
    return results;
  }, [results, selectedTab]);

  const stats = useMemo(() => {
    const count = results.length;
    if (count === 0) return { count: 0, avg: 0, highest: 0, gradeLetter: "—" };
    const percentages = results.map((r) => scorePct(r.score, r.total_score));
    const avg = Math.round(percentages.reduce((a, b) => a + b, 0) / count);
    const highest = Math.max(...percentages);
    const gradeLetter = letterGrade(highest);
    return { count, avg, highest, gradeLetter };
  }, [results]);

  const schoolExamsCount = useMemo(() => {
    return results.filter((r) => !r.practice_id && !r.subject_name?.includes("JAMB") && !r.subject_name?.includes("UTME")).length;
  }, [results]);

  const practiceCount = useMemo(() => {
    return results.filter((r) => Boolean(r.practice_id) || r.subject_name?.includes("JAMB") || r.subject_name?.includes("UTME")).length;
  }, [results]);

  return (
    <div className={styles.container}>
      <ConfirmDialog
        open={!!retakeTarget}
        onClose={() => setRetakeTarget(null)}
        onConfirm={confirmRetake}
        title="Retake Examination Sitting?"
        message="Your previous attempt score will be archived and a new sitting attempt will be initialized."
        confirmLabel="Retake Sitting"
        loading={retaking !== null}
      />

      {/* ── 1. Hero Identity & Telemetry Strip ── */}
      <section className={styles.heroSection}>
        <div className={styles.heroLeft}>
          <h1 className={styles.heroTitle}>My Assessment Results</h1>
          <p className={styles.heroSubtitle}>
            Comprehensive evaluations, performance analytics, and question-by-question review breakdowns.
          </p>
        </div>

        <div className={styles.telemetryPillGroup}>
          <div className={styles.telemetryBadge}>
            <div className={styles.telemetryIcon}>
              <AwardIcon width="18" height="18" />
            </div>
            <div className={styles.telemetryBadgeContent}>
              <span className={styles.telemetryNumber}>{stats.count}</span>
              <span className={styles.telemetryText}>Completed Sittings</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2. 3-KPI Analytics Strip ── */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Completed Evaluations</span>
          <span className={styles.statValue}>{stats.count}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Cumulative Average</span>
          <span className={styles.statValue}>{stats.avg}%</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Top Attainment</span>
          <span className={styles.statValue}>{stats.highest}% ({stats.gradeLetter})</span>
        </div>
      </div>

      {/* ── 3. Enrolled Assessment Records Container ── */}
      <section className={styles.resultsContainer}>
        <div className={styles.resultsHeader}>
          <div className={styles.resultsTitleGroup}>
            <div className={styles.resultsIconBadge}>
              <CheckCircleIcon width="18" height="18" />
            </div>
            <div>
              <span className={styles.resultsEyebrow}>Evaluation Records</span>
              <h2 className={styles.resultsClassTitle}>
                Submitted Evaluations ({filteredResults.length})
              </h2>
            </div>
          </div>

          {/* Filter Tab Chips */}
          <div className={styles.tabList}>
            <button
              type="button"
              className={`${styles.tabBtn} ${selectedTab === "all" ? styles.tabBtnActive : ""}`}
              onClick={() => setSelectedTab("all")}
            >
              <span>All</span>
              <span className={styles.tabCount}>{results.length}</span>
            </button>
            <button
              type="button"
              className={`${styles.tabBtn} ${selectedTab === "exams" ? styles.tabBtnActive : ""}`}
              onClick={() => setSelectedTab("exams")}
            >
              <span>School Exams</span>
              <span className={styles.tabCount}>{schoolExamsCount}</span>
            </button>
            <button
              type="button"
              className={`${styles.tabBtn} ${selectedTab === "practice" ? styles.tabBtnActive : ""}`}
              onClick={() => setSelectedTab("practice")}
            >
              <span>JAMB &amp; Practice</span>
              <span className={styles.tabCount}>{practiceCount}</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "3rem", gap: "0.75rem", color: "#64748B", fontSize: "0.875rem" }}>
            <div className="spinner" style={{ width: 22, height: 22, borderColor: "#E2E8F0", borderTopColor: "#165AF6" }} />
            <span>Loading examination results…</span>
          </div>
        ) : filteredResults.length === 0 ? (
          <div
            style={{
              background: "#FFFFFF",
              border: "1px dashed #E2E8F0",
              borderRadius: "16px",
              padding: "3.5rem 2rem",
              textAlign: "center",
            }}
          >
            <AwardIcon width="36" height="36" style={{ color: "#94A3B8", margin: "0 auto 0.75rem" }} />
            <div style={{ fontWeight: 700, color: "#0F172A", fontSize: "0.9375rem", marginBottom: "0.25rem" }}>
              No {selectedTab === "practice" ? "Practice" : selectedTab === "exams" ? "School Exam" : "Evaluation"} Submissions Recorded
            </div>
            <div style={{ color: "#64748B", fontSize: "0.8125rem" }}>
              {selectedTab === "practice"
                ? "Past question CBT sessions and practice sittings will appear here."
                : "Completed formal test sittings will be compiled and presented here."}
            </div>
          </div>
        ) : (
          <div className={styles.resultsGrid}>
            {filteredResults.map((r) => {
              const subject = subjects.find((s) => s.id === Number(r.subject_id));
              const isPractice = Boolean(r.practice_id) || r.subject_name?.includes("JAMB") || r.subject_name?.includes("UTME");
              const isReleased = isPractice || (r.is_result_released !== false && (r.result_status === "released" || !r.result_status));
              const pct = isReleased && r.score !== null ? scorePct(r.score, r.total_score) : 0;
              const grade = isReleased && r.score !== null ? letterGrade(pct) : "—";
              const canRetake = !isPractice && subject?.can_retake === 1;
              const isGradeA = grade.startsWith("A");
              const isGradeB = grade.startsWith("B");
              const isGradeC = grade.startsWith("C");

              return (
                <div key={r.id} className={styles.resultCard}>
                  <div className={styles.cardHeader}>
                    <div>
                      <div className={styles.subjectTitle}>{r.subject_name || `Subject #${r.subject_id}`}</div>
                      <span className={styles.subjectCode}>{isPractice ? "CBT PRACTICE" : subject?.code || "EXAM"}</span>
                    </div>
                    {isReleased ? (
                      <div className={styles.scoreBadge}>
                        <span className={styles.scoreNumber}>{r.score ?? 0}</span>
                        <span className={styles.scoreTotal}>/ {r.total_score || "?"} marks</span>
                      </div>
                    ) : (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", padding: "0.3rem 0.65rem", background: r.result_status === "scheduled" ? "#EFF4FF" : "#FFFBEB", border: `1px solid ${r.result_status === "scheduled" ? "#DBEAFE" : "#FDE68A"}`, borderRadius: "999px", fontSize: "0.75rem", fontWeight: 700, color: r.result_status === "scheduled" ? "#165AF6" : "#D97706" }}>
                        <ClockIcon width="12" height="12" />
                        <span>{r.result_status === "scheduled" ? "Scheduled" : "Pending Release"}</span>
                      </div>
                    )}
                  </div>

                  {/* Progress track */}
                  <div className={styles.progressTrack}>
                    <div
                      className={styles.progressBar}
                      style={{
                        width: isReleased ? `${Math.min(pct, 100)}%` : "100%",
                        background: !isReleased ? "#CBD5E1" : pct >= 70 ? "#059669" : pct >= 50 ? "#165AF6" : "#DC2626",
                      }}
                    />
                  </div>

                  <div className={styles.metricsRow}>
                    <div className={styles.metricItem}>
                      <span className={styles.metricLabel}>Percentage</span>
                      <span className={styles.metricValue}>{isReleased ? `${pct}%` : "Pending"}</span>
                    </div>
                    <div className={styles.metricItem}>
                      <span className={styles.metricLabel}>Grade</span>
                      <span
                        className={`${styles.gradeBadge} ${
                          !isReleased ? "" : isGradeA ? styles.gradeA : isGradeB ? styles.gradeB : isGradeC ? styles.gradeC : styles.gradeF
                        }`}
                        style={!isReleased ? { background: "#F1F5F9", color: "#64748B" } : undefined}
                      >
                        {grade}
                      </span>
                    </div>
                    <div className={styles.metricItem}>
                      <span className={styles.metricLabel}>Status</span>
                      <span className={styles.metricValue} style={{ color: !isReleased ? "#D97706" : pct >= 50 ? "#059669" : "#DC2626" }}>
                        {!isReleased ? "Under Review" : pct >= 50 ? "Pass" : "Fail"}
                      </span>
                    </div>
                  </div>

                  <div className={styles.cardFooter}>
                    <span className={styles.submittedDate}>
                      {r.end_time ? new Date(r.end_time).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Submitted"}
                    </span>
                    <div style={{ display: "flex", gap: "0.4rem" }}>
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => setReviewingExam({ id: r.id, subjectName: r.subject_name || "Exam" })}
                        disabled={!isReleased}
                        title={!isReleased ? "Results will be reviewable once released by instructor" : "Review question breakdown"}
                      >
                        {isReleased ? "Review" : "Held"}
                      </Button>
                      {canRetake && (
                        <Button
                          variant="secondary"
                          size="xs"
                          onClick={() => setRetakeTarget({ examId: r.id, subjectId: Number(r.subject_id) })}
                          disabled={retaking === r.id}
                        >
                          Retake
                        </Button>
                      )}
                      {isPractice && r.practice_id && (
                        <Button
                          variant="secondary"
                          size="xs"
                          onClick={() => router.push(`/student/exam?practiceId=${r.practice_id}`)}
                        >
                          Practice
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Question Review Modal ──────────────────────────── */}
      {reviewingExam && (
        <StudentReviewModal
          examId={reviewingExam.id}
          subjectName={reviewingExam.subjectName}
          onClose={() => setReviewingExam(null)}
        />
      )}
    </div>
  );
}
