"use client";

import { useState, useEffect } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { api } from "../../../lib/api";
import { CheckCircleIcon, WarningIcon, DocumentIcon } from "../../../components/icons/Icons";

export default function LicensePage() {
  return (
    <RequireRole role="operator">
      <LicenseDashboard />
    </RequireRole>
  );
}

function LicenseDashboard() {
  const [licenseInfo, setLicenseInfo] = useState<any>(null);
  const [fingerprint, setFingerprint] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadData = async () => {
    try {
      // In a real scenario, this would call an API endpoint returning the decoded MLF and hardware fingerprint.
      // E.g., const res = await fetch('/api/admin/license');
      // For now, we simulate fetching the server's current state.
      const token = localStorage.getItem("exampool_token");
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
      const res = await fetch(`${API_BASE}/api/system/license`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        throw new Error("Failed to fetch license data");
      }
      const data = await res.json();
      setLicenseInfo(data.license);
      setFingerprint(data.hardware_fingerprint);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError("");
    setSuccess("");

    try {
      const text = await file.text();
      const payload = JSON.parse(text); // Expecting MLF JSON

      const token = localStorage.getItem("exampool_token");
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
      const res = await fetch(`${API_BASE}/api/system/license`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to upload license");
      }

      setSuccess("License file uploaded and verified successfully.");
      await loadData();
    } catch (err: any) {
      setError("Invalid license file: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return <div className="spinner" style={{ margin: "3rem auto" }} />;
  }

  const isActivated = licenseInfo && licenseInfo.tier !== "core";

  return (
    <main style={{ padding: "2rem", maxWidth: "800px", margin: "0 auto" }}>
      <h1 className="pageTitle" style={{ marginBottom: "2rem" }}>License Management</h1>

      {error && (
        <div className="card" style={{ background: "var(--color-danger-glow)", borderColor: "var(--color-danger)", marginBottom: "1.5rem" }}>
          <p style={{ color: "var(--color-danger)", display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <WarningIcon width="20" height="20" />
            {error}
          </p>
        </div>
      )}

      {success && (
        <div className="card" style={{ background: "var(--color-success-glow)", borderColor: "var(--color-success)", marginBottom: "1.5rem" }}>
          <p style={{ color: "var(--color-success)", display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <CheckCircleIcon width="20" height="20" />
            {success}
          </p>
        </div>
      )}

      {/* Hardware Fingerprint Section */}
      <div className="card" style={{ marginBottom: "2rem" }}>
        <h3 style={{ fontSize: "1.1rem", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <DocumentIcon width="20" height="20" /> Server Identity
        </h3>
        <p style={{ color: "var(--color-muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
          This server's unique hardware fingerprint. You must provide this code when requesting an offline license from ExamPool HQ.
        </p>
        <div style={{ background: "var(--color-surface-2)", padding: "1rem", borderRadius: "var(--radius-md)", border: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <code style={{ fontSize: "1.2rem", fontWeight: "bold", color: "var(--color-primary)" }}>{fingerprint || "UNKNOWN"}</code>
          <button className="btn btn-ghost" onClick={() => navigator.clipboard.writeText(fingerprint)}>
            Copy
          </button>
        </div>
      </div>

      {/* Active License Status */}
      <div className="card" style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
          <div>
            <h3 style={{ fontSize: "1.1rem", marginBottom: "0.25rem" }}>Current License Status</h3>
            <p style={{ color: "var(--color-muted)", fontSize: "0.9rem" }}>Status of the Master License File (MLF)</p>
          </div>
          <span className={`badge ${isActivated ? "badge-success" : "badge-warning"}`} style={{ fontSize: "0.9rem", padding: "0.4rem 0.8rem" }}>
            {isActivated ? "Activated" : "Core (Unlicensed)"}
          </span>
        </div>

        {isActivated ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", background: "var(--color-surface-2)", padding: "1.5rem", borderRadius: "var(--radius-md)" }}>
            <div>
              <div style={{ fontSize: "0.8rem", color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "0.25rem" }}>School</div>
              <div style={{ fontWeight: 600 }}>{licenseInfo.sub}</div>
            </div>
            <div>
              <div style={{ fontSize: "0.8rem", color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "0.25rem" }}>Tier</div>
              <div style={{ fontWeight: 600, color: "var(--color-primary)" }}>{licenseInfo.tier.replace("_", " ").toUpperCase()}</div>
            </div>
            <div>
              <div style={{ fontSize: "0.8rem", color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "0.25rem" }}>Issued</div>
              <div style={{ fontWeight: 600 }}>{new Date(licenseInfo.iat * 1000).toLocaleDateString()}</div>
            </div>
            <div>
              <div style={{ fontSize: "0.8rem", color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "0.25rem" }}>Max Kiosk Devices</div>
              <div style={{ fontWeight: 600 }}>{licenseInfo.max_devices}</div>
            </div>
          </div>
        ) : (
          <p style={{ color: "var(--color-muted)", fontSize: "0.95rem" }}>
            The system is running on the free core tier. Kiosk lockdown and encrypted content packages are unavailable.
          </p>
        )}
      </div>

      {/* Upload New License */}
      <div className="card">
        <h3 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>Upload Master License File</h3>
        <p style={{ color: "var(--color-muted)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
          Select the <code style={{ background: "var(--color-surface-2)", padding: "0.2rem 0.4rem", borderRadius: "4px" }}>license.json</code> file provided by ExamPool HQ to upgrade your server.
        </p>

        <div style={{ border: "2px dashed var(--color-border)", padding: "3rem 2rem", borderRadius: "var(--radius-lg)", textAlign: "center", position: "relative", background: "var(--color-surface-2)", transition: "all 0.2s" }}>
          <input
            type="file"
            accept="application/json"
            onChange={handleFileUpload}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }}
            disabled={uploading}
          />
          <DocumentIcon width="40" height="40" style={{ color: "var(--color-muted)", marginBottom: "1rem" }} />
          <div style={{ fontWeight: 600, color: "var(--color-text)", marginBottom: "0.5rem" }}>
            {uploading ? "Verifying signature..." : "Click or drag license.json here"}
          </div>
          {!uploading && <div style={{ fontSize: "0.85rem", color: "var(--color-muted)" }}>JSON file, max 10KB</div>}
        </div>
      </div>
    </main>
  );
}
