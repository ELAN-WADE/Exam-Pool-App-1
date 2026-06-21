"use client";

import { useEffect, useState } from "react";
import { DownloadIcon, CheckCircleIcon } from "./../icons/Icons";
import styles from "../../app/student/dashboard/page.module.css";

export function DownloadAppWidget() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Check if app is already running in standalone mode (installed)
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
    }
  };

  // Hide the widget if the app is already installed or if installation is not supported/prompted
  if (isInstalled || !deferredPrompt) {
    return null;
  }

  return (
    <div className={styles.card} style={{ width: "100%", background: "var(--color-surface)", border: "1px solid var(--color-primary)", borderLeft: "4px solid var(--color-primary)" }}>
      <div className={styles.cardContent}>
        <div className={styles.cardTop}>
          <div className={styles.subjectIconBox} style={{ background: "var(--color-primary)", color: "white" }}>
            <DownloadIcon width="20" height="20" />
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <span className="badge badge-primary">Recommended</span>
          </div>
        </div>
        <h3 className={styles.subjectName} style={{ marginTop: "0.75rem" }}>Download ExamPool App</h3>
        <p style={{ color: "var(--color-muted)", fontSize: "0.9rem", marginTop: "0.25rem", lineHeight: 1.4 }}>
          Install ExamPool to your device for a seamless, full-screen experience and fast offline access.
        </p>

        <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem", flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={handleInstallClick}>
            <DownloadIcon width="16" height="16" /> Install App Now
          </button>
        </div>
      </div>
    </div>
  );
}
