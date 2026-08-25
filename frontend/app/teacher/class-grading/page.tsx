"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { RequireRole } from "../../../components/auth/RequireRole";
import { api } from "../../../lib/api";
import { useAcademic } from "../../../components/context/AcademicContext";
import {
  PageHeader,
  Button,
  ActiveGoldBadge,
} from "../../../components/ui";
import {
  DocumentIcon,
  UsersIcon,
  BookIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CrownIcon,
  SparklesIcon,
} from "../../../components/icons/Icons";
import styles from "./page.module.css";

export default function ClassGradingCenterPage() {
  return (
    <RequireRole role="teacher">
      <ClassGradingCenter />
    </RequireRole>
  );
}

function ClassGradingCenter() {
  const { selectedSession, selectedTerm, activeSession, activeTerm } = useAcademic();
  const isCurrentSessionActive = Boolean(selectedSession?.is_active || (activeSession && selectedSession?.id === activeSession?.id));
  const isCurrentTermActive = Boolean(selectedTerm?.is_active || (activeTerm && selectedTerm?.id === activeTerm?.id));

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<{
    class: any;
    students: any[];
    grading_subjects: any[];
  } | null>(null);
  const [expandedStudents, setExpandedStudents] = useState<Set<number>>(new Set());

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.getClassGradingCenter({
        sessionId: selectedSession?.id || activeSession?.id,
        termId: selectedTerm?.id || activeTerm?.id,
      });
      if (!res.class) throw new Error("You are not assigned as a class master for any class cohort.");
      setData(res);
      setError("");
    } catch (e: any) {
      setError(e.message || "Failed to load class grading center");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedSession?.id, selectedTerm?.id, activeSession?.id, activeTerm?.id]);

  const currentTermName = selectedTerm?.name || activeTerm?.name || "First Term";
  const currentSessionName = selectedSession?.name || activeSession?.name || "2026/2027";
  const className = data?.class?.name || "Assigned Class";

  const toggleStudent = (id: number) =>
    setExpandedStudents((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const getSubjectResult = (student: any, subjectId: number) =>
    student.subjects.find((s: any) => s.grading_subject_id === subjectId);

  const gradingSubjects: any[] = data?.grading_subjects || [];

  const isSubjectApproved = (gsId: number) =>
    data?.students?.some((st) =>
      st.subjects.some((s: any) => s.grading_subject_id === gsId && s.is_approved === 1)
    );

  const approvedCount = gradingSubjects.filter((gs) => isSubjectApproved(gs.id)).length;
  const readyForReportCard = approvedCount > 0;

  return (
    <div className={styles.container}>
      {/* ── Page Header ───────────────────────────────────── */}
      <PageHeader
        eyebrow="Class Master Authority"
        title="Class Grading Center"
        subtitle={`${className} · Academic Session ${currentSessionName} (${currentTermName})`}
        actions={
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Button variant="secondary" size="sm" onClick={fetchData} loading={loading}>
              Refresh
            </Button>
            {readyForReportCard && (
              <Link href="/teacher/report-card">
                <Button variant="primary" size="sm" leftIcon={<DocumentIcon width="13" height="13" />}>
                  Compiled Report Cards
                </Button>
              </Link>
            )}
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
            <span className={styles.statLabel}>Enrolled Candidates</span>
            <div className={styles.statIcon} style={{ color: "#4F46E5" }}><UsersIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{data?.students?.length || 0}</div>
            <div className={styles.statFootnote}>Students in {className}</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Curriculum Courses</span>
            <div className={styles.statIcon} style={{ color: "#06B6D4" }}><BookIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{gradingSubjects.length}</div>
            <div className={styles.statFootnote}>Subjects under evaluation</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Approved Gradebooks</span>
            <div className={styles.statIcon} style={{ color: "#10B981" }}><CheckCircleIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{approvedCount}</div>
            <div className={styles.statFootnote}>Locked by subject faculty</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Roster Broadsheet</span>
            <div className={styles.statIcon} style={{ color: "#F97316" }}><DocumentIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue} style={{ fontSize: "1.125rem" }}>
              {readyForReportCard ? "Ready" : "In Progress"}
            </div>
            <div className={styles.statFootnote}>{readyForReportCard ? "Cards available" : "Awaiting approval"}</div>
          </div>
        </div>
      </section>

      {/* ── Class Teacher Notice Card ──────────────────────────── */}
      <section className={styles.noticeCard}>
        <div className={styles.noticeLeft}>
          <div className={styles.noticeTitle}>Class Master Oversight & Broadsheet Compilation</div>
          <div className={styles.noticeSubtitle}>
            Subject teachers compute CA and Exam components. Once approved, the scores automatically populate here for compiled report card publishing.
          </div>
        </div>
        {readyForReportCard && (
          <Link href="/teacher/report-card">
            <Button variant="secondary" size="sm">
              Open Broadsheet
            </Button>
          </Link>
        )}
      </section>

      {/* ── Subject Approval Strip ─────────────────────────────── */}
      <section className={styles.approvalStrip}>
        <div className={styles.stripHeader}>
          <span className={styles.stripTitle}>Curriculum Subject Approvals</span>
          <span style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono, monospace)", color: "var(--color-muted)" }}>
            {approvedCount} / {gradingSubjects.length} Approved
          </span>
        </div>
        <div className={styles.chipGroup}>
          {gradingSubjects.length === 0 ? (
            <span style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>No grading subjects configured.</span>
          ) : (
            gradingSubjects.map((gs: any) => {
              const approved = isSubjectApproved(gs.id);
              return (
                <div
                  key={gs.id}
                  className={`${styles.subjectChip} ${approved ? styles.subjectChipApproved : ""}`}
                >
                  <span className={styles.codeMono}>{gs.code}</span>
                  <span style={{ color: "var(--color-text)", fontWeight: 500 }}>{gs.name}</span>
                  <span className={styles.statusIndicator}>
                    {approved ? "✓ Approved" : "Pending"}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* ── Student Cards Grid ─────────────────────────────────── */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "var(--color-muted)", fontSize: "0.8125rem" }}>
          Loading class broadsheet…
        </div>
      ) : !data || data.students.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3.5rem 2rem", background: "var(--color-surface)", border: "1px dashed var(--color-border)", borderRadius: "12px", color: "var(--color-muted)", fontSize: "0.8125rem" }}>
          No enrolled candidates found in {className}.
        </div>
      ) : (
        <div className={styles.studentGrid}>
          {data.students.map((student: any) => {
            const isExpanded = expandedStudents.has(student.student.id);
            const approvedSubjects = student.subjects.filter((s: any) => s.is_approved === 1);
            const pendingSubjects = gradingSubjects.length - approvedSubjects.length;
            const totalScore = approvedSubjects.reduce((sum: number, s: any) => sum + (s.total_score || 0), 0);
            const averageScore = approvedSubjects.length > 0 ? Number((totalScore / approvedSubjects.length).toFixed(1)) : 0;

            return (
              <div key={student.student.id} className={styles.studentCard}>
                <div className={styles.studentTop}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", minWidth: 0 }}>
                    <div className={styles.studentAvatar}>
                      {String(student.student.name || "?").charAt(0).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className={styles.studentName}>{student.student.name}</div>
                      <div className={styles.studentReg}>
                        {student.student.reg_id || "No Reg ID"} · {student.student.grade || className}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleStudent(student.student.id)}
                    style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-muted)", padding: "0.2rem" }}
                  >
                    {isExpanded ? <ChevronUpIcon width="16" height="16" /> : <ChevronDownIcon width="16" height="16" />}
                  </button>
                </div>

                <div className={styles.summaryRow}>
                  <div>
                    <div className={styles.summaryLabel}>Approved</div>
                    <div className={styles.summaryValue}>{approvedSubjects.length}/{gradingSubjects.length}</div>
                  </div>
                  <div>
                    <div className={styles.summaryLabel}>Class Avg</div>
                    <div className={styles.summaryValue}>{averageScore.toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className={styles.summaryLabel}>Pending</div>
                    <div className={styles.summaryValue}>{pendingSubjects}</div>
                  </div>
                </div>

                {isExpanded && (
                  <div className={styles.subjectList}>
                    {gradingSubjects.map((gs: any) => {
                      const result = getSubjectResult(student, gs.id);
                      const isApproved = result?.is_approved === 1;
                      return (
                        <div key={gs.id} className={styles.subjectRow}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", minWidth: 0 }}>
                            <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600, fontSize: "0.6875rem" }}>
                              {gs.code}
                            </span>
                            <span style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                              {gs.name}
                            </span>
                          </div>
                          <div>
                            {!result ? (
                              <span style={{ fontSize: "0.6875rem", color: "var(--color-muted)" }}>No result</span>
                            ) : !isApproved ? (
                              <span style={{ fontSize: "0.6875rem", color: "var(--color-muted)" }}>Pending</span>
                            ) : (
                              <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                                <span className={styles.gradeBadge}>{result.grade || "—"}</span>
                                <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600 }}>
                                  {result.total_score !== undefined ? Number(result.total_score).toFixed(1) : "—"}%
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    <div style={{ paddingTop: "0.5rem", marginTop: "0.25rem" }}>
                      {readyForReportCard ? (
                        <Link
                          href={`/teacher/report-card?studentId=${student.student.id}`}
                          style={{ textDecoration: "none" }}
                        >
                          <Button variant="secondary" size="xs" style={{ width: "100%" }}>
                            <DocumentIcon width="13" height="13" /> Open Report Card
                          </Button>
                        </Link>
                      ) : (
                        <div style={{ textAlign: "center", fontSize: "0.6875rem", color: "var(--color-muted)" }}>
                          Waiting for subject approvals
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
