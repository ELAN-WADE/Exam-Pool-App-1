"use client";

import React from "react";
import Link from "next/link";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useGuardian } from "../../../components/guardian/GuardianContext";
import styles from "./page.module.css";

export default function GuardianPerformancePage() {
  return (
    <RequireRole role="guardian">
      <PerformanceContent />
    </RequireRole>
  );
}

function PerformanceContent() {
  const { activeWard, period, setPeriod } = useGuardian();

  if (!activeWard) {
    return <div style={{ padding: "2rem", textAlign: "center" }}>No active ward selected.</div>;
  }

  // Circular gauge calculations (SVG circumference)
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (activeWard.average_score / 100) * circumference;

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.headerRow}>
        <h1 className={styles.pageHeading}>{activeWard.name} • Performance</h1>
        <button
          type="button"
          className={styles.periodBadge}
          onClick={() => setPeriod(period === "this_term" ? "this_week" : "this_term")}
        >
          {period === "this_term" ? "This Term ▾" : "This Week ▾"}
        </button>
      </div>

      {/* ── 1. Circular Progress Gauge Card ── */}
      <section className={styles.gaugeCard}>
        <div className={styles.gaugeWrapper}>
          <svg width="120" height="120" viewBox="0 0 120 120" style={{ transform: "rotate(-90deg)" }}>
            <circle
              cx="60"
              cy="60"
              r={radius}
              fill="transparent"
              stroke="#F1F5F9"
              strokeWidth="10"
            />
            <circle
              cx="60"
              cy="60"
              r={radius}
              fill="transparent"
              stroke="#165AF6"
              strokeWidth="10"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              style={{ transition: "stroke-dashoffset 0.8s ease" }}
            />
          </svg>
          <div className={styles.gaugeCenterContent}>
            <span className={styles.gaugeValueText}>{activeWard.average_score}%</span>
            <span className={styles.gaugeLabelText}>Average</span>
          </div>
        </div>
        <span className={styles.gaugeRatingText}>• Good Academic Standing</span>
      </section>

      {/* ── 2. Subject Performance Rows ── */}
      <section className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>Subject Breakdown</h2>

        <div className={styles.subjectList}>
          {activeWard.subjects_performance.map((sub) => (
            <div key={sub.subject_code} className={styles.subjectItem}>
              <div className={styles.subjectTopRow}>
                <div className={styles.subjectIdentity}>
                  <div
                    className={styles.subjectIconBox}
                    style={{ background: `${sub.color || "#165AF6"}15`, color: sub.color || "#165AF6" }}
                  >
                    {sub.subject_code}
                  </div>
                  <span className={styles.subjectName}>{sub.subject_name}</span>
                </div>
                <div className={styles.subjectScoreGroup}>
                  <span className={styles.scoreText}>{sub.score}%</span>
                  <span
                    className={styles.gradePill}
                    style={{
                      background: sub.score >= 80 ? "#ECFDF5" : sub.score >= 65 ? "#EFF4FF" : "#FEF2F2",
                      color: sub.score >= 80 ? "#059669" : sub.score >= 65 ? "#165AF6" : "#DC2626",
                    }}
                  >
                    Grade {sub.grade}
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              <div className={styles.progressTrack}>
                <div
                  className={styles.progressBar}
                  style={{
                    width: `${sub.score}%`,
                    background: sub.color || "#165AF6",
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        <Link href="/guardian/reports" className={styles.viewReportBtn}>
          <span>View Detailed Term Report</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>
      </section>
    </div>
  );
}
