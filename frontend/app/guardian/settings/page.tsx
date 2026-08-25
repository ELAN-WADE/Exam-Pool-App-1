"use client";

import React, { useState } from "react";
import Link from "next/link";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useGuardian } from "../../../components/guardian/GuardianContext";
import { useAuth } from "../../../hooks/useAuth";
import { api } from "../../../lib/api";
import styles from "./page.module.css";

export default function GuardianSettingsPage() {
  return (
    <RequireRole role="guardian">
      <SettingsContent />
    </RequireRole>
  );
}

function SettingsContent() {
  const { guardianName, wards } = useGuardian();
  const { logout } = useAuth();

  // Modals state
  const [activeModal, setActiveModal] = useState<"security" | "profile" | "notifications" | null>(null);

  // Security Form State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Profile Form State
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Notification Preferences
  const [notifyAttendance, setNotifyAttendance] = useState(true);
  const [notifyResults, setNotifyResults] = useState(true);
  const [notifyFees, setNotifyFees] = useState(true);
  const [notifyMessages, setNotifyMessages] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifMsg, setNotifMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) {
      setPasswordMsg({ type: "error", text: "Please enter your current and new password." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: "error", text: "New passwords do not match." });
      return;
    }
    if (newPassword.length < 8) {
      setPasswordMsg({ type: "error", text: "Password must be at least 8 characters." });
      return;
    }

    try {
      setPasswordSaving(true);
      setPasswordMsg(null);
      await api.post("/api/guardian/settings/password", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setPasswordMsg({ type: "success", text: "Password updated successfully!" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setPasswordMsg({ type: "error", text: err?.message || "Failed to update password." });
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setProfileSaving(true);
      setProfileMsg(null);
      await api.post("/api/guardian/settings/profile", {
        phone,
        address,
      });
      setProfileMsg({ type: "success", text: "Contact profile updated successfully!" });
    } catch (err: any) {
      setProfileMsg({ type: "error", text: err?.message || "Failed to update profile." });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSaveNotifications = async () => {
    try {
      setNotifSaving(true);
      setNotifMsg(null);

      // Register web push if enabled
      if (pushEnabled && "serviceWorker" in navigator && "Notification" in window) {
        try {
          const perm = await Notification.requestPermission();
          if (perm === "granted") {
            const reg = await navigator.serviceWorker.ready;
            const keyRes = (await api.get("/api/notifications/vapid-public-key")) as any;
            if (keyRes?.publicKey) {
              const sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: keyRes.publicKey,
              });
              await api.post("/api/notifications/subscribe-push", sub.toJSON());
            }
          }
        } catch {}
      }

      await api.post("/api/guardian/settings/notifications", {
        notify_attendance: notifyAttendance,
        notify_results: notifyResults,
        notify_fees: notifyFees,
        notify_messages: notifyMessages,
      });

      setNotifMsg({ type: "success", text: "Notification preferences saved!" });
    } catch (err: any) {
      setNotifMsg({ type: "error", text: err?.message || "Failed to save preferences." });
    } finally {
      setNotifSaving(false);
    }
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>More & Settings</h1>

      {/* ── 1. User Profile Header ── */}
      <section className={styles.userCard}>
        <div className={styles.userAvatar}>{guardianName.charAt(0)}</div>
        <div className={styles.userMeta}>
          <span className={styles.userName}>{guardianName}</span>
          <span className={styles.userRole}>
            Guardian • {wards.length} Linked {wards.length === 1 ? "Child" : "Children"}
          </span>
        </div>
      </section>

      {/* ── 2. Academic Quick Links ── */}
      <section className={styles.settingsGroup}>
        <h2 className={styles.groupHeading}>Academic Modules</h2>

        <Link href="/guardian/fees" className={styles.navRow}>
          <div className={styles.navRowLeft}>
            <div className={styles.navRowIcon} style={{ background: "#EFF4FF", color: "#165AF6" }}>
              💳
            </div>
            <span className={styles.navRowLabel}>Fee Payments & Billing</span>
          </div>
          <span className={styles.navRowChevron}>›</span>
        </Link>

        <Link href="/guardian/examinations" className={styles.navRow}>
          <div className={styles.navRowLeft}>
            <div className={styles.navRowIcon} style={{ background: "#ECFDF5", color: "#059669" }}>
              📅
            </div>
            <span className={styles.navRowLabel}>Examinations & Timetable</span>
          </div>
          <span className={styles.navRowChevron}>›</span>
        </Link>

        <Link href="/guardian/attendance" className={styles.navRow}>
          <div className={styles.navRowLeft}>
            <div className={styles.navRowIcon} style={{ background: "#FFFBEB", color: "#D97706" }}>
              🕒
            </div>
            <span className={styles.navRowLabel}>Attendance Audit</span>
          </div>
          <span className={styles.navRowChevron}>›</span>
        </Link>

        <Link href="/guardian/performance" className={styles.navRow}>
          <div className={styles.navRowLeft}>
            <div className={styles.navRowIcon} style={{ background: "#F5F3FF", color: "#7C3AED" }}>
              📊
            </div>
            <span className={styles.navRowLabel}>Subject Performance Analytics</span>
          </div>
          <span className={styles.navRowChevron}>›</span>
        </Link>

        <Link href="/guardian/links" className={styles.navRow}>
          <div className={styles.navRowLeft}>
            <div className={styles.navRowIcon} style={{ background: "#F1F5F9", color: "#475569" }}>
              🔗
            </div>
            <span className={styles.navRowLabel}>Manage Linked Wards</span>
          </div>
          <span className={styles.navRowChevron}>›</span>
        </Link>
      </section>

      {/* ── 3. App Preferences & Security ── */}
      <section className={styles.settingsGroup}>
        <h2 className={styles.groupHeading}>Preferences & Security</h2>

        <button
          type="button"
          className={styles.navRow}
          onClick={() => setActiveModal("notifications")}
        >
          <div className={styles.navRowLeft}>
            <div className={styles.navRowIcon} style={{ background: "#EFF6FF", color: "#2563EB" }}>
              🔔
            </div>
            <span className={styles.navRowLabel}>Alerts & Notifications</span>
          </div>
          <span className={styles.navRowChevron}>›</span>
        </button>

        <button
          type="button"
          className={styles.navRow}
          onClick={() => setActiveModal("profile")}
        >
          <div className={styles.navRowLeft}>
            <div className={styles.navRowIcon} style={{ background: "#F0FDF4", color: "#16A34A" }}>
              👤
            </div>
            <span className={styles.navRowLabel}>Guardian Contact Profile</span>
          </div>
          <span className={styles.navRowChevron}>›</span>
        </button>

        <button
          type="button"
          className={styles.navRow}
          onClick={() => setActiveModal("security")}
        >
          <div className={styles.navRowLeft}>
            <div className={styles.navRowIcon} style={{ background: "#FEF3C7", color: "#D97706" }}>
              🔒
            </div>
            <span className={styles.navRowLabel}>Security & Password</span>
          </div>
          <span className={styles.navRowChevron}>›</span>
        </button>

        <button
          type="button"
          className={styles.navRow}
          onClick={() => alert("ACAD Guardian Support: support@acad.edu or call +234 800 222 3456")}
        >
          <div className={styles.navRowLeft}>
            <div className={styles.navRowIcon} style={{ background: "#F1F5F9", color: "#475569" }}>
              💬
            </div>
            <span className={styles.navRowLabel}>Help & Support Desk</span>
          </div>
          <span className={styles.navRowChevron}>›</span>
        </button>
      </section>

      {/* ── 4. Sign Out ── */}
      <section className={styles.settingsGroup}>
        <button
          type="button"
          className={`${styles.navRow} ${styles.logoutRow}`}
          onClick={logout}
        >
          <div className={styles.navRowLeft}>
            <div className={styles.navRowIcon}>🚪</div>
            <span className={styles.navRowLabel}>Sign Out of ACAD</span>
          </div>
          <span className={styles.navRowChevron}>›</span>
        </button>
      </section>

      {/* ── Modal: Security & Password ── */}
      {activeModal === "security" && (
        <div className={styles.modalOverlay} onClick={() => setActiveModal(null)}>
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Change Password</h3>
              <button type="button" className={styles.closeBtn} onClick={() => setActiveModal(null)}>
                ✕
              </button>
            </div>

            {passwordMsg && (
              <div className={passwordMsg.type === "success" ? styles.toastSuccess : styles.toastError}>
                {passwordMsg.text}
              </div>
            )}

            <form onSubmit={handleUpdatePassword} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Current Password</label>
                <input
                  type="password"
                  className={styles.formInput}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>New Password</label>
                <input
                  type="password"
                  className={styles.formInput}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Confirm New Password</label>
                <input
                  type="password"
                  className={styles.formInput}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  required
                />
              </div>

              <button type="submit" className={styles.submitBtn} disabled={passwordSaving}>
                {passwordSaving ? "Updating..." : "Update Password"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Contact Profile ── */}
      {activeModal === "profile" && (
        <div className={styles.modalOverlay} onClick={() => setActiveModal(null)}>
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Guardian Profile</h3>
              <button type="button" className={styles.closeBtn} onClick={() => setActiveModal(null)}>
                ✕
              </button>
            </div>

            {profileMsg && (
              <div className={profileMsg.type === "success" ? styles.toastSuccess : styles.toastError}>
                {profileMsg.text}
              </div>
            )}

            <form onSubmit={handleUpdateProfile} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Phone Number / WhatsApp</label>
                <input
                  type="tel"
                  className={styles.formInput}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+234 800 000 0000"
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Residential Address</label>
                <textarea
                  className={styles.formInput}
                  rows={3}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Enter your home address"
                />
              </div>

              <button type="submit" className={styles.submitBtn} disabled={profileSaving}>
                {profileSaving ? "Saving..." : "Save Profile"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Notifications Preferences ── */}
      {activeModal === "notifications" && (
        <div className={styles.modalOverlay} onClick={() => setActiveModal(null)}>
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Notification Channels</h3>
              <button type="button" className={styles.closeBtn} onClick={() => setActiveModal(null)}>
                ✕
              </button>
            </div>

            {notifMsg && (
              <div className={notifMsg.type === "success" ? styles.toastSuccess : styles.toastError}>
                {notifMsg.text}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.875rem", fontWeight: 600, color: "#0F172A", cursor: "pointer", padding: "0.5rem 0", borderBottom: "1px solid #F1F5F9" }}>
                <span>Daily Attendance Roll Call</span>
                <input type="checkbox" checked={notifyAttendance} onChange={(e) => setNotifyAttendance(e.target.checked)} />
              </label>

              <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.875rem", fontWeight: 600, color: "#0F172A", cursor: "pointer", padding: "0.5rem 0", borderBottom: "1px solid #F1F5F9" }}>
                <span>CBT Exam & Test Score Releases</span>
                <input type="checkbox" checked={notifyResults} onChange={(e) => setNotifyResults(e.target.checked)} />
              </label>

              <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.875rem", fontWeight: 600, color: "#0F172A", cursor: "pointer", padding: "0.5rem 0", borderBottom: "1px solid #F1F5F9" }}>
                <span>Fee Receipts & Payment Confirmations</span>
                <input type="checkbox" checked={notifyFees} onChange={(e) => setNotifyFees(e.target.checked)} />
              </label>

              <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.875rem", fontWeight: 600, color: "#0F172A", cursor: "pointer", padding: "0.5rem 0", borderBottom: "1px solid #F1F5F9" }}>
                <span>Teacher & Admin Direct Messages</span>
                <input type="checkbox" checked={notifyMessages} onChange={(e) => setNotifyMessages(e.target.checked)} />
              </label>

              <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.875rem", fontWeight: 600, color: "#0F172A", cursor: "pointer", padding: "0.5rem 0" }}>
                <div>
                  <div>Web Push (Locked Screen Alerts)</div>
                  <div style={{ fontSize: "0.6875rem", color: "#64748B", fontWeight: 400 }}>Wake device and show banner when screen is locked</div>
                </div>
                <input type="checkbox" checked={pushEnabled} onChange={(e) => setPushEnabled(e.target.checked)} />
              </label>

              <button type="button" className={styles.submitBtn} onClick={handleSaveNotifications} disabled={notifSaving} style={{ marginTop: "0.5rem" }}>
                {notifSaving ? "Saving Preferences..." : "Save Preferences"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
