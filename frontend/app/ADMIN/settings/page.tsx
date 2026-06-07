"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { ChangePasswordModal } from "../../../components/auth/ChangePasswordModal";
import { api } from "../../../lib/api";
import { DocumentIcon, WarningIcon, SearchIcon } from "../../../components/icons/Icons";
import styles from "./page.module.css";

type Config = {
  id?: number;
  description?: string;
  favicon?: string;
  admin_name?: string;
  org_name?: string;
  licence_key?: string;
  licence_type?: string;
  theme_json?: string;
  version?: string;
  admin_email?: string;
  registration_open?: boolean;
};

export default function OperatorSettingsPage() {
  return (
    <RequireRole role="operator">
      <SettingsContent />
    </RequireRole>
  );
}

function SettingsContent() {
  const [config,      setConfig]      = useState<Config>({});
  const [configForm,  setConfigForm]  = useState<Config>({});
  const [themeForm,   setThemeForm]   = useState<any>({});
  const [logs,        setLogs]        = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [origin,      setOrigin]      = useState("");
  const [logSearch,   setLogSearch]   = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [confirmText,    setConfirmText]    = useState("");
  const [showFinalModal, setShowFinalModal] = useState(false);
  const [showPwModal,    setShowPwModal]    = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);

    Promise.all([
      api.getConfig().then((d: any) => { 
        setConfig(d ?? {}); 
        setConfigForm(d ?? {}); 
        try {
          setThemeForm(d?.theme_json ? JSON.parse(d.theme_json) : {});
        } catch {
          setThemeForm({});
        }
      }),
      api.getAuditLogs().then((d: any) => setLogs(Array.isArray(d) ? d : [])).catch(() => setLogs([])),
    ]).finally(() => setLogsLoading(false));
  }, []);

  const handleLogoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("error", "Please select a valid image file.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast("error", "Logo image must be smaller than 2MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string;
      setThemeForm((prev: any) => ({ ...prev, school_logo: base64 }));
    };
    reader.readAsDataURL(file);
  };

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      const payload = {
        ...configForm,
        theme_json: JSON.stringify(themeForm)
      };
      const updated = await api.updateConfig(payload);
      setConfig(updated as Config);
      showToast("success", "School configuration saved.");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to save config.");
    } finally {
      setSavingConfig(false);
    }
  };

  const doExport = async () => {
    try {
      const res = await fetch("/api/settings/export", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `exampool-backup-${new Date().toISOString().slice(0, 10)}.db`;
      a.click();
      URL.revokeObjectURL(href);
      showToast("success", "Database exported.");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Export failed.");
    }
  };

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const bytes = await file.arrayBuffer();
      const res = await fetch("/api/settings/import", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/octet-stream" }, body: bytes,
      });
      if (!res.ok) throw new Error("Import failed");
      showToast("success", "Database imported. Restart server to apply.");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Import failed.");
    }
    e.target.value = "";
  };

  const doReset = async () => {
    try {
      await api.resetDb("RESET_ALL_DATA");
      showToast("success", "Factory reset complete.");
      setShowFinalModal(false);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Reset failed.");
    }
  };

  const filteredLogs = logSearch
    ? logs.filter((l) => l.action?.toLowerCase().includes(logSearch.toLowerCase()) || l.resource?.toLowerCase().includes(logSearch.toLowerCase()))
    : logs;

  const actionColor: Record<string, string> = {
    LOGIN: "badge-success", LOGOUT: "badge-muted",
    USER_CREATE: "badge-info", USER_DEACTIVATE: "badge-danger", USER_ACTIVATE: "badge-success", USER_UPDATE: "badge-info",
    SUBJECT_CREATE: "badge-info", SUBJECT_DELETE: "badge-danger",
    QUESTION_CREATE: "badge-info", QUESTION_DELETE: "badge-danger",
    EXAM_START: "badge-warning", EXAM_SUBMIT: "badge-success",
    CONFIG_UPDATE: "badge-warning", SETTINGS_IMPORT: "badge-warning",
  };

  return (
    <>
      {toast && <div className={`toast ${toast.type === "success" ? "toast-success" : "toast-error"}`}>{toast.text}</div>}

      <div className="pageHeader">
        <h1 className="pageTitle">Settings</h1>
      </div>

      {showPwModal && <ChangePasswordModal onClose={() => setShowPwModal(false)} />}

      {/* ── Security ─────────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Security</h2>
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 500, marginBottom: "0.2rem" }}>Admin Password</div>
              <div style={{ color: "var(--color-muted)", fontSize: "0.8rem" }}>Update your login password</div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowPwModal(true)}>
              Change Password
            </button>
          </div>
        </div>
      </section>

      {/* ── School Configuration ─────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>School Configuration</h2>
        <div className={`card ${styles.configCard}`}>
          <div className={styles.configGrid}>
            <div className="field">
              <label>Organisation Name *</label>
              <input className="input" value={configForm.org_name ?? ""} onChange={(e) => setConfigForm({ ...configForm, org_name: e.target.value })} placeholder="ExamPool School" />
            </div>
            <div className="field">
              <label>Admin Name</label>
              <input className="input" value={configForm.admin_name ?? ""} onChange={(e) => setConfigForm({ ...configForm, admin_name: e.target.value })} placeholder="Principal / Admin" />
            </div>
            <div className="field">
              <label>Admin Email</label>
              <input className="input" type="email" value={configForm.admin_email ?? ""} onChange={(e) => setConfigForm({ ...configForm, admin_email: e.target.value })} placeholder="admin@school.edu" />
            </div>
            <div className="field">
              <label>Licence Type</label>
              <select className="select" value={configForm.licence_type ?? "basic"} onChange={(e) => setConfigForm({ ...configForm, licence_type: e.target.value })}>
                <option value="basic">Basic</option>
                <option value="standard">Standard</option>
                <option value="premium">Premium</option>
              </select>
            </div>
            <div className="field">
              <label>Licence Key</label>
              <input className="input" value={configForm.licence_key ?? ""} onChange={(e) => setConfigForm({ ...configForm, licence_key: e.target.value })} placeholder="XXXX-XXXX-XXXX" />
            </div>
            <div className="field">
              <label>Version</label>
              <input className="input" value={configForm.version ?? ""} onChange={(e) => setConfigForm({ ...configForm, version: e.target.value })} placeholder="1.0.0" />
            </div>
          </div>
          <div className="field" style={{ marginTop: "0.5rem" }}>
            <label>Description</label>
            <textarea className={`input ${styles.textarea}`} rows={2} value={configForm.description ?? ""} onChange={(e) => setConfigForm({ ...configForm, description: e.target.value })} placeholder="Brief school description…" />
          </div>

          <div className="field" style={{ marginTop: "1rem", padding: "1rem", background: "var(--color-surface-2)", borderRadius: "var(--radius-md)", border: "1px solid var(--color-border)" }}>
            <label style={{ margin: 0, fontWeight: 600, display: "flex", alignItems: "center", gap: "0.6rem", cursor: "pointer" }}>
              <input 
                type="checkbox" 
                checked={configForm.registration_open ?? true} 
                onChange={(e) => setConfigForm({ ...configForm, registration_open: e.target.checked })} 
                style={{ width: "1.1rem", height: "1.1rem", accentColor: "var(--color-primary)" }} 
              />
              Allow Students & Teachers to Register
            </label>
            <p style={{ margin: "0.4rem 0 0 1.7rem", fontSize: "0.85rem", color: "var(--color-muted)" }}>
              When enabled, anyone can create an account. When disabled, only Operators can add new users.
            </p>
          </div>

          {/* ── School Logo Upload ── */}
          <div className="field" style={{ marginTop: "0.5rem" }}>
            <label>School Logo (for Report Cards)</label>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              {themeForm.school_logo && (
                <div style={{ position: "relative", display: "inline-block" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={themeForm.school_logo}
                    alt="School Logo Preview"
                    style={{ height: 72, width: 72, objectFit: "contain", border: "1.5px solid var(--color-border)", borderRadius: "var(--radius-md)", background: "var(--color-surface-2)", padding: "0.25rem" }}
                  />
                  <button
                    type="button"
                    onClick={() => { setThemeForm((p: any) => ({ ...p, school_logo: "" })); if (logoInputRef.current) logoInputRef.current.value = ""; }}
                    style={{ position: "absolute", top: -8, right: -8, width: 22, height: 22, borderRadius: "50%", background: "var(--color-danger)", color: "#fff", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", fontWeight: 700 }}
                    title="Remove logo"
                  >✕</button>
                </div>
              )}
              <div style={{ flex: 1 }}>
                <label
                  htmlFor="logo-upload"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: "0.5rem",
                    padding: "0.55rem 1rem", borderRadius: "var(--radius-md)",
                    border: "1.5px dashed var(--color-border)", cursor: "pointer",
                    background: "var(--color-surface-2)", color: "var(--color-text)",
                    fontSize: "0.875rem", fontWeight: 500, transition: "all 200ms ease"
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  {themeForm.school_logo ? "Change Logo" : "Upload Logo from Computer"}
                </label>
                <input
                  id="logo-upload"
                  ref={logoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                  onChange={handleLogoUpload}
                  style={{ display: "none" }}
                />
                <p style={{ color: "var(--color-muted)", fontSize: "0.78rem", marginTop: "0.35rem" }}>
                  PNG, JPG, SVG · Max 2MB · Stored as base64 — no external URL needed
                </p>
              </div>
            </div>
          </div>

          <div className="field" style={{ marginTop: "0.5rem" }}>
            <label>Principal Remarks (For Report Cards)</label>
            <textarea className={`input ${styles.textarea}`} rows={2} value={themeForm.principal_remarks ?? ""} onChange={(e) => setThemeForm({ ...themeForm, principal_remarks: e.target.value })} placeholder="Standard remarks to appear on all student report cards…" />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
            <button className="btn btn-primary" onClick={saveConfig} disabled={savingConfig}>
              {savingConfig ? "Saving…" : "Save Configuration"}
            </button>
          </div>
        </div>
      </section>

      {/* ── Server Info ──────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Server Information</h2>
        <div className={`card ${styles.infoGrid}`}>
          <div className={styles.infoRow}><span className={styles.infoKey}>Server URL</span><code className={styles.infoVal}>{origin || "Loading…"}</code></div>
          <div className={styles.infoRow}><span className={styles.infoKey}>Organisation</span><span className={styles.infoVal}>{config.org_name || "—"}</span></div>
          <div className={styles.infoRow}><span className={styles.infoKey}>App Version</span><span className={styles.infoVal}>{config.version || "1.0.0"}</span></div>
          <div className={styles.infoRow}><span className={styles.infoKey}>Licence</span><span className={styles.infoVal}><span className={`badge badge-info`}>{config.licence_type || "basic"}</span></span></div>
          <div className={styles.infoRow}><span className={styles.infoKey}>Platform</span><span className={styles.infoVal}>ExamPool LAN</span></div>
        </div>
      </section>

      {/* ── Database Backup ──────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Database Backup</h2>
        <div className={`card ${styles.backupCard}`}>
          <div className={styles.backupItem}>
            <div>
              <div className={styles.backupLabel}>Export Database</div>
              <div className={styles.backupDesc}>Download a full backup of the SQLite database file.</div>
            </div>
            <button className="btn btn-primary" onClick={doExport} style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
              <DocumentIcon width="14" height="14" />
              Export
            </button>
          </div>
          <div className={styles.divider} />
          <div className={styles.backupItem}>
            <div>
              <div className={styles.backupLabel}>Import Database</div>
              <div className={styles.backupDesc}>Restore from a previously exported .db file.</div>
            </div>
            <label className={`btn btn-ghost ${styles.importLabel}`} style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
              <DocumentIcon width="14" height="14" />
              Import
              <input type="file" accept=".db,application/octet-stream" onChange={onImport} className={styles.hiddenInput} />
            </label>
          </div>
        </div>
      </section>

      {/* ── Factory Reset ────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Factory Reset</h2>
        <div className={`card ${styles.resetCard}`}>
          <div className={styles.resetWarn}>
            <WarningIcon width="18" height="18" />
            <p>This action is <strong>irreversible</strong>. All users, subjects, questions, and exam results will be permanently deleted.</p>
          </div>
          <div className={styles.resetActions}>
            <label className={styles.checkLabel}>
              <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} />
              I understand this deletes all data permanently
            </label>
            <input className="input" style={{ maxWidth: 320 }} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder='Type "DELETE ALL DATA" to confirm' />
            <button className="btn btn-danger" disabled={!confirmChecked || confirmText !== "DELETE ALL DATA"} onClick={() => setShowFinalModal(true)}>
              Factory Reset
            </button>
          </div>
        </div>
      </section>

      {/* ── Audit Logs ───────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Audit Logs</h2>
        <div className={`searchBar ${styles.logSearch}`}>
          <SearchIcon width="14" height="14" />
          <input placeholder="Filter by action or resource…" value={logSearch} onChange={(e) => setLogSearch(e.target.value)} />
        </div>
        <div className={`card ${styles.logsCard}`}>
          {logsLoading ? <div className="loadingWrap"><div className="spinner" /></div>
          : filteredLogs.length === 0 ? <div className={styles.empty}>No audit logs found.</div>
          : (
            <table className="tbl">
              <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Resource</th></tr></thead>
              <tbody>
                {filteredLogs.map((log: any, i: number) => (
                  <tr key={log.id ?? i}>
                    <td style={{ color: "var(--color-muted)", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                      {new Date(log.timestamp).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td style={{ fontSize: "0.82rem" }}>{log.actor_name || `#${log.actor_id}`}</td>
                    <td><span className={`badge ${actionColor[log.action] ?? "badge-muted"}`}>{log.action}</span></td>
                    <td style={{ fontSize: "0.82rem", color: "var(--color-muted)" }}>{log.resource} {log.resource_id != null ? `#${log.resource_id}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {showFinalModal && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setShowFinalModal(false)}>
          <div className="modal" style={{ maxWidth: 400 }}>
            <h2>Final Confirmation</h2>
            <p style={{ color: "var(--color-danger)", marginTop: "0.5rem", fontSize: "0.9rem", fontWeight: 500, display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <WarningIcon width="16" height="16" /> All data will be permanently deleted. This cannot be undone.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", marginTop: "1.5rem" }}>
              <button className="btn btn-ghost" onClick={() => setShowFinalModal(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={doReset}>Confirm Reset</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
