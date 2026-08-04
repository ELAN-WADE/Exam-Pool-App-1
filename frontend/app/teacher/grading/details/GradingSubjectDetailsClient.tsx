"use client";

import React, { useEffect, useState, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { RequireRole } from "../../../../components/auth/RequireRole";
import { api } from "../../../../lib/api";
import { useAcademic } from "../../../../components/context/AcademicContext";
import { Skeleton } from "../../../../components/ui/Skeleton";
import { CheckIcon, WarningIcon } from "../../../../components/icons/Icons";

export default function GradingSubjectDetailsClient() {
  return (
    <RequireRole role="teacher">
      <Suspense fallback={<div className="p-6">Loading...</div>}>
        <GradingSubjectDetails />
      </Suspense>
    </RequireRole>
  );
}

function applyGradeScale(total: number, scale: any[], passMarkVal?: number | string | null): { grade: string; remark: string } {
  if (passMarkVal !== undefined && passMarkVal !== null && passMarkVal !== "") {
    const pm = Number(passMarkVal);
    if (total >= pm) return { grade: "PASS", remark: "Pass" };
    return { grade: "FAIL", remark: "Fail" };
  }
  const sorted = [...scale].sort((a: any, b: any) => b.min - a.min);
  for (const s of sorted) {
    if (total >= s.min) return { grade: s.grade, remark: s.label };
  }
  return { grade: "F", remark: "Fail" };
}

const DEFAULT_GRADE_SCALE = [
  { grade: "A", min: 75, label: "Excellent" },
  { grade: "B", min: 65, label: "Very Good" },
  { grade: "C", min: 55, label: "Credit" },
  { grade: "D", min: 45, label: "Pass" },
  { grade: "E", min: 40, label: "Poor Pass" },
  { grade: "F", min: 0,  label: "Fail" },
];

function GradeTag({ grade }: { grade: string }) {
  const color =
    grade === "A" || grade === "PASS" ? "bg-green-500/20 text-green-400 border-green-500/30"
    : grade === "B" ? "bg-teal-500/20 text-teal-400 border-teal-500/30"
    : grade === "C" ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
    : grade === "D" ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
    : grade === "E" ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
    : "bg-red-500/20 text-red-400 border-red-500/30";
  return (
    <span className={"inline-flex items-center justify-center min-w-[2.25rem] px-2 h-9 rounded-lg border font-bold text-sm " + color}>
      {grade}
    </span>
  );
}

function GradingSubjectDetails() {
  const searchParams = useSearchParams();
  const subjectId = Number(searchParams.get("id"));
  const { selectedSession, selectedTerm } = useAcademic();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"setup" | "sheet">("sheet");
  const [subjectDetails, setSubjectDetails] = useState<any>(null);
  const [gradingConfig, setGradingConfig] = useState<any>(null);
  const [policies, setPolicies] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [cbtScores, setCbtScores] = useState<Record<number, Record<number, number>>>({});
  const [termResults, setTermResults] = useState<any[]>([]);
  const [draftScores, setDraftScores] = useState<Record<number, Record<number, number | string>>>({});
  const [cbtSubjects, setCbtSubjects] = useState<any[]>([]);
  const [passMark, setPassMark] = useState<number | string>("");
  const [savingPolicies, setSavingPolicies] = useState(false);
  const [savingScores, setSavingScores] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      const [allSubs, cfg, pols, scoresData, cbtList] = await Promise.all([
        api.getGradingSubjects(selectedSession?.id, selectedTerm?.id),
        api.getGradingConfig(),
        api.getGradingPolicies(subjectId),
        api.getGradingScores(subjectId),
        api.getSubjects(selectedSession?.id, selectedTerm?.id),
      ]);

      const sub = (allSubs || []).find((s: any) => s.id === subjectId);
      setSubjectDetails(sub || null);
      setGradingConfig(cfg);
      setPolicies(pols || []);
      setCbtSubjects(cbtList || []);

      if (scoresData) {
        setStudents(scoresData.students || []);
        setCbtScores(scoresData.cbtScores || {});
        setTermResults(scoresData.termResults || []);
        setPassMark(scoresData.pass_mark ?? "");
        const draft: Record<number, Record<number, number>> = {};
        for (const ms of scoresData.manualScores || []) {
          if (!draft[ms.student_id]) draft[ms.student_id] = {};
          draft[ms.student_id]![ms.grading_policy_id] = ms.score;
        }
        setDraftScores(draft);
      }
    } catch (e: any) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [subjectId, selectedSession, selectedTerm]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const gradeScale = gradingConfig?.grade_scale ?? DEFAULT_GRADE_SCALE;
  const caMax      = gradingConfig?.ca_max      ?? 40;
  const examMax    = gradingConfig?.exam_max    ?? 60;
  const isApproved = termResults.length > 0 && termResults.every((r: any) => r.is_approved === 1);
  const caPolicies   = policies.filter(p => !p.is_exam);
  const examPolicies = policies.filter(p => p.is_exam  === 1);
  const caTotal      = caPolicies.reduce((s, p) => s + Number(p.max_marks || 0), 0);
  const examTotal    = examPolicies.reduce((s, p) => s + Number(p.max_marks || 0), 0);

  function addManualPolicy(isExam: boolean, name: string, marks: number) {
    if (isApproved) return;
    setPolicies(prev => [...prev, { name, type: "manual", max_marks: marks, is_exam: isExam ? 1 : 0 }]);
  }
  function removePolicy(idx: number) {
    if (isApproved) return;
    setPolicies(prev => prev.filter((_, i) => i !== idx));
  }
  function updatePolicy(idx: number, field: string, value: any) {
    if (isApproved) return;
    setPolicies(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx]!, [field]: value };
      if (field === "type" && value === "manual") next[idx]!.mapped_cbt_subject_id = null;
      return next;
    });
  }

  async function savePolicies() {
    if (caTotal !== caMax) return alert("CA total must be exactly " + caMax + " marks. Currently: " + caTotal);
    if (examTotal !== examMax) return alert("Exam total must be exactly " + examMax + " marks. Currently: " + examTotal);
    try {
      setSavingPolicies(true);
      await api.updateGradingPolicies(subjectId, { policies, pass_mark: passMark });
      await loadAll();
    } catch (e: any) { alert(e.message); }
    finally { setSavingPolicies(false); }
  }

  async function unapproveResults() {
    if (!confirm("Unlock these results for editing?")) return;
    try {
      setSavingScores(true);
      await api.unapproveGradingScores(subjectId);
      await loadAll();
    } catch (e: any) { alert(e.message); }
    finally { setSavingScores(false); }
  }

  function updateDraftScore(studentId: number, policyId: number, val: string, maxMarks: number) {
    if (isApproved) return;
    const num = val === "" ? "" : Math.min(Number(val), maxMarks);
    setDraftScores(prev => ({
      ...prev,
      [studentId]: { ...(prev[studentId] || {}), [policyId]: num },
    }));
  }

  async function saveScores() {
    try {
      setSavingScores(true);
      const payload: any[] = [];
      for (const st of students) {
        for (const p of policies) {
          if (p.type === "manual" && p.id) {
            const sc = draftScores[st.id]?.[p.id];
            if (sc !== undefined && sc !== "") payload.push({ grading_policy_id: p.id, student_id: st.id, score: Number(sc) });
          }
        }
      }
      await api.saveGradingScores(subjectId, payload);
      await loadAll();
    } catch (e: any) { alert(e.message); }
    finally { setSavingScores(false); }
  }

  async function approveResults() {
    if (caTotal !== caMax) return alert("CA must total " + caMax + " before approving. Currently: " + caTotal);
    if (examTotal !== examMax) return alert("Exam must total " + examMax + " before approving. Currently: " + examTotal);
    if (!confirm("Approve and lock these results? This cannot be undone by teachers.")) return;
    try {
      setSavingScores(true);

      // 1. Auto-save any entered manual scores to DB first so approval reads exact values
      const manualPayload: any[] = [];
      for (const st of students) {
        for (const p of policies) {
          if (p.type === "manual" && p.id) {
            const sc = draftScores[st.id]?.[p.id];
            if (sc !== undefined && sc !== "") {
              manualPayload.push({ grading_policy_id: p.id, student_id: st.id, score: Number(sc) });
            }
          }
        }
      }
      if (manualPayload.length > 0) {
        await api.saveGradingScores(subjectId, manualPayload);
      }

      // 2. Approve and lock term results
      const payload = students.map(st => {
        let caScore = 0, examScore = 0;
        for (const p of policies) {
          const score = p.type === "manual"
            ? Number(draftScores[st.id]?.[p.id] || 0)
            : Number(cbtScores[st.id]?.[p.id] || 0);
          if (p.is_exam) examScore += score; else caScore += score;
        }
        const totalScore = caScore + examScore;
        const scale = applyGradeScale(totalScore, gradeScale, passMark);
        return { student_id: st.id, ca_score: caScore, exam_score: examScore, total_score: totalScore, grade: scale.grade, remark: scale.remark, term_id: selectedTerm?.id, session_id: selectedSession?.id };
      });
      await api.approveGradingScores(subjectId, payload);
      await loadAll();
    } catch (e: any) { alert(e.message); }
    finally { setSavingScores(false); }
  }

  function getStudentTotal(st: any) {
    let total = 0;
    for (const p of policies) {
      if (!p.id) continue;
      total += p.type === "manual" ? Number(draftScores[st.id]?.[p.id] || 0) : Number(cbtScores[st.id]?.[p.id] || 0);
    }
    return total;
  }

  if (loading) return <div className="p-6 space-y-4"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>;
  if (error)   return <div className="p-6 text-red-400">{error}</div>;

  const canApprove = !isApproved && students.length > 0 && caTotal === caMax && examTotal === examMax;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Link href="/teacher/grading" className="text-primary hover:underline text-sm font-medium">
        &larr; Back to Grading Center
      </Link>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-primary/5 p-5 rounded-2xl border border-primary/20">
        <div>
          <h1 className="text-2xl font-bold text-primary uppercase">{subjectDetails?.name ?? "Loading..."}</h1>
          <p className="text-white/50 text-sm mt-0.5">{subjectDetails?.code}</p>
        </div>
        {isApproved ? (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-green-500/20 text-green-400 px-4 py-2 rounded-lg font-medium border border-green-500/30 text-sm">
              <CheckIcon /> Results Approved &amp; Locked
            </div>
            <button onClick={unapproveResults} disabled={savingScores} className="px-3 py-2 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 rounded-lg text-xs font-semibold transition-all">
              Unlock Results
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 bg-amber-500/10 text-amber-400 px-3 py-1.5 rounded-lg border border-amber-500/20 text-xs font-medium">
            Draft &mdash; Not yet approved
          </div>
        )}
      </div>

      <div className="flex gap-2 p-1 bg-[#111] border border-white/5 rounded-xl w-fit">
        {([["sheet", "Grade Sheet"], ["setup", "Score Setup"]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={"px-5 py-2 text-sm font-medium rounded-lg transition-all " +
              (activeTab === key ? "bg-primary text-white shadow-[0_2px_10px_rgba(var(--color-primary-rgb),0.2)]" : "text-white/40 hover:text-white/70 hover:bg-white/5")}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === "sheet" && (
        <div className="space-y-4">
          {students.length === 0 ? (
            <div className="bg-[#111] border border-white/5 rounded-2xl p-16 text-center shadow-sm">
              <div className="text-white/20 mb-5">
                <svg className="w-14 h-14 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
              </div>
              <h3 className="text-lg font-medium text-white/80 mb-2">No Students Yet</h3>
              <p className="text-white/40 text-sm max-w-md mx-auto leading-relaxed">Students appear here once they submit the linked CBT activity, or once you enter a manual score for them in Score Setup.</p>
            </div>
          ) : (
            <div className="bg-[#111] border border-white/5 rounded-2xl overflow-x-auto shadow-sm">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 bg-[#111] text-[11px] font-medium text-white/50 uppercase tracking-wider">
                    <th className="p-3 sticky left-0 bg-[#151515] z-10">Student</th>
                    {policies.map((p, i) => (
                      <th key={p.id ?? i} className="p-3 text-center whitespace-nowrap">
                        <div className="text-white/80 text-xs">{p.name}</div>
                        <div className="text-white/40 text-[10px]">{p.type === "manual" ? "manual" : "auto"} / {p.max_marks}pts</div>
                      </th>
                    ))}
                    <th className="p-3 text-center border-l border-white/5 bg-[#111] whitespace-nowrap">Total<br /><span className="text-[10px] text-white/30 font-normal normal-case">/ {caMax + examMax}</span></th>
                    <th className="p-3 text-center bg-[#111]">Grade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {students.map(st => {
                    const total = getStudentTotal(st);
                    const { grade } = applyGradeScale(total, gradeScale, passMark);
                    return (
                      <tr key={st.id} className="hover:bg-white/[0.02]">
                        <td className="p-3 sticky left-0 bg-[#111] z-10 border-r border-white/5">
                          <div className="font-medium text-white/90 text-sm">{st.name}</div>
                          <div className="text-white/40 text-xs font-mono">{st.reg_id}</div>
                        </td>
                        {policies.map((p, i) => {
                          const isCbt = p.type !== "manual";
                          const cbtVal = isCbt ? (p.mapped_cbt_subject_id ? cbtScores[st.id]?.[p.id] : undefined) : undefined;
                          return (
                            <td key={p.id ?? i} className="p-3 text-center">
                              {isCbt ? (
                                cbtVal !== undefined ? (
                                  <span className="inline-flex items-center justify-center min-w-[3rem] px-2 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 text-sm font-medium">{cbtVal}</span>
                                ) : (
                                  <span className="text-white/25 text-xs" title="Did not submit">&#x2014;</span>
                                )
                              ) : (
                                <input type="number" className="input w-20 text-center mx-auto bg-transparent border-white/20 focus:border-primary text-sm"
                                  value={draftScores[st.id]?.[p.id] ?? ""}
                                  onChange={e => updateDraftScore(st.id, p.id, e.target.value, p.max_marks)}
                                  disabled={isApproved || !p.id} min="0" max={p.max_marks} placeholder="0" />
                              )}
                            </td>
                          );
                        })}
                        <td className="p-3 text-center border-l border-white/5 bg-[#111]/50">
                          <span className="font-bold text-white/90">{total.toFixed(1)}</span>
                        </td>
                        <td className="p-3 text-center bg-[#111]/50"><GradeTag grade={grade} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!isApproved && students.length > 0 && (
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white/5 p-4 rounded-xl border border-white/10">
              <div className="flex gap-3 text-xs">
                <span className={"px-2 py-1 rounded font-medium " + (caTotal === caMax ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400")}>
                  CA: {caTotal}/{caMax} {caTotal === caMax ? "OK" : "!"}
                </span>
                <span className={"px-2 py-1 rounded font-medium " + (examTotal === examMax ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400")}>
                  Exam: {examTotal}/{examMax} {examTotal === examMax ? "OK" : "!"}
                </span>
              </div>
              <div className="flex gap-3">
                <button className="btn bg-white/10 hover:bg-white/20 text-white border-none px-5 text-sm" onClick={saveScores} disabled={savingScores}>
                  {savingScores ? "Saving..." : "Save Draft"}
                </button>
                <button
                  className={"btn border-none shadow-lg px-6 text-sm " + (canApprove ? "bg-green-500 hover:bg-green-600 text-white shadow-green-500/20" : "bg-white/10 text-white/30 cursor-not-allowed")}
                  onClick={approveResults} disabled={!canApprove || savingScores}>
                  Approve &amp; Lock Results
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "setup" && (
        <div className="space-y-8">
          {isApproved && (
            <div className="bg-blue-500/10 border border-blue-500/30 text-blue-400 p-4 rounded-xl text-sm flex items-center gap-2">
              <WarningIcon /> Setup is locked because results have been approved.
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-[#111] border border-white/5 rounded-2xl p-6 space-y-5 shadow-sm">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-white/90">Continuous Assessment</h3>
                <span className={"px-3 py-1 rounded-lg font-bold text-sm " + (caTotal === caMax ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400")}>
                  {caTotal} / {caMax} marks
                </span>
              </div>
              {caPolicies.map((p) => {
                const actualIdx = policies.indexOf(p);
                return (
                  <div key={actualIdx} className="p-4 bg-white/5 rounded-xl border border-white/10 space-y-3 relative">
                    {!isApproved && p.type === "manual" && (
                      <button className="absolute top-2 right-2 text-white/30 hover:text-red-400 text-sm" onClick={() => removePolicy(actualIdx)}>&#x2715;</button>
                    )}
                    {(p.type === "cbt_test" || p.type === "cbt_exam") ? (
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-white/80">{p.name}</p>
                          <p className="text-xs text-white/40 mt-0.5">Auto-scored &middot; {p.max_marks} marks</p>
                        </div>
                        <span className="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full">Locked</span>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-white/50 block mb-1">Name</label>
                          <input type="text" className="input w-full text-sm" value={p.name} onChange={e => updatePolicy(actualIdx, "name", e.target.value)} disabled={isApproved} />
                        </div>
                        <div>
                          <label className="text-xs text-white/50 block mb-1">Max Marks</label>
                          <input type="number" className="input w-full text-sm" value={p.max_marks} min={1} onChange={e => updatePolicy(actualIdx, "max_marks", Number(e.target.value))} disabled={isApproved} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {!isApproved && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {[["Quiz", 10], ["Assignment", 10], ["Classwork", 10], ["Project", 20]].map(([label, marks]) => (
                    <button key={label as string} className="text-xs px-3 py-1.5 rounded-lg border border-dashed border-white/20 text-white/50 hover:bg-white/5 hover:text-white/80 transition-colors" onClick={() => addManualPolicy(false, label as string, marks as number)}>
                      + {label}
                    </button>
                  ))}
                  <button className="text-xs px-3 py-1.5 rounded-lg border border-dashed border-white/20 text-white/50 hover:bg-white/5 hover:text-white/80 transition-colors" onClick={() => addManualPolicy(false, "Custom", 10)}>+ Custom</button>
                </div>
              )}
            </div>

            <div className="bg-[#111] border border-white/5 rounded-2xl p-6 space-y-5 shadow-sm">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-white/90">Examination</h3>
                <span className={"px-3 py-1 rounded-lg font-bold text-sm " + (examTotal === examMax ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400")}>
                  {examTotal} / {examMax} marks
                </span>
              </div>
              {examPolicies.map((p) => {
                const actualIdx = policies.indexOf(p);
                return (
                  <div key={actualIdx} className="p-4 bg-white/5 rounded-xl border border-white/10 space-y-3 relative">
                    {!isApproved && p.type === "manual" && (
                      <button className="absolute top-2 right-2 text-white/30 hover:text-red-400 text-sm" onClick={() => removePolicy(actualIdx)}>&#x2715;</button>
                    )}
                    {p.type === "cbt_exam" ? (
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-white/80">{p.name}</p>
                          <p className="text-xs text-white/40 mt-0.5">Auto-scored &middot; {p.max_marks} marks</p>
                        </div>
                        <span className="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full">Locked</span>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-white/50 block mb-1">Name</label>
                          <input type="text" className="input w-full text-sm" value={p.name} onChange={e => updatePolicy(actualIdx, "name", e.target.value)} disabled={isApproved} />
                        </div>
                        <div>
                          <label className="text-xs text-white/50 block mb-1">Max Marks</label>
                          <input type="number" className="input w-full text-sm" value={p.max_marks} min={1} onChange={e => updatePolicy(actualIdx, "max_marks", Number(e.target.value))} disabled={isApproved} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {!isApproved && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <button className="text-xs px-3 py-1.5 rounded-lg border border-dashed border-white/20 text-white/50 hover:bg-white/5 hover:text-white/80 transition-colors" onClick={() => addManualPolicy(true, "Written Exam", examMax)}>+ Written Exam</button>
                  <button className="text-xs px-3 py-1.5 rounded-lg border border-dashed border-white/20 text-white/50 hover:bg-white/5 hover:text-white/80 transition-colors" onClick={() => addManualPolicy(true, "Custom", 10)}>+ Custom</button>
                </div>
              )}
            </div>
          </div>

          {!isApproved && (
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-[#111] border border-white/5 rounded-2xl p-5 shadow-sm">
              <div>
                <p className="text-sm font-semibold text-white/90">Pass / Fail Cutoff (Optional)</p>
                <p className="text-xs text-white/40 mt-0.5">Enter a custom pass mark total (e.g. 40 or 50). If set, student results evaluate as PASS or FAIL.</p>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  className="input w-28 text-center text-sm"
                  placeholder="Pass mark"
                  value={passMark}
                  onChange={e => setPassMark(e.target.value)}
                  disabled={isApproved}
                  min="0" max={caMax + examMax}
                />
                <button className="btn btn-primary px-8 py-3 text-sm shadow-lg shadow-primary/20 whitespace-nowrap" onClick={savePolicies} disabled={savingPolicies}>
                  {savingPolicies ? "Saving..." : "Save Setup"}
                </button>
              </div>
            </div>
          )}

          {gradingConfig?.grade_scale && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <p className="text-sm font-semibold text-white/70 mb-3">School Grade Scale</p>
              <div className="flex flex-wrap gap-2">
                {(gradingConfig.grade_scale as any[]).map((s: any) => (
                  <div key={s.grade} className="text-center px-3 py-2 bg-white/5 rounded-lg border border-white/10">
                    <div className="font-bold text-white/90">{s.grade}</div>
                    <div className="text-xs text-white/50">{s.min}+</div>
                    <div className="text-[10px] text-white/40">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}