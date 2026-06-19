"use client";

import { Suspense } from "react";
import styles from "./page.module.css";
import LoginForm from "../components/auth/LoginForm";

function StudentLoginHero() {
  return (
    <div className={styles.heroPanl}>
      <div className={styles.heroBrand}>
        <div className={styles.heroBrandIcon}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <span className={styles.heroBrandName}>ExamPool</span>
      </div>

      <div className={styles.heroBody}>
        <h2 className={styles.heroTitle}>
          Exams made<br />simple.
        </h2>
        <p className={styles.heroSub}>
          A fast, reliable Local Area Network examination platform designed for students to take exams seamlessly.
        </p>
      </div>

      <div className={styles.heroFeatures}>
        {[
          "Works fully offline on your LAN",
          "Supports MCQ, True/False & Essays",
          "Real-time auto-save during exams",
          "Instant results & report cards",
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

export default function HomePage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="spinner" />
      </div>
    }>
      <main className={styles.page}>
        <StudentLoginHero />
        <div className={styles.formPanl}>
          <div className={styles.mobileBrand}>
            <div className={styles.heroBrandIcon}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <span className={styles.heroBrandName}>ExamPool</span>
          </div>
          <LoginForm expectedRole="student" />
        </div>
      </main>
    </Suspense>
  );
}