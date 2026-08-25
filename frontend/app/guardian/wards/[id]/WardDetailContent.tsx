"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { RequireRole } from "../../../../components/auth/RequireRole";
import { api } from "../../../../lib/api";
import { useAcademic } from "../../../../components/context/AcademicContext";
import {
  ChevronRightIcon,
  RefreshIcon,
  ActivityIcon,
  DocumentIcon,
  BookIcon,
} from "../../../../components/icons/Icons";
import { Skeleton } from "../../../../components/ui/Skeleton";
import { EmptyState } from "../../../../components/ui/EmptyState";
import styles from "./page.module.css";

interface WardInfo {
  id: number;
  student_id: number;
  name: string;
  grade: string;
  reg_id: string;
  avg_score: number;
  completed_exams: number;
}

interface TermResult {
  id: number;
  subject_name: string;
  code: string;
  ca_score: number;
  exam_score: number;
  total_score: number;
  grade: string;
  remark: string;
}

interface WardExam {
  id: number;
  subject_name: string;
  code: string;
  score: number;
  total_score: number;
  start_time: string;
  end_time: string;
}

interface ReportCard {
  results: TermResult[];
  remarks: any[];
}

type TabType = "results" | "exams" | "report-card";

export default function WardDetailContent() {
  const params = useParams();
  const wardId = params?.id as string;

  const [ward, setWard] = useState<WardInfo | null>(null);
  const [results, setResults] = useState<TermResult[]>([]);
  const [exams, setExams] = useState<WardExam[]>([]);
  const [reportCard, setReportCard] = useState<ReportCard | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("results");

  const { selectedSession, selectedTerm } = useAcademic();

  const loadData = useCallback(async (isRefresh = false) => {
    if (!wardId) return;
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");

      const [wardsData, resultsData, examsData, reportData] = await Promise.all([
        api.get<any>("/api/guardian/wards"),
        api.get<any>(`/api/guardian/wards/${wardId}/results`),
        api.get<any>(`/api/guardian/wards/${wardId}/exams`),
        api.get<any>(`/api/guardian/wards/${wardId}/report-card`),
      ]);

      const wardInfo = wardsData?.wards?.find((w: any) => w.id === Number(wardId) || w.student_id === Number(wardId));
      if (wardInfo) {
        setWard({
          id: wardInfo.id,
          student_id: wardInfo.student_id || wardInfo.id,
          name: wardInfo.name || wardInfo.student_name,
          grade: wardInfo.grade,
          reg_id: wardInfo.reg_id,
          avg_score: wardInfo.avg_score,
          completed_exams: wardInfo.completed_exams,
        });
      }

      setResults(resultsData ?? []);
      setExams(examsData ?? []);
      setReportCard(reportData ?? { results: [], remarks: [] });
    } catch (err: any) {
      setError(err.message || "Failed to load ward data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [wardId, selectedSession?.id, selectedTerm?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const getGradeClass = (grade: string) => {
    if (!grade) return "";
    const upper = grade.toUpperCase();
    if (upper.startsWith("A")) return styles.gradeA;
    if (upper.startsWith("B")) return styles.gradeB;
    if (upper.startsWith("C")) return styles.gradeC;
    if (upper.startsWith("D")) return styles.gradeD;
    return styles.gradeF;
  };

  if (error) {
    return (
      <div
        style={{
          background: "var(--color-surface, #FFFFFF)",
          border: "1px solid var(--color-border, #E2E8F0)",
          borderRadius: "12px",
          padding: "3rem 2rem",
          textAlign: "center",
          maxWidth: "460px",
          margin: "3rem auto",
        }}
      >
        <div
          style={{
            width: "40px",
            height: "40px",
            borderRadius: "10px",
            background: "rgba(220, 38, 38, 0.08)",
            color: "var(--color-danger, #DC2626)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 1rem",
          }}
        >
          <ActivityIcon width="20" height="20" />
        </div>
        <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--color-text, #0F172A)", marginBottom: "0.35rem" }}>
          Unable to Load Ward Details
        </h3>
        <p style={{ color: "var(--color-muted, #64748B)", fontSize: "0.8125rem", marginBottom: "1.25rem", lineHeight: 1.5 }}>
          {error}
        </p>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => loadData()}
          style={{ padding: "0.45rem 1.25rem", borderRadius: "8px", fontWeight: 600 }}
        >
          <RefreshIcon width="13" height="13" /> Retry Connection
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.headerWrapper}>
          <div className={styles.headerLeft}>
            <Skeleton width={200} height={28} borderRadius="6px" />
            <Skeleton width={300} height={16} borderRadius="4px" style={{ marginTop: "0.35rem" }} />
          </div>
        </div>
        <Skeleton height={100} borderRadius="12px" />
        <div className={styles.tabsContainer}>
          <Skeleton width={80} height={36} borderRadius="4px" />
          <Skeleton width={80} height={36} borderRadius="4px" />
          <Skeleton width={80} height={36} borderRadius="4px" />
        </div>
        <Skeleton height={200} borderRadius="12px" />
      </div>
    );
  }

  if (!ward) {
    return (
      <div className={styles.container}>
        <EmptyState
          title="Ward Not Found"
          description="The ward you're looking for doesn't exist or you don't have access."
          icon={<ActivityIcon width="22" height="22" />}
        />
      </div>
    );
  }

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: "results", label: "Results", icon: <BookIcon width="14" height="14" /> },
    { id: "exams", label: "Exams", icon: <DocumentIcon width="14" height="14" /> },
    { id: "report-card", label: "Report Card", icon: <DocumentIcon width="14" height="14" /> },
  ];

  return (
    <div className={styles.container}>
      {/* Page Header */}
      <div className={styles.headerWrapper}>
        <div className={styles.headerLeft}>
          <Link href="/guardian/wards" className={styles.backLink}>
            <ChevronRightIcon width="14" height="14" style={{ transform: "rotate(180deg)" }} />
            Back to Wards
          </Link>
          <div className={styles.titleRow}>
            <h1 className={styles.pageTitle}>{ward.name}</h1>
            <span className={styles.roleBadge}>Ward</span>
          </div>
          <p className={styles.subtitle}>
            Academic progress and examination results for {ward.name}.
          </p>
        </div>

        <div className={styles.headerRight}>
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="btn btn-outline btn-sm"
            style={{ padding: "0.35rem 0.7rem", borderRadius: "8px", fontWeight: 600 }}
          >
            <RefreshIcon width="12" height="12" style={{ color: "#6366F1", animation: refreshing ? "spin 1s linear infinite" : "none" }} />
            <span>{refreshing ? "Syncing…" : "Sync"}</span>
          </button>
        </div>
      </div>

      {/* Ward Info Card */}
      <div className={styles.wardInfoCard}>
        <div className={styles.wardAvatarLarge}>
          {ward.name.charAt(0).toUpperCase()}
        </div>
        <div className={styles.wardDetails}>
          <div className={styles.wardNameLarge}>{ward.name}</div>
          <div className={styles.wardMeta}>
            <div className={styles.wardMetaItem}>
              <span className={styles.wardMetaLabel}>Grade:</span>
              <span className={styles.wardMetaValue}>{ward.grade}</span>
            </div>
            {ward.reg_id && (
              <div className={styles.wardMetaItem}>
                <span className={styles.wardMetaLabel}>Reg ID:</span>
                <span className={styles.wardMetaValue}>{ward.reg_id}</span>
              </div>
            )}
            <div className={styles.wardMetaItem}>
              <span className={styles.wardMetaLabel}>Average:</span>
              <span className={styles.wardMetaValue}>{ward.avg_score?.toFixed(1) ?? "—"}%</span>
            </div>
            <div className={styles.wardMetaItem}>
              <span className={styles.wardMetaLabel}>Exams:</span>
              <span className={styles.wardMetaValue}>{ward.completed_exams ?? 0}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabsContainer}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`${styles.tabButton} ${activeTab === tab.id ? styles.tabButtonActive : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
            <span style={{ marginLeft: "0.35rem" }}>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className={styles.sectionContent}>
        {activeTab === "results" && (
          results.length > 0 ? (
            <table className={styles.resultsTable}>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Code</th>
                  <th>CA Score</th>
                  <th>Exam Score</th>
                  <th>Total</th>
                  <th>Grade</th>
                  <th>Remark</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr key={result.id}>
                    <td style={{ fontWeight: 600 }}>{result.subject_name}</td>
                    <td>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontFamily: "var(--font-mono, monospace)",
                          color: "var(--color-muted, #64748B)",
                        }}
                      >
                        {result.code}
                      </span>
                    </td>
                    <td>
                      <span className={styles.scoreValue}>{result.ca_score ?? "—"}</span>
                    </td>
                    <td>
                      <span className={styles.scoreValue}>{result.exam_score ?? "—"}</span>
                    </td>
                    <td>
                      <span className={styles.scoreValue}>{result.total_score ?? "—"}</span>
                    </td>
                    <td>
                      <span className={`${styles.gradeValue} ${getGradeClass(result.grade)}`}>
                        {result.grade || "—"}
                      </span>
                    </td>
                    <td style={{ color: "var(--color-muted, #64748B)" }}>
                      {result.remark || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState
              title="No Results Available"
              description="No term results have been published for this ward yet."
              icon={<BookIcon width="22" height="22" />}
            />
          )
        )}

        {activeTab === "exams" && (
          exams.length > 0 ? (
            <div className={styles.examCards}>
              {exams.map((exam) => (
                <div key={exam.id} className={styles.examCard}>
                  <div className={styles.examInfo}>
                    <div className={styles.examSubject}>{exam.subject_name}</div>
                    <div className={styles.examDate}>
                      {exam.end_time
                        ? new Date(exam.end_time).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : "Date not available"}
                    </div>
                  </div>
                  <div className={styles.examScore}>
                    <span className={styles.examScoreValue}>
                      {exam.total_score > 0 ? `${((exam.score / exam.total_score) * 100).toFixed(1)}%` : "—"}
                    </span>
                    <span className={styles.examScoreLabel}>
                      {exam.score}/{exam.total_score}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No Exams Available"
              description="No completed exams found for this ward."
              icon={<DocumentIcon width="22" height="22" />}
            />
          )
        )}

        {activeTab === "report-card" && (
          reportCard && reportCard.remarks && reportCard.remarks.length > 0 ? (
            <div className={styles.reportCard}>
              {reportCard.remarks.map((remark, index) => (
                <div key={remark.id || index} className={styles.remarkSection}>
                  <div className={styles.remarkLabel}>
                    {remark.remark_type === "teacher"
                      ? "Teacher's Remark"
                      : remark.remark_type === "principal"
                      ? "Principal's Remark"
                      : remark.term || "Term Remark"}
                  </div>
                  <div className={styles.remarkText}>{remark.remark || remark.text || "No remark provided"}</div>
                  {remark.updated_at && (
                    <div style={{ fontSize: "0.6875rem", color: "var(--color-muted, #94A3B8)", marginTop: "0.5rem" }}>
                      Last updated:{" "}
                      {new Date(remark.updated_at).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No Report Card Available"
              description="No report card remarks have been added for this ward yet."
              icon={<DocumentIcon width="22" height="22" />}
            />
          )
        )}
      </div>
    </div>
  );
}
