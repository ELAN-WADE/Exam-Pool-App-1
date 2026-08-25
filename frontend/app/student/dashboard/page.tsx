"use client";

import React, { useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { api } from "../../../lib/api";
import type { Subject, ExamResult, ActiveExamData } from "../../../lib/types";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useAuth } from "../../../hooks/useAuth";
import { useAcademic } from "../../../components/context/AcademicContext";
import { ConfirmDialog } from "../../../components/ui";
import { useToast } from "../../../hooks/useToast";
import {
  BookIcon,
  CheckCircleIcon,
  ClockIcon,
  CalendarIcon,
  GraduationCapIcon,
  DownloadIcon,
  SparklesIcon,
  DocumentIcon,
  ArrowRightIcon,
} from "../../../components/icons/Icons";
import styles from "./page.module.css";

// Animation Variants
const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.04,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: "easeOut" },
  },
};

export default function StudentDashboardPage() {
  return (
    <RequireRole role="student">
      <DashboardContent />
    </RequireRole>
  );
}

function DashboardContent() {
  const { user } = useAuth();
  const { selectedSession, selectedTerm } = useAcademic();
  const router = useRouter();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [results, setResults] = useState<ExamResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [selectedTab, setSelectedTab] = useState<"all" | "live" | "upcoming" | "completed">("all");
  const timeOffsetRef = useRef<number>(0);
  const navigatingRef = useRef(false);

  const [retaking, setRetaking] = useState<number | null>(null);
  const [retakeTarget, setRetakeTarget] = useState<{ examId: number; subjectId: number } | null>(null);
  const { showToast } = useToast();

  // Real Live Student Telemetry (Streak, Today's Goal, Cohort Rank)
  const [telemetry, setTelemetry] = useState<import("../../../lib/types").StudentTelemetry | null>(null);

  const fetchData = async (signal?: AbortSignal, isInitial = false) => {
    try {
      const [subjectsData, resultsData, activeData, telemetryData] = await Promise.all([
        api.getSubjects(selectedSession?.id, selectedTerm?.id),
        api.getResults(selectedSession?.id, selectedTerm?.id),
        api.getActiveExams(),
        api.getStudentTelemetry().catch(() => null),
      ]);

      if (signal?.aborted) return;

      if (telemetryData) {
        setTelemetry(telemetryData);
      }

      const payload = activeData as ActiveExamData;
      if (payload && payload.server_time) {
        const serverMs = new Date(payload.server_time).getTime();
        timeOffsetRef.current = serverMs - Date.now();
      }

      const now = Date.now() + timeOffsetRef.current;
      const activeOne = subjectsData.find((s) => {
        if (!s.exam_datetime) return false;
        const start = new Date(s.exam_datetime).getTime();
        const end = start + Number(s.window_duration || 120) * 60_000;
        const isTaken = resultsData.some((r) => Number(r.subject_id) === Number(s.id));
        return !isTaken && s.is_published === 1 && now >= start && now < end;
      });

      if (activeOne && !navigatingRef.current) {
        navigatingRef.current = true;
        router.replace(`/student/exam?subjectId=${activeOne.id}`);
        return;
      }

      setSubjects(subjectsData ?? []);
      setResults(resultsData ?? []);
    } catch (err: any) {
      if (signal?.aborted) return;
      if (isInitial) setError(err.message || "Failed to load dashboard data");
    } finally {
      if (!signal?.aborted && isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    const abortController = new AbortController();

    fetchData(abortController.signal, true).then(() => {
      if (!mounted) return;
    });
    const interval = setInterval(() => {
      fetchData(abortController.signal, false);
    }, 15000);
    const clockInterval = setInterval(() => setCurrentTime(Date.now() + timeOffsetRef.current), 1000);

    return () => {
      mounted = false;
      abortController.abort();
      clearInterval(interval);
      clearInterval(clockInterval);
    };
  }, [selectedSession?.id, selectedTerm?.id]);

  const takenIds = useMemo(() => new Set(results.map((r) => Number(r.subject_id))), [results]);

  const firstName = user?.name?.split(" ")[0] ?? "Student";

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

  // Group exams by status
  const { liveExams, upcomingExams, completedExams } = useMemo(() => {
    const now = currentTime;
    const live: Subject[] = [];
    const upcoming: Subject[] = [];
    const completed: Subject[] = [];

    for (const s of subjects) {
      const isTaken = takenIds.has(Number(s.id));
      if (isTaken) {
        completed.push(s);
        continue;
      }
      if (Number(s.is_published) !== 1) continue;

      if (!s.exam_datetime) {
        live.push(s);
        continue;
      }

      const start = new Date(s.exam_datetime).getTime();
      const end = start + Number(s.window_duration || 120) * 60_000;

      if (now >= start && now <= end) {
        live.push(s);
      } else if (now < start) {
        upcoming.push(s);
      } else {
        completed.push(s);
      }
    }
    return { liveExams: live, upcomingExams: upcoming, completedExams: completed };
  }, [subjects, takenIds, currentTime]);

  const filteredSubjects = useMemo(() => {
    if (selectedTab === "live") return liveExams;
    if (selectedTab === "upcoming") return upcomingExams;
    if (selectedTab === "completed") return completedExams;
    return subjects;
  }, [selectedTab, subjects, liveExams, upcomingExams, completedExams]);

  const recentSubmissions = useMemo(() => {
    return results
      .filter((r) => r.status === "completed")
      .slice(-3)
      .reverse();
  }, [results]);

  const dailyGoal = telemetry?.dailyGoal ?? 10;
  const todayQuestions = telemetry?.todayQuestions ?? 0;
  const practicePercent = telemetry?.practicePercent ?? (dailyGoal > 0 ? Math.min(Math.round((todayQuestions / dailyGoal) * 100), 100) : 0);

  const tabs: Array<{ id: "all" | "live" | "upcoming" | "completed"; label: string }> = [
    { id: "all", label: "All" },
    { id: "live", label: "Live" },
    { id: "upcoming", label: "Upcoming" },
    { id: "completed", label: "Completed" },
  ];

  return (
    <motion.div
      className={styles.container}
      initial="hidden"
      animate="visible"
      variants={containerVariants}
    >
      <ConfirmDialog
        open={!!retakeTarget}
        onClose={() => setRetakeTarget(null)}
        onConfirm={confirmRetake}
        title="Retake Examination"
        message="Your previous score will be archived and a new sitting attempt will be initialized."
        confirmLabel="Retake Sitting"
        loading={retaking !== null}
      />

      {/* ── 1. Hero Welcome & Quick Stats Section ── */}
      <motion.section className={styles.heroSection} variants={itemVariants}>
        <div className={styles.heroLeft}>
          <h1 className={styles.heroTitle}>
            Welcome back, <span className={styles.nameHighlight}>{firstName}</span>{" "}
            <span className={styles.waveEmoji}>👋</span>
          </h1>
          <p className={styles.heroSubtitle}>
            You&#39;re improving! Keep up the great work.
          </p>
        </div>

        {/* Triple Stat Cards: Day Streak, Today's Goal & Classmates Cohort */}
        <div className={styles.telemetryPillGroup}>
          {/* Flame Day Streak Card */}
          <motion.div
            className={styles.telemetryBadge}
            whileHover={{ y: -2 }}
            transition={{ duration: 0.2 }}
          >
            <div className={styles.streakIconBox}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#EA580C" stroke="#EA580C" strokeWidth="0.5">
                <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
              </svg>
            </div>
            <div className={styles.telemetryBadgeContent}>
              <span className={styles.telemetryNumber}>{telemetry?.streak ?? 0}</span>
              <span className={styles.telemetryText}>Day Streak</span>
              <span className={styles.telemetryCaption}>
                {telemetry?.bestStreak ? `Best: ${telemetry.bestStreak} ${telemetry.bestStreak === 1 ? "day" : "days"}` : "Start streak today!"}
              </span>
            </div>
          </motion.div>

          {/* Goal Card with Animated Progress Bar */}
          <motion.div
            className={styles.telemetryBadge}
            whileHover={{ y: -2 }}
            transition={{ duration: 0.2 }}
          >
            <div className={styles.goalIconBox}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#165AF6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <circle cx="12" cy="12" r="6"/>
                <circle cx="12" cy="12" r="2"/>
              </svg>
            </div>
            <div className={styles.telemetryBadgeContent}>
              <span className={styles.telemetryNumber}>{telemetry?.todayQuestions ?? 0}/{telemetry?.dailyGoal ?? 10}</span>
              <span className={styles.telemetryText}>Today&#39;s Goal</span>
              <div className={styles.goalProgressWrap}>
                <div className={styles.goalProgressBarTrack}>
                  <motion.div
                    className={styles.goalProgressBarFill}
                    initial={{ width: 0 }}
                    animate={{ width: `${telemetry?.practicePercent ?? 0}%` }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                  />
                </div>
                <span className={styles.goalProgressPct}>{telemetry?.practicePercent ?? 0}%</span>
              </div>
            </div>
          </motion.div>

          {/* Classmates & Cohort Size Card */}
          <motion.div
            className={styles.telemetryBadge}
            whileHover={{ y: -2 }}
            transition={{ duration: 0.2 }}
          >
            <div className={styles.cohortIconBox}>
              <GraduationCapIcon width="20" height="20" />
            </div>
            <div className={styles.telemetryBadgeContent}>
              <span className={styles.telemetryNumber}>{telemetry?.cohortTotal ?? 1}</span>
              <span className={styles.telemetryText}>Classmates</span>
              <span className={styles.telemetryCaption}>
                {user?.grade || telemetry?.cohortName ? `${user?.grade || telemetry?.cohortName} • Rank #${telemetry?.rank ?? 1}` : `Rank #${telemetry?.rank ?? 1} in cohort`}
              </span>
            </div>
          </motion.div>
        </div>
      </motion.section>

      {error && (
        <div style={{ padding: "0.85rem 1.25rem", background: "#FEF2F2", color: "#DC2626", borderRadius: "12px", border: "1px solid #FEE2E2", fontSize: "0.875rem" }}>
          <span>{error}</span>
        </div>
      )}

      {/* ── 2. Enrolled Academic Curriculum Track Container ── */}
      <motion.section className={styles.curriculumContainer} id="curriculum-track" variants={itemVariants}>
        <div className={styles.curriculumHeader}>
          <div className={styles.curriculumTitleGroup}>
            <div className={styles.trackIconBadge}>
              <GraduationCapIcon width="22" height="22" />
            </div>
            <div className={styles.trackDetails}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span className={styles.curriculumEyebrow}>Academic Track</span>
                {telemetry?.rank && (
                  <span style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#165AF6", background: "#EFF4FF", border: "1px solid #DBEAFE", borderRadius: "6px", padding: "0.1rem 0.45rem" }}>
                    Rank #{telemetry.rank} of {telemetry.cohortTotal}
                  </span>
                )}
              </div>
              <h2 className={styles.curriculumClassTitle}>
                {user?.grade || "JSS 3"}
              </h2>
            </div>
          </div>

          {/* Filter Tab Chips with Spring Underline Indicator */}
          <div className={styles.tabList}>
            {tabs.map((tab) => {
              const isActive = selectedTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSelectedTab(tab.id)}
                  className={`${styles.tabBtn} ${isActive ? styles.tabBtnActive : ""}`}
                >
                  <span>{tab.label}</span>
                  {isActive && (
                    <motion.div
                      layoutId="tabActiveUnderline"
                      className={styles.tabActiveUnderline}
                      transition={{ type: "spring", stiffness: 450, damping: 35 }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", padding: "3rem 1rem", color: "#64748B", fontSize: "0.875rem" }}>
            <div className="spinner" style={{ width: 22, height: 22, borderColor: "#E2E8F0", borderTopColor: "#165AF6" }} />
            <span>Loading enrolled subjects…</span>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {filteredSubjects.length === 0 ? (
              /* 3D-Styled Illustrated Empty State with Subtle Floating Motion */
              <motion.div
                key="empty"
                className={styles.emptySubjectsBox}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25 }}
              >
                <motion.div
                  className={styles.emptyIllustrationWrapper}
                  animate={{ y: [0, -5, 0] }}
                  transition={{ repeat: Infinity, duration: 3.5, ease: "easeInOut" }}
                >
                  <svg width="120" height="100" viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                    {/* Ambient Soft Shadow */}
                    <ellipse cx="60" cy="85" rx="45" ry="8" fill="#E2E8F0" opacity="0.6" />
                    {/* 3D Base Book */}
                    <path d="M25 65L60 78L95 65L95 55L60 68L25 55Z" fill="#CBD5E1" />
                    <path d="M25 55L60 68L95 55L95 45L60 58L25 45Z" fill="#E2E8F0" />
                    {/* Top Book Cover (Royal Blue) */}
                    <path d="M25 45L60 58L95 45L60 32Z" fill="#165AF6" />
                    <path d="M25 45L60 58L60 68L25 55Z" fill="#1248C8" />
                    {/* Open Book Spine Overlay */}
                    <path d="M60 32L95 45L95 55L60 42Z" fill="#3B82F6" />
                    {/* Bookmark Ribbon */}
                    <path d="M55 35L60 37L65 35L65 48L60 45L55 48Z" fill="#F59E0B" />
                    {/* Floating Micro Sparkles */}
                    <circle cx="20" cy="30" r="2.5" fill="#38BDF8" />
                    <circle cx="100" cy="35" r="2" fill="#FCD34D" />
                    <circle cx="85" cy="20" r="3" fill="#10B981" />
                    <path d="M32 20L34 24L38 26L34 28L32 32L30 28L26 26L30 24Z" fill="#818CF8" opacity="0.8" />
                  </svg>
                </motion.div>
                <div className={styles.emptyTextCol}>
                  <h3 className={styles.emptyTitle}>No subjects found in this tab</h3>
                  <p className={styles.emptySubtitle}>
                    Switch filter tabs or check with your class teacher for schedule updates.
                  </p>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="grid"
                className={styles.subjectGrid}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {filteredSubjects.map((s, idx) => {
                  const isTaken = takenIds.has(Number(s.id));
                  const isLive = liveExams.some((l) => l.id === s.id);
                  const isCore = idx === 0 || s.code?.toUpperCase().includes("ENG") || s.code?.toUpperCase().includes("MTH");

                  return (
                    <motion.div
                      key={s.id}
                      className={`${styles.subjectCard} ${isLive ? styles.subjectCardLive : ""}`}
                      whileHover={{ y: -3 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className={styles.subjectCardHeader}>
                        <div className={styles.subjectIconBox}>
                          <BookIcon width="16" height="16" />
                        </div>
                        {isCore && (
                          <span className={styles.coreBadge}>
                            CORE
                          </span>
                        )}
                      </div>

                      <h3 className={styles.subjectCardName}>{s.name}</h3>

                      <div className={styles.subjectCardFooter}>
                        {isTaken ? (
                          <Link href="/student/results" className={styles.subjectBtnResult}>
                            <span>View Result</span>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                          </Link>
                        ) : isLive ? (
                          <Link href={`/student/exam?subjectId=${s.id}`} className={styles.subjectBtnLive}>
                            <span>Enter Exam Hall →</span>
                          </Link>
                        ) : (
                          <Link href={`/student/practice?subjectId=${s.id}`} className={styles.subjectBtnPractice}>
                            <span>Practice →</span>
                          </Link>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </motion.section>

      {/* ── 3. 5-Tile Quick Action Matrix (Quick Action Cards) ── */}
      <motion.section className={styles.actionGrid} variants={itemVariants}>
        {/* 1. Start Mock Exam (Blue #165AF6) */}
        <Link href="/student/practice" className={styles.actionTile}>
          <div className={styles.actionTileHeader}>
            <div
              className={styles.actionTileIconBox}
              style={{ background: "#EFF4FF", color: "#165AF6", border: "1px solid #DBEAFE" }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <span className={styles.sparkleDot} style={{ color: "#165AF6" }}>✦</span>
          </div>
          <div className={styles.actionTileBody}>
            <span className={styles.actionTileTitle}>Start Mock Exam</span>
            <span className={styles.actionTileSubtitle}>Attempt a full mock exam now</span>
          </div>
          <div
            className={styles.actionTileArrowCircle}
            style={{ background: "#EFF4FF", color: "#165AF6" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </div>
        </Link>

        {/* 2. Practice Mode (Green #10B981) */}
        <Link href="/student/practice" className={styles.actionTile}>
          <div className={styles.actionTileHeader}>
            <div
              className={styles.actionTileIconBox}
              style={{ background: "#ECFDF5", color: "#10B981", border: "1px solid #A7F3D0" }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
              </svg>
            </div>
            <span className={styles.sparkleDot} style={{ color: "#10B981" }}>✦</span>
          </div>
          <div className={styles.actionTileBody}>
            <span className={styles.actionTileTitle}>Practice Mode</span>
            <span className={styles.actionTileSubtitle}>Practice questions by subject</span>
          </div>
          <div
            className={styles.actionTileArrowCircle}
            style={{ background: "#ECFDF5", color: "#10B981" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </div>
        </Link>

        {/* 3. Offline Hub (Amber #F59E0B) */}
        <Link href="/student/offline-assignments" className={styles.actionTile}>
          <div className={styles.actionTileHeader}>
            <div
              className={styles.actionTileIconBox}
              style={{ background: "#FEF3C7", color: "#F59E0B", border: "1px solid #FDE68A" }}
            >
              <DownloadIcon width="20" height="20" />
            </div>
            <span className={styles.sparkleDot} style={{ color: "#F59E0B" }}>✦</span>
          </div>
          <div className={styles.actionTileBody}>
            <span className={styles.actionTileTitle}>Offline Hub</span>
            <span className={styles.actionTileSubtitle}>Access downloaded content</span>
          </div>
          <div
            className={styles.actionTileArrowCircle}
            style={{ background: "#FEF3C7", color: "#F59E0B" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </div>
        </Link>

        {/* 4. Exam History (Red #EF4444) */}
        <Link href="/student/results" className={styles.actionTile}>
          <div className={styles.actionTileHeader}>
            <div
              className={styles.actionTileIconBox}
              style={{ background: "#FEE2E2", color: "#EF4444", border: "1px solid #FECACA" }}
            >
              <ClockIcon width="20" height="20" />
            </div>
            <span className={styles.sparkleDot} style={{ color: "#EF4444" }}>✦</span>
          </div>
          <div className={styles.actionTileBody}>
            <span className={styles.actionTileTitle}>Exam History</span>
            <span className={styles.actionTileSubtitle}>View your past exams</span>
          </div>
          <div
            className={styles.actionTileArrowCircle}
            style={{ background: "#FEE2E2", color: "#EF4444" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </div>
        </Link>

        {/* 5. Candidate ID (Purple #8B5CF6) */}
        <Link href="/student/settings" className={styles.actionTile}>
          <div className={styles.actionTileHeader}>
            <div
              className={styles.actionTileIconBox}
              style={{ background: "#EDE9FE", color: "#8B5CF6", border: "1px solid #DDD6FE" }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <circle cx="9" cy="10" r="2" />
                <line x1="15" y1="8" x2="17" y2="8" />
                <line x1="15" y1="12" x2="17" y2="12" />
                <line x1="7" y1="16" x2="17" y2="16" />
              </svg>
            </div>
            <span className={styles.sparkleDot} style={{ color: "#8B5CF6" }}>✦</span>
          </div>
          <div className={styles.actionTileBody}>
            <span className={styles.actionTileTitle}>Candidate ID</span>
            <span className={styles.actionTileSubtitle}>View &amp; manage your profile</span>
          </div>
          <div
            className={styles.actionTileArrowCircle}
            style={{ background: "#EDE9FE", color: "#8B5CF6" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </div>
        </Link>
      </motion.section>

      {/* ── 4. Two-Column Activity & Schedule Section ── */}
      <motion.section className={styles.feedGrid} variants={itemVariants}>
        {/* Left Column: Upcoming Examination Schedule */}
        <div className={styles.feedCard}>
          <div className={styles.feedHeader}>
            <div className={styles.feedTitleGroup}>
              <CalendarIcon width="18" height="18" style={{ color: "#165AF6" }} />
              <h3 className={styles.feedHeading}>Upcoming Examination Schedule</h3>
            </div>
            <Link href="/student/practice" className={styles.feedViewAll}>
              View All
            </Link>
          </div>

          <div className={styles.feedBody}>
            {upcomingExams.length === 0 && liveExams.length === 0 ? (
              <div className={styles.emptyFeed}>
                <ClockIcon width="24" height="24" style={{ color: "#94A3B8" }} />
                <span>No upcoming examinations currently scheduled.</span>
              </div>
            ) : (
              <>
                {/* Live Exam Item (if active) */}
                {liveExams.slice(0, 1).map((item) => {
                  const d = item.exam_datetime ? new Date(item.exam_datetime) : new Date();
                  const monthName = d.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
                  const dayNumber = d.getDate();
                  const weekdayName = d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();

                  return (
                    <div key={item.id} className={styles.scheduleItem}>
                      <div className={styles.scheduleLeft}>
                        <div className={styles.dateBadge}>
                          <span className={styles.dateMonth}>{monthName}</span>
                          <span className={styles.dateDay}>{dayNumber}</span>
                          <span className={styles.dateWeekday}>{weekdayName}</span>
                        </div>
                        <div className={styles.scheduleInfo}>
                          <div className={styles.scheduleTitleRow}>
                            <span className={styles.scheduleTitle}>{item.name}</span>
                            <span className={styles.statusPillLive}>• Live</span>
                          </div>
                          <span className={styles.scheduleMeta}>
                            Active Now · {item.window_duration || 120} mins
                          </span>
                        </div>
                      </div>
                      <Link href={`/student/exam?subjectId=${item.id}`} className={styles.scheduleBtnPrimary}>
                        Start Exam
                      </Link>
                    </div>
                  );
                })}

                {/* Upcoming Exam Items */}
                {upcomingExams.slice(0, liveExams.length > 0 ? 1 : 2).map((item) => {
                  const d = item.exam_datetime ? new Date(item.exam_datetime) : new Date(Date.now() + 86400000);
                  const monthName = d.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
                  const dayNumber = d.getDate();
                  const weekdayName = d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();

                  return (
                    <div key={item.id} className={styles.scheduleItem}>
                      <div className={styles.scheduleLeft}>
                        <div className={styles.dateBadge}>
                          <span className={styles.dateMonth}>{monthName}</span>
                          <span className={styles.dateDay}>{dayNumber}</span>
                          <span className={styles.dateWeekday}>{weekdayName}</span>
                        </div>
                        <div className={styles.scheduleInfo}>
                          <div className={styles.scheduleTitleRow}>
                            <span className={styles.scheduleTitle}>{item.name}</span>
                            <span className={styles.statusPillUpcoming}>• Upcoming</span>
                          </div>
                          <span className={styles.scheduleMeta}>
                            {d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} · {item.window_duration || 120} mins
                          </span>
                        </div>
                      </div>
                      <Link href={`/student/practice?subjectId=${item.id}`} className={styles.scheduleBtnSecondary}>
                        View Details
                      </Link>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* Right Column: Recent Submissions */}
        <div className={styles.feedCard}>
          <div className={styles.feedHeader}>
            <div className={styles.feedTitleGroup}>
              <CheckCircleIcon width="18" height="18" style={{ color: "#059669" }} />
              <h3 className={styles.feedHeading}>Recent Submissions</h3>
            </div>
            {recentSubmissions.length > 0 && (
              <Link href="/student/results" className={styles.feedViewAll}>
                View All
              </Link>
            )}
          </div>

          <div className={styles.feedBody}>
            {recentSubmissions.length === 0 ? (
              <div className={styles.emptyFeed}>
                <BookIcon width="24" height="24" style={{ color: "#94A3B8" }} />
                <span>No examination submissions recorded yet.</span>
              </div>
            ) : (
              recentSubmissions.map((res, index) => {
                const d = res.end_time ? new Date(res.end_time) : new Date();
                const formattedDate = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                const totalScore = Number(res.total_score || 100);
                const score = Number(res.score || 0);
                const scorePct = totalScore > 0 ? Math.round((score / totalScore) * 100) : 0;

                // Alternate subtle document icon backgrounds
                const iconColors = [
                  { bg: "#FEF3C7", color: "#F59E0B" },
                  { bg: "#EDE9FE", color: "#8B5CF6" },
                  { bg: "#ECFDF5", color: "#10B981" },
                ];
                const activeColor = iconColors[index % iconColors.length];

                return (
                  <div key={res.id} className={styles.submissionItem}>
                    <div className={styles.submissionLeft}>
                      <div
                        className={styles.docIconBox}
                        style={{ background: activeColor.bg, color: activeColor.color }}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                        </svg>
                      </div>
                      <div className={styles.submissionInfo}>
                        <span className={styles.submissionSubject}>
                          {res.subject_name || "Examination Paper"}
                        </span>
                        <span className={styles.submissionDate}>
                          Submitted on {formattedDate}
                        </span>
                      </div>
                    </div>
                    <div className={styles.scoreChipCol}>
                      <span className={styles.scorePercentText}>{scorePct}%</span>
                      <span className={styles.scoreLabelText}>Score</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </motion.section>
    </motion.div>
  );
}
