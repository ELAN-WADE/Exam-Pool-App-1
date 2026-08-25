"use client";

import React, { useEffect, useState, useCallback, Suspense, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { RequireRole } from "../../../../components/auth/RequireRole";
import { api } from "../../../../lib/api";
import { useAcademic } from "../../../../components/context/AcademicContext";
import { useToast } from "../../../../hooks/useToast";
import { Skeleton } from "../../../../components/ui/Skeleton";
import { ConfirmDialog } from "../../../../components/ui/ConfirmDialog";
import { PageHeader, Tabs, Badge, Button } from "../../../../components/ui";
import { GradingWeightBar } from "../../../../components/domain/GradingWeightBar";
import { CheckIcon, WarningIcon, PlusIcon, TrashIcon } from "../../../../components/icons/Icons";

export default function GradingSubjectDetailsClient() {
  return (
    <RequireRole role="teacher">
      <Suspense fallback={<div className="p-6">Loading gradebook...</div>}>
        <GradingSubjectDetails />
      </Suspense>
    </RequireRole>
  );
}

function applyGradeScale(
  total: number,
  scale: any[],
  passMarkVal?: number | string | null,
  totalMax: number = 100
): { grade: string; remark: string } {
  if (passMarkVal !== undefined && passMarkVal !== null && passMarkVal !== "") {
    const pm = Number(passMarkVal);
    if (total >= pm) return { grade: "PASS", remark: "Pass" };
    return { grade: "FAIL", remark: "Fail" };
  }
  const pct = totalMax > 0 ? (total / totalMax) * 100 : total;
  const sorted = [...scale].sort((a: any, b: any) => b.min - a.min);
  for (const s of sorted) {
    if (pct >= s.min) return { grade: s.grade, remark: s.label };
  }
  return { grade: "F", remark: "Fail" };
}

const DEFAULT_GRADE_SCALE = [
  { grade: "A", min: 75, label: "Excellent" },
  { grade: "B", min: 65, label: "Very Good" },
  { grade: "C", min: 55, label: "Credit" },
  { grade: "D", min: 45, label: "Pass" },
  { grade: "E", min: 40, label: "Poor Pass" },
  { grade: "F", min: 0, label: "Fail" },
];

function GradeTag({ grade }: { grade: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0.15rem 0.5rem",
        fontSize: "0.75rem",
        fontWeight: 700,
        fontFamily: "var(--font-mono, monospace)",
        background: "var(--color-surface-2, #F1F5F9)",
        border: "1px solid var(--color-border, #E2E8F0)",
        borderRadius: "4px",
        color: "var(--color-text, #0F172A)",
      }}
    >
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
  const [activeTab, setActiveTab] = useState<string>("sheet");
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
  const { showToast } = useToast();
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const loadAll = useCallback(async () => {
    if (!subjectId || Number.isNaN(subjectId)) {
      setError("Invalid gradebook link — missing subject id. Return to the Gradebook Center and open a subject again.");
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError("");
      const [cfg, pols, scoresData, cbtList] = await Promise.all([
        api.getGradingConfig(),
        api.getGradingPolicies(subjectId),
        api.getGradingScores(subjectId),
        api.getSubjects(selectedSession?.id, selectedTerm?.id),
      ]);

      let sub: any = null;
      try {
        sub = await api.getGradingSubject(subjectId);
      } catch {
        const allSubs = await api.getGradingSubjects(selectedSession?.id, selectedTerm?.id).catch(() => []);
        sub = (allSubs || []).find((s: any) => Number(s.id) === subjectId) || null;
      }
      setSubjectDetails(sub || null);
      setGradingConfig(cfg);
      setPolicies(pols || []);
      setCbtSubjects(cbtList || []);

      if (scoresData) {
        setStudents(scoresData.students || []);
        setCbtScores(scoresData.cbtScores || {});
        setTermResults(scoresData.termResults || []);
        setPassMark(scoresData.pass_mark ?? "");
        const draft: Record<number, Record<number, number | string>> = {};
        const manualList: any[] = Array.isArray(scoresData.manualScores) ? scoresData.manualScores : (scoresData.manualScores ? Object.values(scoresData.manualScores).flat() as any[] : []);
        // Also handle manualMap shape: { policyId: { studentId: score } }
        if (Array.isArray(scoresData.manualScores)) {
          for (const ms of scoresData.manualScores || []) {
            const sid = Number(ms.student_id ?? ms.studentId);
            const pid = Number(ms.grading_policy_id ?? ms.policy_id);
            if (!Number.isFinite(sid) || !Number.isFinite(pid)) continue;
            if (!draft[sid]) draft[sid] = {};
            draft[sid]![pid] = Number(ms.score);
          }
        } else if (scoresData.manualScores && typeof scoresData.manualScores === 'object') {
          for (const [pidStr, studentMap] of Object.entries(scoresData.manualScores as Record<string, any>)) {
            const pid = Number(pidStr);
            if (!studentMap || typeof studentMap !== 'object') continue;
            for (const [sidStr, sc] of Object.entries(studentMap as Record<string, any>)) {
              const sid = Number(sidStr);
              if (!draft[sid]) draft[sid] = {};
              draft[sid]![pid] = Number(sc);
            }
          }
        }
        setDraftScores(draft);
      }
    } catch (e: any) {
      setError(e.message || "Failed to load gradebook");
    } finally {
      setLoading(false);
    }
  }, [subjectId, selectedSession, selectedTerm]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const gradeScale = gradingConfig?.grade_scale ?? DEFAULT_GRADE_SCALE;
  const isApproved = termResults.length > 0 && termResults.every((r: any) => r.is_approved === 1);
  const caPolicies = policies.filter((p) => !p.is_exam);
  const examPolicies = policies.filter((p) => p.is_exam === 1);
  const caTotal = caPolicies.reduce((s, p) => s + Number(p.max_marks || 0), 0);
  const examTotal = examPolicies.reduce((s, p) => s + Number(p.max_marks || 0), 0);
  const totalMax = caTotal + examTotal;

  function applyPreset(presetCa: number, presetExam: number) {
    if (isApproved) return;
    const newPolicies: any[] = [];
    if (presetExam > 0) {
      newPolicies.push({ name: "Written Exam", type: "manual", max_marks: presetExam, is_exam: 1 });
    }
    if (presetCa === 70) {
      newPolicies.push({ name: "Continuous Assessment Test", type: "manual", max_marks: 30, is_exam: 0 });
      newPolicies.push({ name: "Assignments", type: "manual", max_marks: 20, is_exam: 0 });
      newPolicies.push({ name: "Quiz / Practical", type: "manual", max_marks: 10, is_exam: 0 });
      newPolicies.push({ name: "Classwork & Attendance", type: "manual", max_marks: 10, is_exam: 0 });
    } else if (presetCa === 60) {
      newPolicies.push({ name: "Mid-Term Test", type: "manual", max_marks: 30, is_exam: 0 });
      newPolicies.push({ name: "Assignments", type: "manual", max_marks: 20, is_exam: 0 });
      newPolicies.push({ name: "Classwork", type: "manual", max_marks: 10, is_exam: 0 });
    } else if (presetCa === 50) {
      newPolicies.push({ name: "Mid-Term Test", type: "manual", max_marks: 25, is_exam: 0 });
      newPolicies.push({ name: "Assignments & Project", type: "manual", max_marks: 15, is_exam: 0 });
      newPolicies.push({ name: "Classwork", type: "manual", max_marks: 10, is_exam: 0 });
    } else if (presetCa === 40) {
      newPolicies.push({ name: "Mid-Term Test", type: "manual", max_marks: 20, is_exam: 0 });
      newPolicies.push({ name: "Assignment", type: "manual", max_marks: 10, is_exam: 0 });
      newPolicies.push({ name: "Classwork", type: "manual", max_marks: 10, is_exam: 0 });
    } else if (presetCa === 30) {
      newPolicies.push({ name: "Test 1", type: "manual", max_marks: 15, is_exam: 0 });
      newPolicies.push({ name: "Assignment & Quiz", type: "manual", max_marks: 15, is_exam: 0 });
    } else if (presetCa === 100) {
      newPolicies.push({ name: "Practical Assessment", type: "manual", max_marks: 40, is_exam: 0 });
      newPolicies.push({ name: "Continuous Tests", type: "manual", max_marks: 40, is_exam: 0 });
      newPolicies.push({ name: "Projects", type: "manual", max_marks: 20, is_exam: 0 });
    }
    setPolicies(newPolicies);
    showToast(`Applied ${presetCa}/${presetExam} grading breakdown`, "success");
  }

  function addManualPolicy(isExam: boolean, name: string, marks: number) {
    if (isApproved) return;
    setPolicies((prev) => [...prev, { name, type: "manual", max_marks: marks, is_exam: isExam ? 1 : 0 }]);
  }

  function removePolicy(idx: number) {
    if (isApproved) return;
    setPolicies((prev) => prev.filter((_, i) => i !== idx));
  }

  function updatePolicy(idx: number, field: string, value: any) {
    if (isApproved) return;
    setPolicies((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx]!, [field]: value };
      if (field === "type" && value === "manual") next[idx]!.mapped_cbt_subject_id = null;
      return next;
    });
  }

  async function savePolicies() {
    if (totalMax <= 0) return showToast("Please configure at least one assessment policy with marks > 0", "error");
    try {
      setSavingPolicies(true);
      await api.updateGradingPolicies(subjectId, { policies, pass_mark: passMark });
      showToast("Score setup saved successfully", "success");
      await loadAll();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Failed to save setup", "error");
    } finally {
      setSavingPolicies(false);
    }
  }

  async function unapproveResults() {
    setConfirmState({
      open: true,
      title: "Unlock Results?",
      message: "Unlock these results for editing? This will set them back to draft.",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          setSavingScores(true);
          await api.unapproveGradingScores(subjectId);
          await loadAll();
        } catch (e: unknown) {
          showToast(e instanceof Error ? e.message : "Failed to unlock", "error");
        } finally {
          setSavingScores(false);
        }
      },
    });
  }

  function updateDraftScore(studentId: number, policyId: number, val: string, maxMarks: number) {
    if (isApproved) return;
    const num = val === "" ? "" : Math.min(Number(val), maxMarks);
    setDraftScores((prev) => ({
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
            if (sc !== undefined && sc !== "") {
              payload.push({ grading_policy_id: p.id, student_id: st.id, score: Number(sc) });
            }
          }
        }
      }
      await api.saveGradingScores(subjectId, payload);
      showToast("Draft scores saved successfully", "success");
      await loadAll();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Failed to save scores", "error");
    } finally {
      setSavingScores(false);
    }
  }

  async function approveResults() {
    if (totalMax <= 0) return showToast("Total marks must be greater than 0 before approving.", "error");
    setConfirmState({
      open: true,
      title: "Approve & Lock Results?",
      message: `Approve and lock these results (${caTotal} CA + ${examTotal} Exam = ${totalMax} Total)? This will finalize scores for class teachers to compile report cards.`,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          setSavingScores(true);
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
          const payload = students.map((st) => {
            let caScore = 0,
              examScore = 0;
            for (const p of policies) {
              const score =
                p.type === "manual"
                  ? Number(draftScores[st.id]?.[p.id] || 0)
                  : Number(cbtScores[st.id]?.[p.id] || 0);
              if (p.is_exam) examScore += score;
              else caScore += score;
            }
            const totalScore = caScore + examScore;
            const scale = applyGradeScale(totalScore, gradeScale, passMark, totalMax);
            return {
              student_id: st.id,
              ca_score: caScore,
              exam_score: examScore,
              total_score: totalScore,
              grade: scale.grade,
              remark: scale.remark,
              term_id: selectedTerm?.id,
              session_id: selectedSession?.id,
            };
          });
          await api.approveGradingScores(subjectId, payload);
          showToast("Results approved and locked", "success");
          await loadAll();
        } catch (e: unknown) {
          showToast(e instanceof Error ? e.message : "Failed to approve", "error");
        } finally {
          setSavingScores(false);
        }
      },
    });
  }

  function getStudentTotal(st: any) {
    let total = 0;
    for (const p of policies) {
      if (!p.id) continue;
      total += p.type === "manual" ? Number(draftScores[st.id]?.[p.id] || 0) : Number(cbtScores[st.id]?.[p.id] || 0);
    }
    return total;
  }

  if (loading)
    return (
      <div className="p-6 space-y-4">
        <Skeleton height="3rem" />
        <Skeleton height="16rem" />
      </div>
    );
  if (error) return <div className="p-6 text-rose-600 font-semibold">{error}</div>;

  const canApprove = !isApproved && students.length > 0 && totalMax > 0;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <ConfirmDialog
        open={Boolean(confirmState?.open)}
        onClose={() => setConfirmState(null)}
        onConfirm={() => confirmState?.onConfirm()}
        title={confirmState?.title || ""}
        message={confirmState?.message || ""}
        loading={savingScores}
      />

      <Link
        href="/teacher/grading"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
      >
        &larr; Back to Subject Grading Center
      </Link>

      <PageHeader
        title={subjectDetails?.name ?? "Subject Gradebook"}
        subtitle={`${subjectDetails?.code || ""} · ${subjectDetails?.class || "All Cohorts"} · ${students.length} candidate(s)`}
        eyebrow="Continuous Assessment & Examination"
        badge={
          isApproved ? (
            <Badge variant="success" size="sm" dot>
              Approved & Locked
            </Badge>
          ) : (
            <Badge variant="warning" size="sm" dot>
              Draft Mode
            </Badge>
          )
        }
        actions={
          isApproved ? (
            <Button variant="outline" size="sm" onClick={unapproveResults} loading={savingScores}>
              Unlock Results
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={saveScores} loading={savingScores}>
                Save Draft
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={approveResults}
                disabled={!canApprove}
                loading={savingScores}
              >
                Approve & Lock
              </Button>
            </div>
          )
        }
      />

      {/* Tabs */}
      <Tabs
        tabs={[
          { id: "sheet", label: "Grade Sheet Matrix", count: students.length },
          { id: "setup", label: "Score Breakdown Setup", count: policies.length },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "sheet" && (
        <div className="space-y-4">
          {/* Weight Indicator */}
          <GradingWeightBar
            items={policies.map((p) => ({ name: p.name, weight: Number(p.max_marks) || 0 }))}
            maxTotal={100}
          />

          {students.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center shadow-xs">
              <h3 className="text-base font-bold text-slate-800 mb-1">No Student Scores Yet</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Students will appear here once they submit CBT tests or once you configure assessment policies in Score Setup.
              </p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-xs">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                    <th className="p-3.5 sticky left-0 bg-slate-50 z-10">Candidate</th>
                    {policies.map((p, i) => (
                      <th key={p.id ?? i} className="p-3.5 text-center whitespace-nowrap">
                        <div className="text-slate-900 font-bold">{p.name}</div>
                        <div className="text-slate-500 font-mono text-[10px]">
                          {p.type === "manual" ? "Manual" : "CBT Auto"} · {p.max_marks}pts
                        </div>
                      </th>
                    ))}
                    <th className="p-3.5 text-center border-l border-slate-200 bg-slate-100/60 font-bold">
                      Total (/ {totalMax || 100})
                    </th>
                    <th className="p-3.5 text-center bg-slate-100/60 font-bold">Grade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {students.map((st) => {
                    const total = getStudentTotal(st);
                    const { grade } = applyGradeScale(total, gradeScale, passMark, totalMax);
                    return (
                      <tr key={st.id} className="hover:bg-slate-50/80 transition">
                        <td className="p-3.5 sticky left-0 bg-white z-10 border-r border-slate-200">
                          <div className="font-bold text-slate-900">{st.name}</div>
                          <div className="text-slate-500 font-mono text-[11px]">{st.reg_id}</div>
                        </td>
                        {policies.map((p, i) => {
                          const isCbt = p.type !== "manual";
                          const cbtVal = isCbt
                            ? p.mapped_cbt_subject_id
                              ? cbtScores[st.id]?.[p.id]
                              : undefined
                            : undefined;
                          return (
                            <td key={p.id ?? i} className="p-3 text-center">
                              {isCbt ? (
                                cbtVal !== undefined ? (
                                  <span className="inline-flex items-center justify-center font-mono font-bold px-2 py-1 rounded bg-indigo-50 border border-indigo-200 text-indigo-700">
                                    {cbtVal}
                                  </span>
                                ) : (
                                  <span className="text-slate-400 font-mono italic">—</span>
                                )
                              ) : (
                                <input
                                  type="number"
                                  className="w-16 text-center font-mono font-bold text-xs p-1.5 rounded border border-slate-300 focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 outline-none transition bg-white"
                                  value={draftScores[st.id]?.[p.id] ?? ""}
                                  onChange={(e) => updateDraftScore(st.id, p.id, e.target.value, p.max_marks)}
                                  disabled={isApproved || !p.id}
                                  min="0"
                                  max={p.max_marks}
                                  placeholder="0"
                                />
                              )}
                            </td>
                          );
                        })}
                        <td className="p-3.5 text-center border-l border-slate-200 bg-slate-50/50 font-mono font-bold text-slate-900 text-sm">
                          {total.toFixed(1)}
                        </td>
                        <td className="p-3.5 text-center bg-slate-50/50">
                          <GradeTag grade={grade} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "setup" && (
        <div className="space-y-6">
          {/* Quick Presets */}
          {!isApproved && (
            <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-xs space-y-3">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <div>
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Quick Assessment Presets
                  </h3>
                  <p className="text-xs text-slate-500">Apply standard institution grading distributions:</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button variant="outline" size="xs" onClick={() => applyPreset(70, 30)}>
                    70% CA + 30% Exam
                  </Button>
                  <Button variant="outline" size="xs" onClick={() => applyPreset(60, 40)}>
                    60% CA + 40% Exam
                  </Button>
                  <Button variant="outline" size="xs" onClick={() => applyPreset(50, 50)}>
                    50% CA + 50% Exam
                  </Button>
                  <Button variant="outline" size="xs" onClick={() => applyPreset(40, 60)}>
                    40% CA + 60% Exam
                  </Button>
                  <Button variant="outline" size="xs" onClick={() => applyPreset(30, 70)}>
                    30% CA + 70% Exam
                  </Button>
                  <Button variant="outline" size="xs" onClick={() => applyPreset(100, 0)}>
                    100% Continuous Assessment
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Assessment Policies Config */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Configured Assessment Components ({policies.length})
              </h3>
              {!isApproved && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="xs"
                    leftIcon={<PlusIcon width="13" height="13" />}
                    onClick={() => addManualPolicy(false, "New CA Component", 10)}
                  >
                    + CA Item
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    leftIcon={<PlusIcon width="13" height="13" />}
                    onClick={() => addManualPolicy(true, "Final Examination", 60)}
                  >
                    + Exam Item
                  </Button>
                </div>
              )}
            </div>

            <div className="divide-y divide-slate-200 p-5 space-y-4">
              {policies.map((p, idx) => (
                <div key={idx} className="flex flex-wrap items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="flex-1 min-w-[180px]">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase">Name</label>
                    <input
                      type="text"
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs font-semibold text-slate-900 bg-white"
                      value={p.name}
                      disabled={isApproved}
                      onChange={(e) => updatePolicy(idx, "name", e.target.value)}
                    />
                  </div>

                  <div className="w-28">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase">Max Points</label>
                    <input
                      type="number"
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs font-mono font-bold text-slate-900 bg-white"
                      value={p.max_marks}
                      disabled={isApproved}
                      onChange={(e) => updatePolicy(idx, "max_marks", Number(e.target.value))}
                    />
                  </div>

                  <div className="w-32">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase">Category</label>
                    <select
                      className="w-full px-2 py-1.5 rounded border border-slate-300 text-xs font-semibold bg-white"
                      value={p.is_exam ? "1" : "0"}
                      disabled={isApproved}
                      onChange={(e) => updatePolicy(idx, "is_exam", Number(e.target.value))}
                    >
                      <option value="0">Continuous Assessment</option>
                      <option value="1">Final Exam</option>
                    </select>
                  </div>

                  {!isApproved && (
                    <button
                      type="button"
                      onClick={() => removePolicy(idx)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition border border-transparent mt-4"
                      title="Remove component"
                    >
                      <TrashIcon width="14" height="14" />
                    </button>
                  )}
                </div>
              ))}

              {!isApproved && (
                <div className="flex justify-end pt-3">
                  <Button variant="primary" size="sm" onClick={savePolicies} loading={savingPolicies}>
                    Save Assessment Breakdown
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}