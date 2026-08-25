"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useAcademic } from "../context/AcademicContext";
import {
  SearchIcon,
  DocumentIcon,
  BookIcon,
  UsersIcon,
  CalendarIcon,
  ArchiveIcon,
  GraduationCapIcon,
  LayersIcon,
  ChevronRightIcon,
  ActivityIcon,
} from "../icons/Icons";

interface SearchResult {
  type: "report_card" | "exam" | "subject" | "teacher_assignment" | "session";
  id: string | number;
  [key: string]: any;
}

export function AdminGlobalSearch() {
  const { sessions, terms, selectedSession, selectedTerm } = useAcademic();

  const [query, setQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterSessionId, setFilterSessionId] = useState<number | 0>(0);
  const [filterTermId, setFilterTermId] = useState<number | 0>(0);

  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

  const executeSearch = useCallback(async (qStr: string, tType: string, sId: number, tId: number) => {
    if (!qStr.trim() && tType === "all" && !sId && !tId) {
      setResults([]);
      setTotal(0);
      setSearched(false);
      return;
    }

    setLoading(true);
    setError("");
    setSearched(true);

    try {
      const res = await api.globalAdminSearch({
        q: qStr.trim(),
        type: tType,
        sessionId: sId || undefined,
        termId: tId || undefined,
        limit: 100,
      });

      setResults(res.results || []);
      setTotal(res.total || 0);
    } catch (err: any) {
      setError(err.message || "Search failed");
      setResults([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced auto-search when query or filters change
  useEffect(() => {
    const timer = setTimeout(() => {
      executeSearch(query, filterType, filterSessionId, filterTermId);
    }, 280);
    return () => clearTimeout(timer);
  }, [query, filterType, filterSessionId, filterTermId, executeSearch]);

  const categories = [
    { key: "all", label: "All", icon: <LayersIcon width="13" height="13" />, color: "#4F46E5" },
    { key: "report_cards", label: "Report Cards", icon: <GraduationCapIcon width="13" height="13" />, color: "#0D9488" },
    { key: "exams", label: "Exams", icon: <ActivityIcon width="13" height="13" />, color: "#EA580C" },
    { key: "subjects", label: "Subjects", icon: <BookIcon width="13" height="13" />, color: "#0891B2" },
    { key: "teachers", label: "Teachers", icon: <UsersIcon width="13" height="13" />, color: "#7C3AED" },
    { key: "sessions", label: "Sessions", icon: <CalendarIcon width="13" height="13" />, color: "#EAB308" },
  ];

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
          <span className="text-cyan-600 flex items-center">
            <ArchiveIcon width="16" height="16" />
          </span>
          <h2 style={{ fontSize: "0.9375rem", fontWeight: 600, margin: 0, color: "var(--color-text, #0F172A)", letterSpacing: "-0.01em" }}>
            Historical Archives Search
          </h2>
        </div>

        {searched && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--color-muted, #64748B)" }}>
              <strong style={{ color: "var(--color-text, #0F172A)", fontFamily: "var(--font-mono, monospace)" }}>{total}</strong> results
            </span>
            <button
              onClick={() => {
                setQuery("");
                setFilterType("all");
                setFilterSessionId(0);
                setFilterTermId(0);
                setResults([]);
                setSearched(false);
              }}
              style={{
                fontSize: "0.6875rem",
                fontWeight: 500,
                padding: "0.2rem 0.5rem",
                borderRadius: "4px",
                border: "1px solid var(--color-border, #E2E8F0)",
                background: "transparent",
                color: "var(--color-muted, #64748B)",
                cursor: "pointer",
              }}
            >
              Reset
            </button>
          </div>
        )}
      </div>

      {/* Main Search Input */}
      <div style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        background: "var(--color-surface, #FFFFFF)",
        borderRadius: "8px",
        border: "1px solid var(--color-border, #E2E8F0)",
        padding: "0.45rem 0.75rem",
        transition: "border-color 150ms ease",
      }}>
        <SearchIcon width="15" height="15" style={{ color: "var(--color-muted-2, #94A3B8)", flexShrink: 0, marginRight: "0.5rem" }} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by student name, registration ID, subject, teacher, or term…"
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            outline: "none",
            fontSize: "0.8125rem",
            color: "var(--color-text, #0F172A)",
            fontFamily: "inherit",
          }}
        />
        {loading && (
          <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2, flexShrink: 0, marginLeft: "0.5rem" }} />
        )}
      </div>

      {/* Category Tabs & Session Filter Row */}
      <div style={{ display: "flex", gap: "0.625rem", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        {/* Category Tabs */}
        <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
          {categories.map((cat) => {
            const active = filterType === cat.key;
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => setFilterType(cat.key)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.3rem",
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  padding: "0.25rem 0.6rem",
                  borderRadius: "6px",
                  border: active ? `1px solid ${cat.color}` : "1px solid var(--color-border, #E2E8F0)",
                  background: active ? `${cat.color}15` : "transparent",
                  color: active ? cat.color : "var(--color-muted, #64748B)",
                  cursor: "pointer",
                  transition: "all 120ms ease",
                }}
              >
                <span style={{ color: active ? cat.color : "var(--color-muted-2, #94A3B8)" }}>{cat.icon}</span>
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Historical Session & Term Dropdowns */}
        <div style={{ display: "flex", gap: "0.375rem", alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={filterSessionId}
            onChange={(e) => {
              setFilterSessionId(Number(e.target.value));
              setFilterTermId(0);
            }}
            style={{
              fontSize: "0.6875rem",
              padding: "0.25rem 0.5rem",
              borderRadius: "6px",
              border: "1px solid var(--color-border, #E2E8F0)",
              background: "var(--color-surface, #FFFFFF)",
              color: "var(--color-text, #0F172A)",
              fontWeight: 600,
              outline: "none",
              cursor: "pointer",
            }}
          >
            <option value={0}>All Sessions</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>{s.name} {s.is_active ? "✨ (Active Session)" : ""}</option>
            ))}
          </select>

          <select
            value={filterTermId}
            onChange={(e) => setFilterTermId(Number(e.target.value))}
            style={{
              fontSize: "0.6875rem",
              padding: "0.25rem 0.5rem",
              borderRadius: "6px",
              border: "1px solid var(--color-border, #E2E8F0)",
              background: "var(--color-surface, #FFFFFF)",
              color: "var(--color-text, #0F172A)",
              fontWeight: 600,
              outline: "none",
              cursor: "pointer",
            }}
          >
            <option value={0}>All Terms</option>
            {terms
              .filter((t) => !filterSessionId || t.session_id === filterSessionId)
              .map((t) => (
                <option key={t.id} value={t.id}>{t.name} {t.is_active ? "⭐ (Active Term)" : ""}</option>
              ))}
          </select>
        </div>
      </div>


      {/* Results Section */}
      {searched && (
        <div style={{ marginTop: "0.5rem", borderTop: "1px solid var(--color-border, #E2E8F0)", paddingTop: "0.875rem" }}>
          {error && (
            <div style={{ padding: "0.625rem 0.875rem", borderRadius: "6px", background: "rgba(220, 38, 38, 0.05)", border: "1px solid rgba(220, 38, 38, 0.15)", color: "var(--color-danger, #DC2626)", fontSize: "0.75rem", marginBottom: "0.75rem" }}>
              {error}
            </div>
          )}

          {!loading && results.length === 0 && !error && (
            <div style={{ textAlign: "center", padding: "2rem 1rem", color: "var(--color-muted, #64748B)" }}>
              <p style={{ fontWeight: 500, color: "var(--color-text, #0F172A)", margin: 0, fontSize: "0.8125rem" }}>No matching records found</p>
              <p style={{ fontSize: "0.75rem", margin: "0.2rem 0 0 0", color: "var(--color-muted, #64748B)" }}>Try adjusting keywords or selecting "All Sessions".</p>
            </div>
          )}

          {results.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {results.map((item, idx) => (
                <div
                  key={`${item.type}-${item.id}-${idx}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0.65rem 0.875rem",
                    borderRadius: "8px",
                    background: "var(--color-surface, #FFFFFF)",
                    border: "1px solid var(--color-border, #E2E8F0)",
                    gap: "0.75rem",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flex: 1, minWidth: 240 }}>
                    <div style={{
                      width: 28,
                      height: 28,
                      borderRadius: "6px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "var(--color-surface-2, #F1F5F9)",
                      color: "var(--color-muted, #64748B)",
                      flexShrink: 0,
                    }}>
                      {item.type === "report_card" && <GraduationCapIcon width="14" height="14" />}
                      {item.type === "exam" && <ActivityIcon width="14" height="14" />}
                      {item.type === "subject" && <BookIcon width="14" height="14" />}
                      {item.type === "teacher_assignment" && <UsersIcon width="14" height="14" />}
                      {item.type === "session" && <CalendarIcon width="14" height="14" />}
                    </div>

                    <div>
                      {/* Report Card */}
                      {item.type === "report_card" && (
                        <>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 600, color: "var(--color-text, #0F172A)", fontSize: "0.8125rem" }}>
                              {item.student_name}
                            </span>
                            {item.student_reg_id && (
                              <span style={{ fontSize: "0.6875rem", fontFamily: "var(--font-mono, monospace)", color: "var(--color-muted, #64748B)", background: "var(--color-surface-2, #F1F5F9)", padding: "0.05rem 0.35rem", borderRadius: "3px" }}>
                                {item.student_reg_id}
                              </span>
                            )}
                            <span style={{ fontSize: "0.6875rem", color: "var(--color-muted, #64748B)" }}>
                              · {item.session_name} ({item.term_name})
                            </span>
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "var(--color-muted, #64748B)", marginTop: "0.1rem" }}>
                            Avg Score: <strong style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--color-text, #0F172A)" }}>{item.average_score || "—"}%</strong> · {item.total_subjects} Subjects
                          </div>
                        </>
                      )}

                      {/* Exam */}
                      {item.type === "exam" && (
                        <>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 600, color: "var(--color-text, #0F172A)", fontSize: "0.8125rem" }}>
                              {item.student_name}
                            </span>
                            <span style={{ color: "var(--color-muted, #64748B)", fontSize: "0.75rem" }}>
                              — {item.subject_title} ({item.subject_code})
                            </span>
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "var(--color-muted, #64748B)", marginTop: "0.1rem" }}>
                            Score: <strong style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--color-text, #0F172A)" }}>{item.score ?? "—"} / {item.total_score}</strong> ({item.score_pct != null ? `${item.score_pct}%` : "—"})
                          </div>
                        </>
                      )}

                      {/* Subject */}
                      {item.type === "subject" && (
                        <>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 600, color: "var(--color-text, #0F172A)", fontSize: "0.8125rem" }}>
                              {item.name}
                            </span>
                            <span style={{ fontSize: "0.6875rem", fontFamily: "var(--font-mono, monospace)", color: "var(--color-muted, #64748B)", background: "var(--color-surface-2, #F1F5F9)", padding: "0.05rem 0.35rem", borderRadius: "3px" }}>
                              {item.code}
                            </span>
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "var(--color-muted, #64748B)", marginTop: "0.1rem" }}>
                            Teacher: {item.teacher_name || "Unassigned"} · Enrolled: <strong style={{ fontFamily: "var(--font-mono, monospace)" }}>{item.enrolled_count}</strong>
                          </div>
                        </>
                      )}

                      {/* Teacher Assignment */}
                      {item.type === "teacher_assignment" && (
                        <>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 600, color: "var(--color-text, #0F172A)", fontSize: "0.8125rem" }}>
                              {item.teacher_name}
                            </span>
                            <span style={{ color: "var(--color-muted, #64748B)", fontSize: "0.75rem" }}>
                              → {item.class_name}
                            </span>
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "var(--color-muted, #64748B)", marginTop: "0.1rem" }}>
                            Contact: {item.teacher_email || item.teacher_phone || "N/A"}
                          </div>
                        </>
                      )}

                      {/* Session */}
                      {item.type === "session" && (
                        <>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 600, color: "var(--color-text, #0F172A)", fontSize: "0.8125rem" }}>
                              {item.name}
                            </span>
                            {item.is_active === 1 && (
                              <span style={{ fontSize: "0.625rem", fontWeight: 600, padding: "0.05rem 0.35rem", borderRadius: "3px", background: "rgba(22, 163, 74, 0.08)", color: "#16A34A" }}>
                                Active
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "var(--color-muted, #64748B)", marginTop: "0.1rem" }}>
                            Terms: {(item.terms || []).map((t: any) => t.name).join(", ") || "None"}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div>
                    {item.type === "report_card" && (
                      <Link
                        href={`/ADMIN/report-card?studentId=${item.student_id}&sessionId=${item.session_id}&termId=${item.term_id}`}
                        style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--color-primary, #4F46E5)", padding: "0.2rem 0.5rem" }}
                      >
                        Report Card →
                      </Link>
                    )}

                    {item.type === "exam" && (
                      <Link
                        href={`/ADMIN/report-card?studentId=${item.student_id}&sessionId=${item.session_id}&termId=${item.term_id}`}
                        style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--color-muted, #64748B)", padding: "0.2rem 0.5rem" }}
                      >
                        Results →
                      </Link>
                    )}

                    {item.type === "subject" && (
                      <Link
                        href="/ADMIN/subjects"
                        style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--color-muted, #64748B)", padding: "0.2rem 0.5rem" }}
                      >
                        Curriculum →
                      </Link>
                    )}

                    {item.type === "teacher_assignment" && (
                      <Link
                        href="/ADMIN/class-teachers"
                        style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--color-muted, #64748B)", padding: "0.2rem 0.5rem" }}
                      >
                        Faculty →
                      </Link>
                    )}

                    {item.type === "session" && (
                      <Link
                        href="/ADMIN/academic-sessions"
                        style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--color-muted, #64748B)", padding: "0.2rem 0.5rem" }}
                      >
                        Manage →
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
