"use client";

import React, { useState } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useGuardian, type WardExamEvent } from "../../../components/guardian/GuardianContext";
import styles from "./page.module.css";

export default function GuardianExaminationsPage() {
  return (
    <RequireRole role="guardian">
      <ExaminationsList />
    </RequireRole>
  );
}

function ExaminationsList() {
  const { activeWard } = useGuardian();
  const [activeTab, setActiveTab] = useState<"all" | "upcoming" | "completed">("all");

  if (!activeWard) {
    return <div style={{ padding: "2rem", textAlign: "center" }}>No active ward selected.</div>;
  }

  const events: WardExamEvent[] = activeWard.upcoming_events || [];

  const filteredEvents = events.filter((ev) => {
    if (activeTab === "all") return true;
    if (activeTab === "upcoming") return ev.status === "upcoming" || ev.status === "live" || ev.status === "event";
    if (activeTab === "completed") return ev.status === "completed";
    return true;
  });

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <h1 className={styles.pageTitle}>Examinations & Timetable</h1>
      </div>

      {/* Tabs */}
      <div className={styles.tabList}>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === "all" ? styles.tabBtnActive : ""}`}
          onClick={() => setActiveTab("all")}
        >
          All ({events.length})
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === "upcoming" ? styles.tabBtnActive : ""}`}
          onClick={() => setActiveTab("upcoming")}
        >
          Live & Upcoming
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === "completed" ? styles.tabBtnActive : ""}`}
          onClick={() => setActiveTab("completed")}
        >
          Completed
        </button>
      </div>

      {/* Event Cards */}
      <div className={styles.examList}>
        {filteredEvents.map((ev) => (
          <div key={ev.id} className={styles.examCard}>
            <div className={styles.cardMainRow}>
              <div className={styles.dateBox}>
                <span className={styles.dateMonth}>{ev.month}</span>
                <span className={styles.dateDay}>{ev.day}</span>
                <span className={styles.dateWeekday}>{ev.weekday}</span>
              </div>
              <div className={styles.examInfoCol}>
                <div className={styles.examTitleLine}>
                  <span className={styles.examTitle}>{ev.title}</span>
                  {ev.status === "live" && <span className={`${styles.statusPill} ${styles.statusLive}`}>• Live Now</span>}
                  {ev.status === "upcoming" && <span className={`${styles.statusPill} ${styles.statusUpcoming}`}>Upcoming</span>}
                  {ev.status === "completed" && <span className={`${styles.statusPill} ${styles.statusCompleted}`}>Completed</span>}
                </div>
                <span className={styles.timeAndVenue}>
                  🕒 {ev.time_str} • 📍 {ev.venue}
                </span>
              </div>
            </div>

            {ev.instructions && (
              <div className={styles.instructionsBox}>
                <strong>Note:</strong> {ev.instructions}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
