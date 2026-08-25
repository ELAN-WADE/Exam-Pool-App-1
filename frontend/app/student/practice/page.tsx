"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { RequireRole } from "../../../components/auth/RequireRole";
import { api } from "../../../lib/api";
import { savePackage, getAllPackageIds, getOfflineSubmissions, deleteOfflineSubmission } from "../../../lib/idb";
import { useToast } from "../../../hooks/useToast";
import {
  DocumentIcon,
  DownloadIcon,
  PlayIcon,
  CheckCircleIcon,
  BookIcon,
  SparklesIcon,
  ArrowRightIcon,
  SubjectIcon,
  ClockIcon,
} from "../../../components/icons/Icons";
import styles from "./page.module.css";

const SUBJECT_MAP: Record<string, string> = {
  MTH: "Mathematics",
  ENG: "English Language",
  PHY: "Physics",
  CHM: "Chemistry",
  BIO: "Biology",
  GOV: "Government",
  ECO: "Economics",
  LIT: "Literature in English",
  CRS: "Christian Religious Studies",
  IRS: "Islamic Religious Studies",
  ACC: "Accounting",
  COM: "Commerce",
  GEO: "Geography",
  AGR: "Agricultural Science",
};

const getSubjectName = (code: string) => {
  return SUBJECT_MAP[code.toUpperCase()] || code;
};

export default function PracticeSandboxPage() {
  return (
    <RequireRole role="student">
      <PracticeSandbox />
    </RequireRole>
  );
}

function PracticeSandbox() {
  const router = useRouter();
  const [packages, setPackages] = useState<any[]>([]);
  const [downloadedPkgs, setDownloadedPkgs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [selectedBody, setSelectedBody] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [selectedPkgId, setSelectedPkgId] = useState<string>("");
  const { showToast } = useToast();

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    const syncOfflineSubmissions = async () => {
      try {
        if (!navigator.onLine) return;
        const offlineSubs = await getOfflineSubmissions();
        if (offlineSubs.length > 0) {
          for (const sub of offlineSubs) {
            try {
              await api.submitPractice(sub.value.practiceId, sub.value.answers);
              await deleteOfflineSubmission(sub.key);
            } catch (e) {
              // Silently handle sync failures
            }
          }
        }
      } catch (e) {
        // Silently handle outer sync failures
      }
    };

    const loadPackages = async () => {
      try {
        try {
          await syncOfflineSubmissions();
        } catch (e) {
          // ignore sync error
        }

        try {
          const data = (await api.getContentManifest()) as any;
          if (!signal.aborted && data?.packages) {
            setPackages(data.packages);
          }
        } catch (netErr) {
          console.warn("Could not fetch online packages, checking local cache", netErr);
        }

        const cached = await getAllPackageIds();
        if (!signal.aborted) setDownloadedPkgs(cached);
      } catch (err: any) {
        if (!signal.aborted) setError(err.message || "Failed to load practice catalog.");
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    };
    loadPackages();
    return () => controller.abort();
  }, []);

  const handleStartPractice = (pkgId: string) => {
    const isDownloaded = downloadedPkgs.includes(pkgId);
    if (!navigator.onLine && !isDownloaded) {
      showToast("You are offline. Please connect to download this package first.", "error");
      return;
    }
    router.push(`/student/exam?practiceId=${pkgId}${isDownloaded ? "&offlinePkg=true" : ""}`);
  };

  const handleDownload = async (pkgId: string) => {
    setDownloadingId(pkgId);
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
      const res = await fetch(`${API_BASE}/api/practice/download?packageId=${encodeURIComponent(pkgId)}`, { credentials: "include" });
      let epkg: any = null;
      if (res.ok) {
        epkg = await res.json().catch(() => null);
        // If server returns encrypted epkg (ciphertext), try to hydrate via content API as fallback for offline
        const hasQuestions = epkg && ((Array.isArray(epkg.questions) && epkg.questions.length) || epkg.data?.questions);
        if (!hasQuestions) {
          try {
            const pkgData = await api.getPackageQuestions(pkgId) as any;
            const qs = pkgData?.questions || pkgData?.data?.questions;
            if (Array.isArray(qs) && qs.length) epkg = { questions: qs, downloaded_at: Date.now() };
          } catch {}
        }
      } else {
        // Fallback to questions API when download endpoint unavailable (e.g., content_bank empty)
        const pkgData = await api.getPackageQuestions(pkgId) as any;
        const qs = pkgData?.questions || pkgData?.data?.questions;
        if (Array.isArray(qs) && qs.length) epkg = { questions: qs, downloaded_at: Date.now() };
        else throw new Error("Failed to download package");
      }
      if (!epkg) throw new Error("Failed to download package");
      await savePackage(pkgId, epkg);
      setDownloadedPkgs((prev) => [...prev, pkgId]);
      showToast("Package downloaded for offline practice!", "success");
    } catch (err: any) {
      showToast("Download failed: " + err.message, "error");
    } finally {
      setDownloadingId(null);
    }
  };

  const uniqueBodies = useMemo(() => Array.from(new Set(packages.map((p) => p.exam_body))), [packages]);
  
  const availableYears = useMemo(() => {
    if (!selectedBody) return Array.from(new Set(packages.map((p) => p.year)));
    return Array.from(new Set(packages.filter((p) => p.exam_body === selectedBody).map((p) => p.year)));
  }, [packages, selectedBody]);

  const visiblePackages = useMemo(() => {
    return packages.filter((p) => {
      if (selectedBody && p.exam_body !== selectedBody) return false;
      if (selectedYear && String(p.year) !== String(selectedYear)) return false;
      return true;
    });
  }, [packages, selectedBody, selectedYear]);

  const activePackage = useMemo(() => {
    if (!selectedPkgId && visiblePackages.length > 0) return visiblePackages[0];
    return packages.find((p) => (p.id || p.subject) === selectedPkgId) || visiblePackages[0];
  }, [packages, visiblePackages, selectedPkgId]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "320px", gap: "0.75rem", color: "#64748B", fontSize: "0.875rem" }}>
        <div className="spinner" style={{ width: 22, height: 22, borderColor: "#E2E8F0", borderTopColor: "#165AF6" }} />
        <span>Loading practice catalog…</span>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* ── 1. Hero Welcome & Telemetry Strip ── */}
      <section className={styles.heroSection}>
        <div className={styles.heroLeft}>
          <h1 className={styles.heroTitle}>Practice Sandbox</h1>
          <p className={styles.heroSubtitle}>
            Simulate previous examination papers and master subjects at your own pace.
          </p>
        </div>

        <div className={styles.telemetryPillGroup}>
          <div className={styles.telemetryBadge}>
            <div className={styles.telemetryIcon}>
              <SparklesIcon width="18" height="18" />
            </div>
            <div className={styles.telemetryBadgeContent}>
              <span className={styles.telemetryNumber}>{packages.length}</span>
              <span className={styles.telemetryText}>Past Papers</span>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "10px", padding: "0.75rem 1.15rem", color: "#DC2626", fontSize: "0.8125rem", fontWeight: 600 }}>
          {error}
        </div>
      )}

      {/* ── 2. Selected Package Readiness Banner ── */}
      {activePackage && (
        <section className={styles.readinessBanner}>
          <div className={styles.readinessLeft}>
            <div className={styles.readinessIconBox}>
              <PlayIcon width="16" height="16" />
            </div>
            <div>
              <h2 className={styles.readinessTitle}>
                {getSubjectName(activePackage.subject)} ({activePackage.exam_body} {activePackage.year})
              </h2>
              <div className={styles.readinessSubtitle}>
                {downloadedPkgs.includes(activePackage.id || activePackage.subject) ? (
                  <span style={{ color: "#059669", fontWeight: 700, display: "flex", alignItems: "center", gap: "0.25rem" }}>
                    <CheckCircleIcon width="13" height="13" /> Offline Cached &amp; Ready
                  </span>
                ) : (
                  <span>Standard Simulation • Timed Paper</span>
                )}
              </div>
            </div>
          </div>

          <div className={styles.readinessActions}>
            {!downloadedPkgs.includes(activePackage.id || activePackage.subject) && (
              <button
                type="button"
                className={styles.downloadBtn}
                onClick={() => handleDownload(activePackage.id || activePackage.subject)}
                disabled={downloadingId === (activePackage.id || activePackage.subject)}
              >
                <DownloadIcon width="13" height="13" />
                <span>{downloadingId === (activePackage.id || activePackage.subject) ? "Downloading…" : "Download"}</span>
              </button>
            )}
            <button
              type="button"
              className={styles.launchBtn}
              onClick={() => handleStartPractice(activePackage.id || activePackage.subject)}
            >
              <span>Start Simulation</span>
              <ArrowRightIcon width="13" height="13" />
            </button>
          </div>
        </section>
      )}

      {/* ── 3. Enrolled Practice Repository Track Container ── */}
      <section className={styles.repositoryContainer}>
        <div className={styles.repositoryHeader}>
          <div className={styles.repositoryTitleGroup}>
            <div className={styles.repoIconBadge}>
              <BookIcon width="18" height="18" />
            </div>
            <div>
              <span className={styles.repoEyebrow}>Past Question Repository</span>
              <h2 className={styles.repoClassTitle}>
                {selectedBody || "All Exam Bodies"} {selectedYear ? `(${selectedYear})` : ""}
              </h2>
            </div>
          </div>

          {/* Filter Dropdowns */}
          <div className={styles.filterPillsRow}>
            <select
              className={styles.filterSelect}
              value={selectedBody}
              onChange={(e) => setSelectedBody(e.target.value)}
            >
              <option value="">All Bodies</option>
              {uniqueBodies.map((b) => (
                <option key={b as string} value={b as string}>
                  {b as string}
                </option>
              ))}
            </select>

            <select
              className={styles.filterSelect}
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
            >
              <option value="">All Years</option>
              {availableYears.map((y) => (
                <option key={y as string} value={y as string}>
                  Year {y as string}
                </option>
              ))}
            </select>
          </div>
        </div>

        {packages.length === 0 ? (
          <div className={styles.emptyState}>
            <DocumentIcon width="36" height="36" style={{ color: "#94A3B8" }} />
            <h3>No Past Question Packages Available</h3>
            <p>Offline content packages have not been installed yet. Contact your administrator.</p>
          </div>
        ) : visiblePackages.length === 0 ? (
          <div className={styles.emptyState}>
            <SubjectIcon width="28" height="28" style={{ color: "#94A3B8" }} />
            <h3>No matching past papers found</h3>
            <p>Try selecting a different examination body or assessment year filter.</p>
          </div>
        ) : (
          <div className={styles.paperGrid}>
            {visiblePackages.map((pkg) => {
              const pkgId = pkg.id || pkg.subject;
              const isSelected = (activePackage?.id || activePackage?.subject) === pkgId;
              const isCached = downloadedPkgs.includes(pkgId);

              return (
                <div
                  key={pkgId}
                  className={`${styles.paperCard} ${isSelected ? styles.paperCardSelected : ""}`}
                  onClick={() => setSelectedPkgId(pkgId)}
                >
                  <div className={styles.paperCardHeader}>
                    <div className={styles.paperIconBox}>
                      <BookIcon width="15" height="15" />
                    </div>
                    <span className={styles.paperBadge}>
                      {pkg.exam_body} {pkg.year}
                    </span>
                  </div>

                  <div>
                    <h3 className={styles.paperName}>{getSubjectName(pkg.subject)}</h3>
                    <span className={styles.paperMeta}>
                      {isCached ? "✓ Offline Available" : "Online Paper"}
                    </span>
                  </div>

                  <div>
                    <button
                      type="button"
                      className={styles.paperActionBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartPractice(pkgId);
                      }}
                    >
                      <span>Practice →</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
