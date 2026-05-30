"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import styles from "../page.module.css";

export default function ForgotPasswordPage() {
  const router = useRouter();

  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("");
  
  const [verification, setVerification] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    
    try {
      const res = await fetch("/api/auth/reset-password/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "Failed to verify email");
      }
      
      setRole(data.data?.role || "student");
      setStep(2);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    
    setSubmitting(true);
    
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, verification, new_password: newPassword }),
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "Failed to reset password");
      }
      
      setSuccess("Your password has been successfully reset.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className={styles.page}>
      {/* ── Left Hero ── */}
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
            Regain<br />access.
          </h2>
          <p className={styles.heroSub}>
            Securely reset your password using your offline profile details.
          </p>
        </div>
      </div>

      {/* ── Right Form ── */}
      <div className={styles.formPanl}>
        <div className={styles.formWrap}>
          <div className={styles.formHeader}>
            <h1 className={styles.formTitle}>Reset Password</h1>
            <p className={styles.formSubtitle}>
              Remembered your password?{" "}
              <Link href="/" className={styles.formSubtitleLink}>Sign in →</Link>
            </p>
          </div>

          {success ? (
            <div className={styles.form}>
              <div className={styles.alertSuccess}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                {success}
              </div>
              <button 
                type="button" 
                className={styles.submitBtn} 
                onClick={() => router.push("/")}
              >
                Back to Sign in
              </button>
            </div>
          ) : (
            <>
              {error && (
                <div className={styles.alertError}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0, marginTop: "1px" }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  {error}
                </div>
              )}

              {step === 1 ? (
                <form onSubmit={handleEmailSubmit} className={styles.form}>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel} htmlFor="reset-email">Registration ID or Email</label>
                    <input
                      id="reset-email"
                      type="text"
                      className={styles.fieldInput}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="REG-XXXX or teacher@school.edu"
                      required
                    />
                  </div>

                  <button type="submit" className={styles.submitBtn} disabled={submitting}>
                    {submitting ? (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin 0.8s linear infinite" }}><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" opacity="0.25"/><path d="M21 12a9 9 0 00-9-9"/></svg>
                        Verifying…
                      </>
                    ) : "Next →"}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleResetSubmit} className={styles.form}>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel} htmlFor="reset-verification">
                      {role === "student" ? "Date of Birth (YYYY-MM-DD)" : "Phone Number"}
                    </label>
                    <input
                      id="reset-verification"
                      type={role === "student" ? "date" : "tel"}
                      className={styles.fieldInput}
                      value={verification}
                      onChange={(e) => setVerification(e.target.value)}
                      placeholder={role === "student" ? "YYYY-MM-DD" : "+1234567890"}
                      required
                    />
                  </div>

                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel} htmlFor="reset-new-password">New Password</label>
                    <div style={{ position: "relative" }}>
                      <input
                        id="reset-new-password"
                        type={showPass ? "text" : "password"}
                        className={styles.fieldInput}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        minLength={6}
                        style={{ paddingRight: "3rem" }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass(!showPass)}
                        style={{
                          position: "absolute", right: "0.875rem", top: "50%", transform: "translateY(-50%)",
                          background: "none", border: "none", cursor: "pointer", color: "var(--color-muted)",
                          padding: "0", minHeight: "unset", display: "flex", alignItems: "center",
                        }}
                        tabIndex={-1}
                      >
                        {showPass ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        )}
                      </button>
                    </div>
                  </div>
                  
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel} htmlFor="reset-confirm-password">Confirm Password</label>
                    <input
                      id="reset-confirm-password"
                      type={showPass ? "text" : "password"}
                      className={styles.fieldInput}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                    />
                  </div>

                  <button type="submit" className={styles.submitBtn} disabled={submitting}>
                    {submitting ? (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin 0.8s linear infinite" }}><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" opacity="0.25"/><path d="M21 12a9 9 0 00-9-9"/></svg>
                        Resetting…
                      </>
                    ) : "Reset Password"}
                  </button>
                  
                  <button 
                    type="button" 
                    onClick={() => setStep(1)} 
                    style={{ 
                      background: "none", border: "none", color: "var(--color-muted)", 
                      cursor: "pointer", fontSize: "0.875rem", marginTop: "0.5rem",
                      textDecoration: "underline"
                    }}
                  >
                    ← Back to Email
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
