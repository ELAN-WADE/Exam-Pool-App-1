"use client";

import { Suspense } from "react";
import styles from "../page.module.css";
import LoginForm from "../../components/auth/LoginForm";

function AdminLoginHero() {
  return (
    <div className={styles.heroPanl}>
      <div className={styles.heroBrand}>
        <div className={styles.heroBrandIcon}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <span className={styles.heroBrandName}>ExamPool Portal</span>
      </div>

      <div className={styles.heroBody}>
        <h2 className={styles.heroTitle}>
          System<br />Administration.
        </h2>
        <p className={styles.heroSub}>
          Central control for school academic calendars, user management, timetables, and system settings.
        </p>
      </div>

      <div className={styles.heroFeatures}>
        {[
          "Master curriculum & timetable control",
          "Form & Class Teacher assignments",
          "Automated grading configurations",
          "Network telemetry & host server controls",
        ].map((f) => (
          <div key={f} className={styles.heroFeatureItem}>
            <span className={styles.heroFeatureDot} />
            {f}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="spinner" />
      </div>
    }>
      <main className={styles.page}>
        <div className={styles.authContainer}>
          <AdminLoginHero />
          <div className={styles.formPanl}>
            <div className={styles.mobileBrand}>
              <div className={styles.heroBrandIcon}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                </svg>
              </div>
              <span className={styles.heroBrandName}>ExamPool</span>
            </div>
            <LoginForm expectedRole="operator" />
          </div>
        </div>
      </main>
    </Suspense>
  );
}
