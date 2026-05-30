"use client";

import React, { useState } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { ChangePasswordModal } from "../../../components/auth/ChangePasswordModal";
import { useAuth } from "../../../hooks/useAuth";
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

  return (
    <>
      {showPwModal && <ChangePasswordModal onClose={() => setShowPwModal(false)} />}

      <div className="pageHeader">
        <h1 className="pageTitle">Account Settings</h1>
      </div>

      <div className={styles.page}>

        {/* ── Profile Card ── */}
        <div className={styles.profileCard}>
          <div className={styles.profileHeader}>
            <div className={styles.avatar}>{initial}</div>
            <div>
              <div className={styles.name}>{user?.name ?? "—"}</div>
              <div className={styles.email}>{user?.email ?? "—"}</div>
              <span className="badge badge-success" style={{ marginTop: "0.4rem" }}>Teacher</span>
            </div>
          </div>

          <div className={styles.fields}>
            {([
              ["Role",  "Teacher"],
              ["Name",  user?.name],
              ["Email", user?.email],
            ] as [string, string | null | undefined][]).map(([label, val]) => (
              <React.Fragment key={label}>
                <div className={styles.lbl}>{label}</div>
                <div className={styles.val}>{val || "—"}</div>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* ── Security Card ── */}
        <div className={styles.sectionCard}>
          <h3 className={styles.sectionTitle}>
            <LockIcon width="16" height="16" /> Security
          </h3>

          <div className={styles.row}>
            <div>
              <div className={styles.rowLabel}>Password</div>
              <div className={styles.rowSub}>Update your login password</div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowPwModal(true)}>
              Change Password
            </button>
          </div>

          <div className={styles.row}>
            <div>
              <div className={styles.rowLabel}>Logout</div>
              <div className={styles.rowSub}>Sign out of this session</div>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              style={{ color: "var(--color-danger)" }}
              onClick={async () => { await logout(); window.location.href = "/"; }}
            >
              Logout
            </button>
          </div>
        </div>

      </div>
    </>
  );
}
