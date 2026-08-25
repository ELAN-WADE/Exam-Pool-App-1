"use client";

import React, { useState } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { ChangePasswordModal } from "../../../components/auth/ChangePasswordModal";
import { useAuth } from "../../../hooks/useAuth";
import { PageHeader, Button } from "../../../components/ui";
import { LockIcon } from "../../../components/icons/Icons";
import styles from "./page.module.css";

export default function TeacherSettingsPage() {
  return (
    <RequireRole role="teacher">
      <TeacherSettings />
    </RequireRole>
  );
}

function TeacherSettings() {
  const { user, logout } = useAuth();
  const [showPwModal, setShowPwModal] = useState(false);

  const initial = user?.name?.charAt(0)?.toUpperCase() ?? "T";
  const isClassTeacher = (user as any)?.is_class_teacher === true;
  const assignedClassName = (user as any)?.assigned_class_name;

  return (
    <div className={styles.container}>
      {showPwModal && <ChangePasswordModal onClose={() => setShowPwModal(false)} />}

      {/* ── Page Header ───────────────────────────────────── */}
      <PageHeader
        eyebrow="Faculty Preferences"
        title="Teacher Profile & Account"
        subtitle="Manage faculty credentials, institutional class allocations, and password security."
      />

      {/* ── Profile Information Card ──────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.avatar}>{initial}</div>
          <div>
            <div className={styles.name}>{user?.name ?? "—"}</div>
            <div className={styles.email}>{user?.email ?? "—"}</div>
          </div>
        </div>

        <div className={styles.gridFields}>
          <div className={styles.fieldItem}>
            <span className={styles.fieldLabel}>System Role</span>
            <span className={styles.fieldValue}>Faculty Teacher</span>
          </div>
          <div className={styles.fieldItem}>
            <span className={styles.fieldLabel}>Class Master Role</span>
            <span className={styles.fieldValue}>
              {isClassTeacher ? `Assigned (${assignedClassName})` : "Course Faculty"}
            </span>
          </div>
          <div className={styles.fieldItem}>
            <span className={styles.fieldLabel}>Account Status</span>
            <span className={styles.fieldValue}>Active · Verified</span>
          </div>
        </div>
      </section>

      {/* ── Security & Sessions Card ──────────────────────── */}
      <section className={styles.card}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.9375rem", fontWeight: 600, color: "var(--color-text)" }}>
          <LockIcon width="16" height="16" />
          <span>Security & Authentication</span>
        </div>

        <div>
          <div className={styles.actionRow}>
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--color-text)" }}>Account Password</div>
              <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", marginTop: "0.15rem" }}>
                Update your login credentials to maintain secure access.
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setShowPwModal(true)}>
              Change Password
            </Button>
          </div>

          <div className={styles.actionRow}>
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--color-text)" }}>Sign Out</div>
              <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", marginTop: "0.15rem" }}>
                Terminate active faculty session on this workstation.
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                await logout();
                window.location.href = "/";
              }}
            >
              Log Out
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
