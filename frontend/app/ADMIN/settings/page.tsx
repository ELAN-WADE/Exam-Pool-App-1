"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { ChangePasswordModal } from "../../../components/auth/ChangePasswordModal";
import { api } from "../../../lib/api";
import {
  PageHeader,
  Button,
} from "../../../components/ui";
import {
  DocumentIcon,
  WarningIcon,
  SearchIcon,
  SettingsIcon,
  UsersIcon,
  BookIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
} from "../../../components/icons/Icons";
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
  institution_type?: string;
};

type TabKey = "institution" | "security" | "network" | "backup" | "terminal" | "audit";

export default function OperatorSettingsPage() {
  return (
    <RequireRole role="operator">
      <SettingsContent />
    </RequireRole>
  );
}

function SettingsContent() {
  const [activeTab, setActiveTab] = useState<TabKey>("institution");
  const [config, setConfig] = useState<Config>({});
  const [configForm, setConfigForm] = useState<Config>({});
  const [themeForm, setThemeForm] = useState<any>({});
  const [logs, setLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [origin, setOrigin] = useState("");
  const [logSearch, setLogSearch] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [showFinalModal, setShowFinalModal] = useState(false);
  const [showPwModal, setShowPwModal] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [systemSettings, setSystemSettings] = useState<{ custom_url: string; server_ip: string; server_port: number; dns_active: boolean; mdns_active?: boolean } | null>(null);
  const [customUrlInput, setCustomUrlInput] = useState("");
  const [savingDomain, setSavingDomain] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    showToast("success", `Copied to clipboard: ${text}`);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  // Terminal & Network state
  type LogEntry = { ts: string; level: "info" | "warn" | "error"; msg: string };
  type IfaceEntry = { name: string; address: string; netmask: string; type: string };
  const [termLogs, setTermLogs] = useState<LogEntry[]>([]);
  const [termLoading, setTermLoading] = useState(true);
  const [termFilter, setTermFilter] = useState<"" | "info" | "warn" | "error">("");
  const [networkInfo, setNetworkInfo] = useState<{ wifi: IfaceEntry[]; ethernet: IfaceEntry[]; other: IfaceEntry[]; primary_ip: string; server_port: number; dns_active: boolean; custom_url: string } | null>(null);
  const termEndRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    setOrigin(window.location.origin);

    Promise.all([
      api.getConfig().then((d: any) => {
        if (!signal.aborted) {
          setConfig(d ?? {});
          setConfigForm(d ?? {});
          try {
            setThemeForm(d?.theme_json ? JSON.parse(d.theme_json) : {});
          } catch {
            setThemeForm({});
          }
        }
      }),
      api.getAuditLogs().then((d: any) => { if (!signal.aborted) setLogs(Array.isArray(d) ? d : []); }).catch(() => { if (!signal.aborted) setLogs([]); }),
      api.getSystemSettings().then((sys) => { if (!signal.aborted) { setSystemSettings(sys); setCustomUrlInput(sys.custom_url || ""); } }).catch(() => {}),
      api.getNetworkInfo().then((n: any) => { if (!signal.aborted) setNetworkInfo(n); }).catch(() => {}),
      api.getServerLogs(100).then((l: any) => { if (!signal.aborted) setTermLogs(Array.isArray(l) ? l : []); }).catch(() => {}).finally(() => { if (!signal.aborted) setTermLoading(false); }),
    ]).finally(() => { if (!signal.aborted) setLogsLoading(false); });

    return () => controller.abort();
  }, []);

  // Poll server logs every 5 seconds
  useEffect(() => {
    const id = setInterval(() => {
      api.getServerLogs(100, termFilter).then((l: any) => {
        if (Array.isArray(l)) setTermLogs(l);
      }).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [termFilter]);

  useEffect(() => {
    termEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [termLogs]);

  const saveCustomUrl = async () => {
    if (!customUrlInput.trim()) return;
    setSavingDomain(true);
    try {
      const res = await api.updateSystemSettings({ custom_url: customUrlInput.trim() });
      setSystemSettings(res);
      setCustomUrlInput(res.custom_url);
      showToast("success", `Custom domain published: ${res.custom_url}`);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to publish domain");
    } finally {
      setSavingDomain(false);
    }
  };

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
        theme_json: JSON.stringify(themeForm),
      };
      if (configForm.institution_type !== config.institution_type) {
        if (configForm.institution_type) {
          await api.setInstitutionType(configForm.institution_type);
        }
      }
      const updated = await api.updateConfig(payload);
      setConfig(updated as Config);
      showToast("success", "Configuration saved successfully.");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to save configuration.");
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
      showToast("success", "Database backup exported.");
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
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes,
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
      // Send the typed confirmation (UI requires "DELETE ALL DATA") — backend accepts both variants case-insensitively
      const confirmation = confirmText.trim() || "DELETE ALL DATA";
      await api.resetDb(confirmation);
      showToast("success", "Factory reset complete. Redirecting to setup…");
      setShowFinalModal(false);
      setConfirmText("");
      setConfirmChecked(false);
      // Give user a moment to read toast, then force reload to setup wizard
      setTimeout(() => {
        window.location.href = "/setup/";
      }, 1400);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Reset failed.");
    }
  };

  const filteredLogs = logSearch
    ? logs.filter((l) => l.action?.toLowerCase().includes(logSearch.toLowerCase()) || l.resource?.toLowerCase().includes(logSearch.toLowerCase()))
    : logs;

  return (
    <div className={styles.container}>
      {toast && <div className={styles.toast}>{toast.text}</div>}

      {/* ── Page Header ───────────────────────────────────── */}
      <PageHeader
        eyebrow="System Configuration"
        title="Settings & Administration"
        subtitle="Manage institutional profile, network access, security policies, and maintenance."
      />

      {showPwModal && <ChangePasswordModal onClose={() => setShowPwModal(false)} />}

      {/* ── Settings Workspace Layout ─────────────────────────── */}
      <div className={styles.workspaceLayout}>
        {/* Navigation Sidebar */}
        <aside className={styles.navSidebar}>
          <button
            type="button"
            className={`${styles.navItem} ${activeTab === "institution" ? styles.navItemActive : ""}`}
            onClick={() => setActiveTab("institution")}
          >
            <div className={styles.navIcon} style={{ color: "#06B6D4" }}><BookIcon width="15" height="15" /></div>
            Institution & Profile
          </button>

          <button
            type="button"
            className={`${styles.navItem} ${activeTab === "security" ? styles.navItemActive : ""}`}
            onClick={() => setActiveTab("security")}
          >
            <div className={styles.navIcon} style={{ color: "#6366F1" }}><SettingsIcon width="15" height="15" /></div>
            Security & License
          </button>

          <button
            type="button"
            className={`${styles.navItem} ${activeTab === "network" ? styles.navItemActive : ""}`}
            onClick={() => setActiveTab("network")}
          >
            <div className={styles.navIcon} style={{ color: "#10B981" }}><CalendarIcon width="15" height="15" /></div>
            Network & Domain
          </button>

          <button
            type="button"
            className={`${styles.navItem} ${activeTab === "backup" ? styles.navItemActive : ""}`}
            onClick={() => setActiveTab("backup")}
          >
            <div className={styles.navIcon} style={{ color: "#F97316" }}><DocumentIcon width="15" height="15" /></div>
            Backup & Maintenance
          </button>

          <button
            type="button"
            className={`${styles.navItem} ${activeTab === "terminal" ? styles.navItemActive : ""}`}
            onClick={() => setActiveTab("terminal")}
          >
            <div className={styles.navIcon} style={{ color: "#8B5CF6" }}><ClockIcon width="15" height="15" /></div>
            Server Logs & Diagnostics
          </button>

          <button
            type="button"
            className={`${styles.navItem} ${activeTab === "audit" ? styles.navItemActive : ""}`}
            onClick={() => setActiveTab("audit")}
          >
            <div className={styles.navIcon} style={{ color: "#3B82F6" }}><UsersIcon width="15" height="15" /></div>
            Audit Trail
          </button>
        </aside>

        {/* Content Pane */}
        <main className={styles.contentPane}>
          {/* ── TAB 1: INSTITUTION & PROFILE ── */}
          {activeTab === "institution" && (
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitle}>Institutional Profile & Report Settings</div>
                <div className={styles.cardSubtitle}>
                  Configure school name, administrator details, branding logo, and report card remarks.
                </div>
              </div>

              <div className={styles.formGrid2}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Organisation / School Name</label>
                  <input
                    className={styles.formInput}
                    value={configForm.org_name ?? ""}
                    onChange={(e) => setConfigForm({ ...configForm, org_name: e.target.value })}
                    placeholder="e.g. Apex International Academy"
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Institution Type</label>
                  <select
                    className={styles.formSelect}
                    value={configForm.institution_type ?? ""}
                    onChange={(e) => setConfigForm({ ...configForm, institution_type: e.target.value })}
                  >
                    <option value="">Select institution type…</option>
                    <option value="Primary">Primary School</option>
                    <option value="Secondary">Secondary School / High School</option>
                    <option value="University">University</option>
                    <option value="Polytechnic">Polytechnic / College</option>
                  </select>
                </div>
              </div>

              <div className={styles.formGrid2}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Administrator Full Name</label>
                  <input
                    className={styles.formInput}
                    value={configForm.admin_name ?? ""}
                    onChange={(e) => setConfigForm({ ...configForm, admin_name: e.target.value })}
                    placeholder="Principal / Chief Administrator"
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Administrator Contact Email</label>
                  <input
                    className={styles.formInput}
                    type="email"
                    value={configForm.admin_email ?? ""}
                    onChange={(e) => setConfigForm({ ...configForm, admin_email: e.target.value })}
                    placeholder="admin@school.edu"
                  />
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Institutional Description</label>
                <textarea
                  rows={2}
                  className={styles.formTextarea}
                  value={configForm.description ?? ""}
                  onChange={(e) => setConfigForm({ ...configForm, description: e.target.value })}
                  placeholder="Official mission statement or institutional overview…"
                />
              </div>

              {/* Self-Registration Toggle */}
              <div className={styles.toggleRow}>
                <input
                  type="checkbox"
                  id="reg_open"
                  checked={configForm.registration_open ?? true}
                  onChange={(e) => setConfigForm({ ...configForm, registration_open: e.target.checked })}
                  className={styles.checkboxInput}
                />
                <div>
                  <label htmlFor="reg_open" style={{ fontWeight: 600, fontSize: "0.8125rem", color: "var(--color-text)", cursor: "pointer" }}>
                    Allow Public Student & Teacher Registration
                  </label>
                  <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", marginTop: "0.15rem" }}>
                    When enabled, candidates and staff can self-register. When disabled, only Operators can provision accounts.
                  </div>
                </div>
              </div>

              {/* Logo Upload */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Official School Crest / Logo</label>
                <div className={styles.logoUploadWrap}>
                  {themeForm.school_logo && (
                    <img
                      src={themeForm.school_logo}
                      alt="School Logo"
                      className={styles.logoPreview}
                    />
                  )}
                  <div style={{ flex: 1 }}>
                    <label
                      htmlFor="logo-upload"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.45rem",
                        padding: "0.45rem 0.85rem",
                        borderRadius: "6px",
                        border: "1px solid var(--color-border)",
                        background: "#FFFFFF",
                        color: "var(--color-text)",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {themeForm.school_logo ? "Replace Crest Image" : "Upload Crest Image"}
                    </label>
                    <input
                      id="logo-upload"
                      ref={logoInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      style={{ display: "none" }}
                    />
                    <div style={{ fontSize: "0.6875rem", color: "var(--color-muted)", marginTop: "0.35rem" }}>
                      PNG, JPG or SVG format · Maximum size 2MB · Embedded in official broadsheets and transcripts.
                    </div>
                  </div>
                </div>
              </div>

              {/* Principal Remarks */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Standard Principal Remarks (For Report Cards)</label>
                <textarea
                  rows={2}
                  className={styles.formTextarea}
                  value={themeForm.principal_remarks ?? ""}
                  onChange={(e) => setThemeForm({ ...themeForm, principal_remarks: e.target.value })}
                  placeholder="e.g. An encouraging term of steady academic progress and dedicated performance."
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: "0.75rem", borderTop: "1px solid var(--color-border)" }}>
                <Button variant="primary" size="sm" onClick={saveConfig} loading={savingConfig}>
                  Save Institutional Profile
                </Button>
              </div>
            </div>
          )}

          {/* ── TAB 2: SECURITY & LICENSE ── */}
          {activeTab === "security" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>Administrator Authentication</div>
                  <div className={styles.cardSubtitle}>
                    Manage master credentials and operator login protection.
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.8125rem", color: "var(--color-text)" }}>Master Operator Password</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>
                      Update the password used for system-wide configuration and user administration.
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setShowPwModal(true)}>
                    Change Password
                  </Button>
                </div>
              </div>

              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>License & Deployment Tier</div>
                  <div className={styles.cardSubtitle}>
                    Software version and institutional license authentication.
                  </div>
                </div>

                <div className={styles.formGrid3}>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>License Tier</label>
                    <select
                      className={styles.formSelect}
                      value={configForm.licence_type ?? "basic"}
                      onChange={(e) => setConfigForm({ ...configForm, licence_type: e.target.value })}
                    >
                      <option value="basic">Basic Tier</option>
                      <option value="standard">Standard Institutional</option>
                      <option value="premium">Enterprise Unlimited</option>
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>License Authentication Key</label>
                    <input
                      className={styles.formInput}
                      value={configForm.licence_key ?? ""}
                      onChange={(e) => setConfigForm({ ...configForm, licence_key: e.target.value })}
                      placeholder="XXXX-XXXX-XXXX"
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Application Version</label>
                    <input
                      className={styles.formInput}
                      value={configForm.version ?? "1.0.0"}
                      readOnly
                    />
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: "0.75rem", borderTop: "1px solid var(--color-border)" }}>
                  <Button variant="primary" size="sm" onClick={saveConfig} loading={savingConfig}>
                    Save License Details
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ── TAB 3: NETWORK & DOMAIN ── */}
          {activeTab === "network" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              {/* Custom Domain Management Card */}
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>Local Domain & Wi-Fi IP Masking</div>
                  <div className={styles.cardSubtitle}>
                    Enable friendly URL access (e.g. <code>exampool.co</code>, <code>exampool.ng</code>, or your school's custom domain) so candidates and teachers don't have to memorize numerical IP addresses.
                  </div>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", maxWidth: "520px" }}>
                  <input
                    className={styles.formInput}
                    value={customUrlInput}
                    onChange={(e) => setCustomUrlInput(e.target.value)}
                    placeholder="e.g. exampool.co, exampool.ng, or cbt.school.edu.ng"
                  />
                  <Button variant="primary" size="sm" onClick={saveCustomUrl} loading={savingDomain}>
                    Publish Domain
                  </Button>
                </div>

                {/* 3 Live Access Methods */}
                <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.65rem" }}>
                  <div style={{ fontWeight: 600, fontSize: "0.8125rem", color: "var(--color-text)" }}>Available Access URLs on School Network:</div>
                  
                  {/* Method 1: Zero-Config mDNS */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.65rem 0.85rem", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: "8px" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#166534" }}>🚀 Zero-Config Wi-Fi (No Router Setup Needed):</span>
                        <span style={{ fontSize: "0.6875rem", background: "#DCFCE7", color: "#15803D", padding: "0.1rem 0.4rem", borderRadius: "4px", fontWeight: 600 }}>● mDNS Active</span>
                      </div>
                      <div style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#14532D", marginTop: "0.15rem" }}>
                        <a href={`http://exampool.local:${systemSettings?.server_port || 8001}`} target="_blank" rel="noreferrer" style={{ color: "#15803D", textDecoration: "underline", fontWeight: 600 }}>
                          {`http://exampool.local:${systemSettings?.server_port || 8001}`}
                        </a>
                      </div>
                      <div style={{ fontSize: "0.6875rem", color: "#166534", marginTop: "0.1rem" }}>
                        Works immediately on iPhones, iPads, Android (12+), MacBooks, and Windows PCs on the same Wi-Fi.
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => copyToClipboard(`http://exampool.local:${systemSettings?.server_port || 8001}`, "mdns")}
                    >
                      {copiedKey === "mdns" ? "Copied!" : "Copy Link"}
                    </Button>
                  </div>

                  {/* Method 2: Custom Domain via Router DNS */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.65rem 0.85rem", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: "8px" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#1E40AF" }}>🌐 Custom Domain (Wi-Fi Router DNS):</span>
                        {systemSettings?.dns_active ? (
                          <span style={{ fontSize: "0.6875rem", background: "#DBEAFE", color: "#1D4ED8", padding: "0.1rem 0.4rem", borderRadius: "4px", fontWeight: 600 }}>● Port 53 Active (Recursive)</span>
                        ) : (
                          <span style={{ fontSize: "0.6875rem", background: "#FEF3C7", color: "#B45309", padding: "0.1rem 0.4rem", borderRadius: "4px", fontWeight: 600 }}>○ Run As Admin</span>
                        )}
                      </div>
                      <div style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#1E3A8A", marginTop: "0.15rem" }}>
                        <a href={`http://${systemSettings?.custom_url || customUrlInput || "exampool.ng"}:${systemSettings?.server_port || 8001}`} target="_blank" rel="noreferrer" style={{ color: "#1D4ED8", textDecoration: "underline", fontWeight: 600 }}>
                          {`http://${systemSettings?.custom_url || customUrlInput || "exampool.ng"}:${systemSettings?.server_port || 8001}`}
                        </a>
                      </div>
                      <div style={{ fontSize: "0.6875rem", color: "#1E40AF", marginTop: "0.1rem" }}>
                        Works across all devices on Wi-Fi when router Primary DNS is set to <code>{networkInfo?.primary_ip || systemSettings?.server_ip || "SERVER_IP"}</code>.
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => copyToClipboard(`http://${systemSettings?.custom_url || customUrlInput || "exampool.ng"}:${systemSettings?.server_port || 8001}`, "custom")}
                    >
                      {copiedKey === "custom" ? "Copied!" : "Copy Link"}
                    </Button>
                  </div>

                  {/* Method 3: Direct LAN IP */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.65rem 0.85rem", background: "var(--color-surface-2, #F8FAFC)", border: "1px solid var(--color-border)", borderRadius: "8px" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--color-text)" }}>📡 Direct LAN IP:</span>
                        <span style={{ fontSize: "0.6875rem", background: "#E2E8F0", color: "#475569", padding: "0.1rem 0.4rem", borderRadius: "4px", fontWeight: 600 }}>Universal Fallback</span>
                      </div>
                      <div style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "var(--color-text)", marginTop: "0.15rem" }}>
                        <a href={`http://${networkInfo?.primary_ip || systemSettings?.server_ip || "127.0.0.1"}:${systemSettings?.server_port || 8001}`} target="_blank" rel="noreferrer" style={{ color: "#4F46E5", textDecoration: "underline", fontWeight: 600 }}>
                          {`http://${networkInfo?.primary_ip || systemSettings?.server_ip || "127.0.0.1"}:${systemSettings?.server_port || 8001}`}
                        </a>
                      </div>
                      <div style={{ fontSize: "0.6875rem", color: "var(--color-muted)", marginTop: "0.1rem" }}>
                        Always connects without any DNS or router setup.
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => copyToClipboard(`http://${networkInfo?.primary_ip || systemSettings?.server_ip || "127.0.0.1"}:${systemSettings?.server_port || 8001}`, "ip")}
                    >
                      {copiedKey === "ip" ? "Copied!" : "Copy Link"}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Host Machine Local Setup Card */}
              <div className={styles.card} style={{ borderLeft: "4px solid #4F46E5" }}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>Host Computer Setup (Browsing from this PC)</div>
                  <div className={styles.cardSubtitle}>
                    To open <code>{`http://${systemSettings?.custom_url || customUrlInput || "exampool.ng"}:${systemSettings?.server_port || 8001}`}</code> directly on <strong>this host computer</strong>, map the domain in Windows hosts file.
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.8125rem" }}>
                  <div style={{ color: "var(--color-text)" }}>
                    Open PowerShell or Command Prompt in the project folder and run:
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "#0F172A", color: "#38BDF8", padding: "0.6rem 0.85rem", borderRadius: "6px", fontFamily: "monospace", fontSize: "0.8125rem" }}>
                    <span style={{ flex: 1 }}>bun run hosts:setup</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard("bun run hosts:setup", "cmd_hosts")}
                      style={{
                        padding: "0.25rem 0.55rem",
                        background: "#334155",
                        color: "#FFFFFF",
                        border: "none",
                        borderRadius: "4px",
                        fontSize: "0.6875rem",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      {copiedKey === "cmd_hosts" ? "Copied!" : "Copy Command"}
                    </button>
                  </div>
                  <div style={{ fontSize: "0.6875rem", color: "var(--color-muted)" }}>
                    Alternatively, double-click <code>scripts\setup-hosts.bat</code> to grant elevation and map the domain in 1 second.
                  </div>
                </div>
              </div>

              {/* Network Status Grid */}
              <div className={styles.networkGrid}>
                <div className={styles.networkCard}>
                  <div className={styles.networkCardHeader}>
                    <span className={styles.networkCardTitle}>Primary LAN IP</span>
                    <span className={styles.statusPill} style={{ background: "#EFF6FF", color: "#2563EB", border: "1px solid #BFDBFE" }}>IPv4</span>
                  </div>
                  <div>
                    <span className={styles.codeVal}>{networkInfo?.primary_ip || systemSettings?.server_ip || "Detecting…"}</span>
                  </div>
                  <div style={{ fontSize: "0.6875rem", color: "var(--color-muted)", marginTop: "0.25rem" }}>Physical Wi-Fi / Ethernet adapter.</div>
                </div>

                <div className={styles.networkCard}>
                  <div className={styles.networkCardHeader}>
                    <span className={styles.networkCardTitle}>Server Port</span>
                    <span className={styles.statusPill} style={{ background: "#F0FDF4", color: "#16A34A", border: "1px solid #BBF7D0" }}>HTTP</span>
                  </div>
                  <div>
                    <span className={styles.codeVal}>{systemSettings?.server_port || 8001}</span>
                  </div>
                  <div style={{ fontSize: "0.6875rem", color: "var(--color-muted)", marginTop: "0.25rem" }}>Web & API traffic port.</div>
                </div>

                <div className={styles.networkCard}>
                  <div className={styles.networkCardHeader}>
                    <span className={styles.networkCardTitle}>DNS Masking</span>
                    <span className={styles.statusPill} style={{ background: systemSettings?.dns_active ? "#ECFDF5" : "#FEF3C7", color: systemSettings?.dns_active ? "#059669" : "#D97706", border: `1px solid ${systemSettings?.dns_active ? "#A7F3D0" : "#FDE68A"}` }}>{systemSettings?.dns_active ? "Active" : "Standard LAN"}</span>
                  </div>
                  <div>
                    <span className={styles.codeVal} style={{ color: systemSettings?.dns_active ? "#059669" : "#D97706" }}>{systemSettings?.dns_active ? "✅ Port 53 Active" : "○ Port 53 Standard"}</span>
                  </div>
                  <div style={{ fontSize: "0.6875rem", color: "var(--color-muted)", marginTop: "0.25rem" }}>Recursive pass-through for internet.</div>
                </div>

                <div className={styles.networkCard}>
                  <div className={styles.networkCardHeader}>
                    <span className={styles.networkCardTitle}>mDNS Zero-Config</span>
                    <span className={styles.statusPill} style={{ background: "#ECFDF5", color: "#059669", border: "1px solid #A7F3D0" }}>Port 5353</span>
                  </div>
                  <div>
                    <span className={styles.codeVal} style={{ color: "#059669" }}>✅ exampool.local</span>
                  </div>
                  <div style={{ fontSize: "0.6875rem", color: "var(--color-muted)", marginTop: "0.25rem" }}>Zero-config Wi-Fi multicast.</div>
                </div>
              </div>

              {/* Wi-Fi Router Configuration Guide */}
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>School Wi-Fi & Router Configuration Guide</div>
                  <div className={styles.cardSubtitle}>One-time router setup for institution-wide custom domain access.</div>
                </div>
                <ol style={{ margin: 0, paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "0.45rem", fontSize: "0.8125rem", color: "var(--color-muted)" }}>
                  <li>Access your Wi-Fi router admin page (commonly <code>192.168.1.1</code> or <code>192.168.8.1</code>).</li>
                  <li>Under <strong>DHCP / LAN DNS Settings</strong>, set <strong>Primary DNS</strong> to <code>{networkInfo?.primary_ip || systemSettings?.server_ip || "SERVER_IP"}</code>.</li>
                  <li>Set <strong>Secondary DNS</strong> to <code>8.8.8.8</code> (Google DNS) or leave default.</li>
                  <li><strong>Full Internet Preserved:</strong> ExamPool includes an integrated recursive DNS proxy, so phones and computers retain uninterrupted internet access (Google, WhatsApp, Apple services) while resolving <code>http://{systemSettings?.custom_url || customUrlInput || "exampool.ng"}:{systemSettings?.server_port || 8001}</code>!</li>
                  <li style={{ color: "#64748B" }}><strong>Tip:</strong> If router access is restricted, candidates can always connect instantly via Zero-Config <code>http://exampool.local:{systemSettings?.server_port || 8001}</code> or direct IP.</li>
                </ol>
              </div>
            </div>
          )}

          {/* ── TAB 4: BACKUP & MAINTENANCE ── */}
          {activeTab === "backup" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>Database Snapshot & Archival</div>
                  <div className={styles.cardSubtitle}>
                    Export local SQLite snapshots or restore from historical system backups.
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.8125rem", color: "var(--color-text)" }}>Export Database Backup</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>Download a complete <code>.db</code> snapshot file.</div>
                    </div>
                    <Button variant="secondary" size="sm" onClick={doExport} leftIcon={<DocumentIcon width="13" height="13" />}>
                      Export Backup
                    </Button>
                  </div>

                  <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: "1rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.8125rem", color: "var(--color-text)" }}>Restore Snapshot</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>Replace current state from an existing <code>.db</code> archive.</div>
                    </div>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", padding: "0.4rem 0.75rem", borderRadius: "6px", border: "1px solid var(--color-border)", background: "#FFFFFF", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}>
                      Select File
                      <input type="file" accept=".db,application/octet-stream" onChange={onImport} style={{ display: "none" }} />
                    </label>
                  </div>
                </div>
              </div>

              {/* Danger Zone: Factory Reset */}
              <div className={styles.dangerCard}>
                <div className={styles.dangerHeader}>
                  <WarningIcon width="16" height="16" />
                  Irreversible System Reset
                </div>
                <div style={{ fontSize: "0.8125rem", color: "var(--color-text)", lineHeight: 1.5 }}>
                  This operation permanently wipes all questions, user accounts, candidate submissions, and broadsheets.
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.25rem" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", fontWeight: 500, cursor: "pointer" }}>
                    <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} />
                    I understand this deletes all data permanently
                  </label>

                  <div style={{ display: "flex", gap: "0.5rem", maxWidth: "420px" }}>
                    <input
                      className={styles.formInput}
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder='Type "DELETE ALL DATA"'
                    />
                    <button
                      type="button"
                      disabled={!confirmChecked || confirmText !== "DELETE ALL DATA"}
                      onClick={() => setShowFinalModal(true)}
                      style={{
                        padding: "0.45rem 0.85rem",
                        borderRadius: "6px",
                        border: "none",
                        background: (!confirmChecked || confirmText !== "DELETE ALL DATA") ? "var(--color-surface-2)" : "var(--color-danger, #DC2626)",
                        color: (!confirmChecked || confirmText !== "DELETE ALL DATA") ? "var(--color-muted)" : "#FFFFFF",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        cursor: (!confirmChecked || confirmText !== "DELETE ALL DATA") ? "not-allowed" : "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Factory Reset
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── TAB 5: SERVER LOGS & TERMINAL ── */}
          {activeTab === "terminal" && (
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitle}>Live Server Logs & Diagnostics</div>
                <div className={styles.cardSubtitle}>
                  Real-time telemetry stream from the backend engine.
                </div>
              </div>

              <div className={styles.terminalContainer}>
                <div className={styles.terminalHeader}>
                  <div className={styles.terminalTitle}>exampool-engine / stdout</div>
                  <div style={{ display: "flex", gap: "0.35rem" }}>
                    {(["" as const, "info" as const, "warn" as const, "error" as const]).map((lvl) => (
                      <button
                        key={lvl}
                        onClick={() => setTermFilter(lvl)}
                        style={{
                          padding: "0.15rem 0.45rem",
                          borderRadius: "4px",
                          fontSize: "0.6875rem",
                          fontWeight: 600,
                          cursor: "pointer",
                          border: "none",
                          background: termFilter === lvl ? "#334155" : "transparent",
                          color: termFilter === lvl ? "#FFFFFF" : "#94A3B8",
                        }}
                      >
                        {lvl === "" ? "ALL" : lvl.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.terminalBody}>
                  {termLoading ? (
                    <div style={{ color: "#64748B" }}>Connecting to stream…</div>
                  ) : termLogs.length === 0 ? (
                    <div style={{ color: "#64748B" }}>No log entries recorded.</div>
                  ) : (
                    termLogs.map((l, i) => (
                      <div key={i} style={{ display: "flex", gap: "0.65rem", marginBottom: "0.15rem" }}>
                        <span style={{ color: "#64748B", flexShrink: 0 }}>
                          {new Date(l.ts).toLocaleTimeString("en-GB")}
                        </span>
                        <span style={{ color: l.level === "error" ? "#F87171" : l.level === "warn" ? "#FBBF24" : "#94A3B8", textTransform: "uppercase", fontWeight: 600, minWidth: "36px" }}>
                          {l.level}
                        </span>
                        <span style={{ color: "#E2E8F0", wordBreak: "break-all" }}>{l.msg}</span>
                      </div>
                    ))
                  )}
                  <div ref={termEndRef} />
                </div>

                <div className={styles.terminalFooter}>
                  <span>{termLogs.length} events logged · Auto-polling enabled</span>
                  <span style={{ color: "#10B981", fontWeight: 600 }}>● CONNECTED</span>
                </div>
              </div>
            </div>
          )}

          {/* ── TAB 6: AUDIT TRAIL ── */}
          {activeTab === "audit" && (
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitle}>Administrative Audit Trail</div>
                <div className={styles.cardSubtitle}>
                  Chronological record of administrative operations and system events.
                </div>
              </div>

              <div style={{ maxWidth: "320px" }}>
                <input
                  type="text"
                  placeholder="Filter audit events…"
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  className={styles.formInput}
                />
              </div>

              <div className={styles.tableWrapper}>
                <table className={styles.tbl}>
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Actor</th>
                      <th>Action</th>
                      <th>Target Resource</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logsLoading ? (
                      <tr>
                        <td colSpan={4} style={{ textAlign: "center", padding: "2rem", color: "var(--color-muted)" }}>
                          Loading audit records…
                        </td>
                      </tr>
                    ) : filteredLogs.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ textAlign: "center", padding: "2rem", color: "var(--color-muted)" }}>
                          No audit entries found.
                        </td>
                      </tr>
                    ) : (
                      filteredLogs.map((log: any, i: number) => (
                        <tr key={log.id ?? i}>
                          <td style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.75rem", color: "var(--color-muted)", whiteSpace: "nowrap" }}>
                            {new Date(log.timestamp).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </td>
                          <td style={{ fontWeight: 600, fontSize: "0.8125rem" }}>
                            {log.actor_name || `#${log.actor_id}`}
                          </td>
                          <td>
                            <span className={styles.codeVal}>{log.action}</span>
                          </td>
                          <td style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>
                            {log.resource} {log.resource_id != null ? `#${log.resource_id}` : ""}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ── FINAL CONFIRMATION MODAL ── */}
      {showFinalModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.4)", backdropFilter: "blur(4px)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
          <div style={{ background: "#FFFFFF", borderRadius: "12px", border: "1px solid var(--color-border)", padding: "1.5rem", maxWidth: "400px", width: "100%", display: "flex", flexDirection: "column", gap: "1rem", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
            <div style={{ fontWeight: 600, fontSize: "1rem", color: "var(--color-text)" }}>Confirm Factory Reset</div>
            <div style={{ fontSize: "0.8125rem", color: "var(--color-danger, #DC2626)", lineHeight: 1.5 }}>
              All examination data, user records, and candidate submissions will be permanently wiped. This action is irreversible.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", paddingTop: "0.75rem", borderTop: "1px solid var(--color-border)" }}>
              <Button variant="secondary" size="sm" onClick={() => setShowFinalModal(false)}>
                Cancel
              </Button>
              <Button variant="secondary" size="sm" onClick={doReset}>
                Confirm Reset
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
