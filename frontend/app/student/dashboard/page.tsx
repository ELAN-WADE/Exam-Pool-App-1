"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
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
      
      const now = Date.now();
      const activeOne = (subjectsData as any[]).find(s => {
        if (!s.exam_datetime) return false;
        const start = new Date(s.exam_datetime).getTime();
        const end = start + Number(s.window_duration || 120) * 60_000;
        const isTaken = (resultsData as any[]).some(r => Number(r.subject_id) === Number(s.id));
        return !isTaken && s.is_published === 1 && now >= start && now < end;
      });
      
      if (activeOne) {
        // Exam is live and published. Auto-route the student.
        router.replace(`/student/exam?subjectId=${activeOne.id}`);
        return;
      }

      setSubjects((subjectsData as any[]) ?? []);
      setResults((resultsData as any[]) ?? []);
      
      const activeDataPayload = (activeData as any)?.exams ?? activeData;
      setActiveExams((activeDataPayload as any[]) ?? []);
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
    const available = subjects.filter(s => !takenIds.has(Number(s.id))).length;
    return { available, examsTaken: taken.length, avgScore: avg };
  }, [subjects, results, takenIds]);

  const firstName = user?.name?.split(" ")[0] ?? "Student";

  // Auto-route instantly when the local clock hits the start time
  useEffect(() => {
    const activeOne = subjects.find(s => {
      if (!s.exam_datetime) return false;
      const start = new Date(s.exam_datetime).getTime();
      const end = start + Number(s.window_duration || 120) * 60_000;
      return !takenIds.has(Number(s.id)) && s.is_published === 1 && currentTime >= start && currentTime < end;
    });
    if (activeOne) {
      router.replace(`/student/exam?subjectId=${activeOne.id}`);
    }
  }, [currentTime, subjects, takenIds, router]);

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
          <p className={styles.sub}>{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} · {stats.available} exam{stats.available !== 1 ? "s" : ""} pending</p>
        </div>
      </div>

      {/* Stats Row */}
      <div className={styles.statsRow}>
        <div className={`${styles.statCard} animate-enter`} style={{ animationDelay: "50ms", "--accent": "var(--color-primary)" } as React.CSSProperties}>
          <div className={styles.statIconBox} style={{ background: "rgba(20, 184, 166, 0.12)", color: "var(--color-primary)" }}>
            <BookIcon width="22" height="22" />
          </div>
          <div className={styles.statData}>
            <div className={styles.statValue}>{stats.available}</div>
            <div className={styles.statLabel}>Available</div>
          </div>
        </div>
      </div>

      {/* Exam Categories */}
      {subjects.length === 0 ? (
        <div className="animate-enter" style={{ animationDelay: "200ms" }}>
          <EmptyState
            title="No Exams Available"
            description="No exams have been published for your term yet. Check back later."
            icon={<EmptyBoxIcon width="32" height="32" />}
          />
        </div>
      ) : (
        <div className={styles.categories}>
          {["active", "upcoming"].map((category) => {
            const categorySubjects = subjects.filter((s: any) => {
              const isTaken = takenIds.has(Number(s.id));
              if (!s.exam_datetime) {
                if (category === "active") return !isTaken && s.is_published === 1;
                return false;
              }
              const examDate = new Date(s.exam_datetime);
              const now = currentTime;
              const start = examDate.getTime();
              const end = start + Number(s.window_duration || 120) * 60_000;
              
              if (category === "active") return !isTaken && s.is_published === 1 && now >= start && now < end;
              if (category === "upcoming") return !isTaken && s.is_published === 1 && now < start;
              if (category === "past") return isTaken || now >= end;
              return false;
            });

            if (categorySubjects.length === 0) return null;

            return (
              <div key={category} className={styles.categorySection} style={{ marginBottom: "3rem" }}>
                <div className={styles.sectionHeader}>
                  <span className={styles.sectionLabel}>
                    {category === "active" ? "🔥 Open Now" : "📅 Upcoming Timetable"}
                  </span>
                  {category === "active" && (
                    <div className={styles.refreshIndicator}>
                      <span className={styles.refreshDot} />
                      Auto-refreshing
                    </div>
                  )}
                </div>

                <div className={styles.grid}>
                  {categorySubjects.map((s: any, i: number) => {
                    const isUnscheduled = !s.exam_datetime;
                    const examDate   = isUnscheduled ? new Date() : new Date(s.exam_datetime);
                    const now        = currentTime;
                    const start      = isUnscheduled ? 0 : examDate.getTime();
                    const end        = isUnscheduled ? Infinity : start + Number(s.window_duration || 120) * 60_000;
                    const isTaken    = takenIds.has(Number(s.id));
                    const isActive   = activeIds.has(Number(s.id));
                    const isOpen     = isUnscheduled ? true : (now >= start && now < end);
                    const isClosed   = isUnscheduled ? false : (now >= end);
                    const isUpcoming = isUnscheduled ? false : (now < start);
                    
                    let countdownText = "";
                    if (isUpcoming) {
                      const diffSeconds = Math.floor((start - now) / 1000);
                      const d = Math.floor(diffSeconds / 86400);
                      const h = Math.floor((diffSeconds % 86400) / 3600);
                      const m = Math.floor((diffSeconds % 3600) / 60).toString().padStart(2, "0");
                      const s = (diffSeconds % 60).toString().padStart(2, "0");
                      if (d > 0) countdownText = `${d}d ${h}h ${m}m ${s}s`;
                      else countdownText = `${h}h ${m}m ${s}s`;
                    }

                    return (
                      <div
                        key={s.id}
                        className={`${styles.card} ${(isClosed || isTaken) ? styles.cardDim : ""} ${isTaken ? styles.taken : isOpen ? styles.open : isUpcoming ? styles.upcoming : styles.closed} animate-enter`}
                        style={{ animationDelay: `${200 + i * 50}ms` }}
                      >
                        <div className={styles.cardContent}>
                          <div className={styles.cardTop}>
                            <div className={styles.subjectIconBox}>
                              <SubjectIcon width="16" height="16" />
                            </div>
                            <div>
                              {isTaken    && <span className="badge badge-success">✓ Done</span>}
                              {!isTaken && isOpen     && <span className="badge badge-success">● Open</span>}
                              {!isTaken && isClosed   && <span className="badge badge-muted">Closed</span>}
                              {!isTaken && isUpcoming && <span className="badge badge-info">Upcoming</span>}
                            </div>
                          </div>

                          <h3 className={styles.subjectName}>{s.name}</h3>
                          <code className={styles.code}>{s.code}</code>

                          <div className={styles.meta}>
                            {isUnscheduled ? (
                              <div className={styles.metaRow} style={{ color: "var(--color-primary)", fontWeight: 600 }}>
                                <CalendarIcon width="12" height="12" />
                                Available Anytime
                              </div>
                            ) : (
                              <div className={styles.metaRow}>
                                <CalendarIcon width="12" height="12" />
                                {examDate.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                              </div>
                            )}
                            <div className={styles.metaRow}>
                              <ClockIcon width="12" height="12" />
                              {s.duration} minutes
                            </div>
                            {isUpcoming && countdownText && (
                              <div className={styles.metaRow} style={{ color: "var(--color-primary)", fontWeight: 700, marginTop: "0.25rem" }}>
                                <ClockIcon width="12" height="12" />
                                Starts in: {countdownText}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className={styles.cardAction}>
                          {isTaken ? (
                            <button className={`btn btn-ghost ${styles.fullBtn}`} disabled>Exam Completed</button>
                          ) : isActive ? (
                            <Link href={`/student/exam?subjectId=${s.id}`} className={`btn ${styles.resumeBtn} ${styles.fullBtn}`}>
                              <PlayIcon width="13" height="13" /> Resume
                            </Link>
                          ) : isOpen ? (
                            <Link href={`/student/exam?subjectId=${s.id}`} className={`btn btn-primary ${styles.fullBtn}`} style={{ transform: "scale(1.02)", boxShadow: "0 4px 12px rgba(var(--color-primary-rgb), 0.3)" }}>
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
