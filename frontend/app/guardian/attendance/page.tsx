"use client";

import React from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useGuardian } from "../../../components/guardian/GuardianContext";
import styles from "./page.module.css";

export default function GuardianAttendancePage() {
  return (
    <RequireRole role="guardian">
      <AttendanceContent />
    </RequireRole>
  );
}

function AttendanceContent() {
  const { activeWard } = useGuardian();

  if (!activeWard) {
    return <div style={{ padding: "2rem", textAlign: "center" }}>No active ward selected.</div>;
  }

  const att = activeWard.attendance;
  const daysOfWeek = ["M", "T", "W", "T", "F", "S", "S"];

  const calendarDays = (att.calendar_days && att.calendar_days.length > 0) ? att.calendar_days : Array.from({ length: 30 }, (_, i) => {
    const dayNum = i + 1;
    const dayOfWeek = (dayNum + 2) % 7; // rough weekday calculation
    let status: "present" | "absent" | "late" | "holiday" | "weekend" = "present";
    if (dayOfWeek === 0 || dayOfWeek === 6) status = "weekend";
    else if (dayNum === 14) status = "absent";
    else if (dayNum === 21) status = "late";
    return { day: dayNum, status };
  });

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>Attendance Record</h1>

      {/* ── 1. Overview Card ── */}
      <section className={styles.overviewCard}>
        <div className={styles.overviewLeft}>
          <span className={styles.pctTitle}>{att.percentage}%</span>
          <span className={styles.pctSubtitle}>• Consistent Punctuality</span>
          <span className={styles.pctDays}>
            {att.present_days} of {att.total_days} school days attended
          </span>
        </div>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#EFF4FF", display: "flex", alignItems: "center", justifyContent: "center", color: "#165AF6" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      </section>

      {/* ── 2. Stat Pills ── */}
      <section className={styles.statPillsRow}>
        <div className={styles.statPill}>
          <span className={styles.statPillNum} style={{ color: "#059669" }}>
            {att.present_days}
          </span>
          <span className={styles.statPillLabel}>Present</span>
        </div>
        <div className={styles.statPill}>
          <span className={styles.statPillNum} style={{ color: "#DC2626" }}>
            {att.absent_days}
          </span>
          <span className={styles.statPillLabel}>Absent</span>
        </div>
        <div className={styles.statPill}>
          <span className={styles.statPillNum} style={{ color: "#D97706" }}>
            {att.late_days}
          </span>
          <span className={styles.statPillLabel}>Late</span>
        </div>
      </section>

      {/* ── 3. Interactive Monthly Calendar ── */}
      <section className={styles.calendarCard}>
        <div className={styles.calendarHeader}>
          <span className={styles.calendarMonthTitle}>May 2025</span>
          <span style={{ fontSize: "0.75rem", color: "#64748B" }}>Term 1</span>
        </div>

        <div className={styles.calendarGrid}>
          {daysOfWeek.map((d, i) => (
            <div key={i} className={styles.dayLabel}>
              {d}
            </div>
          ))}

          {calendarDays.map((item) => (
            <div key={item.day} className={styles.dateCell}>
              <span>{item.day}</span>
              {item.status === "present" && <span className={`${styles.statusDot} ${styles.dotPresent}`} />}
              {item.status === "absent" && <span className={`${styles.statusDot} ${styles.dotAbsent}`} />}
              {item.status === "late" && <span className={`${styles.statusDot} ${styles.dotLate}`} />}
              {item.status === "holiday" && <span className={`${styles.statusDot} ${styles.dotHoliday}`} />}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className={styles.legendRow}>
          <div className={styles.legendItem}>
            <span className={`${styles.statusDot} ${styles.dotPresent}`} />
            <span>Present</span>
          </div>
          <div className={styles.legendItem}>
            <span className={`${styles.statusDot} ${styles.dotAbsent}`} />
            <span>Absent</span>
          </div>
          <div className={styles.legendItem}>
            <span className={`${styles.statusDot} ${styles.dotHoliday}`} />
            <span>Holiday</span>
          </div>
        </div>
      </section>
    </div>
  );
}
