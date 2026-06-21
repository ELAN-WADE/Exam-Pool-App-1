"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { RequireRole } from "../../../components/auth/RequireRole";
import { api } from "../../../lib/api";
import { savePackage, getAllPackageIds, deletePackage, getOfflineSubmissions, deleteOfflineSubmission } from "../../../lib/idb";
import { DocumentIcon, SearchIcon, ClockIcon } from "../../../components/icons/Icons";

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
  const [selectedBody, setSelectedBody] = useState<string | null>(null);

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

  return (
    <main style={{ padding: "2rem", maxWidth: "900px", margin: "0 auto" }}>
      <header style={{ marginBottom: "2rem" }}>
        <h1 className="pageTitle">Practice Sandbox</h1>
        <p style={{ color: "var(--color-muted)" }}>Sharpen your skills using past questions from JAMB, WAEC, and NECO.</p>
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
        <>
          {/* Filters */}
          <div style={{ display: "flex", gap: "1rem", marginBottom: "2rem" }}>
            <button 
              className={`btn ${!selectedBody ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setSelectedBody(null)}
            >
              All
            </button>
            {uniqueBodies.map(body => (
              <button 
                key={body}
                className={`btn ${selectedBody === body ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setSelectedBody(body as string)}
              >
                {body}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1.5rem" }}>
            {packages
              .filter(p => !selectedBody || p.exam_body === selectedBody)
              .map((pkg, idx) => (
              <div key={idx} className="card" style={{ display: "flex", flexDirection: "column", height: "100%", padding: "1.5rem", transition: "transform 0.2s" }} onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-4px)'} onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}>
                <div style={{ marginBottom: "auto" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
                    <span className="badge" style={{ background: "var(--color-primary-glow)", color: "var(--color-primary)", fontWeight: "bold" }}>
                      {pkg.exam_body} {pkg.year}
                    </span>
                    <span style={{ fontSize: "0.8rem", color: "var(--color-muted)", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                      <ClockIcon width="14" height="14" /> 45 mins
                    </span>
                  </div>
                  <h3 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>{pkg.subject}</h3>
                  <p style={{ color: "var(--color-muted)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
                    {pkg.content_count} past questions available.
                  </p>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "auto" }}>
                  <button 
                    className="btn btn-primary" 
                    style={{ flex: 1, justifyContent: "center" }}
                    onClick={() => handleStartPractice(pkg.id || pkg.subject)}
                  >
                    Start
                  </button>
                  {downloadedPkgs.includes(pkg.id || pkg.subject) ? (
                    <button className="btn btn-ghost" style={{ color: "var(--color-danger)" }} onClick={() => handleDelete(pkg.id || pkg.subject)} title="Remove Offline Download">
                      🗑️
                    </button>
                  ) : (
                    <button className="btn btn-ghost" onClick={() => handleDownload(pkg.id || pkg.subject)} disabled={downloadingId === (pkg.id || pkg.subject)} title="Download for Offline">
                      {downloadingId === (pkg.id || pkg.subject) ? "..." : "⬇️"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
