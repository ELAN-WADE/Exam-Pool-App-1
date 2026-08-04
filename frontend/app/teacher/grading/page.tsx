"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { RequireRole } from "../../../components/auth/RequireRole";
import { api } from "../../../lib/api";
import { useAcademic } from "../../../components/context/AcademicContext";
import { Skeleton } from "../../../components/ui/Skeleton";

export default function GradingCenterPage() {
  return (
    <RequireRole role="teacher">
      <GradingCenter />
    </RequireRole>
  );
}

const IconExam = () => <svg className="w-3.5 h-3.5 mr-1 inline-block mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>;
const IconTest = () => <svg className="w-3.5 h-3.5 mr-1 inline-block mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>;
const IconQuiz = () => <svg className="w-3.5 h-3.5 mr-1 inline-block mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
const IconAssignment = () => <svg className="w-3.5 h-3.5 mr-1 inline-block mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>;

const MODE_STYLES: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  exam:       { label: "EXAM",       cls: "bg-blue-500/10 text-blue-400 border-blue-500/20",     icon: <IconExam /> },
  test:       { label: "TEST",       cls: "bg-amber-500/10 text-amber-400 border-amber-500/20",   icon: <IconTest /> },
  quiz:       { label: "QUIZ",       cls: "bg-purple-500/10 text-purple-400 border-purple-500/20", icon: <IconQuiz /> },
  assignment: { label: "ASSIGNMENT", cls: "bg-green-500/10 text-green-400 border-green-500/20",   icon: <IconAssignment /> },
};
function getModeStyle(mode?: string) {
  return MODE_STYLES[mode || "exam"] ?? MODE_STYLES.exam;
}

function GradingCenter() {
  const { selectedSession, selectedTerm } = useAcademic();
  const [subjects, setSubjects]           = useState<any[]>([]);
  const [gradingConfig, setGradingConfig] = useState<any>(null);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState("");

  useEffect(() => { loadData(); }, [selectedSession, selectedTerm]);

  async function loadData() {
    try {
      setLoading(true);
      setError("");
      const [subs, cfg] = await Promise.all([
        api.getGradingSubjects(selectedSession?.id, selectedTerm?.id),
        api.getGradingConfig(),
      ]);
      setSubjects(subs || []);
      setGradingConfig(cfg);
    } catch (e: any) {
      setError(e.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  const caMax   = gradingConfig?.ca_max   ?? 40;
  const examMax = gradingConfig?.exam_max ?? 60;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary uppercase">Grading Center</h1>
          <p className="text-white/50 mt-2 text-sm">
            Subjects appear automatically once students submit activities.
            {gradingConfig && (
              <span className="ml-2 text-white/40">
                School grading: <span className="text-primary/80">CA {caMax}pts</span> + <span className="text-blue-400/80">Exam {examMax}pts</span>
              </span>
            )}
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-xl text-sm flex items-center gap-2">
          ⚠️ {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-48 rounded-2xl" />)}
        </div>
      ) : subjects.length === 0 ? (
        <div className="bg-[#111] border border-white/5 rounded-2xl p-16 text-center shadow-sm">
          <div className="text-white/20 mb-5">
            <svg className="w-14 h-14 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
          </div>
          <h3 className="text-lg font-medium text-white/80 mb-2">No Completed Activities Yet</h3>
          <p className="text-white/40 max-w-md mx-auto text-sm leading-relaxed">
            Once students submit any exam, test, quiz, or assignment you have assigned,
            it will appear here automatically ready for grading.
          </p>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {subjects.map((sub, idx) => {
            const style     = getModeStyle(sub.mode);
            const completed = sub.students_completed ?? 0;
            const enrolled  = sub.students_enrolled  ?? 0;
            const progress  = enrolled > 0 ? Math.round((completed / enrolled) * 100) : 0;
            const avgPct    = sub.avg_score_pct != null ? String(sub.avg_score_pct) + "%" : "--";

            return (
              <motion.div
                key={sub.id}
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.06 }}
              >
                <Link href={"/teacher/grading/details?id=" + sub.id} className="block h-full">
                  <div className="group h-full bg-[#181a20] border border-white/10 p-6 rounded-2xl hover:bg-[#1f222a] hover:border-primary/50 transition-all duration-300 flex flex-col justify-between gap-5 shadow-lg shadow-black/40 hover:shadow-[0_4px_24px_rgba(var(--color-primary-rgb),0.15)]">
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex flex-wrap gap-1.5">
                          <span className={"text-[11px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider " + style.cls}>
                            {style.icon} {style.label}
                          </span>
                          {sub.is_approved && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full border border-green-500/30 bg-green-500/10 text-green-400 font-bold uppercase tracking-wider">
                              APPROVED
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-white/30 mt-0.5 whitespace-nowrap font-mono">{sub.code}</span>
                      </div>
                      <h3 className="text-base font-semibold text-white/90 leading-snug">{sub.name}</h3>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between text-xs text-white/50">
                        <span>{completed} of {enrolled} submitted</span>
                        <span className="text-white/60 font-medium">avg {avgPct}</span>
                      </div>
                      <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-primary rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: progress + "%" }}
                          transition={{ delay: idx * 0.06 + 0.3, duration: 0.6, ease: "easeOut" }}
                        />
                      </div>
                      <div className="flex justify-end">
                        <span className="text-xs text-primary/70 group-hover:text-primary transition-colors font-medium">
                          Open Grade Sheet
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </div>
  );
}
