"use client";

import { FormEvent, useState } from "react";
import { api } from "../../lib/api";

type Props = {
  onClose: () => void;
};

export function ChangePasswordModal({ onClose }: Props) {
  const [current,  setCurrent]  = useState("");
  const [next,     setNext]     = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [saving,   setSaving]   = useState(false);
  const [toast,    setToast]    = useState<{ type: "success" | "error"; text: string } | null>(null);

  const showToast = (type: "success" | "error", text: string) => {
    setToast({ type, text });
    if (type === "success") setTimeout(onClose, 1800);
    else setTimeout(() => setToast(null), 3500);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!current || !next || !confirm) { showToast("error", "All fields are required."); return; }
    if (next.length < 6) { showToast("error", "New password must be at least 6 characters."); return; }
    if (next !== confirm) { showToast("error", "Passwords do not match."); return; }
    setSaving(true);
    try {
      await api.changePassword(current, next);
      showToast("success", "Password changed successfully!");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to change password.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
          <h2 style={{ margin: 0 }}>Change Password</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {toast && (
          <div style={{
            marginBottom: "1rem",
            padding: "0.75rem 1rem",
            borderRadius: 8,
            background: toast.type === "success" ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
            color: toast.type === "success" ? "var(--color-success)" : "var(--color-danger)",
            border: `1px solid ${toast.type === "success" ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
            fontSize: "0.875rem",
          }}>
            {toast.text}
          </div>
        )}

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="cp-current">Current Password *</label>
            <input
              id="cp-current"
              className="input"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              placeholder="Enter current password"
              autoComplete="current-password"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="cp-new">New Password *</label>
            <input
              id="cp-new"
              className="input"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder="At least 6 characters"
              autoComplete="new-password"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="cp-confirm">Confirm New Password *</label>
            <input
              id="cp-confirm"
              className="input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter new password"
              autoComplete="new-password"
              required
            />
          </div>

          {/* Password strength indicator */}
          {next && (
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ display: "flex", gap: "0.3rem", marginBottom: "0.25rem" }}>
                {[6, 10, 14].map((threshold, i) => (
                  <div
                    key={i}
                    style={{
                      flex: 1, height: 4, borderRadius: 4,
                      background: next.length >= threshold
                        ? (i === 0 ? "var(--color-danger)" : i === 1 ? "var(--color-warning)" : "var(--color-success)")
                        : "var(--color-surface-2)",
                      transition: "background 0.2s",
                    }}
                  />
                ))}
              </div>
              <span style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>
                {next.length < 6 ? "Too short" : next.length < 10 ? "Weak" : next.length < 14 ? "Moderate" : "Strong"}
              </span>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", marginTop: "0.5rem" }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Update Password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
