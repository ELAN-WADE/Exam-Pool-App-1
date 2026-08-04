"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RequireRole } from "../../../components/auth/RequireRole";
import { ReportCardModal } from "../../../components/teacher/ReportCardModal";
import { api } from "../../../lib/api";
import type { Subject, ExamResult } from "../../../lib/types";
import { SubjectIcon, WarningIcon, EmptyBoxIcon, CalendarIcon, ClockIcon, BookIcon, UsersIcon, DocumentIcon, ClipboardIcon } from "../../../components/icons/Icons";
import { Skeleton } from "../../../components/ui/Skeleton";
import { useAcademic } from "../../../components/context/AcademicContext";
import { useAuth } from "../../../hooks/useAuth";

export default function TeacherDashboardPage() {
  return (
    <RequireRole role="teacher">
      <TeacherDashboard />
    </RequireRole>
  );
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } }
};

function TeacherDashboard() {
  const { user } = useAuth();
  const isClassTeacher = (user as any)?.is_class_teacher === true;
  const assignedClassName = (user as any)?.assigned_class_name;
  const { selectedSession, selectedTerm, activeSession, activeTerm } = useAcademic();
  const currentTermName = selectedTerm?.name || activeTerm?.name || "First Term";
  const currentSessionName = selectedSession?.name || activeSession?.name || "2026/2027";
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [questionCounts, setQuestionCounts] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Report card quick-launch
  const [reportStudents, setReportStudents] = useState<ExamResult[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportCardStudent, setReportCardStudent] = useState<ExamResult | null>(null);

  const loadReportStudents = useCallback(async (subs: Subject[], signal?: AbortSignal) => {
    setReportLoading(true);
    const allStudentMap: Record<number, ExamResult> = {};
    await Promise.all(
      subs.map(async (s) => {
        try {
          if (signal?.aborted) return;
          const students = await api.getSubjectStudents(Number(s.id));
          if (signal?.aborted) return;
          for (const st of students ?? []) {
            if (st.exam_status === "completed" && st.student_user_id && !allStudentMap[st.student_user_id]) {
              allStudentMap[st.student_user_id] = st as any;
            }
          }
        } catch { /* ignore */ }
      })
    );
    if (signal?.aborted) return;
    setReportStudents(Object.values(allStudentMap));
    setReportLoading(false);
  }, []);

  const subjectsRef = useRef<Subject[]>([]);

  useEffect(() => {
    const abortController = new AbortController();
    const signal = abortController.signal;

    (async () => {
      try {
        setLoading(true);
        const subs = await api.getSubjects(selectedSession?.id, selectedTerm?.id) ?? [];
        if (signal.aborted) return;
        
        const examSubs = subs.filter(s => s.is_assignment !== 1);
        subjectsRef.current = examSubs;
        setSubjects(examSubs);
        
        const counts: Record<number, number> = {};
        await Promise.all(
          examSubs.map(async (s) => {
            try {
              if (signal.aborted) return;
              const qs = await api.getQuestions(Number(s.id));
              if (signal.aborted) return;
              counts[Number(s.id)] = Array.isArray(qs) ? qs.length : 0;
            } catch {
              counts[Number(s.id)] = 0;
            }
          })
        );
        if (signal.aborted) return;
        setQuestionCounts(counts);
        await loadReportStudents(examSubs, signal);
      } catch (err: any) {
        if (!signal.aborted) setError(err.message || "Failed to load subjects");
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    })();
    return () => abortController.abort();
  }, [loadReportStudents, selectedSession?.id, selectedTerm?.id]);

  useEffect(() => {
    const handler = (e: Event) => {
      const notif = (e as CustomEvent).detail;
      if (notif?.type === "exam_submitted") {
        loadReportStudents(subjectsRef.current);
      }
    };
    window.addEventListener("notification_received", handler);
    return () => window.removeEventListener("notification_received", handler);
  }, [loadReportStudents]);

  if (loading) return (
    <div className="font-roboto flex flex-col gap-8">
      <div className="flex flex-col gap-4 animate-pulse">
        <Skeleton width={200} height={36} />
        <div className="flex gap-2">
          <Skeleton width={72} height={28} borderRadius={999} />
          <Skeleton width={72} height={28} borderRadius={999} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={300} borderRadius={24} />
        ))}
      </div>
    </div>
  );

  if (error) return (
    <div className="font-roboto flex flex-col items-center gap-5 p-16 bg-red-50/50 text-red-600 rounded-3xl border border-dashed border-red-200 text-center font-bold text-lg">
      <WarningIcon width="40" height="40" />
      <p>{error}</p>
    </div>
  );

  const published = subjects.filter((s) => s.is_published).length;
  const drafts = subjects.filter((s) => !s.is_published).length;

  return (
    <div className="font-roboto min-h-screen">
      <AnimatePresence>
        {reportCardStudent && (
          <ReportCardModal
            student={reportCardStudent}
            onClose={() => setReportCardStudent(null)}
          />
        )}
      </AnimatePresence>

      <motion.div 
        variants={containerVariants} 
        initial="hidden" 
        animate="visible"
        className="flex flex-col gap-8 pb-12"
      >
        {/* Welcome Banner Section */}
        <motion.div 
          variants={itemVariants} 
          className="relative overflow-hidden rounded-[28px] bg-gradient-to-r from-slate-900 via-teal-950 to-slate-900 p-6 md:p-8 text-white shadow-xl border border-teal-500/20"
        >
          <div className="absolute -top-12 -right-12 w-64 h-64 bg-teal-500/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-12 -left-12 w-64 h-64 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none" />
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="max-w-2xl">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/20 border border-teal-400/30 text-teal-300 text-xs font-bold uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
                  Active Academic Session
                </div>
                {isClassTeacher ? (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-400/30 text-amber-300 text-xs font-bold uppercase tracking-wider">
                    <span>👑</span> Class Teacher: {assignedClassName || "Assigned Class"}
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-500/20 border border-slate-400/30 text-slate-300 text-xs font-bold uppercase tracking-wider">
                    <span>📖</span> Subject Teacher
                  </div>
                )}
              </div>
              <h1 className="text-2xl md:text-3xl font-black text-white m-0 tracking-tight leading-snug">
                Welcome to {currentTermName} <span className="text-teal-400">({currentSessionName})</span>
              </h1>
              <p className="text-slate-300 mt-2 text-sm font-medium leading-relaxed">
                Manage your exam content, question banks, and student results smoothly for this published academic term.
              </p>
              {isClassTeacher && (
                <div className="mt-4">
                  <Link
                    href="/teacher/report-card"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black transition-all shadow-md hover:shadow-lg"
                  >
                    <span>📜</span> Open Class Report Cards ({assignedClassName}) &rarr;
                  </Link>
                </div>
              )}
            </div>
            <div className="flex flex-wrap md:flex-nowrap gap-3 shrink-0">
              <div className="bg-white/10 backdrop-blur-md border border-white/15 px-4 py-2.5 rounded-2xl text-xs font-semibold text-slate-200 flex items-center gap-2">
                <span className="text-white font-black text-lg">{subjects.length}</span> Total Subjects
              </div>
              <div className="bg-emerald-500/20 backdrop-blur-md border border-emerald-400/30 px-4 py-2.5 rounded-2xl text-xs font-semibold text-emerald-200 flex items-center gap-2">
                <span className="text-emerald-300 font-black text-lg">{published}</span> Live
              </div>
              <div className="bg-teal-500/20 backdrop-blur-md border border-teal-400/30 px-4 py-2.5 rounded-2xl text-xs font-semibold text-teal-200 flex items-center gap-2">
                <span className="text-teal-300 font-black text-lg">{drafts}</span> Drafts
              </div>
            </div>
          </div>
        </motion.div>

        {/* Header Section */}
        <motion.div variants={itemVariants} className="flex flex-col gap-4 md:flex-row md:items-end justify-between">
          <div>
            <h1 className="text-4xl font-black text-slate-900 m-0 tracking-tight">Overview</h1>
            <p className="text-slate-500 mt-1 font-medium text-sm">Manage your exam content and student results smoothly</p>
          </div>
          <div className="flex gap-3 mt-4 md:mt-0">
            <div className="bg-white border border-slate-200/60 px-4 py-2 rounded-full text-xs font-semibold flex items-center gap-2 text-slate-500 shadow-sm">
              <span className="text-slate-900 font-black text-base">{subjects.length}</span> Total
            </div>
            <div className="bg-white border border-slate-200/60 px-4 py-2 rounded-full text-xs font-semibold flex items-center gap-2 text-slate-500 shadow-sm">
              <span className="text-emerald-600 font-black text-base">{published}</span> Live
            </div>
            <div className="bg-white border border-slate-200/60 px-4 py-2 rounded-full text-xs font-semibold flex items-center gap-2 text-slate-500 shadow-sm">
              <span className="text-teal-600 font-black text-base">{drafts}</span> Draft
            </div>
          </div>
        </motion.div>

        {subjects.length === 0 ? (
          <motion.div variants={itemVariants} className="mt-4">
            <div className="flex flex-col items-center justify-center py-20 px-4 border border-dashed border-slate-200 rounded-[32px] bg-white/50 text-center">
              <div className="bg-slate-50 p-4 rounded-full mb-4">
                <EmptyBoxIcon width="32" height="32" className="text-slate-400" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">No Exams Assigned</h3>
              <p className="text-slate-500 text-sm max-w-sm">You don't have any exams yet. Contact your operator to get assigned to a subject.</p>
            </div>
          </motion.div>
        ) : (
          <motion.div variants={containerVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {subjects.map((s) => {
              const qCount = questionCounts[Number(s.id)] ?? "…";
              const isLive = Boolean(s.is_published);
              return (
                <motion.div 
                  key={s.id} 
                  variants={itemVariants}
                  whileHover={{ y: -6, transition: { duration: 0.2 } }}
                  className="bg-white border border-slate-100 rounded-[28px] p-6 flex flex-col gap-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_20px_40px_rgb(0,0,0,0.08)] transition-shadow duration-300 relative overflow-hidden group"
                >
                  {/* Status Indicator Glow */}
                  <div className={`absolute top-0 right-0 w-32 h-32 blur-3xl opacity-20 -mr-10 -mt-10 pointer-events-none transition-opacity group-hover:opacity-40 ${isLive ? 'bg-emerald-500' : 'bg-slate-400'}`} />

                  <div className="flex items-center justify-between relative z-10">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${isLive ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-600'}`}>
                      <SubjectIcon width="20" height="20" />
                    </div>
                    <span className={`px-3 py-1 rounded-full text-[10px] uppercase tracking-wider font-bold ${isLive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {isLive ? "Live" : "Draft"}
                    </span>
                  </div>
                  
                  <div className="flex-1 flex flex-col relative z-10">
                    <h3 className="text-xl font-black text-slate-900 m-0 leading-snug tracking-tight line-clamp-2">{s.name}</h3>
                    
                    <div className="flex items-center gap-2 mt-3">
                      <span className="text-[10px] uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-1 rounded-lg font-bold">{s.code}</span>
                      <span className="text-[10px] uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-1 rounded-lg font-bold">Term {s.term}</span>
                    </div>

                    <div className="flex flex-col gap-2 mt-5">
                      <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
                        <CalendarIcon width="14" height="14" className="opacity-60" />
                        {s.exam_datetime ? new Date(s.exam_datetime).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Date TBA"}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
                        <ClockIcon width="14" height="14" className="opacity-60" />
                        {s.duration} mins
                      </div>
                    </div>

                    <div className="flex gap-2 mt-4 pt-4 border-t border-slate-50/80">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                        {qCount} Qs
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                        {s.total_score ?? 0} Marks
                      </div>
                      {isLive && (
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-500 ml-auto">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                          Locked
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 mt-2 relative z-10">
                    <Link href={`/teacher/questions?subjectId=${s.id}${!isLive ? "&action=create" : ""}`} className="w-full text-center bg-slate-900 hover:bg-black text-white font-bold py-3.5 rounded-2xl transition-colors shadow-md text-sm">
                      {isLive ? "View Questions" : "Manage Questions"}
                    </Link>
                    <div className="flex gap-2">
                      <Link href={`/teacher/students?subjectId=${s.id}`} className="flex-1 flex items-center justify-center gap-2 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-bold py-3 rounded-2xl transition-colors text-xs">
                        <UsersIcon width="14" height="14" /> Students
                      </Link>
                      <Link href="/teacher/results" className="flex-1 flex items-center justify-center gap-2 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-bold py-3 rounded-2xl transition-colors text-xs">
                        <BookIcon width="14" height="14" /> Results
                      </Link>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}

        {/* Report Cards Section */}
        <motion.div variants={itemVariants} className="mt-8 bg-white border border-slate-100 rounded-[32px] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.03)]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div>
              <h2 className="text-2xl font-black m-0 text-slate-900 tracking-tight">Report Cards</h2>
              <p className="text-slate-500 text-sm mt-1">
                {isClassTeacher
                  ? `Compiled term report cards for ${assignedClassName || "your class"} and exam submissions`
                  : "Generate and preview report cards for students who completed exams in your subjects"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {isClassTeacher && (
                <Link
                  href="/teacher/report-card"
                  className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 rounded-xl transition-colors self-start sm:self-auto shadow-sm"
                >
                  <span>📜</span> Class Roster & Compiled Cards ({assignedClassName})
                </Link>
              )}
              <button
                className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-xl transition-colors self-start sm:self-auto"
                onClick={() => loadReportStudents(subjectsRef.current)}
                title="Refresh to see newly completed exams"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 009-9 9 9 0 015.657 2.343"/>
                  <polyline points="21 3 21 9 15 9"/>
                  <path d="M21 12a9 9 0 01-9 9 9 9 0 01-5.657-2.343"/>
                </svg>
                Refresh
              </button>
            </div>
          </div>

          {reportLoading ? (
            <div className="flex gap-4 overflow-hidden">
              {[1, 2, 3].map((i) => <Skeleton key={i} width={240} height={80} borderRadius={20} />)}
            </div>
          ) : reportStudents.length === 0 ? (
            <div className="bg-slate-50/50 rounded-2xl p-12 text-center flex flex-col items-center">
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
                <ClipboardIcon width="24" height="24" className="text-slate-300" />
              </div>
              <p className="font-bold text-slate-900 mb-1">No completed exams yet</p>
              <p className="text-sm text-slate-500">Students who have submitted exams will appear here.</p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
              {reportStudents.map((st) => (
                <motion.div
                  key={st.student_user_id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="bg-white border border-slate-100 hover:border-slate-300 shadow-sm hover:shadow-md rounded-[20px] p-4 flex items-center gap-4 cursor-pointer transition-colors"
                  onClick={() => setReportCardStudent(st)}
                >
                  <div className="w-12 h-12 rounded-full bg-slate-900 text-white flex items-center justify-center font-black text-lg shrink-0">
                    {String(st.student_name || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-sm truncate text-slate-900">{st.student_name}</div>
                    <div className="text-xs text-slate-500 mt-1 font-medium">{st.grade || "—"} · {st.reg_id || ""}</div>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center shrink-0">
                    <DocumentIcon width="14" height="14" className="text-slate-400" />
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
}
