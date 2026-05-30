"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { api } from "../../../lib/api";
import { scorePct, letterGrade, gradeBadgeClass, gradeColor, fmtDate } from "../../../lib/gradeUtils";
import { DocumentIcon, BarChartIcon, TrophyIcon, CheckCircleIcon, EmptyBoxIcon, SettingsIcon } from "../../../components/icons/Icons";
import styles from "./page.module.css";

export default function StudentResultsPage() {
  return (
    <RequireRole role="student">
      <ResultsContent />
    </RequireRole>
  );
}

function ResultsContent() {
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = (await api.getResults()) as any[];
        if (mounted) setResults(data ?? []);
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : "Failed to load results");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const stats = useMemo(() => {
    if (!results.length) return { total: 0, avg: 0, best: 0, pass: 0 };
    const pcts = results.map((r) => scorePct(r.score, r.total_score));
    const avg  = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
    const best = Math.max(...pcts);
    const pass = pcts.filter((p) => p >= 50).length;
    return { total: results.length, avg, best, pass };
  }, [results]);

  if (loading) return <div className="loadingWrap"><div className="spinner" /></div>;
  if (error)   return <main className={styles.page}><p className={styles.error}>{error}</p></main>;

  return (
    <main className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <h1 className={styles.title}>My Results</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Link href="/student/dashboard" className="btn btn-ghost">← Dashboard</Link>
          <Link href="/student/settings" className="btn btn-ghost" style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}><SettingsIcon width="14" height="14" /> Settings</Link>
          <button className="btn btn-ghost" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      {/* Stats */}
      <div className={styles.statsRow}>
        {[
          { label: "Exams Taken",  value: stats.total,   icon: <DocumentIcon width="24" height="24" />, color: "#4f7cff" },
          { label: "Average Score",value: `${stats.avg}%`, icon: <BarChartIcon width="24" height="24" />, color: "#22c55e" },
          { label: "Best Score",   value: `${stats.best}%`, icon: <TrophyIcon width="24" height="24" />, color: "#f59e0b" },
          { label: "Passed",       value: stats.pass,    icon: <CheckCircleIcon width="24" height="24" />, color: "#38bdf8" },
        ].map((s) => (
          <div key={s.label} className={styles.statCard}>
            <span className={styles.statIcon}>{s.icon}</span>
            <div>
              <div className={styles.statValue} style={{ color: s.color }}>{s.value}</div>
              <div className={styles.statLabel}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {results.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIconWrapper}>
            <EmptyBoxIcon width="48" height="48" />
          </div>
          <h2>No Results Yet</h2>
          <p>You haven't completed any exams yet.</p>
          <Link href="/student/dashboard" className="btn btn-primary" style={{ marginTop: "0.75rem" }}>Go to Dashboard</Link>
        </div>
      ) : (
        <div className={styles.cards}>
          {results.map((r) => {
            const pct        = scorePct(r.score, r.total_score);
            const grade      = letterGrade(pct);
            const gColor     = gradeColor(pct);
            const gradeClass = gradeBadgeClass(pct);
            return (
              <div key={r.id} className={styles.card}>
                <div className={styles.cardLeft}>
                  <div className={styles.gradeCircle} style={{ borderColor: gColor, color: gColor }}>
                    {grade}
                  </div>
                </div>
                <div className={styles.cardBody}>
                  <div className={styles.subjectName}>{r.subject_name || `Subject #${r.subject_id}`}</div>
                  <div className={styles.cardMeta}>
                    <span className={`badge ${gradeClass}`}>{pct}%</span>
                    <span style={{ color: "var(--color-muted)", fontSize: "0.8rem" }}>
                      Score: {r.score ?? 0} / {Number(r.total_score ?? 0) || "?"}
                    </span>
                    {r.end_time && (
                      <span style={{ color: "var(--color-muted)", fontSize: "0.78rem" }}>
                        {fmtDate(r.end_time, { day: "2-digit", month: "short", year: "numeric" })}
                      </span>
                    )}
                  </div>
                  <div className={styles.progressBar}>
                    <div className={styles.progressFill} style={{ width: `${pct}%`, background: gColor }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <footer className={styles.footer}>ExamPool LAN — Student Report</footer>
    </main>
  );
}
