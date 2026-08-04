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
  CheckCircleIcon,
  CalendarIcon,
  RefreshIcon,
  ChevronRightIcon,
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
    { key: "all", label: "All Records", icon: "🌐" },
    { key: "report_cards", label: "Report Cards", icon: "📜" },
    { key: "exams", label: "Exam Attempts", icon: "📝" },
    { key: "subjects", label: "Subjects & Curricula", icon: "📚" },
    { key: "teachers", label: "Teacher Assignments", icon: "👨‍🏫" },
    { key: "sessions", label: "Academic Sessions", icon: "📅" },
  ];

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <span style={{ fontSize: "1.3rem" }}>🔍</span>
            <h2 style={{ fontSize: "1.15rem", fontWeight: 800, margin: 0, color: "var(--color-text)" }}>
              Historical Archives & Global Crawler
            </h2>
            <span className="badge badge-primary" style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}>
              Deep Crawl
            </span>
          </div>
          <p style={{ color: "var(--color-muted)", fontSize: "0.825rem", margin: "0.25rem 0 0 0" }}>
            Instant search across all past academic sessions, terms, report cards, exam scores, curricula, and teacher assignments without switching global school session.
          </p>
        </div>

        {searched && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.825rem", color: "var(--color-muted)" }}>
              Found <strong>{total}</strong> match{total === 1 ? "" : "es"}
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
                fontSize: "0.75rem",
                padding: "0.25rem 0.6rem",
                borderRadius: "6px",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface-2)",
                color: "var(--color-muted)",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Main Search Input */}
      <div style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        background: "var(--color-surface-2)",
        borderRadius: "10px",
        border: "1px solid var(--color-border)",
        padding: "0.5rem 1rem",
        marginBottom: "1rem",
      }}>
        <SearchIcon width="18" height="18" style={{ color: "var(--color-primary)", flexShrink: 0, marginRight: "0.75rem" }} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by student name, Reg ID, subject title, teacher name, session (e.g. 2025/2026), or keyword…"
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            outline: "none",
            fontSize: "0.95rem",
            color: "var(--color-text)",
            fontWeight: 500,
          }}
        />
        {loading && (
          <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2, flexShrink: 0, marginLeft: "0.5rem" }} />
        )}
      </div>

      {/* Category Pills & Session/Term Filters */}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        {/* Category Tabs */}
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          {categories.map((cat) => (
            <button
              key={cat.key}
              type="button"
              onClick={() => setFilterType(cat.key)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                fontSize: "0.78rem",
                fontWeight: 600,
                padding: "0.35rem 0.75rem",
                borderRadius: "8px",
                border: filterType === cat.key ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
                background: filterType === cat.key ? "var(--color-primary)" : "var(--color-surface-2)",
                color: filterType === cat.key ? "#fff" : "var(--color-text)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <span>{cat.icon}</span>
              {cat.label}
            </button>
          ))}
        </div>

        {/* Historical Session & Term Dropdowns */}
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <select
            value={filterSessionId}
            onChange={(e) => {
              setFilterSessionId(Number(e.target.value));
              setFilterTermId(0);
            }}
            style={{
              fontSize: "0.78rem",
              padding: "0.35rem 0.6rem",
              borderRadius: "6px",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface-2)",
              color: "var(--color-text)",
              fontWeight: 600,
              outline: "none",
            }}
          >
            <option value={0}>All Sessions</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>{s.name} {s.is_active ? "(Active)" : ""}</option>
            ))}
          </select>

          <select
            value={filterTermId}
            onChange={(e) => setFilterTermId(Number(e.target.value))}
            style={{
              fontSize: "0.78rem",
              padding: "0.35rem 0.6rem",
              borderRadius: "6px",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface-2)",
              color: "var(--color-text)",
              fontWeight: 600,
              outline: "none",
            }}
          >
            <option value={0}>All Terms</option>
            {terms
              .filter((t) => !filterSessionId || t.session_id === filterSessionId)
              .map((t) => (
                <option key={t.id} value={t.id}>{t.name} {t.is_active ? "(Active)" : ""}</option>
              ))}
          </select>
        </div>
      </div>

      {/* Results Section */}
      {searched && (
        <div style={{ marginTop: "1.25rem", borderTop: "1px solid var(--color-border)", paddingTop: "1.25rem" }}>
          {error && (
            <div style={{ padding: "0.75rem", borderRadius: "8px", background: "#fef2f2", color: "#dc2626", fontSize: "0.85rem", marginBottom: "1rem" }}>
              {error}
            </div>
          )}

          {!loading && results.length === 0 && !error && (
            <div style={{ textAlign: "center", padding: "2.5rem 1rem", color: "var(--color-muted)" }}>
              <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🔎</div>
              <p style={{ fontWeight: 600, margin: 0 }}>No matching historical records found.</p>
              <p style={{ fontSize: "0.8rem", margin: "0.25rem 0 0 0" }}>Try searching with a broader keyword, reg ID, or selecting "All Sessions".</p>
            </div>
          )}

          {results.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {results.map((item, idx) => (
                <div
                  key={`${item.type}-${item.id}-${idx}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0.9rem 1.1rem",
                    borderRadius: "10px",
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border)",
                    gap: "1rem",
                    flexWrap: "wrap",
                    transition: "transform 0.15s ease, box-shadow 0.15s ease",
                  }}
                >
                  {/* Left: Type Icon & Info */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.9rem", flex: 1, minWidth: 260 }}>
                    <div style={{
                      width: 40,
                      height: 40,
                      borderRadius: "10px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "1.2rem",
                      background: item.type === "report_card"
                        ? "rgba(99, 102, 241, 0.12)"
                        : item.type === "exam"
                        ? "rgba(16, 185, 129, 0.12)"
                        : item.type === "subject"
                        ? "rgba(245, 158, 11, 0.12)"
                        : item.type === "teacher_assignment"
                        ? "rgba(236, 72, 153, 0.12)"
                        : "rgba(100, 116, 139, 0.12)",
                      flexShrink: 0,
                    }}>
                      {item.type === "report_card" && "📜"}
                      {item.type === "exam" && "📝"}
                      {item.type === "subject" && "📚"}
                      {item.type === "teacher_assignment" && "👨‍🏫"}
                      {item.type === "session" && "📅"}
                    </div>

                    <div>
                      {/* 1. Report Card Entry */}
                      {item.type === "report_card" && (
                        <>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 700, color: "var(--color-text)", fontSize: "0.95rem" }}>
                              {item.student_name}
                            </span>
                            {item.student_reg_id && (
                              <code style={{ fontSize: "0.75rem", background: "var(--color-surface)", padding: "0.1rem 0.4rem", borderRadius: "4px", color: "var(--color-muted)" }}>
                                {item.student_reg_id}
                              </code>
                            )}
                            {item.student_grade && (
                              <span className="badge badge-primary" style={{ fontSize: "0.7rem", padding: "0.15rem 0.45rem" }}>
                                {item.student_grade}
                              </span>
                            )}
                            <span className="badge badge-success" style={{ fontSize: "0.7rem", padding: "0.15rem 0.45rem" }}>
                              {item.session_name} · {item.term_name}
                            </span>
                          </div>
                          <div style={{ fontSize: "0.8rem", color: "var(--color-muted)", marginTop: "0.2rem" }}>
                            {item.total_subjects} Subjects Enrolled · Avg Score: <strong>{item.average_score || "—"}%</strong>
                            {item.teacher_remark && ` · Remark: "${item.teacher_remark.slice(0, 45)}..."`}
                          </div>
                        </>
                      )}

                      {/* 2. Exam Entry */}
                      {item.type === "exam" && (
                        <>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 700, color: "var(--color-text)", fontSize: "0.95rem" }}>
                              {item.student_name}
                            </span>
                            <span style={{ color: "var(--color-primary)", fontWeight: 600, fontSize: "0.85rem" }}>
                              — {item.subject_title} ({item.subject_code})
                            </span>
                            <span className="badge badge-info" style={{ fontSize: "0.7rem", padding: "0.15rem 0.45rem" }}>
                              {item.session_name} · {item.term_name}
                            </span>
                          </div>
                          <div style={{ fontSize: "0.8rem", color: "var(--color-muted)", marginTop: "0.2rem" }}>
                            Score: <strong>{item.score ?? "—"} / {item.total_score}</strong> ({item.score_pct != null ? `${item.score_pct}%` : "—"})
                            {" "}· Mode: <span style={{ textTransform: "uppercase" }}>{item.exam_mode}</span> · Status: <strong>{item.status}</strong>
                          </div>
                        </>
                      )}

                      {/* 3. Subject Entry */}
                      {item.type === "subject" && (
                        <>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 700, color: "var(--color-text)", fontSize: "0.95rem" }}>
                              {item.name}
                            </span>
                            <code style={{ fontSize: "0.75rem", background: "var(--color-surface)", padding: "0.1rem 0.4rem", borderRadius: "4px" }}>
                              {item.code}
                            </code>
                            {item.class_name && (
                              <span className="badge badge-purple" style={{ fontSize: "0.7rem", padding: "0.15rem 0.45rem" }}>
                                {item.class_name}
                              </span>
                            )}
                            <span className="badge badge-muted" style={{ fontSize: "0.7rem", padding: "0.15rem 0.45rem" }}>
                              {item.session_name || "Any Session"} · {item.term_name || "Any Term"}
                            </span>
                          </div>
                          <div style={{ fontSize: "0.8rem", color: "var(--color-muted)", marginTop: "0.2rem" }}>
                            Teacher: <strong>{item.teacher_name}</strong> {item.teacher_email ? `(${item.teacher_email})` : ""} · Enrolled: <strong>{item.enrolled_count}</strong> students
                          </div>
                        </>
                      )}

                      {/* 4. Teacher Assignment Entry */}
                      {item.type === "teacher_assignment" && (
                        <>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 700, color: "var(--color-text)", fontSize: "0.95rem" }}>
                              {item.teacher_name}
                            </span>
                            <span style={{ color: "var(--color-primary)", fontWeight: 600, fontSize: "0.85rem" }}>
                              → {item.class_name} {item.class_section ? `(${item.class_section})` : ""}
                            </span>
                            <span className="badge badge-warning" style={{ fontSize: "0.7rem", padding: "0.15rem 0.45rem" }}>
                              {item.action || "Assigned"}
                            </span>
                          </div>
                          <div style={{ fontSize: "0.8rem", color: "var(--color-muted)", marginTop: "0.2rem" }}>
                            Contact: {item.teacher_email || item.teacher_phone || "N/A"} · Assigned by: <strong>{item.assigned_by_name || "Admin"}</strong>
                            {item.notes ? ` · Notes: "${item.notes}"` : ""}
                          </div>
                        </>
                      )}

                      {/* 5. Session Entry */}
                      {item.type === "session" && (
                        <>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 700, color: "var(--color-text)", fontSize: "0.95rem" }}>
                              Academic Session: {item.name}
                            </span>
                            {item.is_active === 1 ? (
                              <span className="badge badge-success" style={{ fontSize: "0.7rem", padding: "0.15rem 0.45rem" }}>
                                Currently Active School Session
                              </span>
                            ) : (
                              <span className="badge badge-muted" style={{ fontSize: "0.7rem", padding: "0.15rem 0.45rem" }}>
                                Archived Session
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: "0.8rem", color: "var(--color-muted)", marginTop: "0.2rem" }}>
                            Terms: {(item.terms || []).map((t: any) => `${t.name} ${t.is_active ? "(Active)" : ""}`).join(" · ") || "None"}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Right: Quick Action Links */}
                  <div>
                    {item.type === "report_card" && (
                      <Link
                        href={`/ADMIN/report-card?studentId=${item.student_id}&sessionId=${item.session_id}&termId=${item.term_id}`}
                        className="btn btn-primary btn-sm"
                        style={{ fontSize: "0.78rem", padding: "0.3rem 0.75rem" }}
                      >
                        <DocumentIcon width="14" height="14" />
                        View Report Card
                      </Link>
                    )}

                    {item.type === "exam" && (
                      <Link
                        href={`/ADMIN/report-card?studentId=${item.student_id}&sessionId=${item.session_id}&termId=${item.term_id}`}
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: "0.78rem", padding: "0.3rem 0.75rem" }}
                      >
                        Student Results →
                      </Link>
                    )}

                    {item.type === "subject" && (
                      <Link
                        href="/ADMIN/subjects"
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: "0.78rem", padding: "0.3rem 0.75rem" }}
                      >
                        Curriculum →
                      </Link>
                    )}

                    {item.type === "teacher_assignment" && (
                      <Link
                        href="/ADMIN/class-teachers"
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: "0.78rem", padding: "0.3rem 0.75rem" }}
                      >
                        Class Teachers →
                      </Link>
                    )}

                    {item.type === "session" && (
                      <Link
                        href="/ADMIN/academic-sessions"
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: "0.78rem", padding: "0.3rem 0.75rem" }}
                      >
                        Manage Session →
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
