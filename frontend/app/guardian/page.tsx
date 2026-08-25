"use client";

import { Suspense } from "react";
import styles from "../page.module.css";
import LoginForm from "../../components/auth/LoginForm";

function GuardianLoginHero() {
  return (
    <div className={styles.heroPanl} style={{ background: "linear-gradient(145deg, #1E1B4B 0%, #312E81 100%)" }}>
      <div className={styles.heroBrand}>
        <div className={styles.heroBrandIcon} style={{ background: "#6366F1" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
            <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 00-3-3.87" />
            <path d="M16 3.13a4 4 0 010 7.75" />
          </svg>
        </div>
        <span className={styles.heroBrandName}>ExamPool Guardian</span>
      </div>

      <div className={styles.heroBody}>
        <h2 className={styles.heroTitle}>
          Guardian<br />Portal.
        </h2>
        <p className={styles.heroSub}>
          Track your wards' academic growth, view live CBT schedules, review scorecards, and stay informed on progress.
        </p>
      </div>

      <div className={styles.heroFeatures}>
        {[
          "Real-time ward scorecards & remarks",
          "Live CBT exam timetables",
          "Term report cards & share tokens",
          "Direct teacher messaging channels",
        ].map((f) => (
          <div key={f} className={styles.heroFeatureItem}>
            <span className={styles.heroFeatureDot} style={{ background: "#818CF8" }} />
            {f}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function GuardianPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="spinner" />
      </div>
    }>
      <main className={styles.page}>
        <div className={styles.authContainer}>
          <GuardianLoginHero />
          <div className={styles.formPanl}>
            <div className={styles.mobileBrand}>
              <div className={styles.heroBrandIcon} style={{ background: "#6366F1" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
                  <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 00-3-3.87" />
                  <path d="M16 3.13a4 4 0 010 7.75" />
                </svg>
              </div>
              <span className={styles.heroBrandName}>ExamPool</span>
            </div>
            <LoginForm expectedRole="guardian" />
          </div>
        </div>
      </main>
    </Suspense>
  );
}
