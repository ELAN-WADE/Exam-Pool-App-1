"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { api } from "../../../lib/api";
import { useAcademic } from "../../../components/context/AcademicContext";
import { UsersIcon, BookIcon, CheckCircleIcon, DocumentIcon, BarChartIcon, SettingsIcon, ChevronRightIcon } from "../../../components/icons/Icons";
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
  const [users, setUsers] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { selectedSession, selectedTerm } = useAcademic();

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [u, s, r] = await Promise.all([
        api.getUsers(selectedSession?.id, selectedTerm?.id), 
        api.getSubjects(selectedSession?.id, selectedTerm?.id), 
        api.getResults(selectedSession?.id, selectedTerm?.id)
      ]);
      setUsers((u as any[]) ?? []);
      setSubjects((s as any[]) ?? []);
      setResults((r as any[]) ?? []);
      setLoading(false);
    })();
  }, [selectedSession?.id, selectedTerm?.id]);

  const stats = useMemo(() => {
    const students  = users.filter((u) => u.role === "student").length;
    const teachers  = users.filter((u) => u.role === "teacher").length;
    const operators = users.filter((u) => u.role === "operator").length;
    const published = subjects.filter((s) => s.is_published).length;
    const avgScore  = results.length
      ? (results.reduce((a: number, r: any) => a + (r.score ?? 0), 0) / results.length).toFixed(1)
      : "—";
    return { students, teachers, operators, subjects: subjects.length, published, exams: results.length, avgScore };
  }, [users, subjects, results]);

  if (loading) {
    return (
      <>
        <div className="pageHeader animate-enter">
          <div>
            <Skeleton width={220} height={36} />
            <Skeleton width={140} height={20} style={{ marginTop: "0.5rem" }} />
          </div>
          <Skeleton width={160} height={34} borderRadius="999px" />
        </div>
        <section className={styles.statsGrid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={96} borderRadius="var(--radius-lg)" className="animate-enter" style={{ animationDelay: `${i * 45}ms` }} />
          ))}
        </section>
        <div style={{ marginTop: "2rem" }}>
          <Skeleton width={140} height={18} style={{ marginBottom: "0.875rem" }} />
          <div className={styles.quickGrid}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} height={80} borderRadius="var(--radius-lg)" className="animate-enter" style={{ animationDelay: `${i * 45 + 270}ms` }} />
            ))}
          </div>
        </div>
      </>
    );
  }

  const statCards = [
    { label: "Total Students",    value: stats.students,  icon: <UsersIcon width="22" height="22" />,       color: "var(--color-primary)", bg: "var(--color-primary-glow)", accent: "var(--color-primary)" },
    { label: "Total Teachers",    value: stats.teachers,  icon: <UsersIcon width="22" height="22" />,       color: "var(--color-success)", bg: "var(--color-success-bg)",  accent: "var(--color-success)" },
    { label: "Total Operators",   value: stats.operators, icon: <UsersIcon width="22" height="22" />,       color: "var(--color-info)",    bg: "var(--color-info-bg)",     accent: "var(--color-info)" },
    { label: "Total Subjects",    value: stats.subjects,  icon: <BookIcon width="22" height="22" />,        color: "var(--color-warning)", bg: "var(--color-warning-bg)",  accent: "var(--color-warning)" },
    { label: "Published Exams",   value: stats.published, icon: <CheckCircleIcon width="22" height="22" />, color: "var(--color-success)", bg: "var(--color-success-bg)",  accent: "var(--color-success)" },
    { label: "Exams Completed",   value: stats.exams,     icon: <DocumentIcon width="22" height="22" />,    color: "var(--color-purple)",  bg: "var(--color-purple-bg)",   accent: "var(--color-purple)" },
  ];

  const quickLinks = [
    { href: "/ADMIN/subjects", label: "Manage Subjects", desc: "Create, assign & publish exams", icon: <BookIcon width="20" height="20" /> },
    { href: "/ADMIN/users",    label: "Manage Users",    desc: "Add teachers, students & operators", icon: <UsersIcon width="20" height="20" /> },
    { href: "/ADMIN/settings", label: "System Settings", desc: "Backup, restore & audit logs", icon: <SettingsIcon width="20" height="20" /> },
  ];

  return (
    <>
      {/* Page Header */}
      <div className="pageHeader animate-enter">
        <div>
          <h1 className="pageTitle">Dashboard</h1>
          <p className="pageSubtitle">Welcome back, Operator</p>
        </div>
        <span className={styles.dateTag}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          {new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
        </span>
      </div>

      {/* Global Search & Historical Archive Crawler */}
      <AdminGlobalSearch />

      {/* Stats */}
      <section className={styles.statsGrid}>
        {statCards.map((s, i) => (
          <div
            key={s.label}
            className={`${styles.statCard} animate-enter`}
            style={{ animationDelay: `${i * 45}ms`, "--accent": s.accent } as React.CSSProperties}
          >
            <div className={styles.statIconBox} style={{ background: s.bg, color: s.color }}>
              {s.icon}
            </div>
            <div className={styles.statData}>
              <div className={styles.statValue}>{s.value}</div>
              <div className={styles.statLabel}>{s.label}</div>
            </div>
          </div>
        ))}
      </section>

      {/* Session Snapshots & Historical Performance */}
      <SessionSnapshotCard />

      {/* Quick Actions */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>Quick Actions</span>
        </div>
        <div className={styles.quickGrid}>
          {quickLinks.map((l, i) => (
            <Link key={l.href} href={l.href} className={`${styles.quickCard} animate-enter`} style={{ animationDelay: `${i * 45 + 270}ms` }}>
              <div className={styles.quickIcon}>{l.icon}</div>
              <div className={styles.quickContent}>
                <div className={styles.quickLabel}>{l.label}</div>
                <div className={styles.quickDesc}>{l.desc}</div>
              </div>
              <div className={styles.arrow}><ChevronRightIcon width="16" height="16" /></div>
            </Link>
          ))}
        </div>
      </section>

      {/* Recent Subjects */}
      <section className={`${styles.section} animate-enter`} style={{ animationDelay: "400ms" }}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>Recent Subjects</span>
          <Link href="/ADMIN/subjects" className="btn btn-ghost btn-sm inline">View All →</Link>
        </div>
        {subjects.length > 0 ? (
          <div className={styles.tableCard}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Code</th>
                  <th>Term</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {subjects.slice(0, 6).map((s: any) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600, color: "var(--color-text)" }}>{s.name}</td>
                    <td><code style={{ fontSize: "0.75rem", color: "var(--color-muted)", background: "var(--color-surface-2)", padding: "0.15rem 0.5rem", borderRadius: "4px" }}>{s.code}</code></td>
                    <td style={{ color: "var(--color-muted)", fontSize: "0.875rem" }}>{s.term}</td>
                    <td>
                      <span className={`badge ${s.is_published ? "badge-success" : "badge-muted"}`}>
                        {s.is_published ? "Published" : "Draft"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No Subjects Yet"
            description="You haven't created any subjects yet. Get started by adding one."
            action={<Link href="/ADMIN/subjects" className="btn btn-primary">Create Subject</Link>}
            icon={<BookIcon width="24" height="24" />}
          />
        )}
      </section>
    </>
  );
}
