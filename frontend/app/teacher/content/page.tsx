"use client";

import { useState, useEffect } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { DocumentIcon, SearchIcon, WarningIcon, CheckCircleIcon } from "../../../components/icons/Icons";
import { api } from "../../../lib/api";

export default function TeacherContentPage() {
  return (
    <RequireRole role="teacher">
      <ContentLibrary />
    </RequireRole>
  );
}

function ContentLibrary() {
  const [packages, setPackages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  
  const [pdfMeta, setPdfMeta] = useState({ exam_body: "JAMB", year: new Date().getFullYear(), subject_code: "", paper_type: "objective" });

  const loadPackages = async () => {
    try {
      const token = localStorage.getItem("exampool_token");
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
      const res = await fetch(`${API_BASE}/api/sync/content/manifest`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPackages(data.packages || []);
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPackages();
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError("");
    setSuccess("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const token = localStorage.getItem("exampool_token");
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
      const res = await fetch(`${API_BASE}/api/system/content/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to upload package");
      }

      setSuccess(`Successfully imported package: ${file.name}`);
      await loadPackages();
    } catch (err: any) {
      setError("Import failed: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!pdfMeta.exam_body || !pdfMeta.subject_code) {
       setError("Please fill out Exam Body and Subject Code before uploading the PDF.");
       return;
    }

    setUploadingPdf(true);
    setError("");
    setSuccess("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("exam_body", pdfMeta.exam_body);
      formData.append("year", pdfMeta.year.toString());
      formData.append("subject_code", pdfMeta.subject_code);
      formData.append("paper_type", pdfMeta.paper_type);

      const token = localStorage.getItem("exampool_token");
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
      const res = await fetch(`${API_BASE}/api/content/pdf-upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to parse PDF");
      }

      const d = await res.json();
      setSuccess(d.message || `Successfully parsed PDF: ${file.name}`);
      await loadPackages();
    } catch (err: any) {
      setError("Import failed: " + err.message);
    } finally {
      setUploadingPdf(false);
    }
  };

  if (loading) return <div className="spinner" style={{ margin: "3rem auto" }} />;

  return (
    <main style={{ padding: "2rem", maxWidth: "900px", margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <h1 className="pageTitle">Content Library</h1>
          <p style={{ color: "var(--color-muted)" }}>Manage encrypted exam content packages (.epkg)</p>
        </div>
      </header>

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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: "2rem" }}>
        {/* Left Column: Installed Packages */}
        <div>
          <h3 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Installed Packages</h3>
          {packages.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: "3rem 1rem", background: "var(--color-surface-2)" }}>
              <DocumentIcon width="40" height="40" style={{ color: "var(--color-muted)", margin: "0 auto 1rem" }} />
              <p style={{ color: "var(--color-muted)" }}>No content packages installed.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {packages.map((pkg, idx) => (
                <div key={idx} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <h4 style={{ margin: "0 0 0.25rem 0", fontSize: "1.05rem" }}>{pkg.exam_body} {pkg.year} - {pkg.subject}</h4>
                    <div style={{ fontSize: "0.85rem", color: "var(--color-muted)", display: "flex", gap: "1rem" }}>
                      <span>Version: {pkg.version}</span>
                      <span>Questions: {pkg.content_count}</span>
                    </div>
                  </div>
                  <span className="badge badge-success">Verified</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Upload */}
        <div>
          <h3 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Import Package</h3>
          <div className="card" style={{ padding: "1.5rem" }}>
            <p style={{ fontSize: "0.85rem", color: "var(--color-muted)", marginBottom: "1.5rem", lineHeight: 1.5 }}>
              Upload an encrypted <strong>.epkg</strong> file. The system will automatically decrypt it using your Master License File and insert the questions into the Content Bank.
            </p>

            <div style={{ border: "2px dashed var(--color-border)", padding: "2rem 1rem", borderRadius: "var(--radius-lg)", textAlign: "center", position: "relative", background: "var(--color-surface-2)", transition: "all 0.2s" }}>
              <input
                type="file"
                accept=".epkg"
                onChange={handleFileUpload}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }}
                disabled={uploading}
              />
              <DocumentIcon width="32" height="32" style={{ color: "var(--color-primary)", margin: "0 auto 0.5rem" }} />
              <div style={{ fontWeight: 600, color: "var(--color-text)", fontSize: "0.9rem", marginBottom: "0.5rem" }}>
                {uploading ? "Decrypting package..." : "Select .epkg file"}
              </div>
            </div>
          </div>

          <h3 style={{ fontSize: "1.1rem", marginBottom: "1rem", marginTop: "2rem" }}>Import PDF (Auto-Parse)</h3>
          <div className="card" style={{ padding: "1.5rem" }}>
            <p style={{ fontSize: "0.85rem", color: "var(--color-muted)", marginBottom: "1rem", lineHeight: 1.5 }}>
              Upload a standard PDF of past questions. The system will extract the text, identify questions and options, and insert them into the bank automatically.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1rem" }}>
              <div>
                <label style={{ fontSize: "0.8rem", color: "var(--color-muted)", marginBottom: "0.25rem", display: "block" }}>Exam Body</label>
                <select className="input" value={pdfMeta.exam_body} onChange={e => setPdfMeta({...pdfMeta, exam_body: e.target.value})}>
                  <option value="JAMB">JAMB</option>
                  <option value="WAEC">WAEC</option>
                  <option value="NECO">NECO</option>
                  <option value="NABTEB">NABTEB</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: "0.8rem", color: "var(--color-muted)", marginBottom: "0.25rem", display: "block" }}>Subject Code (e.g. MTH, PHY, CHM)</label>
                <input type="text" className="input" placeholder="Subject Code (e.g. MTH)" value={pdfMeta.subject_code} onChange={e => setPdfMeta({...pdfMeta, subject_code: e.target.value.toUpperCase()})} />
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input type="number" className="input" placeholder="Year" value={pdfMeta.year} onChange={e => setPdfMeta({...pdfMeta, year: parseInt(e.target.value) || 2024})} />
                <select className="input" value={pdfMeta.paper_type} onChange={e => setPdfMeta({...pdfMeta, paper_type: e.target.value})}>
                  <option value="objective">Objective</option>
                  <option value="theory">Theory</option>
                </select>
              </div>
            </div>

            <div style={{ border: "2px dashed var(--color-border)", padding: "1.5rem 1rem", borderRadius: "var(--radius-lg)", textAlign: "center", position: "relative", background: "var(--color-surface-2)", transition: "all 0.2s" }}>
              <input
                type="file"
                accept=".pdf"
                onChange={handlePdfUpload}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }}
                disabled={uploadingPdf || !pdfMeta.exam_body || !pdfMeta.subject_code}
              />
              <DocumentIcon width="24" height="24" style={{ color: "var(--color-primary)", margin: "0 auto 0.5rem" }} />
              <div style={{ fontWeight: 600, color: "var(--color-text)", fontSize: "0.9rem" }}>
                {uploadingPdf ? "Parsing PDF..." : "Select .pdf file"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
