"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";
import { api } from "../../lib/api";
import styles from "../../app/page.module.css";

export default function LoginForm({ expectedRole }: { expectedRole: "student" | "teacher" | "operator" }) {
  const router = useRouter();
  const { isAuthenticated, user, login, logout, isLoading, setupRequired } = useAuth();
  const { showToast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [serverIp, setServerIp] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

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
      window.location.href = "/setup/";
      return;
    }
    if (!isAuthenticated || !user) return;

    // Strict Role Enforcement
    if (user.role !== expectedRole) {
      logout().then(() => {
        setError("Please use the correct portal to log in for your role.");
      });
      return;
    }

    // Smart Login & Auto-Routing for students
    if (user.role === "student") {
      api.getSubjects().then(subjectsData => {
        api.getResults().then(resultsData => {
          const now = Date.now();
          const activeOne = (subjectsData as any[]).find(s => {
            if (!s.exam_datetime) return false;
            const start = new Date(s.exam_datetime).getTime();
            const end = start + Number(s.window_duration || 120) * 60_000;
            const isTaken = (resultsData as any[]).some(r => Number(r.subject_id) === Number(s.id));
            return !isTaken && now >= start && now < end;
          });
          if (activeOne) {
            window.location.href = `/student/exam?subjectId=${activeOne.id}`;
          } else {
            window.location.href = "/student/dashboard/";
          }
        }).catch(() => {
          window.location.href = "/student/dashboard/";
        });
      }).catch(() => {
        window.location.href = "/student/dashboard/";
      });
    } else if (user.role === "teacher") {
      window.location.href = "/Teacher/dashboard/";
    } else {
      window.location.href = "/ADMIN/dashboard/";
    }
  }, [isLoading, isAuthenticated, user, setupRequired, expectedRole, logout]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email, password);
      // Let the useEffect handle redirection or error logging out
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed. Check your credentials.");
      setSubmitting(false);
    }
  };

  const statusClass =
    serverOnline === null ? styles.statusChecking :
    serverOnline ? styles.statusOnline : styles.statusOffline;

  return (
    <div className={styles.formWrap}>
      <div className={styles.formHeader}>
        <h1 className={styles.formTitle}>Sign in</h1>
        {expectedRole === "student" && (
          <p className={styles.formSubtitle}>
            No account?{" "}
            <Link href="/register" className={styles.formSubtitleLink}>Create one →</Link>
          </p>
        )}
      </div>

      {error && (
        <div className={styles.alertError}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0, marginTop: "1px" }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className={styles.form}>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel} htmlFor="login-email">Registration ID or Email</label>
          <input
            id="login-email"
            type="text"
            className={styles.fieldInput}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={expectedRole === "student" ? "REG-XXXX or you@school.edu" : "Email Address"}
            required
            autoComplete="email"
          />
        </div>

        <div className={styles.fieldGroup}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.5rem" }}>
            <label className={styles.fieldLabel} htmlFor="login-password" style={{ marginBottom: 0 }}>Password</label>
            <Link href="/forgot-password" className={styles.formSubtitleLink} style={{ fontSize: "0.875rem" }}>Forgot Password?</Link>
          </div>
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

        <div style={{ display: "flex", justifyContent: "flex-start", marginTop: "0.25rem" }}>
          <button type="submit" className={styles.submitBtn} disabled={submitting} style={{ width: "30%", minWidth: "120px" }}>
            {submitting ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin 0.8s linear infinite" }}><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" opacity="0.25"/><path d="M21 12a9 9 0 00-9-9"/></svg>
                Signing in…
              </>
            ) : "Sign in →"}
          </button>
        </div>
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
  );
}
