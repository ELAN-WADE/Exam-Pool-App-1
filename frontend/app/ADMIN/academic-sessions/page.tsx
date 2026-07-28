"use client";

import React, { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useAcademic } from "../../../components/context/AcademicContext";

export default function AcademicSessionsPage() {
  return (
    <RequireRole role="operator">
      <AcademicSessionsContent />
    </RequireRole>
  );
}

function AcademicSessionsContent() {
  const { activeSession, activeTerm, refreshAcademic } = useAcademic();
  const [sessions, setSessions] = useState<any[]>([]);
  const [terms, setTerms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [newSessionName, setNewSessionName] = useState("");
  const [selectedSessionForTerm, setSelectedSessionForTerm] = useState<number>(0);
  const [newTermName, setNewTermName] = useState<"First Term" | "Second Term" | "Third Term">("First Term");
  
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await api.getAcademicSessions();
      if (res) {
        setSessions(res.sessions || []);
        setTerms(res.terms || []);
        if (res.sessions?.length > 0 && !selectedSessionForTerm) {
          setSelectedSessionForTerm(res.sessions[0].id);
        }
      }
    } catch (err: any) {
      setMsg({ type: "error", text: err.message || "Failed to load sessions" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSessionName.trim()) return;
    try {
      const res = await api.createAcademicSession(newSessionName.trim());
      setMsg({ type: "success", text: res.message || "Academic session created!" });
      setNewSessionName("");
      await loadData();
      await refreshAcademic();
    } catch (err: any) {
      setMsg({ type: "error", text: err.message || "Failed to create session" });
    }
  };

  const handleCreateTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSessionForTerm) return;
    try {
      const res = await api.createAcademicTerm(selectedSessionForTerm, newTermName);
      setMsg({ type: "success", text: res.message || "Academic term created!" });
      await loadData();
      await refreshAcademic();
    } catch (err: any) {
      setMsg({ type: "error", text: err.message || "Failed to create term" });
    }
  };

  const handleActivateSession = async (sessionId: number) => {
    try {
      const res = await api.activateAcademicSession(sessionId);
      setMsg({ type: "success", text: res.message || "Session activated" });
      await loadData();
      await refreshAcademic();
    } catch (err: any) {
      setMsg({ type: "error", text: err.message || "Failed to activate session" });
    }
  };

  const handleActivateTerm = async (termId: number) => {
    try {
      const res = await api.activateAcademicTerm(termId);
      setMsg({ type: "success", text: res.message || "Term activated" });
      await loadData();
      await refreshAcademic();
    } catch (err: any) {
      setMsg({ type: "error", text: err.message || "Failed to activate term" });
    }
  };

  const handleEndTerm = async () => {
    if (!window.confirm("Are you sure you want to end the current term? This will deactivate the term and unpublish all subjects for this term.")) return;
    try {
      const res = await api.endTerm();
      setMsg({ type: "success", text: res.message || "Term ended" });
      await loadData();
      await refreshAcademic();
    } catch (err: any) {
      setMsg({ type: "error", text: err.message || "Failed to end term" });
    }
  };

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto space-y-8 font-body">
      <div>
        <h1 className="text-3xl font-black text-slate-900 tracking-tight">Academic Sessions & Terms</h1>
        <p className="text-slate-500 text-sm mt-1">
          Manage school academic sessions and term cycles. Publishing/activating a term isolates new dashboard data for teachers & students.
        </p>
      </div>

      {msg && (
        <div
          className={`p-4 rounded-2xl text-sm font-semibold flex items-center justify-between ${
            msg.type === "success" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="text-xs uppercase font-bold opacity-60 hover:opacity-100">Dismiss</button>
        </div>
      )}

      {/* Active Session & Term Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative flex flex-col justify-between hover:shadow-md transition">
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              Active Session
            </div>
            <div className="text-2xl font-black text-slate-900">{activeSession?.name || "None"}</div>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">System-wide active academic year. New subjects & exams default to this session.</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative flex flex-col justify-between hover:shadow-md transition">
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              Active Term
            </div>
            <div className="text-2xl font-black text-slate-900">{activeTerm?.name || "None"}</div>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">Student & Teacher dashboards display data for this published term.</p>
          </div>
          {activeTerm && (
            <div className="mt-5 pt-5 border-t border-slate-100">
              <button
                onClick={handleEndTerm}
                className="px-5 py-2 bg-white border border-red-200 hover:bg-red-50 hover:border-red-300 text-red-600 text-xs font-bold rounded-xl transition shadow-sm w-full sm:w-auto"
              >
                End Active Term
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Creation Forms */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Create Session Form */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 hover:shadow-md transition">
          <h2 className="text-sm font-bold text-slate-900">Create Academic Session</h2>
          <form onSubmit={handleCreateSession} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Session Name</label>
              <input
                type="text"
                placeholder="e.g. 2026/2027"
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition bg-slate-50 focus:bg-white"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition shadow-sm"
            >
              Add Session
            </button>
          </form>
        </div>

        {/* Create Term Form */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 hover:shadow-md transition">
          <h2 className="text-sm font-bold text-slate-900">Create Academic Term</h2>
          <form onSubmit={handleCreateTerm} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Target Session</label>
              <select
                value={selectedSessionForTerm}
                onChange={(e) => setSelectedSessionForTerm(Number(e.target.value))}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition bg-slate-50 focus:bg-white"
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.is_active ? "(Active)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Term Name</label>
              <select
                value={newTermName}
                onChange={(e) => setNewTermName(e.target.value as any)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition bg-slate-50 focus:bg-white"
              >
                <option value="First Term">First Term</option>
                <option value="Second Term">Second Term</option>
                <option value="Third Term">Third Term</option>
              </select>
            </div>
            <button
              type="submit"
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition shadow-sm"
            >
              Add Term
            </button>
          </form>
        </div>
      </div>

      {/* Sessions and Terms List */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden p-6 space-y-6">
        <h2 className="text-lg font-bold text-slate-900">All Academic Sessions & Published Terms</h2>

        {loading ? (
          <p className="text-sm text-slate-400">Loading sessions...</p>
        ) : (
          <div className="space-y-6">
            {sessions.map((s) => {
              const sessionTerms = terms.filter((t) => t.session_id === s.id);
              return (
                <div key={s.id} className="border border-slate-100 rounded-2xl p-5 bg-slate-50/50 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h3 className="text-sm font-black text-slate-900">{s.name}</h3>
                      {s.is_active === 1 ? (
                        <span className="px-2.5 py-1 bg-blue-50 text-blue-700 text-[10px] font-bold rounded-md border border-blue-100">
                          Active Session
                        </span>
                      ) : (
                        <button
                          onClick={() => handleActivateSession(s.id)}
                          className="px-2.5 py-1 bg-white border border-slate-200 hover:border-slate-300 text-slate-600 text-[10px] font-bold rounded-md transition shadow-sm"
                        >
                          Set Active Session
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                    {sessionTerms.length === 0 ? (
                      <p className="text-xs text-slate-400 col-span-3">No terms created for this session yet.</p>
                    ) : (
                      sessionTerms.map((t) => (
                        <div
                          key={t.id}
                          className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${
                            t.is_active === 1
                              ? "bg-blue-50/50 border-blue-200"
                              : "bg-white border-slate-200"
                          }`}
                        >
                          <div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{s.name}</div>
                            <div className="text-sm font-bold text-slate-800">{t.name}</div>
                          </div>

                          {t.is_active === 1 ? (
                            <span className="text-[10px] font-bold text-blue-700 inline-flex items-center gap-1.5 bg-white py-1 px-2 rounded-md border border-blue-100 w-max">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" /> Active Term
                            </span>
                          ) : (
                            <button
                              onClick={() => handleActivateTerm(t.id)}
                              className="w-full py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-[10px] font-bold rounded-lg transition shadow-sm"
                            >
                              Activate Term
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
