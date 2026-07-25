"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { RequireRole } from "../../../components/auth/RequireRole";
import { api } from "../../../lib/api";
import { savePackage, getAllPackageIds, deletePackage, getOfflineSubmissions, deleteOfflineSubmission } from "../../../lib/idb";
import { DocumentIcon, SearchIcon, ClockIcon, DownloadIcon } from "../../../components/icons/Icons";

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
  AGR: "Agricultural Science"
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
  const [selectedSubject, setSelectedSubject] = useState<string>("");

  useEffect(() => {
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
        if (navigator.onLine) {
          syncOfflineSubmissions();
          const data = await api.getContentManifest() as any;
          setPackages(data?.packages || []);
        }
        const cached = await getAllPackageIds();
        setDownloadedPkgs(cached);
      } catch (err: any) {
        setError(navigator.onLine ? err.message : "You are offline and no packages are downloaded.");
      } finally {
        setLoading(false);
      }
    };
    loadPackages();
  }, []);

  const handleStartPractice = (pkgId: string) => {
    const isDownloaded = downloadedPkgs.includes(pkgId);
    if (!navigator.onLine && !isDownloaded) {
      alert("You are offline. Please connect to download this package first.");
      return;
    }
    router.push(`/student/exam?practiceId=${pkgId}${isDownloaded ? "&offlinePkg=true" : ""}`);
  };

  const handleDownload = async (pkgId: string) => {
    setDownloadingId(pkgId);
    try {
      const res = await fetch(`/api/practice/download?packageId=${pkgId}`);
      if (!res.ok) throw new Error("Failed to download package");
      const epkg = await res.json();
      await savePackage(pkgId, epkg);
      setDownloadedPkgs(prev => [...prev, pkgId]);
    } catch (err: any) {
      alert("Download failed: " + err.message);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (pkgId: string) => {
    await deletePackage(pkgId);
    setDownloadedPkgs(prev => prev.filter(id => id !== pkgId));
  };

  if (loading) return <div className="spinner" style={{ margin: "3rem auto" }} />;

  const uniqueBodies = Array.from(new Set(packages.map(p => p.exam_body)));
  const availableYears = selectedBody ? Array.from(new Set(packages.filter(p => p.exam_body === selectedBody).map(p => p.year))) : [];
  const availableSubjects = selectedYear ? Array.from(new Set(packages.filter(p => p.exam_body === selectedBody && String(p.year) === String(selectedYear)).map(p => p.subject))) : [];
  const selectedPkg = packages.find(p => p.exam_body === selectedBody && String(p.year) === String(selectedYear) && p.subject === selectedSubject);

  return (
    <main style={{ padding: "2rem", maxWidth: "800px", margin: "0 auto" }}>
      <header style={{ marginBottom: "3rem", textAlign: "center" }}>
        <h1 className="pageTitle" style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>Practice Sandbox</h1>
        <p style={{ color: "var(--color-muted)", fontSize: "1.1rem" }}>Configure your practice session parameters below.</p>
      </header>

      {error ? (
        <div className="card" style={{ background: "var(--color-danger-glow)", borderColor: "var(--color-danger)" }}>
          {error}
        </div>
      ) : packages.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "4rem 2rem", background: "var(--color-surface-2)" }}>
          <DocumentIcon width="48" height="48" style={{ color: "var(--color-muted)", margin: "0 auto 1rem" }} />
          <h3 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>No Past Questions Available</h3>
          <p style={{ color: "var(--color-muted)", maxWidth: "400px", margin: "0 auto" }}>
            Your school has not installed any offline content packages yet. Check back later or ask your administrator.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: "2rem", background: "var(--color-surface)", boxShadow: "0 4px 12px rgba(0,0,0,0.05)", borderRadius: "12px", border: "1px solid var(--color-border)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            
            {/* Step 1: Exam Type */}
            <div>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "var(--color-muted)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Exam Body
              </label>
              <select 
                className="input" 
                value={selectedBody}
                onChange={e => {
                  setSelectedBody(e.target.value);
                  setSelectedYear("");
                  setSelectedSubject("");
                }}
                style={{ width: "100%", padding: "0.75rem", fontSize: "1rem", borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-surface)", cursor: "pointer" }}
              >
                <option value="">-- Select ({uniqueBodies.length} available) --</option>
                {uniqueBodies.map(body => {
                  const bodyCount = packages.filter(p => p.exam_body === body).length;
                  return <option key={body as string} value={body as string}>{body as string} ({bodyCount} packages)</option>
                })}
              </select>
            </div>

            {/* Step 2: Year */}
            <div style={{ opacity: selectedBody ? 1 : 0.4, pointerEvents: selectedBody ? "auto" : "none", transition: "opacity 0.2s" }}>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "var(--color-muted)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Year
              </label>
              <select 
                className="input" 
                value={selectedYear}
                onChange={e => {
                  setSelectedYear(e.target.value);
                  setSelectedSubject("");
                }}
                disabled={!selectedBody}
                style={{ width: "100%", padding: "0.75rem", fontSize: "1rem", borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-surface)", cursor: selectedBody ? "pointer" : "not-allowed" }}
              >
                <option value="">{selectedBody ? `-- Select (${availableYears.length} available) --` : "-- Select Year --"}</option>
                {availableYears.map(year => (
                  <option key={year as string} value={year as string}>{year as string}</option>
                ))}
              </select>
            </div>

            {/* Step 3: Subject */}
            <div style={{ opacity: selectedYear ? 1 : 0.4, pointerEvents: selectedYear ? "auto" : "none", transition: "opacity 0.2s" }}>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "var(--color-muted)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Subject
              </label>
              <select 
                className="input" 
                value={selectedSubject}
                onChange={e => setSelectedSubject(e.target.value)}
                disabled={!selectedYear}
                style={{ width: "100%", padding: "0.75rem", fontSize: "1rem", borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-surface)", cursor: selectedYear ? "pointer" : "not-allowed" }}
              >
                <option value="">{selectedYear ? `-- Select (${availableSubjects.length} available) --` : "-- Select Subject --"}</option>
                {availableSubjects.map(sub => (
                  <option key={sub as string} value={sub as string}>{getSubjectName(sub as string)}</option>
                ))}
              </select>
            </div>

            {/* Actions */}
            <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <button 
                className="btn btn-primary" 
                disabled={!selectedPkg}
                onClick={() => selectedPkg && handleStartPractice(selectedPkg.id || selectedPkg.subject)}
                style={{ width: "100%", padding: "0.85rem", fontSize: "1.05rem", fontWeight: 600, borderRadius: "6px", transition: "all 0.2s", opacity: selectedPkg ? 1 : 0.5 }}
              >
                Start Practice Exam
              </button>

              {selectedPkg && (
                <div style={{ textAlign: "center" }}>
                  {downloadedPkgs.includes(selectedPkg.id || selectedPkg.subject) ? (
                    <span style={{ fontSize: "0.85rem", color: "var(--color-success)", fontWeight: 500 }}>✓ Ready for offline use</span>
                  ) : (
                    <button 
                      className="btn btn-ghost" 
                      onClick={() => handleDownload(selectedPkg.id || selectedPkg.subject)} 
                      disabled={downloadingId === (selectedPkg.id || selectedPkg.subject)}
                      style={{ fontSize: "0.85rem", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", padding: "0.4rem 0.8rem", height: "auto", minHeight: "0" }}
                    >
                      {downloadingId === (selectedPkg.id || selectedPkg.subject) ? "Downloading..." : (
                        <>
                          <DownloadIcon width="14" height="14" /> Download for Offline
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </main>
  );
}
