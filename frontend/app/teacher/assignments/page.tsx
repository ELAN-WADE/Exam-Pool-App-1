"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useState, useRef } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useAcademic } from "../../../components/context/AcademicContext";
import { api } from "../../../lib/api";
import type { Subject } from "../../../lib/types";
import { SubjectIcon, WarningIcon, EmptyBoxIcon, CalendarIcon, ClockIcon, BookIcon, UsersIcon, PlusIcon } from "../../../components/icons/Icons";
import { Skeleton } from "../../../components/ui/Skeleton";
import { EmptyState } from "../../../components/ui/EmptyState";
import { useToast } from "../../../hooks/useToast";
import dynamic from "next/dynamic";

const Modal = dynamic(() => import("../../../components/ui/Modal").then(mod => mod.Modal), { ssr: false });

export default function TeacherAssignmentsPage() {
  return (
    <RequireRole role="teacher">
      <TeacherAssignments />
    </RequireRole>
  );
}

function TeacherAssignments() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [questionCounts, setQuestionCounts] = useState<Record<number, number>>({});
  const { selectedSession, selectedTerm } = useAcademic();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", term: "", duration: "60", mode: "test", is_assignment: true });
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  const handleCreateAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createSubject({
        name: form.name,
        code: form.code,
        term: form.term,
        duration: Number(form.duration),
        exam_datetime: "", 
        teacher_id: 0, 
        mode: form.mode,
        is_assignment: form.is_assignment ? 1 : 0,
        can_retake: 1,
        session_id: selectedSession?.id,
        term_id: selectedTerm?.id,
      });
      showToast("Successfully created assessment", "success");
      setModalOpen(false);
      setForm({ name: "", code: "", term: "", duration: "60", mode: "test", is_assignment: true });
      
      const subs = await api.getSubjects(selectedSession?.id, selectedTerm?.id);
      if (subs) {
        setSubjects(subs.filter(s => s.is_assignment === 1));
      }
    } catch (err: any) {
      showToast(err.message || "Failed to create assessment", "error");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const abortController = new AbortController();
    const signal = abortController.signal;

    (async () => {
      try {
        const subs = await api.getSubjects(selectedSession?.id, selectedTerm?.id) ?? [];
        if (signal.aborted) return;
        
        const assignmentSubs = subs.filter(s => s.is_assignment === 1);
        setSubjects(assignmentSubs);
        
        const counts: Record<number, number> = {};
        await Promise.all(
          assignmentSubs.map(async (s) => {
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
      } catch (err: any) {
        if (!signal.aborted) setError(err.message || "Failed to load subjects");
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    })();
    return () => abortController.abort();
  }, []);

  if (loading) return (
    <>
      <div className="flex flex-col gap-4 animate-enter mb-6">
        <Skeleton width={200} height={36} />
        <div className="flex gap-2">
          <Skeleton width={72} height={28} borderRadius={999} />
          <Skeleton width={72} height={28} borderRadius={999} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={300} borderRadius={24} className="animate-enter" style={{ animationDelay: `${i * 50}ms` }} />
        ))}
      </div>
    </>
  );

  if (error) return (
    <div className="flex flex-col items-center gap-5 p-16 bg-danger-bg text-danger rounded-3xl border border-dashed border-danger-border text-center font-bold text-lg">
      <WarningIcon width="40" height="40" />
      <p>{error}</p>
    </div>
  );

  return (
    <>
      <div className="flex items-start justify-between pb-6">
        <div>
          <h1 className="text-3xl font-black text-text m-0 tracking-tight">My Assignments</h1>
          <p className="text-muted mt-1 font-medium">Manage take-home assignments and tasks</p>
          <div className="flex gap-2 mt-4 flex-wrap">
            <span className="bg-surface border border-border px-4 py-1.5 rounded-full text-sm font-semibold flex items-center gap-2 text-muted shadow-sm transition-all hover:shadow-md hover:border-border-hover">
              <span className="text-text font-black text-lg tracking-tight">{subjects.length}</span> Total
            </span>
            <span className="bg-surface border border-border px-4 py-1.5 rounded-full text-sm font-semibold flex items-center gap-2 text-muted shadow-sm transition-all hover:shadow-md hover:border-border-hover">
              <span className="text-primary font-black text-lg tracking-tight">{subjects.filter(s => !s.is_published).length}</span> Draft
            </span>
          </div>
        </div>
        <button className="bg-primary hover:bg-primary-dark text-white rounded-xl px-5 py-2.5 font-bold flex items-center gap-2 shadow-lg shadow-primary-glow transition-all hover:-translate-y-0.5" onClick={() => setModalOpen(true)}>
          <PlusIcon width="16" height="16" /> Create Assessment
        </button>
      </div>

      {subjects.length === 0 ? (
        <div className="animate-enter mt-4">
          <EmptyState
            title="No Assignments Found"
            description="You don't have any assignments yet. Click Create Assessment to get started."
            icon={<EmptyBoxIcon width="32" height="32" />}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {subjects.map((s, i: number) => {
            const qCount = questionCounts[Number(s.id)] ?? "…";
            const isLive = Boolean(s.is_published);
            return (
              <div key={s.id} className="bg-white border border-gray-100 rounded-[24px] p-6 flex flex-col gap-5 shadow-[0_4px_20px_-5px_rgba(0,0,0,0.05)] transition-all duration-400 hover:shadow-[0_20px_40px_-10px_rgba(0,0,0,0.08)] hover:-translate-y-1 hover:border-gray-200 animate-enter" style={{ animationDelay: `${i * 50}ms` }}>
                <div className="flex items-center justify-between">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-lg ${isLive ? 'bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 text-emerald-600 shadow-emerald-500/10' : 'bg-gradient-to-br from-teal-500/10 to-teal-500/5 text-teal-600 shadow-teal-500/10'}`}>
                    <SubjectIcon width="18" height="18" />
                  </div>
                  <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${isLive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                    {isLive ? "● Live" : "Draft"}
                  </span>
                </div>
                
                <div className="flex-1 flex flex-col gap-3">
                  <h3 className="text-xl font-extrabold text-slate-900 m-0 leading-snug tracking-tight truncate">{s.name}</h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-md font-bold tracking-wide">{s.code}</code>
                    <code className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-md font-bold tracking-wide">Term {s.term}</code>
                    <span className="text-xs text-sky-600 bg-sky-50 px-2 py-1 rounded-md font-bold tracking-wide">Assignment</span>
                  </div>

                  <div className="flex flex-col gap-2 mt-2">
                    <div className="flex items-center gap-2 text-sm text-slate-600 font-medium">
                      <CalendarIcon width="14" height="14" className="opacity-70" />
                      {s.exam_datetime ? new Date(s.exam_datetime).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Date TBA"}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-600 font-medium">
                      <ClockIcon width="14" height="14" className="opacity-70" />
                      {s.duration} min duration
                    </div>
                  </div>

                  <div className="flex gap-2 flex-wrap mt-2">
                    <span className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                      {qCount} Qs
                    </span>
                    <span className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                      {s.total_score ?? 0} Marks
                    </span>
                    {isLive && (
                      <span className="inline-flex items-center gap-1.5 bg-amber-50/50 border border-amber-200/50 px-2.5 py-1.5 rounded-lg text-xs font-bold text-amber-600">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        Locked
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-3 mt-auto pt-4 border-t border-slate-100">
                  <Link href={`/teacher/questions?subjectId=${s.id}${!isLive ? "&action=create" : ""}`} className="w-full text-center bg-teal-600 hover:bg-teal-700 text-white font-bold py-3 rounded-xl transition-colors shadow-sm text-sm">
                    {isLive ? "View Questions" : "Manage Questions"}
                  </Link>
                  <div className="flex gap-3">
                    <Link href={`/teacher/students?subjectId=${s.id}`} className="flex-1 flex items-center justify-center gap-2 bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-bold py-2.5 rounded-xl transition-colors text-xs">
                      <UsersIcon width="14" height="14" /> Students
                    </Link>
                    <Link href="/teacher/results" className="flex-1 flex items-center justify-center gap-2 bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-bold py-2.5 rounded-xl transition-colors text-xs">
                      <BookIcon width="14" height="14" /> Results
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Create Assessment Modal ── */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} size="md">
        <h2 className="text-2xl font-black mb-1">Create Assessment</h2>
        <p className="text-slate-500 text-sm mb-6">Create a class test, quiz, or a take-home assignment.</p>
        <form onSubmit={handleCreateAssessment} className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-bold text-slate-700">Name *</label>
              <input className="px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all font-medium" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Week 1 Quiz" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-bold text-slate-700">Code *</label>
              <input className="px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all font-medium" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. MTH101-Q1" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-bold text-slate-700">Term *</label>
              <input className="px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all font-medium" value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} placeholder="e.g. 2026-T1" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-bold text-slate-700">Duration (mins) *</label>
              <input className="px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all font-medium" type="number" min={1} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} required />
            </div>
          </div>
          
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-bold text-slate-700">Assessment Type *</label>
            <select className="px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all font-bold text-slate-700 cursor-pointer appearance-none" value={form.is_assignment ? "assignment" : form.mode} onChange={(e) => {
              const val = e.target.value;
              if (val === "assignment") {
                setForm({ ...form, mode: "test", is_assignment: true });
              } else {
                setForm({ ...form, mode: val, is_assignment: false });
              }
            }}>
              <option value="test">Class Test (Tier 2)</option>
              <option value="quiz">Class Quiz (Tier 2)</option>
              <option value="assignment">Take-Home Assignment (Tier 3)</option>
            </select>
            <div className="p-3 mt-2 bg-slate-50 rounded-xl text-sm text-slate-500 font-medium border border-slate-100">
              {form.is_assignment 
                ? "📚 Students will download this assignment to their app and complete it offline at home." 
                : "💻 Students will take this assessment in class using the school Wi-Fi network."}
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-slate-100">
            <button type="button" className="px-5 py-2.5 font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-all" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" className="px-6 py-2.5 font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-xl shadow-lg shadow-teal-500/20 transition-all hover:-translate-y-0.5" disabled={saving}>{saving ? "Creating..." : "Create Assessment"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
