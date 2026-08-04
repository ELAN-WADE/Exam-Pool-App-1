"use client";

import React, { useEffect, useState } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { api } from "../../../lib/api";
import { useAcademic } from "../../../components/context/AcademicContext";
import { Skeleton } from "../../../components/ui/Skeleton";
import { WarningIcon } from "../../../components/icons/Icons";

export default function AnnualResultsPage() {
  return (
    <RequireRole role="operator">
      <AnnualResults />
    </RequireRole>
  );
}

function AnnualResults() {
  const { selectedSession } = useAcademic();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Server pre-computes these via SQL AVG — no client-side math needed
  const [studentAverages, setStudentAverages] = useState<any[]>([]);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [existingResults, setExistingResults] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, [selectedSession]);

  async function loadData() {
    try {
      setLoading(true);
      const data = await api.getAnnualResults(selectedSession?.id);
      setStudentAverages(data?.studentAverages || []);
      setEnrollments(data?.classEnrollments || []);
      setExistingResults(data?.existingResults || []);
    } catch (e: any) {
      setError(e.message || "Failed to load annual results");
    } finally {
      setLoading(false);
    }
  }

  async function handlePromote(studentId: number, classId: number, avg: number, status: string) {
    if (!confirm(`Mark this student as "${status}"?`)) return;
    try {
      await api.promoteStudent({
        student_id: studentId,
        session_id: selectedSession?.id,
        class_id: classId,
        total_average: avg,
        promotion_status: status,
      });
      loadData();
    } catch (e: any) {
      alert(e.message);
    }
  }

  function getDecision(studentId: number) {
    return existingResults.find((r: any) => r.student_id === studentId);
  }

  if (loading) return <div className="p-6"><Skeleton className="h-64 rounded-2xl" /></div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white/90">Annual Results &amp; Promotion</h1>
        <p className="text-white/60 mt-2 text-lg">
          Cumulative average of all approved term results — {selectedSession?.name || "Current Session"}.
        </p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-xl flex items-center gap-3">
          <WarningIcon /> {error}
        </div>
      )}

      <div className="bg-[#111] border border-white/10 rounded-2xl overflow-hidden overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-white/10 bg-white/5 text-sm font-medium text-white/60">
              <th className="p-4 w-[220px]">Student</th>
              <th className="p-4">Reg ID</th>
              <th className="p-4">Subjects</th>
              <th className="p-4">Terms</th>
              <th className="p-4">Annual Average</th>
              <th className="p-4">Decision</th>
              <th className="p-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {studentAverages.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-white/50">
                  No approved results found for this session.
                </td>
              </tr>
            ) : (
              studentAverages.map((sa: any) => {
                const avg = Number(sa.annual_average) || 0;
                const classId = enrollments.find((ce: any) => ce.student_id === sa.student_id)?.class_id || 0;
                const decision = getDecision(sa.student_id);

                return (
                  <tr key={sa.student_id} className="hover:bg-white/[0.02]">
                    <td className="p-4">
                      <div className="font-medium text-white/90">{sa.student_name}</div>
                    </td>
                    <td className="p-4 text-white/60">{sa.reg_id || "N/A"}</td>
                    <td className="p-4 text-white/60">{sa.subjects_count}</td>
                    <td className="p-4 text-white/60">{sa.terms_count}</td>
                    <td className="p-4">
                      <span className={`font-bold text-lg ${avg >= 50 ? "text-green-400" : "text-red-400"}`}>
                        {avg.toFixed(2)}%
                      </span>
                    </td>
                    <td className="p-4">
                      {decision ? (
                        <span className={`px-3 py-1 rounded-lg text-sm font-bold ${
                          decision.promotion_status === "Promoted" ? "bg-green-500/20 text-green-400"
                          : decision.promotion_status === "Graduated" ? "bg-blue-500/20 text-blue-400"
                          : "bg-red-500/20 text-red-400"
                        }`}>
                          {decision.promotion_status}
                        </span>
                      ) : (
                        <span className="text-white/30 text-sm">Pending</span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          className="btn bg-green-500/20 text-green-400 hover:bg-green-500/30 border-none btn-sm"
                          onClick={() => handlePromote(sa.student_id, classId, avg, "Promoted")}
                        >Promote</button>
                        <button
                          className="btn bg-red-500/20 text-red-400 hover:bg-red-500/30 border-none btn-sm"
                          onClick={() => handlePromote(sa.student_id, classId, avg, "Repeated")}
                        >Repeat</button>
                        <button
                          className="btn bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border-none btn-sm"
                          onClick={() => handlePromote(sa.student_id, classId, avg, "Graduated")}
                        >Graduate</button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

