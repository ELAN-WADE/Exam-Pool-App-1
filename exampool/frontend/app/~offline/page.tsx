"use client";

import styles from "./page.module.css";

export default function OfflinePage() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1>Connection lost to exam server</h1>
        <p>Please notify your teacher.</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    </main>
  );
}
