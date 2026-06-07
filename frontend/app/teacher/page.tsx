"use client";

import { Suspense } from "react";
import styles from "../page.module.css";
import LoginForm from "../../components/auth/LoginForm";

function TeacherLoginHero() {
  return (
    <div className={styles.heroPanl}>
      <div className={styles.heroBrand}>
        <div className={styles.heroBrandIcon}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <span className={styles.heroBrandName}>ExamPool Portal</span>
      </div>

      <div className={styles.heroBody}>
        <h2 className={styles.heroTitle}>
          Teacher<br />Access.
        </h2>
        <p className={styles.heroSub}>
          Welcome to the Teacher Portal. Create questions, grade essays, and manage your subjects securely on the local network.
        </p>
      </div>
    </div>
  );
}

export default function TeacherPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="spinner" />
      </div>
    }>
      <main className={styles.page}>
        <TeacherLoginHero />
        <div className={styles.formPanl}>
          <LoginForm expectedRole="teacher" />
        </div>
      </main>
    </Suspense>
  );
}
