"use client";

import React, { useState, useEffect, useCallback } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import {
  PageHeader,
  Badge,
  Button,
} from "../../../components/ui";
import {
  ShieldCheckIcon,
  DocumentIcon,
  CheckCircleIcon,
  WarningIcon,
  CheckIcon,
  SchoolIcon,
  LayersIcon,
  ActivityIcon,
  RefreshIcon,
} from "../../../components/icons/Icons";
import styles from "./page.module.css";

interface MachineInfo {
  hostname?: string;
  platform?: string;
  arch?: string;
  cpu?: string;
  memory_gb?: number;
}

interface LicensePayload {
  sub?: string;
  tier?: string;
  iat?: number;
  exp?: number;
  max_devices?: number;
  hw_fp?: string;
  error?: string;
  status?: string;
}

export default function LicensePage() {
  return (
    <RequireRole role="operator">
      <LicenseDashboard />
    </RequireRole>
  );
}

function LicenseDashboard() {
  const [licenseInfo, setLicenseInfo] = useState<LicensePayload | null>(null);
  const [machineInfo, setMachineInfo] = useState<MachineInfo | null>(null);
  const [fingerprint, setFingerprint] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadData = useCallback(async (signal?: AbortSignal, isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");

      const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
      const res = await fetch(`${API_BASE}/api/system/license`, {
        credentials: "include",
        signal,
      });

      if (signal?.aborted) return;
      if (!res.ok) {
        throw new Error("Failed to fetch license data from server");
      }

      const data = await res.json();
      if (!signal?.aborted) {
        setLicenseInfo(data.license || null);
        setFingerprint(data.hardware_fingerprint || "");
        setMachineInfo(data.machine_info || null);
      }
    } catch (err: any) {
      if (!signal?.aborted) {
        setError(err.message || "Unable to reach server licensing subsystem");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  const handleCopyFingerprint = async () => {
    if (!fingerprint) return;
    try {
      await navigator.clipboard.writeText(fingerprint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError("");
    setSuccess("");

    try {
      const text = await file.text();
      let payload: any;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error("The selected file is not a valid JSON document.");
      }

      const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
      const res = await fetch(`${API_BASE}/api/system/license`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to verify and register Master License File");
      }

      const d = await res.json();
      setSuccess(d.message || "Master License registered and cryptographically bound to hardware successfully.");
      await loadData(undefined, true);
    } catch (err: any) {
      setError(err.message || "Failed to upload license file");
    } finally {
      setUploading(false);
    }
  };

  const isActivated = Boolean(licenseInfo && licenseInfo.tier && licenseInfo.tier !== "core" && !licenseInfo.error);
  const formattedTier = licenseInfo?.tier ? licenseInfo.tier.replace(/_/g, " ").toUpperCase() : "STANDARD EVALUATION";
  const schoolName = licenseInfo?.sub || "ExamPool Institutional Deployment";
  const issuedDate = licenseInfo?.iat ? new Date(licenseInfo.iat * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "Active";
  const maxDevices = licenseInfo?.max_devices ? Number(licenseInfo.max_devices) : 50;

  return (
    <div className={styles.container}>
      {/* ── Page Header ── */}
      <PageHeader
        eyebrow="Administration"
        title="License & Hardware Security"
        subtitle="Cryptographic machine hardware locking and institutional software activation."
        actions={
          <Button
            variant="outline"
            size="sm"
            leftIcon={<RefreshIcon width="14" height="14" />}
            loading={refreshing}
            onClick={() => loadData(undefined, true)}
          >
            Refresh Status
          </Button>
        }
      />

      {/* ── Toast Alerts ── */}
      {error && (
        <div className={`${styles.alertBanner} ${styles.alertError}`} role="alert">
          <div className="flex items-center gap-2">
            <WarningIcon width="18" height="18" />
            <span>{error}</span>
          </div>
          <button className={styles.alertClose} onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      )}

      {success && (
        <div className={`${styles.alertBanner} ${styles.alertSuccess}`} role="status">
          <div className="flex items-center gap-2">
            <CheckCircleIcon width="18" height="18" />
            <span>{success}</span>
          </div>
          <button className={styles.alertClose} onClick={() => setSuccess("")}>
            Dismiss
          </button>
        </div>
      )}

      {loading ? (
        <div className={styles.loadingContainer}>
          <div className="w-8 h-8 border-2 border-slate-700 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-medium text-slate-500">Verifying cryptographic machine hardware identity...</span>
        </div>
      ) : (
        <>
          {/* ── Activation Hero Card ── */}
          <div className={`${styles.heroCard} ${isActivated ? styles.heroActivated : styles.heroUnlicensed}`}>
            <div className={styles.heroTop}>
              <div className={styles.heroHeaderLeft}>
                <div className={`${styles.heroIconBadge} ${isActivated ? styles.heroIconActive : styles.heroIconNeutral}`} style={{ color: isActivated ? "#10B981" : "#64748B" }}>
                  <ShieldCheckIcon width="24" height="24" />
                </div>
                <div className={styles.heroTitleGroup}>
                  <span className={styles.heroEyebrow}>Software License Tier</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <h2 className={styles.heroTitle}>{formattedTier}</h2>
                    {isActivated ? (
                      <Badge variant="success" size="sm" dot>
                        Machine Bound
                      </Badge>
                    ) : (
                      <Badge variant="neutral" size="sm">
                        Evaluation Mode
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <Badge variant={isActivated ? "primary" : "neutral"} size="md">
                  {isActivated ? "Verified Installation" : "Local Single Node"}
                </Badge>
              </div>
            </div>

            {/* License Metadata Grid */}
            <div className={styles.metaGrid}>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Licensed Entity</span>
                <span className={styles.metaValue}>{schoolName}</span>
              </div>

              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Activation Tier</span>
                <span className={`${styles.metaValue} ${styles.metaMono}`}>{formattedTier}</span>
              </div>

              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>License Status</span>
                <span className={styles.metaValue}>{licenseInfo?.error ? "Signature Mismatch" : "Active & Verified"}</span>
              </div>

              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Network Client Capacity</span>
                <span className={`${styles.metaValue} ${styles.metaMono}`}>
                  {maxDevices} Concurrent Devices
                </span>
              </div>
            </div>
          </div>

          {/* ── Server Hardware Fingerprint & Machine Identity ── */}
          <div className={styles.fingerprintCard}>
            <div className={styles.cardHeader}>
              <div className={styles.cardHeaderLeft}>
                <SchoolIcon width="20" height="20" style={{ color: "#6366F1" }} />
                <div>
                  <h3 className={styles.cardTitle}>Physical Host Hardware Identity</h3>
                  <p className={styles.cardSubtitle}>
                    Tamper-proof hardware signature computed from host CPU, memory, and MAC address.
                  </p>
                </div>
              </div>
              <Badge variant="neutral" size="sm">
                Anti-Cloning Active
              </Badge>
            </div>

            {/* Machine Specs Pill Row */}
            {machineInfo && (
              <div className={styles.specsRow}>
                <div className={styles.specPill}>
                  <span className={styles.specKey}>Host:</span>
                  <span className={styles.specVal}>{machineInfo.hostname || "local"}</span>
                </div>
                <div className={styles.specPill}>
                  <span className={styles.specKey}>Platform:</span>
                  <span className={styles.specVal}>{machineInfo.platform} ({machineInfo.arch})</span>
                </div>
                <div className={styles.specPill}>
                  <span className={styles.specKey}>CPU:</span>
                  <span className={styles.specVal}>{machineInfo.cpu}</span>
                </div>
                <div className={styles.specPill}>
                  <span className={styles.specKey}>Memory:</span>
                  <span className={styles.specVal}>{machineInfo.memory_gb} GB RAM</span>
                </div>
              </div>
            )}

            {/* Fingerprint Display & Copy */}
            <div className={styles.fingerprintBox}>
              <code className={styles.fingerprintCode}>
                {fingerprint || "EP-HW-0000-0000-0000-0000"}
              </code>
              <Button
                variant={copied ? "success" : "primary"}
                size="sm"
                leftIcon={copied ? <CheckIcon width="14" height="14" /> : <DocumentIcon width="14" height="14" />}
                className={styles.copyButton}
                onClick={handleCopyFingerprint}
              >
                {copied ? "Copied!" : "Copy Signature"}
              </Button>
            </div>

            <div className={styles.lockNotice}>
              <ShieldCheckIcon width="16" height="16" className="text-emerald-600 flex-shrink-0" />
              <span>
                <strong>Anti-Piracy Machine Lock:</strong> This server installation is cryptographically bound to this physical machine. If this folder or database is copied or moved to an unauthorized computer, the hardware lock will engage and require re-activation.
              </span>
            </div>
          </div>

          {/* ── Feature Capability Matrix ── */}
          <div className={styles.featuresSection}>
            <h3 className={styles.sectionHeading}>
              <LayersIcon width="16" height="16" />
              Institutional Security & Operational Capabilities
            </h3>

            <div className={styles.featuresGrid}>
              {/* Feature 1 */}
              <div className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <ActivityIcon width="18" height="18" />
                </div>
                <div className={styles.featureContent}>
                  <div className={styles.featureHeader}>
                    <span className={styles.featureTitle}>Local Network Examination Engine</span>
                    <Badge variant="success" size="sm">
                      Active
                    </Badge>
                  </div>
                  <p className={styles.featureDesc}>
                    Zero-cloud, high-throughput exam delivery across air-gapped school Wi-Fi or LAN laboratories.
                  </p>
                </div>
              </div>

              {/* Feature 2 */}
              <div className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <DocumentIcon width="18" height="18" />
                </div>
                <div className={styles.featureContent}>
                  <div className={styles.featureHeader}>
                    <span className={styles.featureTitle}>Past Paper Question Auto-Parser</span>
                    <Badge variant="success" size="sm">
                      Active
                    </Badge>
                  </div>
                  <p className={styles.featureDesc}>
                    Automated extraction of WAEC, JAMB, NECO, and BECE PDF question papers into local SQLite repositories.
                  </p>
                </div>
              </div>

              {/* Feature 3 */}
              <div className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <SchoolIcon width="18" height="18" />
                </div>
                <div className={styles.featureContent}>
                  <div className={styles.featureHeader}>
                    <span className={styles.featureTitle}>Multi-Term Continuous Assessment</span>
                    <Badge variant="success" size="sm">
                      Active
                    </Badge>
                  </div>
                  <p className={styles.featureDesc}>
                    Weighted assessments (CA1, CA2, Final Exams) with termly remark management and teacher sign-off.
                  </p>
                </div>
              </div>

              {/* Feature 4 */}
              <div className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <LayersIcon width="18" height="18" />
                </div>
                <div className={styles.featureContent}>
                  <div className={styles.featureHeader}>
                    <span className={styles.featureTitle}>Annual Broad Sheet & Report Cards</span>
                    <Badge variant="success" size="sm">
                      Active
                    </Badge>
                  </div>
                  <p className={styles.featureDesc}>
                    Automated termly position rankings, annual grade broad sheets, and printable student transcript cards.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ── Upload Master License File ── */}
          <div className={styles.uploadCard}>
            <div>
              <h3 className={styles.cardTitle}>Register Master License File</h3>
              <p className={styles.cardSubtitle}>
                Upload the cryptographically signed <code className="font-mono text-slate-800 bg-slate-100 px-1 py-0.5 rounded">license.json</code> file provided by ExamPool HQ to register your institution or unlock capacity.
              </p>
            </div>

            <div className={`${styles.dropzone} ${uploading ? styles.dropzoneActive : ""}`}>
              <input
                type="file"
                accept="application/json,.json"
                className={styles.dropzoneFileInput}
                disabled={uploading}
                onChange={handleFileUpload}
                aria-label="Upload license.json"
              />
              <div className={styles.dropzoneIcon}>
                <DocumentIcon width="24" height="24" />
              </div>
              <div className={styles.dropzoneTitle}>
                {uploading ? "Verifying signature and binding machine..." : "Click or drag license.json here"}
              </div>
              <div className={styles.dropzoneSub}>
                Cryptographically signed JSON license certificate, max 10KB
              </div>
            </div>
          </div>

          {/* ── Offline Air-Gapped Activation Guide ── */}
          <div className={styles.stepperCard}>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Offline School Licensing Workflow
            </h3>

            <div className={styles.stepsGrid}>
              <div className={styles.stepItem}>
                <span className={styles.stepNumber}>STEP 01</span>
                <span className={styles.stepTitle}>Copy Hardware Signature</span>
                <p className={styles.stepText}>
                  Copy your unique Server Hardware Identity token generated above.
                </p>
              </div>

              <div className={styles.stepItem}>
                <span className={styles.stepNumber}>STEP 02</span>
                <span className={styles.stepTitle}>Request Signed License</span>
                <p className={styles.stepText}>
                  Submit the signature to your authorized ExamPool distributor or portal to generate a locked certificate.
                </p>
              </div>

              <div className={styles.stepItem}>
                <span className={styles.stepNumber}>STEP 03</span>
                <span className={styles.stepTitle}>Activate Offline</span>
                <p className={styles.stepText}>
                  Drop the received license file into the upload zone above. Activated instantly with zero internet required.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
