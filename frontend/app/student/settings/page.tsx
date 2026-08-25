"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RequireRole } from "../../../components/auth/RequireRole";
import { ChangePasswordModal } from "../../../components/auth/ChangePasswordModal";
import { useAuth } from "../../../hooks/useAuth";
import { api } from "../../../lib/api";
import { Button } from "../../../components/ui";
import { LockIcon, GraduationCapIcon } from "../../../components/icons/Icons";
import { ErrorState } from "../../../components/ui/ErrorState";
import styles from "./page.module.css";

export default function StudentSettingsPage() {
  return (
    <RequireRole role="student">
      <StudentSettings />
    </RequireRole>
  );
}

function StudentSettings() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [showPwModal, setShowPwModal] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .getMyProfile()
      .then((p) => {
        setProfile(p);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load profile");
        setLoading(false);
      });
  }, []);

  const initial = user?.name?.charAt(0)?.toUpperCase() ?? "S";

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "320px", gap: "0.75rem", color: "#64748B", fontSize: "0.875rem" }}>
        <div className="spinner" style={{ width: 22, height: 22, borderColor: "#E2E8F0", borderTopColor: "#165AF6" }} />
        <span>Loading candidate profile…</span>
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        message={error}
        onRetry={() => {
          setError("");
          setLoading(true);
        }}
      />
    );
  }

  return (
    <div className={styles.container}>
      {showPwModal && <ChangePasswordModal onClose={() => setShowPwModal(false)} />}

      {/* ── 1. Hero Identity & Telemetry Strip ── */}
      <section className={styles.heroSection}>
        <div className={styles.heroLeft}>
          <h1 className={styles.heroTitle}>Student Profile &amp; Security</h1>
          <p className={styles.heroSubtitle}>
            Manage registration details, assigned class cohort, and portal authentication credentials.
          </p>
        </div>

        <div className={styles.telemetryPillGroup}>
          <div className={styles.telemetryBadge}>
            <div className={styles.telemetryIcon}>
              <GraduationCapIcon width="18" height="18" />
            </div>
            <div className={styles.telemetryBadgeContent}>
              <span className={styles.telemetryNumber}>{user?.grade || "Candidate"}</span>
              <span className={styles.telemetryText}>Assigned Cohort</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2. Profile Information Card ──────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.avatar}>{initial}</div>
          <div>
            <div className={styles.name}>{user?.name ?? "—"}</div>
            <div className={styles.email}>{user?.email ?? "—"}</div>
            {user?.grade && (
              <span className={styles.gradeBadge}>{user.grade}</span>
            )}
          </div>
        </div>

        <div className={styles.gridFields}>
          <div className={styles.fieldItem}>
            <span className={styles.fieldLabel}>System Role</span>
            <span className={styles.fieldValue}>Candidate (Student)</span>
          </div>
          <div className={styles.fieldItem}>
            <span className={styles.fieldLabel}>Class / Grade</span>
            <span className={styles.fieldValue}>{user?.grade || "General Cohort"}</span>
          </div>
          <div className={styles.fieldItem}>
            <span className={styles.fieldLabel}>Registration ID</span>
            <span className={styles.fieldValue} style={{ fontFamily: "monospace" }}>
              {profile?.user?.reg_id || "Unset"}
            </span>
          </div>
          <div className={styles.fieldItem}>
            <span className={styles.fieldLabel}>Phone Contact</span>
            <span className={styles.fieldValue}>{profile?.user?.phone || "—"}</span>
          </div>
        </div>
      </section>

      {/* ── 3. Security & Authentication Card ────────────────── */}
      <section className={styles.card}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.9375rem", fontWeight: 700, color: "#0F172A" }}>
          <LockIcon width="16" height="16" style={{ color: "#165AF6" }} />
          <span>Security &amp; Authentication</span>
        </div>

        <div>
          <div className={styles.actionRow}>
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "#0F172A" }}>Portal Password</div>
              <div style={{ fontSize: "0.75rem", color: "#64748B", marginTop: "0.15rem" }}>
                Update your password to keep your examination attempts secure.
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setShowPwModal(true)}>
              Change Password
            </Button>
          </div>

          <div className={styles.actionRow}>
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "#0F172A" }}>Sign Out</div>
              <div style={{ fontSize: "0.75rem", color: "#64748B", marginTop: "0.15rem" }}>
                End student session on this computer or terminal.
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                await logout();
                router.replace("/");
              }}
            >
              Sign Out
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
