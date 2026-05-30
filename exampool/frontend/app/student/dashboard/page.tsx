"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useAuth } from "../../../hooks/useAuth";
import { BookIcon, CheckCircleIcon, EmptyBoxIcon, SubjectIcon, ClockIcon, CalendarIcon, PlayIcon } from "../../../components/icons/Icons";
import { Skeleton } from "../../../components/ui/Skeleton";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ProgressRing } from "../../../components/ui/ProgressRing";
import styles from "./page.module.css";

export default function StudentDashboardPage() {
  return (
    <RequireRole role="student">
      <DashboardContent />
    </RequireRole>
  );
}

function DashboardContent() {
  const { user } = useAuth();
  const [subjects,    setSubjects]    = useState<any[]>([]);
  const [results,     setResults]     = useState<any[]>([]);
  const [activeExams, setActiveExams] = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState("");
  const [currentTime, setCurrentTime] = useState(Date.now());

  const fetchData = async (isInitial = false) => {
    try {
      const [subjectsData, resultsData, activeData] = await Promise.all([
        api.getSubjects(),
        api.getResults(),
        api.getActiveExams(),
      ]);
      setSubjects((subjectsData as any[]) ?? []);
      setResults((resultsData as any[]) ?? []);
      setActiveExams((activeData as any[]) ?? []);
    } catch (err) {
      if (isInitial) setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    fetchData(true).then(() => { if (!mounted) return; });
    const interval = setInterval(() => { fetchData(false); }, 15000);
    const clockInterval = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => { 
      mounted = false; 
      clearInterval(interval); 
      clearInterval(clockInterval); 
    };
  }, []);

  const takenIds  = useMemo(() => new Set(results.map((r: any) => Number(r.subject_id))), [results]);
  const activeIds = useMemo(() => new Set(activeExams.map((e: any) => Number(e.subject_id))), [activeExams]);

  const stats = useMemo(() => {
    const taken = results.filter((r) => r.status === "completed");
    const avg = taken.length === 0 ? 0 : Math.round(
      taken.reduce((acc, curr) => {
        const total = Number(curr.total_score ?? 0);
        if (!total) return acc;
        return acc + (Number(curr.score ?? 0) / total) * 100;
      }, 0) / taken.length,
    );
    return { available: subjects.length, examsTaken: taken.length, avgScore: avg };
  }, [subjects, results]);

  const firstName = user?.name?.split(" ")[0] ?? "Student";

  if (loading) return (
    <div>
      <Skeleton height={130} borderRadius="var(--radius-xl)" className="animate-enter" style={{ marginBottom: "2rem" }} />
      <div className={styles.statsRow}>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} height={96} borderRadius="var(--radius-lg)" className="animate-enter" style={{ animationDelay: `${i * 50}ms` }} />
        ))}
      </div>
      <div className={styles.grid}>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} height={220} borderRadius="var(--radius-xl)" className="animate-enter" style={{ animationDelay: `${i * 50 + 150}ms` }} />
        ))}
      </div>
    </div>
  );

  if (error) return <p className={styles.error}>{error}</p>;

  return (
    <div>
      {/* Welcome Banner */}
      <div className={`${styles.welcomeBanner} animate-enter`}>
        <div className={styles.welcomeText}>
          <h1 className={styles.greeting}>Hello, {firstName}! 👋</h1>
          <p className={styles.sub}>{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} · {subjects.length} exam{subjects.length !== 1 ? "s" : ""} available</p>
        </div>
      </div>

      {/* Stats Row */}
      <div className={styles.statsRow}>
        <div className={`${styles.statCard} animate-enter`} style={{ animationDelay: "50ms", "--accent": "var(--color-primary)" } as React.CSSProperties}>
          <div className={styles.statIconBox} style={{ background: "var(--color-primary-glow)", color: "var(--color-primary)" }}>
            <BookIcon width="22" height="22" />
          </div>
          <div className={styles.statData}>
            <div className={styles.statValue}>{stats.available}</div>
            <div className={styles.statLabel}>Available</div>
          </div>
        </div>
        <div className={`${styles.statCard} animate-enter`} style={{ animationDelay: "100ms", "--accent": "var(--color-success)" } as React.CSSProperties}>
          <div className={styles.statIconBox} style={{ background: "var(--color-success-bg)", color: "var(--color-success)" }}>
            <CheckCircleIcon width="22" height="22" />
          </div>
          <div className={styles.statData}>
            <div className={styles.statValue}>{stats.examsTaken}</div>
            <div className={styles.statLabel}>Completed</div>
          </div>
        </div>
        <div className={`${styles.statCard} animate-enter`} style={{ animationDelay: "150ms", "--accent": "var(--color-warning)" } as React.CSSProperties}>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flex: 1 }}>
            <div className={styles.statData}>
              <div className={styles.statLabel} style={{ marginBottom: "0.25rem" }}>Avg Score</div>
            </div>
            <ProgressRing radius={28} stroke={4} progress={stats.avgScore} />
          </div>
        </div>
      </div>

      {/* Exam Cards */}
      <div className={styles.sectionHeader}>
        <span className={styles.sectionLabel}>Your Exams</span>
        <div className={styles.refreshIndicator}>
          <span className={`${styles.refreshDot} ${styles.spinning}`} />
          Auto-refreshing
        </div>
      </div>

      {subjects.length === 0 ? (
        <div className="animate-enter" style={{ animationDelay: "200ms" }}>
          <EmptyState
            title="No Exams Available"
            description="No exams have been published for your term yet. Check back later."
            icon={<EmptyBoxIcon width="32" height="32" />}
          />
        </div>
      ) : (
        <div className={styles.grid}>
          {subjects.filter((s: any) => {
            // Filter out exams that are not scheduled or are closed/upcoming if we strictly want to focus on taking exams.
            // But to be safe, let's just filter out ones with no exam_datetime, or if it's upcoming we just show it's scheduled.
            // The user requested to remove "upcoming exam scheduled when this is not exam schedule".
            // So we'll only show it if it's open, taken, or actively scheduled with a valid date.
            return s.exam_datetime != null;
          }).map((s: any, i: number) => {
            const examDate   = s.exam_datetime ? new Date(s.exam_datetime) : null;
            const now        = currentTime;
            const start      = examDate ? examDate.getTime() : 0;
            const end        = start + Number(s.duration) * 60_000;
            const isTaken    = takenIds.has(Number(s.id));
            const isActive   = activeIds.has(Number(s.id));
            const isOpen     = examDate != null && now >= start && now < end;
            const isClosed   = examDate != null && now >= end;
            const isUpcoming = examDate != null && now < start;

            const stripClass = isTaken ? styles.taken : isOpen ? styles.open : isUpcoming ? styles.upcoming : styles.closed;

            return (
            <div
                key={s.id}
                className={`${styles.card} ${(isClosed || isTaken) ? styles.cardDim : ""} ${isTaken ? styles.taken : isOpen ? styles.open : isUpcoming ? styles.upcoming : styles.closed} animate-enter`}
                style={{ animationDelay: `${200 + i * 50}ms` }}
              >
                <div className={styles.cardContent}>
                  <div className={styles.cardTop}>
                    <div className={`${styles.subjectIconBox} ${isOpen && !isTaken ? styles.openRing : ""}`}>
                      <SubjectIcon width="16" height="16" />
                    </div>
                    <div>
                      {isTaken    && <span className="badge badge-success">✓ Done</span>}
                      {!isTaken && isOpen     && <span className="badge badge-success">● Open</span>}
                      {!isTaken && isClosed   && <span className="badge badge-muted">Closed</span>}
                      {!isTaken && isUpcoming && <span className="badge badge-info">Upcoming</span>}
                      {!isTaken && !examDate  && <span className="badge badge-muted">TBA</span>}
                    </div>
                  </div>

                  <h3 className={styles.subjectName}>{s.name}</h3>
                  <code className={styles.code}>{s.code}</code>

                  <div className={styles.meta}>
                    {examDate && (
                      <div className={styles.metaRow}>
                        <CalendarIcon width="12" height="12" />
                        {examDate.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    )}
                    <div className={styles.metaRow}>
                      <ClockIcon width="12" height="12" />
                      {s.duration} minutes
                    </div>
                  </div>
                </div>

                <div className={styles.cardAction}>
                  {isTaken ? (
                    <Link href="/student/results" className={`btn btn-ghost ${styles.fullBtn}`}>View Result</Link>
                  ) : isActive ? (
                    <Link href={`/student/exam?subjectId=${s.id}`} className={`btn btn-warning ${styles.fullBtn}`}>
                      <PlayIcon width="13" height="13" /> Resume
                    </Link>
                  ) : isOpen ? (
                    <Link href={`/student/exam?subjectId=${s.id}`} className={`btn btn-primary ${styles.fullBtn}`}>
                      Start Exam →
                    </Link>
                  ) : (
                    <button className={`btn btn-ghost ${styles.fullBtn}`} disabled>
                      {isClosed ? "Exam Closed" : "Not Open Yet"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
