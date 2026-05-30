"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState, Suspense } from "react";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../hooks/useToast";
import styles from "./page.module.css";

function normalizePath(p: string): string {
  return p.replace(/\/+$/, "") || "/";
}

function LoginContent() {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const { isAuthenticated, user, login, isLoading, setupRequired } = useAuth();
  const { showToast } = useToast();

  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [showPass,     setShowPass]     = useState(false);
  const [error,        setError]        = useState("");
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [serverIp,     setServerIp]     = useState<string>("");
  const [submitting,   setSubmitting]   = useState(false);

  const successMessage = searchParams.get("message");

  useEffect(() => {
    fetch("/api/server-info")
      .then((r) => { if (!r.ok) throw new Error("not ok"); return r.json(); })
      .then((data) => {
        if (data.data?.ip) setServerIp(`${data.data.ip}:${data.data.port}`);
        setServerOnline(true);
      })
      .catch(() => setServerOnline(false));
  }, []);

  useEffect(() => {
    if (isLoading) return;
    if (setupRequired) {
      if (normalizePath(pathname) !== "/setup") router.replace("/setup/");
      return;
    }
    if (!isAuthenticated || !user) return;
    if (user.role === "student") router.replace("/student/dashboard/");
    else if (user.role === "teacher") router.replace("/teacher/dashboard/");
    else router.replace("/operator/dashboard/");
  }, [isLoading, isAuthenticated, user, router, setupRequired, pathname]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email, password);
      showToast("Welcome back!", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed. Check your credentials.");
    } finally {
      setSubmitting(false);
    }
  };

  const statusClass =
    serverOnline === null ? styles.statusChecking :
    serverOnline ? styles.statusOnline : styles.statusOffline;

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
            Exams made<br />simple.
          </h2>
          <p className={styles.heroSub}>
            A fast, reliable Local Area Network examination platform designed for schools and institutions.
          </p>
        </div>

        <div className={styles.heroFeatures}>
          {[
            "Works fully offline on your LAN",
            "Supports MCQ, True/False & Essays",
            "Real-time auto-save during exams",
            "Teacher & Operator dashboards",
          ].map((f) => (
            <div key={f} className={styles.heroFeatureItem}>
              <span className={styles.heroFeatureDot} />
              {f}
            </div>
          ))}
        </div>
      </div>

      {/* ── Right Form ── */}
      <div className={styles.formPanl}>
        <div className={styles.formWrap}>
          <div className={styles.formHeader}>
            <h1 className={styles.formTitle}>Sign in</h1>
            <p className={styles.formSubtitle}>
              No account?{" "}
              <Link href="/register" className={styles.formSubtitleLink}>Create one →</Link>
            </p>
          </div>

          {successMessage && (
            <div className={styles.alertSuccess}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              {successMessage}
            </div>
          )}
          {error && (
            <div className={styles.alertError}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0, marginTop: "1px" }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {error}
            </div>
          )}

          <form onSubmit={onSubmit} className={styles.form}>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel} htmlFor="login-email">Email address</label>
              <input
                id="login-email"
                type="email"
                className={styles.fieldInput}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@school.edu"
                required
                autoComplete="email"
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel} htmlFor="login-password">Password</label>
              <div style={{ position: "relative" }}>
                <input
                  id="login-password"
                  type={showPass ? "text" : "password"}
                  className={styles.fieldInput}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
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
                  aria-label={showPass ? "Hide password" : "Show password"}
                >
                  {showPass ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              </div>
            </div>

            <button type="submit" className={styles.submitBtn} disabled={submitting}>
              {submitting ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin 0.8s linear infinite" }}><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" opacity="0.25"/><path d="M21 12a9 9 0 00-9-9"/></svg>
                  Signing in…
                </>
              ) : "Sign in →"}
            </button>
          </form>

          <div className={styles.status}>
            <span className={`${styles.statusDot} ${statusClass}`} />
            {serverOnline === null
              ? "Checking server…"
              : serverOnline
                ? `Server online${serverIp ? ` · ${serverIp}` : ""}`
                : "Server offline — check connection"}
          </div>
        </div>
      </div>
    </main>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="spinner" />
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}