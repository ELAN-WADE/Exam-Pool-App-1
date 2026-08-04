"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useAcademic } from "../context/AcademicContext";
import {
  CalendarIcon,
  UsersIcon,
  BookIcon,
  DocumentIcon,
  CheckCircleIcon,
  BarChartIcon,
  RefreshIcon,
  ChevronRightIcon,
} from "../icons/Icons";

interface TermStat {
  term_id: number;
  term_name: string;
  is_active: number;
  completed_exams: number;
  avg_score: number | null;
  report_cards: number;
}

interface SessionSnapshot {
  session_id: number;
  session_name: string;
  is_active: number;
  start_date?: string | null;
  end_date?: string | null;
  stats: {
    total_students: number;
    total_teachers: number;
    total_subjects: number;
    completed_exams: number;
    avg_exam_score: number | null;
    report_cards_count: number;
    promoted_count: number;
    repeated_count: number;
    graduated_count: number;
  };
  terms: TermStat[];
}

export function SessionSnapshotCard() {
  const { sessions, terms, selectedSession, setSelectedSession, setSelectedTerm } = useAcademic();

  const [snapshots, setSnapshots] = useState<SessionSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedSessionId, setExpandedSessionId] = useState<number | null>(null);

  const fetchSnapshots = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.getSessionSnapshots();
      const list: SessionSnapshot[] = res.snapshots || [];
      setSnapshots(list);
      if (list.length > 0 && !expandedSessionId) {
        // Expand the active session or the first session by default
        const active = list.find((s) => s.is_active === 1) || list[0];
        setExpandedSessionId(active.session_id);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load session snapshots");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSnapshots();
  }, []);

  const handleFocusSession = (sessionId: number) => {
    const s = sessions.find((x) => x.id === sessionId);
    if (s) {
      setSelectedSession(s);
      const firstTerm = terms.find((t) => t.session_id === s.id);
      setSelectedTerm(firstTerm || null);
    }
  };

  return (
    <div style={{
      background: "var(--color-surface)",
      border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-xl, 14px)",
      padding: "1.5rem",
      marginBottom: "2rem",
      boxShadow: "0 4px 20px rgba(0, 0, 0, 0.04)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <span style={{ fontSize: "1.3rem" }}>📊</span>
            <h2 style={{ fontSize: "1.15rem", fontWeight: 800, margin: 0, color: "var(--color-text)" }}>
              Session Snapshots & Academic Historical Stats
            </h2>
          </div>
          <p style={{ color: "var(--color-muted)", fontSize: "0.825rem", margin: "0.25rem 0 0 0" }}>
            Comprehensive performance analytics, promotion metrics, and term breakdowns across past and present sessions.
          </p>
        </div>

        <button
          onClick={fetchSnapshots}
          className="btn btn-ghost btn-sm"
          style={{ fontSize: "0.8rem" }}
          disabled={loading}
        >
          <RefreshIcon width="14" height="14" /> Refresh
        </button>
      </div>

      {loading && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "2.5rem 0", gap: "0.75rem", color: "var(--color-muted)" }}>
          <div className="spinner" style={{ width: 20, height: 20 }} />
          <span>Aggregating session metrics…</span>
        </div>
      )}

      {error && (
        <div style={{ padding: "0.85rem 1rem", borderRadius: "8px", background: "#fef2f2", color: "#dc2626", fontSize: "0.85rem", marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {!loading && !error && snapshots.length === 0 && (
        <div style={{ textAlign: "center", padding: "2.5rem 1rem", color: "var(--color-muted)" }}>
          <CalendarIcon width="36" height="36" style={{ opacity: 0.4, margin: "0 auto 0.75rem" }} />
          <p style={{ fontWeight: 600, margin: 0 }}>No academic sessions registered yet.</p>
        </div>
      )}

      {/* Snapshots Grid */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {snapshots.map((snap) => {
          const isExpanded = expandedSessionId === snap.session_id;
          const isCurrentSelected = selectedSession?.id === snap.session_id;
          const stats = snap.stats || {
            total_students: (snap as any).total_students_enrolled ?? 0,
            total_teachers: (snap as any).total_teachers_active ?? 0,
            total_subjects: ((snap as any).grading_subjects_count ?? 0) + ((snap as any).cbt_subjects_count ?? 0),
            completed_exams: (snap as any).total_exams_completed ?? 0,
            avg_exam_score: (snap as any).avg_exam_pct ?? null,
            report_cards_count: (snap as any).total_report_cards ?? 0,
            promoted_count: (snap as any).promotions?.Promoted ?? 0,
            repeated_count: (snap as any).promotions?.Repeated ?? 0,
            graduated_count: (snap as any).promotions?.Graduated ?? 0,
          };
          const termsList = snap.terms || [];

          return (
            <div
              key={snap.session_id}
              style={{
                border: isCurrentSelected ? "1.5px solid var(--color-primary)" : "1px solid var(--color-border)",
                borderRadius: "12px",
                background: "var(--color-surface-2)",
                overflow: "hidden",
                transition: "all 0.2s ease",
              }}
            >
              {/* Session Banner / Accordion Header */}
              <div
                onClick={() => setExpandedSessionId(isExpanded ? null : snap.session_id)}
                style={{
                  padding: "1rem 1.25rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  cursor: "pointer",
                  userSelect: "none",
                  background: isExpanded ? "rgba(99, 102, 241, 0.05)" : "transparent",
                  flexWrap: "wrap",
                  gap: "0.75rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "1.25rem", fontWeight: 800, color: "var(--color-text)" }}>
                    {snap.session_name}
                  </span>

                  {snap.is_active === 1 && (
                    <span className="badge badge-success" style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem" }}>
                      Active School Session
                    </span>
                  )}

                  {isCurrentSelected && (
                    <span className="badge badge-primary" style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem" }}>
                      Currently Viewing
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleFocusSession(snap.session_id);
                    }}
                    className={`btn btn-sm ${isCurrentSelected ? "btn-ghost" : "btn-primary"}`}
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.65rem" }}
                  >
                    {isCurrentSelected ? "Filtered" : "Filter Dashboard View"}
                  </button>

                  <span style={{ fontSize: "0.85rem", color: "var(--color-muted)", transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s ease" }}>
                    ▶
                  </span>
                </div>
              </div>

              {/* Collapsible Content */}
              {isExpanded && (
                <div style={{ padding: "1.25rem", borderTop: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
                  {/* Metric Cards Row */}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                    gap: "0.75rem",
                    marginBottom: "1.25rem",
                  }}>
                    <div style={{ padding: "0.75rem", borderRadius: "10px", background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
                      <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", fontWeight: 600 }}>Students</div>
                      <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--color-primary)", marginTop: "0.2rem" }}>
                        {stats.total_students ?? 0}
                      </div>
                    </div>

                    <div style={{ padding: "0.75rem", borderRadius: "10px", background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
                      <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", fontWeight: 600 }}>Teachers</div>
                      <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--color-success)", marginTop: "0.2rem" }}>
                        {stats.total_teachers ?? 0}
                      </div>
                    </div>

                    <div style={{ padding: "0.75rem", borderRadius: "10px", background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
                      <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", fontWeight: 600 }}>Subjects</div>
                      <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--color-warning)", marginTop: "0.2rem" }}>
                        {stats.total_subjects ?? 0}
                      </div>
                    </div>

                    <div style={{ padding: "0.75rem", borderRadius: "10px", background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
                      <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", fontWeight: 600 }}>Exams Completed</div>
                      <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--color-purple)", marginTop: "0.2rem" }}>
                        {stats.completed_exams ?? 0}
                      </div>
                    </div>

                    <div style={{ padding: "0.75rem", borderRadius: "10px", background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
                      <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", fontWeight: 600 }}>Avg Score</div>
                      <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--color-primary)", marginTop: "0.2rem" }}>
                        {stats.avg_exam_score != null ? `${stats.avg_exam_score}%` : "—"}
                      </div>
                    </div>

                    <div style={{ padding: "0.75rem", borderRadius: "10px", background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
                      <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", fontWeight: 600 }}>Report Cards</div>
                      <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--color-text)", marginTop: "0.2rem" }}>
                        {stats.report_cards_count ?? 0}
                      </div>
                    </div>
                  </div>

                  {/* Promotion Stats & Term Breakdown */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
                    {/* Promotion Breakdown */}
                    <div style={{
                      padding: "1rem",
                      borderRadius: "10px",
                      background: "var(--color-surface-2)",
                      border: "1px solid var(--color-border)",
                    }}>
                      <div style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "0.6rem", color: "var(--color-text)" }}>
                        🎓 Annual Promotion & Decision Metrics
                      </div>
                      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: 70, textAlign: "center", padding: "0.5rem", borderRadius: "8px", background: "rgba(16, 185, 129, 0.1)" }}>
                          <div style={{ fontSize: "0.72rem", color: "var(--color-success)", fontWeight: 700 }}>PROMOTED</div>
                          <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "var(--color-success)" }}>
                            {stats.promoted_count ?? 0}
                          </div>
                        </div>

                        <div style={{ flex: 1, minWidth: 70, textAlign: "center", padding: "0.5rem", borderRadius: "8px", background: "rgba(239, 68, 68, 0.1)" }}>
                          <div style={{ fontSize: "0.72rem", color: "#dc2626", fontWeight: 700 }}>REPEATED</div>
                          <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#dc2626" }}>
                            {stats.repeated_count ?? 0}
                          </div>
                        </div>

                        <div style={{ flex: 1, minWidth: 70, textAlign: "center", padding: "0.5rem", borderRadius: "8px", background: "rgba(99, 102, 241, 0.1)" }}>
                          <div style={{ fontSize: "0.72rem", color: "var(--color-primary)", fontWeight: 700 }}>GRADUATED</div>
                          <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "var(--color-primary)" }}>
                            {stats.graduated_count ?? 0}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Terms Breakdown */}
                    <div style={{
                      padding: "1rem",
                      borderRadius: "10px",
                      background: "var(--color-surface-2)",
                      border: "1px solid var(--color-border)",
                    }}>
                      <div style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "0.6rem", color: "var(--color-text)" }}>
                        📅 Term-by-Term Progress
                      </div>

                      {termsList.length === 0 ? (
                        <div style={{ fontSize: "0.8rem", color: "var(--color-muted)" }}>No terms recorded for this session.</div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                          {termsList.map((t) => (
                            <div
                              key={t.term_id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "0.4rem 0.6rem",
                                borderRadius: "6px",
                                background: "var(--color-surface)",
                                border: "1px solid var(--color-border)",
                                fontSize: "0.8rem",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                                <span style={{ fontWeight: 700 }}>{t.term_name}</span>
                                {t.is_active === 1 && (
                                  <span className="badge badge-success" style={{ fontSize: "0.65rem", padding: "0.1rem 0.35rem" }}>
                                    Active
                                  </span>
                                )}
                              </div>

                              <div style={{ display: "flex", gap: "0.75rem", color: "var(--color-muted)", fontSize: "0.75rem" }}>
                                <span>Exams: <strong style={{ color: "var(--color-text)" }}>{t.completed_exams ?? 0}</strong></span>
                                <span>Avg: <strong style={{ color: "var(--color-primary)" }}>{t.avg_score != null ? `${t.avg_score}%` : "—"}</strong></span>
                                <span>Cards: <strong style={{ color: "var(--color-text)" }}>{t.report_cards ?? 0}</strong></span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
