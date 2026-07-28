"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useAcademic } from "../../../components/context/AcademicContext";
import { api } from "../../../lib/api";
import type { ExamResult, Subject } from "../../../lib/types";
import { BookIcon } from "../../../components/icons/Icons";
import { Skeleton } from "../../../components/ui/Skeleton";
import { StudentReviewModal } from "../../../components/student/StudentReviewModal";
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
  const [retaking, setRetaking] = useState<number | null>(null);
  const [reviewingExam, setReviewingExam] = useState<{ id: number, subjectName: string } | null>(null);
  const router = useRouter();

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    setLoading(true);

    Promise.all([api.getResults(selectedSession?.id, selectedTerm?.id), api.getSubjects(selectedSession?.id, selectedTerm?.id)])
      .then(([resData, subData]) => {
        if (signal.aborted) return;
        setResults((resData as ExamResult[])?.filter(r => r.status === "completed") ?? []);
        setSubjects((subData as Subject[]) ?? []);
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [selectedSession?.id, selectedTerm?.id]);

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
          {results.map((r) => {
            const subject = subjects.find((s) => s.id === r.subject_id) || { id: 0, name: "Unknown Subject", code: "—", can_retake: 0 } as Subject;
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
                  <div className={styles.scoreCircle} style={{ borderColor: color, color }}>
                    <div className={styles.scoreNumber}>{score}</div>
                    <div className={styles.scoreTotal}>/ {total}</div>
                  </div>
                </div>
                
                <div className={styles.cardFooter}>
                  <button 
                    onClick={() => setReviewingExam({ id: r.id, subjectName: subject.name })}
                    className="btn btn-secondary" style={{ flex: 1 }}
                  >
                    Review Exam
                  </button>

                  {subject.can_retake === 1 && (
                    <button
                      onClick={() => handleRetake(r.id, subject.id)}
                      disabled={retaking === r.id}
                      className="btn className" style={{ flex: 1 }}
                    >
                      {retaking === r.id ? "Resetting..." : "Retake Exam"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

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
