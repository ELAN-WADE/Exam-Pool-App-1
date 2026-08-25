"use client";

import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import { useAcademic } from "../context/AcademicContext";
import {
  CalendarIcon,
  TrendingUpIcon,
  RefreshIcon,
  ChevronRightIcon,
  CrownIcon,
  SparklesIcon,
  GraduationCapIcon,
  UsersIcon,
  BookIcon,
  DocumentIcon,
  CheckCircleIcon,
} from "../icons/Icons";
import { ActiveGoldBadge } from "../ui/ActiveGoldBadge";

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
      background: "var(--color-surface, #FFFFFF)",
      border: "1px solid var(--color-border, #E2E8F0)",
      borderRadius: "12px",
      padding: "1.25rem",
      display: "flex",
      flexDirection: "column",
      gap: "0.875rem",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
          <span className="text-indigo-600 flex items-center">
            <TrendingUpIcon width="16" height="16" />
          </span>
          <h2 style={{ fontSize: "0.9375rem", fontWeight: 600, margin: 0, color: "var(--color-text, #0F172A)", letterSpacing: "-0.01em" }}>
            Session Analytics &amp; History
          </h2>
        </div>

        <button
          onClick={fetchSnapshots}
          style={{
            fontSize: "0.6875rem",
            fontWeight: 500,
            padding: "0.25rem 0.55rem",
            borderRadius: "6px",
            border: "1px solid var(--color-border, #E2E8F0)",
            background: "transparent",
            color: "var(--color-muted, #64748B)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.3rem",
          }}
          disabled={loading}
        >
          <RefreshIcon width="11" height="11" /> Refresh
        </button>
      </div>

      {loading && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem 0", gap: "0.5rem", color: "var(--color-muted, #64748B)" }}>
          <div className="spinner" style={{ width: 14, height: 14 }} />
          <span style={{ fontSize: "0.75rem" }}>Aggregating session metrics…</span>
        </div>
      )}

      {error && (
        <div style={{ padding: "0.625rem 0.875rem", borderRadius: "6px", background: "rgba(220, 38, 38, 0.05)", border: "1px solid rgba(220, 38, 38, 0.15)", color: "var(--color-danger, #DC2626)", fontSize: "0.75rem" }}>
          {error}
        </div>
      )}

      {!loading && !error && snapshots.length === 0 && (
        <div style={{ textAlign: "center", padding: "1.5rem 1rem", color: "var(--color-muted, #64748B)" }}>
          <p style={{ fontWeight: 500, color: "var(--color-text, #0F172A)", margin: 0, fontSize: "0.8125rem" }}>No academic sessions registered</p>
        </div>
      )}

      {/* Snapshots List */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {snapshots.map((snap) => {
          const isExpanded = expandedSessionId === snap.session_id;
          const isCurrentSelected = selectedSession?.id === snap.session_id;
          const isSnapActive = snap.is_active === 1;
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
                border: isSnapActive
                  ? "1px solid var(--color-gold-border, rgba(202, 138, 4, 0.35))"
                  : "1px solid var(--color-border, #E2E8F0)",
                borderRadius: "8px",
                background: "var(--color-surface, #FFFFFF)",
                boxShadow: isSnapActive
                  ? "0 2px 8px rgba(234, 179, 8, 0.08)"
                  : "none",
                overflow: "hidden",
              }}
            >
              {/* Header Toggle */}
              <div
                onClick={() => setExpandedSessionId(isExpanded ? null : snap.session_id)}
                style={{
                  padding: "0.65rem 0.875rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  cursor: "pointer",
                  userSelect: "none",
                  background: isExpanded
                    ? isSnapActive
                      ? "rgba(254, 249, 195, 0.25)"
                      : "var(--color-surface-2, #F8FAFC)"
                    : "transparent",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text, #0F172A)" }}>
                    {snap.session_name}
                  </span>

                  {isSnapActive && (
                    <ActiveGoldBadge
                      type="session"
                      label="Active Session"
                      size="sm"
                      glowing={true}
                    />
                  )}

                  {isCurrentSelected && (
                    <span style={{
                      fontSize: "0.625rem",
                      fontWeight: 500,
                      padding: "0.1rem 0.35rem",
                      borderRadius: "4px",
                      background: "var(--color-surface-2, #F1F5F9)",
                      color: "var(--color-muted, #64748B)",
                    }}>
                      Filtered
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  {!isCurrentSelected && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFocusSession(snap.session_id);
                      }}
                      style={{
                        fontSize: "0.6875rem",
                        fontWeight: 500,
                        padding: "0.2rem 0.45rem",
                        borderRadius: "4px",
                        border: "1px solid var(--color-border, #E2E8F0)",
                        background: "var(--color-surface, #FFFFFF)",
                        color: "var(--color-text, #0F172A)",
                        cursor: "pointer",
                      }}
                    >
                      Filter View
                    </button>
                  )}

                  <div style={{
                    width: "16px",
                    height: "16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--color-muted-2, #94A3B8)",
                    transform: isExpanded ? "rotate(90deg)" : "none",
                    transition: "transform 150ms ease",
                  }}>
                    <ChevronRightIcon width="12" height="12" />
                  </div>
                </div>
              </div>

              {/* Collapsible Content */}
              {isExpanded && (
                <div style={{ padding: "0.875rem", borderTop: "1px solid var(--color-border, #E2E8F0)", background: "var(--color-surface, #FFFFFF)" }}>
                  {/* Metric Chips */}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
                    gap: "0.5rem",
                    marginBottom: "0.75rem",
                  }}>
                    <div style={{ padding: "0.5rem 0.65rem", borderRadius: "6px", background: "var(--color-surface-2, #F8FAFC)", border: "1px solid var(--color-border, #E2E8F0)" }}>
                      <span style={{ fontSize: "0.625rem", color: "var(--color-muted, #64748B)", textTransform: "uppercase" }}>Students</span>
                      <div style={{ fontSize: "1rem", fontWeight: 700, fontFamily: "var(--font-mono, monospace)", color: "var(--color-text, #0F172A)", marginTop: "0.15rem" }}>
                        {stats.total_students ?? 0}
                      </div>
                    </div>

                    <div style={{ padding: "0.5rem 0.65rem", borderRadius: "6px", background: "var(--color-surface-2, #F8FAFC)", border: "1px solid var(--color-border, #E2E8F0)" }}>
                      <span style={{ fontSize: "0.625rem", color: "var(--color-muted, #64748B)", textTransform: "uppercase" }}>Teachers</span>
                      <div style={{ fontSize: "1rem", fontWeight: 700, fontFamily: "var(--font-mono, monospace)", color: "var(--color-text, #0F172A)", marginTop: "0.15rem" }}>
                        {stats.total_teachers ?? 0}
                      </div>
                    </div>

                    <div style={{ padding: "0.5rem 0.65rem", borderRadius: "6px", background: "var(--color-surface-2, #F8FAFC)", border: "1px solid var(--color-border, #E2E8F0)" }}>
                      <span style={{ fontSize: "0.625rem", color: "var(--color-muted, #64748B)", textTransform: "uppercase" }}>Subjects</span>
                      <div style={{ fontSize: "1rem", fontWeight: 700, fontFamily: "var(--font-mono, monospace)", color: "var(--color-text, #0F172A)", marginTop: "0.15rem" }}>
                        {stats.total_subjects ?? 0}
                      </div>
                    </div>

                    <div style={{ padding: "0.5rem 0.65rem", borderRadius: "6px", background: "var(--color-surface-2, #F8FAFC)", border: "1px solid var(--color-border, #E2E8F0)" }}>
                      <span style={{ fontSize: "0.625rem", color: "var(--color-muted, #64748B)", textTransform: "uppercase" }}>Exams Done</span>
                      <div style={{ fontSize: "1rem", fontWeight: 700, fontFamily: "var(--font-mono, monospace)", color: "var(--color-text, #0F172A)", marginTop: "0.15rem" }}>
                        {stats.completed_exams ?? 0}
                      </div>
                    </div>

                    <div style={{ padding: "0.5rem 0.65rem", borderRadius: "6px", background: "var(--color-surface-2, #F8FAFC)", border: "1px solid var(--color-border, #E2E8F0)" }}>
                      <span style={{ fontSize: "0.625rem", color: "var(--color-muted, #64748B)", textTransform: "uppercase" }}>Avg Score</span>
                      <div style={{ fontSize: "1rem", fontWeight: 700, fontFamily: "var(--font-mono, monospace)", color: "var(--color-text, #0F172A)", marginTop: "0.15rem" }}>
                        {stats.avg_exam_score != null ? `${stats.avg_exam_score}%` : "—"}
                      </div>
                    </div>

                    <div style={{ padding: "0.5rem 0.65rem", borderRadius: "6px", background: "var(--color-surface-2, #F8FAFC)", border: "1px solid var(--color-border, #E2E8F0)" }}>
                      <span style={{ fontSize: "0.625rem", color: "var(--color-muted, #64748B)", textTransform: "uppercase" }}>Report Cards</span>
                      <div style={{ fontSize: "1rem", fontWeight: 700, fontFamily: "var(--font-mono, monospace)", color: "var(--color-text, #0F172A)", marginTop: "0.15rem" }}>
                        {stats.report_cards_count ?? 0}
                      </div>
                    </div>
                  </div>

                  {/* Promotion & Term Rows */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.625rem" }}>
                    {/* Decisions */}
                    <div style={{
                      padding: "0.65rem",
                      borderRadius: "6px",
                      background: "var(--color-surface-2, #F8FAFC)",
                      border: "1px solid var(--color-border, #E2E8F0)",
                    }}>
                      <div style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--color-muted, #64748B)", textTransform: "uppercase", marginBottom: "0.4rem" }}>
                        Annual Decisions
                      </div>
                      <div style={{ display: "flex", gap: "0.375rem" }}>
                        <div style={{ flex: 1, textAlign: "center", padding: "0.35rem", borderRadius: "4px", background: "rgba(22, 163, 74, 0.06)", border: "1px solid rgba(22, 163, 74, 0.2)" }}>
                          <div style={{ fontSize: "0.625rem", color: "#16A34A", fontWeight: 600 }}>Promoted</div>
                          <div style={{ fontSize: "0.875rem", fontWeight: 700, fontFamily: "var(--font-mono, monospace)", color: "#16A34A" }}>
                            {stats.promoted_count ?? 0}
                          </div>
                        </div>

                        <div style={{ flex: 1, textAlign: "center", padding: "0.35rem", borderRadius: "4px", background: "rgba(220, 38, 38, 0.06)", border: "1px solid rgba(220, 38, 38, 0.2)" }}>
                          <div style={{ fontSize: "0.625rem", color: "#DC2626", fontWeight: 600 }}>Repeated</div>
                          <div style={{ fontSize: "0.875rem", fontWeight: 700, fontFamily: "var(--font-mono, monospace)", color: "#DC2626" }}>
                            {stats.repeated_count ?? 0}
                          </div>
                        </div>

                        <div style={{ flex: 1, textAlign: "center", padding: "0.35rem", borderRadius: "4px", background: "rgba(79, 70, 229, 0.06)", border: "1px solid rgba(79, 70, 229, 0.2)" }}>
                          <div style={{ fontSize: "0.625rem", color: "#4F46E5", fontWeight: 600 }}>Graduated</div>
                          <div style={{ fontSize: "0.875rem", fontWeight: 700, fontFamily: "var(--font-mono, monospace)", color: "#4F46E5" }}>
                            {stats.graduated_count ?? 0}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Terms */}
                    <div style={{
                      padding: "0.65rem",
                      borderRadius: "6px",
                      background: "var(--color-surface-2, #F8FAFC)",
                      border: "1px solid var(--color-border, #E2E8F0)",
                    }}>
                      <div style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--color-muted, #64748B)", textTransform: "uppercase", marginBottom: "0.4rem" }}>
                        Term Breakdown
                      </div>

                      {termsList.length === 0 ? (
                        <div style={{ fontSize: "0.6875rem", color: "var(--color-muted, #64748B)" }}>No terms recorded</div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                          {termsList.map((t) => (
                            <div
                              key={t.term_id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "0.3rem 0.5rem",
                                borderRadius: "4px",
                                background: t.is_active ? "rgba(254, 249, 195, 0.35)" : "var(--color-surface, #FFFFFF)",
                                border: t.is_active ? "1px solid var(--color-gold-border, rgba(202, 138, 4, 0.35))" : "1px solid var(--color-border, #E2E8F0)",
                                fontSize: "0.6875rem",
                              }}
                            >
                              <div className="flex items-center gap-1.5">
                                {t.is_active && (
                                  <SparklesIcon width="11" height="11" style={{ color: "#CA8A04" }} />
                                )}
                                <span style={{ fontWeight: 600, color: t.is_active ? "#B45309" : "var(--color-text, #0F172A)" }}>{t.term_name}</span>
                              </div>
                              <div style={{ display: "flex", gap: "0.5rem", color: "var(--color-muted, #64748B)" }}>
                                <span>Done: <strong style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--color-text, #0F172A)" }}>{t.completed_exams ?? 0}</strong></span>
                                <span>Avg: <strong style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--color-text, #0F172A)" }}>{t.avg_score != null ? `${t.avg_score}%` : "—"}</strong></span>
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
