"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { WarningIcon, CheckCircleIcon, BookIcon } from "../../components/icons/Icons";
import styles from "./page.module.css";

export default function SetupPage() {
  const router = useRouter();
  const { init } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState(1);

  useEffect(() => {
    fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then((res) => {
        if (res.status === 403) router.replace("/");
      })
      .finally(() => setLoading(false));
  }, [router]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.setup({ name, email, password });
      if (!result) return;
      await init();
      setStep(3); // Show success step before redirecting
      setTimeout(() => router.replace("/ADMIN/dashboard/"), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className={styles.page}>
        <div className="loadingWrap"><div className="spinner" style={{ borderColor: "rgba(255,255,255,0.2)", borderTopColor: "#fff" }} /></div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        {/* Left Side: Information */}
        <div className={styles.infoPane}>
          <div className={styles.brand}>
            <BookIcon width="28" height="28" />
            <span>ExamPool Initial Setup</span>
          </div>
          
          <div className={styles.heroText}>
            <h1>Welcome to ExamPool.</h1>
            <p>You are configuring this machine as the central exam server for your local network.</p>
          </div>

          <div className={styles.features}>
            <div className={styles.feature}>
              <div className={styles.featureIcon}><CheckCircleIcon width="20" height="20" /></div>
              <div>
                <strong>Offline Capable</strong>
                <p>Run exams securely without internet access.</p>
              </div>
            </div>
            <div className={styles.feature}>
              <div className={styles.featureIcon}><CheckCircleIcon width="20" height="20" /></div>
              <div>
                <strong>LAN Multiplayer</strong>
                <p>Students connect directly to this machine's IP address.</p>
              </div>
            </div>
            <div className={styles.feature}>
              <div className={styles.featureIcon}><WarningIcon width="20" height="20" style={{ color: "#FCD34D" }} /></div>
              <div>
                <strong>No Password Recovery</strong>
                <p>Keep your operator password safe. It cannot be recovered.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Form */}
        <div className={styles.formPane}>
          {step === 1 && (
            <div className={styles.formWrapper}>
              <div className={styles.stepIndicator}>Step 1 of 2</div>
              <h2>Operator Profile</h2>
              <p className={styles.subtitle}>Create the master administrator account for this server.</p>
              
              {error && (
                <div className={styles.errorBanner}>
                  <WarningIcon width="16" height="16" />
                  {error}
                </div>
              )}

              <form onSubmit={(e) => { e.preventDefault(); setStep(2); }} className={styles.form}>
                <div className="field">
                  <label>Full Name</label>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="System Administrator" required autoFocus />
                </div>
                <div className="field">
                  <label>Email Address</label>
                  <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@school.local" required />
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: "100%", padding: "0.85rem", marginTop: "1rem" }}>
                  Continue →
                </button>
              </form>
            </div>
          )}

          {step === 2 && (
            <div className={styles.formWrapper}>
              <div className={styles.stepIndicator}>Step 2 of 2</div>
              <h2>Secure the Server</h2>
              <p className={styles.subtitle}>Create a strong password for the <strong>{email}</strong> operator account.</p>
              
              {error && (
                <div className={styles.errorBanner}>
                  <WarningIcon width="16" height="16" />
                  {error}
                </div>
              )}

              <form onSubmit={onSubmit} className={styles.form}>
                <div className="field">
                  <label>Master Password</label>
                  <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimum 6 characters" required autoFocus />
                </div>
                <div className="field">
                  <label>Confirm Password</label>
                  <input className="input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-type password" required />
                </div>
                
                <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setStep(1)} style={{ flex: 1 }}>
                    ← Back
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={submitting} style={{ flex: 2 }}>
                    {submitting ? "Initializing Server..." : "Complete Setup"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {step === 3 && (
            <div className={styles.formWrapper} style={{ textAlign: "center", alignItems: "center", display: "flex", flexDirection: "column" }}>
              <div style={{ color: "var(--color-success)", marginBottom: "1.5rem" }}>
                <CheckCircleIcon width="64" height="64" />
              </div>
              <h2>Server Initialized!</h2>
              <p className={styles.subtitle} style={{ marginBottom: "0" }}>Your local exam server is now running.</p>
              <p className={styles.subtitle}>Redirecting you to the Operator Dashboard...</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
