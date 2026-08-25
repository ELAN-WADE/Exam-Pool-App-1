"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useCallback } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { api } from "../../../lib/api";
import { useAcademic } from "../../../components/context/AcademicContext";
import type { Subject, User, ExamResult } from "../../../lib/types";
import {
  UsersIcon,
  BookIcon,
  CheckCircleIcon,
  DocumentIcon,
  CalendarIcon,
  RefreshIcon,
  ActivityIcon,
  ShieldCheckIcon,
  GraduationCapIcon,
  SettingsIcon,
  ChevronRightIcon,
  PlusIcon,
} from "../../../components/icons/Icons";
import { Skeleton } from "../../../components/ui/Skeleton";
import { EmptyState } from "../../../components/ui/EmptyState";
import { AdminGlobalSearch } from "../../../components/admin/AdminGlobalSearch";
import { SessionSnapshotCard } from "../../../components/admin/SessionSnapshotCard";
import styles from "./page.module.css";

export default function OperatorDashboardPage() {
  return (
    <RequireRole role="operator">
      <OperatorDashboard />
    </RequireRole>
  );
}

function OperatorDashboard() {
  const [users, setUsers] = useState<User[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [results, setResults] = useState<ExamResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const { selectedSession, selectedTerm, activeSession, activeTerm } = useAcademic();

  const isCurrentSessionActive = Boolean(selectedSession?.is_active || (activeSession && selectedSession?.id === activeSession?.id));
  const isCurrentTermActive = Boolean(selectedTerm?.is_active || (activeTerm && selectedTerm?.id === activeTerm?.id));

  const loadData = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");

      const [u, s, r] = await Promise.all([
        api.getUsers(selectedSession?.id, selectedTerm?.id),
        api.getSubjects(selectedSession?.id, selectedTerm?.id),
        api.getResults(selectedSession?.id, selectedTerm?.id),
      ]);
      setUsers(u ?? []);
      setSubjects(s ?? []);
      setResults(r ?? []);
    } catch (err: any) {
      setError(err.message || "Failed to load dashboard data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedSession?.id, selectedTerm?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const stats = useMemo(() => {
    const students  = users.filter((u) => u.role === "student").length;
    const teachers  = users.filter((u) => u.role === "teacher").length;
    const operators = users.filter((u) => u.role === "operator").length;
    const published = subjects.filter((s) => s.is_published).length;
    const avgScore  = results.length
      ? (results.reduce((a: number, r) => a + (r.score ?? 0), 0) / results.length).toFixed(1)
      : "—";
    return { students, teachers, operators, subjects: subjects.length, published, exams: results.length, avgScore };
  }, [users, subjects, results]);

  if (error) {
    return (
      <div style={{
        background: "var(--color-surface, #FFFFFF)",
        border: "1px solid var(--color-border, #E2E8F0)",
        borderRadius: "12px",
        padding: "3rem 2rem",
        textAlign: "center",
        maxWidth: "460px",
        margin: "3rem auto",
      }}>
        <div style={{
          width: "40px",
          height: "40px",
          borderRadius: "10px",
          background: "rgba(220, 38, 38, 0.08)",
          color: "var(--color-danger, #DC2626)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 1rem",
        }}>
          <ActivityIcon width="20" height="20" />
        </div>
        <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--color-text, #0F172A)", marginBottom: "0.35rem" }}>
          Unable to Load Dashboard
        </h3>
        <p style={{ color: "var(--color-muted, #64748B)", fontSize: "0.8125rem", marginBottom: "1.25rem", lineHeight: 1.5 }}>
          {error}
        </p>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => loadData()}
          style={{ padding: "0.45rem 1.25rem", borderRadius: "8px", fontWeight: 600 }}
        >
          <RefreshIcon width="13" height="13" /> Retry Connection
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.dashboardContainer}>
        <div className={styles.headerWrapper}>
          <div className={styles.headerLeft}>
            <Skeleton width={180} height={28} borderRadius="6px" />
            <Skeleton width={260} height={16} borderRadius="4px" style={{ marginTop: "0.35rem" }} />
          </div>
          <div className={styles.headerRight}>
            <Skeleton width={140} height={30} borderRadius="6px" />
            <Skeleton width={80} height={30} borderRadius="6px" />
          </div>
        </div>

        <section className={styles.statsGrid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={styles.statCard}>
              <div className={styles.statTop}>
                <Skeleton width={60} height={10} borderRadius="3px" />
                <Skeleton width={16} height={16} borderRadius="3px" />
              </div>
              <Skeleton width={50} height={24} borderRadius="4px" />
              <Skeleton width={90} height={10} borderRadius="3px" />
            </div>
          ))}
        </section>

        <Skeleton height={120} borderRadius="12px" />
        <Skeleton height={180} borderRadius="12px" />
      </div>
    );
  }

  const statCards = [
    {
      label: "Students",
      value: stats.students,
      icon: <GraduationCapIcon width="16" height="16" style={{ color: "#4F46E5" }} />,
      footnote: "Enrolled candidates",
    },
    {
      label: "Teachers",
      value: stats.teachers,
      icon: <UsersIcon width="16" height="16" style={{ color: "#7C3AED" }} />,
      footnote: "Assigned faculty",
    },
    {
      label: "Operators",
      value: stats.operators,
      icon: <ShieldCheckIcon width="16" height="16" style={{ color: "#6366F1" }} />,
      footnote: "Administrators",
    },
    {
      label: "Subjects",
      value: stats.subjects,
      icon: <BookIcon width="16" height="16" style={{ color: "#0891B2" }} />,
      footnote: "Configured curricula",
    },
    {
      label: "Published",
      value: stats.published,
      icon: <CheckCircleIcon width="16" height="16" style={{ color: "#059669" }} />,
      footnote: "Active CBT windows",
    },
    {
      label: "Exams Done",
      value: stats.exams,
      icon: <DocumentIcon width="16" height="16" style={{ color: "#EA580C" }} />,
      footnote: stats.avgScore !== "—" ? `${stats.avgScore}% class avg` : "Completed attempts",
      badge: stats.avgScore !== "—" ? `${stats.avgScore}%` : undefined,
    },
  ];

  const quickLinks = [
    {
      href: "/ADMIN/subjects",
      label: "Subjects & Curricula",
      desc: "Configure subject codes, question sets, and assign teachers.",
      icon: <BookIcon width="18" height="18" style={{ color: "#0891B2" }} />,
    },
    {
      href: "/ADMIN/timetable",
      label: "Timetable & CBT Windows",
      desc: "Schedule examination slots, set timers, and manage status.",
      icon: <CalendarIcon width="18" height="18" style={{ color: "#EA580C" }} />,
    },
    {
      href: "/ADMIN/users",
      label: "User Management",
      desc: "Register student cohorts, invite staff, and assign roles.",
      icon: <UsersIcon width="18" height="18" style={{ color: "#7C3AED" }} />,
    },
    {
      href: "/ADMIN/settings",
      label: "System & Backups",
      desc: "Manage local database backups, system locks, and logs.",
      icon: <SettingsIcon width="18" height="18" style={{ color: "#4F46E5" }} />,
    },
  ];

  return (
    <div className={styles.dashboardContainer}>
      {/* ── Page Header ───────────────────────────────────── */}
      <div className={styles.headerWrapper}>
        <div className={styles.headerLeft}>
          <div className={styles.titleRow}>
            <h1 className={styles.pageTitle}>Dashboard</h1>
            <span className={styles.roleBadge}>Operator</span>
          </div>
          <p className={styles.subtitle}>
            Institutional overview of active examination and academic operations.
          </p>
        </div>

        <div className={styles.headerRight}>
          {/* Active Gold / Neutral Session Pill */}
          <div
            className={styles.sessionPill}
            style={{
              background: isCurrentSessionActive
                ? "var(--color-gold-bg, rgba(234, 179, 8, 0.10))"
                : undefined,
              borderColor: isCurrentSessionActive
                ? "var(--color-gold-border, rgba(202, 138, 4, 0.35))"
                : undefined,
              color: isCurrentSessionActive
                ? "var(--color-gold-text, #B45309)"
                : undefined,
              boxShadow: isCurrentSessionActive
                ? "0 0 12px rgba(234, 179, 8, 0.16)"
                : undefined,
            }}
          >
            <span
              className={isCurrentSessionActive ? "gold-live-dot" : styles.statusDot}
            />
            <span style={{ fontWeight: isCurrentSessionActive ? 700 : 500 }}>
              {selectedSession?.name || "System Ready"}
              {selectedTerm?.name ? ` · ${selectedTerm.name}` : ""}
            </span>
          </div>

          <div className={styles.dateChip}>
            <CalendarIcon width="13" height="13" style={{ color: "#F97316" }} />
            <span>{new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
          </div>

          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            className={styles.syncBtn}
            title="Refresh dashboard data"
          >
            <RefreshIcon width="12" height="12" style={{ color: "#4F46E5", animation: refreshing ? "spin 1s linear infinite" : "none" }} />
            <span>{refreshing ? "Syncing…" : "Sync"}</span>
          </button>
        </div>
      </div>

      {/* ── Minimalist 6-Stat Metrics Grid ──────────────────── */}
      <section className={styles.statsGrid}>
        {statCards.map((s) => (
          <div key={s.label} className={styles.statCard}>
            <div className={styles.statTop}>
              <span className={styles.statLabel}>{s.label}</span>
              <div className={styles.statIcon}>{s.icon}</div>
            </div>

            <div>
              <div className={styles.statValue}>{s.value}</div>
              <div className={styles.statBottom}>
                <span className={styles.statFootnote}>{s.footnote}</span>
                {s.badge && <span className={styles.statBadge}>{s.badge}</span>}
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* ── Global Search & Cross-Session Historical Archives ── */}
      <AdminGlobalSearch />

      {/* ── Academic Session Analytics & Promotion Trends ─── */}
      <SessionSnapshotCard />

      {/* ── Quick Administrative Directory ─────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>
            <span>Administrative Actions</span>
          </div>
        </div>

        <div className={styles.quickGrid}>
          {quickLinks.map((l) => (
            <Link key={l.href} href={l.href} className={styles.quickCard}>
              <div className={styles.quickIcon}>{l.icon}</div>
              <div className={styles.quickContent}>
                <div className={styles.quickLabel}>{l.label}</div>
                <div className={styles.quickDesc}>{l.desc}</div>
              </div>
              <div className={styles.quickArrow}>
                <ChevronRightIcon width="14" height="14" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Recent Subjects & Curricula Table ──────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>
            <span>Recent Subjects</span>
            <span className={styles.sectionCount}>{subjects.length}</span>
          </div>
          <Link
            href="/ADMIN/subjects"
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "var(--color-primary, #4F46E5)",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.2rem",
            }}
          >
            <span>View All</span>
            <ChevronRightIcon width="13" height="13" />
          </Link>
        </div>

        {subjects.length > 0 ? (
          <div className={styles.tableCard}>
            <div className={styles.tableWrapper}>
              <table className={styles.tbl}>
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Code</th>
                    <th>Term</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {subjects.slice(0, 6).map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600, color: "var(--color-text, #0F172A)" }}>
                        {s.name}
                      </td>
                      <td>
                        <span className={styles.codeBadge}>{s.code}</span>
                      </td>
                      <td style={{ color: "var(--color-muted, #64748B)" }}>
                        {s.term || "General"}
                      </td>
                      <td>
                        <span className={`${styles.statusTag} ${s.is_published ? styles.statusPublished : styles.statusDraft}`}>
                          <span style={{
                            width: 4,
                            height: 4,
                            borderRadius: "50%",
                            background: s.is_published ? "var(--color-success, #16A34A)" : "var(--color-muted-2, #94A3B8)",
                          }} />
                          {s.is_published ? "Published" : "Draft"}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <Link
                          href="/ADMIN/subjects"
                          style={{
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            color: "var(--color-primary, #4F46E5)",
                            padding: "0.2rem 0.5rem",
                            borderRadius: "4px",
                          }}
                        >
                          Manage →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <EmptyState
            title="No Subjects Configured Yet"
            description="Get started by creating your first academic subject or importing curricula."
            action={<Link href="/ADMIN/subjects" className="btn btn-primary btn-sm" style={{ padding: "0.45rem 1.1rem", borderRadius: "8px" }}><PlusIcon width="13" height="13" /> Create Subject</Link>}
            icon={<BookIcon width="22" height="22" />}
          />
        )}
      </section>
    </div>
  );
}
