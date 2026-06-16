"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RequireRole } from "../../../components/auth/RequireRole";
import { api } from "../../../lib/api";
import { BookIcon } from "../../../components/icons/Icons";
import { Skeleton } from "../../../components/ui/Skeleton";
import styles from "./page.module.css";

export default function StudentResultsPage() {
  return (
    <RequireRole role="student">
      <StudentResults />
    </RequireRole>
  );
}

function StudentResults() {
  const [results, setResults] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [retaking, setRetaking] = useState<number | null>(null);
  const router = useRouter();

  useEffect(() => {
    Promise.all([api.getResults(), api.getSubjects()])
      .then(([resData, subData]) => {
        setResults((resData as any[])?.filter(r => r.status === "completed") ?? []);
        setSubjects((subData as any[]) ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleRetake = async (examId: number, subjectId: number) => {
    if (!confirm("Are you sure you want to retake this exam? Your previous attempt will be overwritten and your score will be reset.")) return;
    setRetaking(examId);
    try {
      await api.retakeExam(examId);
      localStorage.removeItem(`exam_answers_${examId}`);
      router.push(`/student/exam?subjectId=${subjectId}`);
    } catch (err: any) {
      alert(err.message || "Failed to retake exam.");
      setRetaking(null);
    }
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <Skeleton height={60} borderRadius={12} />
        <div className={styles.grid}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={200} borderRadius={16} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>My Results</h1>
          <p className={styles.subtitle}>Review your performance in completed exams.</p>
        </div>
        <Link href="/student/dashboard" className="btn btn-ghost">← Dashboard</Link>
      </div>

      {results.length === 0 ? (
        <div className={styles.emptyState}>
          <BookIcon width="48" height="48" style={{ opacity: 0.5, marginBottom: "1rem" }} />
          <h3>No Results Yet</h3>
          <p>You haven't completed any exams yet. Completed exams will appear here.</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {results.map((r: any) => {
            const subject = subjects.find((s) => s.id === r.subject_id) || { name: "Unknown Subject", code: "—" };
            const score = Number(r.score || 0);
            const total = Number(r.total_score || 1);
            const percentage = Math.round((score / total) * 100);
            
            // Determine color based on percentage
            let color = "var(--color-success)";
            if (percentage < 40) color = "var(--color-danger)";
            else if (percentage < 70) color = "var(--color-warning)";

            return (
              <div key={r.id} className={styles.resultCard}>
                <div className={styles.cardHeader}>
                  <div>
                    <div className={styles.subjectName}>{subject.name}</div>
                    <span className={styles.subjectCode}>{subject.code}</span>
                  </div>
                  <div className={styles.scoreCircle} style={{ background: color }}>
                    {percentage}%
                    <span className={styles.scoreLabel}>Score</span>
                  </div>
                </div>

                <div className={styles.statsRow}>
                  <div className={styles.statItem}>
                    <div className={styles.statValue}>{score} / {total}</div>
                    <div className={styles.statLabel}>Marks</div>
                  </div>
                  <div className={styles.statItem}>
                    <div className={styles.statValue}>{r.total_questions || 0}</div>
                    <div className={styles.statLabel}>Questions</div>
                  </div>
                </div>

                {subject.can_retake === 1 && (
                  <div style={{ marginTop: "0.5rem", display: "flex", justifyContent: "flex-end" }}>
                    <button 
                      className={styles.retakeBtn}
                      onClick={() => handleRetake(r.id, subject.id)}
                      disabled={retaking === r.id}
                    >
                      {retaking === r.id ? "Opening..." : "Retake Exam"}
                    </button>
                  </div>
                )}

                {r.teacher_remark && (
                  <div className={styles.teacherRemark}>
                    <div className={styles.remarkLabel}>Teacher Remark</div>
                    {r.teacher_remark}
                  </div>
                )}
                
                {r.principal_remark && (
                  <div className={styles.teacherRemark} style={{ borderLeftColor: "var(--color-warning)", background: "rgba(245, 158, 11, 0.05)" }}>
                    <div className={styles.remarkLabel} style={{ color: "var(--color-warning)" }}>Principal Remark</div>
                    {r.principal_remark}
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
