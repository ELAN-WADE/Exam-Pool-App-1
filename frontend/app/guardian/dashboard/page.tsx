"use client";

import React, { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useGuardian } from "../../../components/guardian/GuardianContext";
import styles from "./page.module.css";

export default function GuardianDashboardPage() {
  return (
    <RequireRole role="guardian">
      <GuardianDashboard />
    </RequireRole>
  );
}

function GuardianDashboard() {
  const { activeWard, guardianName, period, setPeriod } = useGuardian();
  const [activePointIndex, setActivePointIndex] = useState<number | null>(6); // Default to latest W7

  if (!activeWard) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "#64748B" }}>
        Loading guardian overview…
      </div>
    );
  }

  // Trend line chart computation
  const trendPoints = activeWard.trend_data || [];
  const svgWidth = 320;
  const svgHeight = 110;
  const paddingX = 25;
  const paddingY = 20;

  const minScore = 60;
  const maxScore = 100;

  const coordinates = trendPoints.map((pt, i) => {
    const x = paddingX + (i / (trendPoints.length - 1)) * (svgWidth - paddingX * 2);
    const normalizedY = (pt.score - minScore) / (maxScore - minScore);
    const y = svgHeight - paddingY - normalizedY * (svgHeight - paddingY * 2);
    return { x, y, week: pt.week, score: pt.score };
  });

  const pathD = coordinates.reduce((acc, curr, idx) => {
    if (idx === 0) return `M ${curr.x} ${curr.y}`;
    const prev = coordinates[idx - 1];
    const cp1x = prev.x + (curr.x - prev.x) / 2;
    const cp1y = prev.y;
    const cp2x = prev.x + (curr.x - prev.x) / 2;
    const cp2y = curr.y;
    return `${acc} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${curr.x} ${curr.y}`;
  }, "");

  const areaD = `${pathD} L ${coordinates[coordinates.length - 1]?.x || svgWidth} ${svgHeight} L ${coordinates[0]?.x || 0} ${svgHeight} Z`;

  const nextEvent = activeWard.upcoming_events?.[0];

  return (
    <div className={styles.container}>
      {/* ── 1. Personalized Greeting Header ── */}
      <section className={styles.greetingSection}>
        <div className={styles.greetingTitleRow}>
          <h1 className={styles.greetingHeading}>Good morning, {guardianName} 👋</h1>
          <button
            type="button"
            className={styles.periodDropdown}
            onClick={() => setPeriod(period === "this_term" ? "this_week" : "this_term")}
          >
            <span>{period === "this_term" ? "This Term" : "This Week"}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
        <p className={styles.greetingSubtitle}>
          Here's how {activeWard.name.split(" ")[0]} is doing today.
        </p>
      </section>

      {/* ── 2. 2x2 Quick Overview Stat Grid ── */}
      <section className={styles.statGrid}>
        {/* Card 1: Overall Average */}
        <Link href="/guardian/performance" className={styles.statCard}>
          <div className={styles.statCardTop}>
            <div className={styles.statIconBox} style={{ background: "#EFF4FF", color: "#165AF6" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 20V10" />
                <path d="M12 20V4" />
                <path d="M6 20v-6" />
              </svg>
            </div>
            <span style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#059669" }}>
              +{activeWard.score_delta || 4.2}%
            </span>
          </div>
          <div>
            <div className={styles.statValue}>{activeWard.average_score}%</div>
            <div className={styles.statMeta}>
              <span className={styles.statLabel}>Overall Average</span>
              <span className={styles.statSubtext}>• Good Performance</span>
            </div>
          </div>
        </Link>

        {/* Card 2: Exams Completed */}
        <Link href="/guardian/examinations" className={styles.statCard}>
          <div className={styles.statCardTop}>
            <div className={styles.statIconBox} style={{ background: "#ECFDF5", color: "#059669" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            </div>
            <span style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#059669" }}>Live</span>
          </div>
          <div>
            <div className={styles.statValue}>
              {activeWard.completed_exams}/{activeWard.total_exams}
            </div>
            <div className={styles.statMeta}>
              <span className={styles.statLabel}>Exams Completed</span>
              <span className={styles.statSubtext}>This Term</span>
            </div>
          </div>
        </Link>

        {/* Card 3: Attendance */}
        <Link href="/guardian/attendance" className={styles.statCard}>
          <div className={styles.statCardTop}>
            <div className={styles.statIconBox} style={{ background: "#FFFBEB", color: "#D97706" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <span style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#D97706" }}>
              {activeWard.attendance.present_days}/{activeWard.attendance.total_days}
            </span>
          </div>
          <div>
            <div className={styles.statValue}>{activeWard.attendance_pct}%</div>
            <div className={styles.statMeta}>
              <span className={styles.statLabel}>Attendance</span>
              <span className={styles.statSubtext}>Present: {activeWard.attendance.present_days} days</span>
            </div>
          </div>
        </Link>

        {/* Card 4: Class Position */}
        <Link href="/guardian/reports" className={styles.statCard}>
          <div className={styles.statCardTop}>
            <div className={styles.statIconBox} style={{ background: "#F5F3FF", color: "#7C3AED" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="7" />
                <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
              </svg>
            </div>
            <span style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#7C3AED" }}>Top 10%</span>
          </div>
          <div>
            <div className={styles.statValue}>{activeWard.class_position}</div>
            <div className={styles.statMeta}>
              <span className={styles.statLabel}>Class Position</span>
              <span className={styles.statSubtext}>out of {activeWard.total_class_students} students</span>
            </div>
          </div>
        </Link>
      </section>

      {/* ── 3. Performance Trend SVG Line Graph ── */}
      <section className={styles.trendCard}>
        <div className={styles.trendHeader}>
          <h2 className={styles.trendTitle}>Performance Trend</h2>
          <button type="button" className={styles.subjectFilterPill}>
            All Subjects ▾
          </button>
        </div>

        <div className={styles.chartSvgWrapper}>
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            style={{ width: "100%", height: "100%", overflow: "visible" }}
          >
            <defs>
              <linearGradient id="trendGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#165AF6" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#165AF6" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Subtle Horizontal Grid lines */}
            <line x1="0" y1="25" x2={svgWidth} y2="25" stroke="#F1F5F9" strokeWidth="1" strokeDasharray="3 3" />
            <line x1="0" y1="60" x2={svgWidth} y2="60" stroke="#F1F5F9" strokeWidth="1" strokeDasharray="3 3" />
            <line x1="0" y1="90" x2={svgWidth} y2="90" stroke="#F1F5F9" strokeWidth="1" strokeDasharray="3 3" />

            {/* Area Fill */}
            <path d={areaD} fill="url(#trendGradient)" />

            {/* Stroke Line */}
            <path
              d={pathD}
              fill="none"
              stroke="#165AF6"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Interactive Points */}
            {coordinates.map((pt, idx) => {
              const isSelected = activePointIndex === idx;
              return (
                <g key={pt.week} onClick={() => setActivePointIndex(idx)} style={{ cursor: "pointer" }}>
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={isSelected ? 5 : 3.5}
                    fill="#FFFFFF"
                    stroke="#165AF6"
                    strokeWidth={isSelected ? 3 : 2}
                  />
                  {isSelected && (
                    <g>
                      <rect
                        x={pt.x - 18}
                        y={pt.y - 26}
                        width="36"
                        height="18"
                        rx="4"
                        fill="#0F172A"
                      />
                      <text
                        x={pt.x}
                        y={pt.y - 14}
                        fill="#FFFFFF"
                        fontSize="9"
                        fontWeight="700"
                        textAnchor="middle"
                      >
                        {pt.score}%
                      </text>
                    </g>
                  )}
                  {/* Week label below */}
                  <text
                    x={pt.x}
                    y={svgHeight - 4}
                    fill="#94A3B8"
                    fontSize="9"
                    fontWeight="600"
                    textAnchor="middle"
                  >
                    {pt.week}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </section>

      {/* ── 4. Upcoming Events Spotlight ── */}
      {nextEvent && (
        <section className={styles.sectionBlock}>
          <div className={styles.sectionHeaderRow}>
            <h2 className={styles.sectionHeading}>Upcoming Events</h2>
            <Link href="/guardian/examinations" className={styles.sectionLink}>
              View All
            </Link>
          </div>

          <Link href="/guardian/examinations" className={styles.eventCard}>
            <div className={styles.eventLeft}>
              <div className={styles.eventDateBadge}>
                <span className={styles.eventMonth}>{nextEvent.month}</span>
                <span className={styles.eventDay}>{nextEvent.day}</span>
                <span className={styles.eventWeekday}>{nextEvent.weekday}</span>
              </div>
              <div className={styles.eventDetailsCol}>
                <div className={styles.eventTitleRow}>
                  <span className={styles.eventTitle}>{nextEvent.title}</span>
                  {nextEvent.status === "live" && <span className={styles.livePill}>• Live</span>}
                </div>
                <span className={styles.eventMetaText}>
                  {nextEvent.time_str} • {nextEvent.venue}
                </span>
              </div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={styles.chevronIcon}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Link>
        </section>
      )}

      {/* ── 5. Recent Activity Feed ── */}
      <section className={styles.sectionBlock}>
        <div className={styles.sectionHeaderRow}>
          <h2 className={styles.sectionHeading}>Recent Activity</h2>
          <Link href="/guardian/reports" className={styles.sectionLink}>
            View All
          </Link>
        </div>

        <div className={styles.activityList}>
          {activeWard.recent_activity.map((act) => (
            <div key={act.id} className={styles.activityItem}>
              <div className={styles.activityLeft}>
                <div className={styles.activityCheckIcon}>✓</div>
                <div className={styles.activityInfo}>
                  <span className={styles.activityTitle}>{act.title}</span>
                  <span className={styles.activityDate}>{act.date_label}</span>
                </div>
              </div>
              {act.score && <span className={styles.activityScoreChip}>{act.score}</span>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
