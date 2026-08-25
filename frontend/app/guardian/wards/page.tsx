"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useGuardian } from "../../../components/guardian/GuardianContext";
import styles from "./page.module.css";

export default function GuardianWardsPage() {
  return (
    <RequireRole role="guardian">
      <WardsList />
    </RequireRole>
  );
}

function WardsList() {
  const { wards, setActiveWardId } = useGuardian();
  const router = useRouter();

  const handleSelectWard = (id: number, targetUrl: string) => {
    setActiveWardId(id);
    router.push(targetUrl);
  };

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <h1 className={styles.pageTitle}>My Children</h1>
        <Link href="/guardian/links" className={styles.addWardBtn} title="Link a new child">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </Link>
      </div>

      <div className={styles.childrenList}>
        {wards.map((ward) => (
          <div key={ward.id} className={styles.childCard}>
            {/* Top Identity Row */}
            <div
              className={styles.childCardTop}
              onClick={() => handleSelectWard(ward.id, `/guardian/wards/${ward.id}`)}
              style={{ cursor: "pointer" }}
            >
              <div className={styles.childIdentityGroup}>
                <div className={styles.childAvatar}>{ward.name.charAt(0).toUpperCase()}</div>
                <div className={styles.childMeta}>
                  <span className={styles.childName}>{ward.name}</span>
                  <span className={styles.childClass}>{ward.grade}</span>
                  <span className={styles.childAdmission}>Admission No. {ward.admission_number}</span>
                </div>
              </div>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={styles.chevronIcon}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>

            {/* 3-Column Metrics */}
            <div className={styles.childMetricsRow}>
              <div className={styles.metricCol}>
                <span className={styles.metricLabel}>Average</span>
                <span className={styles.metricValue}>{ward.average_score}%</span>
              </div>
              <div className={styles.metricCol}>
                <span className={styles.metricLabel}>Attendance</span>
                <span className={styles.metricValue}>{ward.attendance_pct}%</span>
              </div>
              <div className={styles.metricCol}>
                <span className={styles.metricLabel}>Position</span>
                <span className={styles.metricValue}>{ward.class_position}</span>
              </div>
            </div>

            {/* Quick Navigation Strip */}
            <div className={styles.quickActionsRow}>
              <button
                type="button"
                className={styles.quickActionBtn}
                onClick={() => handleSelectWard(ward.id, "/guardian/performance")}
              >
                Performance
              </button>
              <button
                type="button"
                className={styles.quickActionBtn}
                onClick={() => handleSelectWard(ward.id, "/guardian/attendance")}
              >
                Attendance
              </button>
              <button
                type="button"
                className={styles.quickActionBtn}
                onClick={() => handleSelectWard(ward.id, `/guardian/wards/${ward.id}`)}
              >
                Full Profile
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
