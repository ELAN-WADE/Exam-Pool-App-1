"use client";

import { useState, useEffect } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { DocumentIcon, SearchIcon, WarningIcon, CheckCircleIcon } from "../../../components/icons/Icons";
import { fetchWithAuth } from "../../../lib/api";

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
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  
  const [pdfMeta, setPdfMeta] = useState({ exam_body: "JAMB", year: new Date().getFullYear(), subject_code: "", paper_type: "objective" });

  const loadPackages = async () => {
    try {
      // [SECURITY FIX VULN-13] Use credentials: "include" — HttpOnly cookie, not localStorage token
      const data = await fetchWithAuth('/api/sync/content/manifest');
      setPackages(data.packages || []);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load packages");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPackages();
  }, []);

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

      // [SECURITY FIX VULN-13] Use credentials: "include" — HttpOnly cookie, not localStorage token
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
      const res = await fetch(`${API_BASE}/api/content/pdf-upload`, {
        method: "POST",
        credentials: "include",
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

      <div style={{ maxWidth: "600px", margin: "0 auto" }}>
        <div>
          <h3 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Import PDF (Auto-Parse)</h3>
          <div className="card" style={{ padding: "1.5rem" }}>
            <p style={{ fontSize: "0.85rem", color: "var(--color-muted)", marginBottom: "1rem", lineHeight: 1.5 }}>
              Upload a standard PDF of past questions. The system will extract the text, identify questions and options, and insert them into the bank automatically.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1.5rem" }}>
              <div>
                <label style={{ fontSize: "0.8rem", color: "var(--color-muted)", marginBottom: "0.4rem", display: "block", fontWeight: 600, textTransform: "uppercase" }}>Exam Body</label>
                <select className="input" value={pdfMeta.exam_body} onChange={e => setPdfMeta({...pdfMeta, exam_body: e.target.value})} style={{ width: "100%", padding: "0.75rem", borderRadius: "6px", border: "1px solid var(--color-border)" }}>
                  <option value="JAMB">JAMB</option>
                  <option value="WAEC">WAEC</option>
                  <option value="NECO">NECO</option>
                  <option value="NABTEB">NABTEB</option>
                </select>
              </div>
              
              <div>
                <label style={{ fontSize: "0.8rem", color: "var(--color-muted)", marginBottom: "0.4rem", display: "block", fontWeight: 600, textTransform: "uppercase" }}>Subject Code</label>
                <input type="text" className="input" placeholder="e.g. MTH, ENG, PHY" value={pdfMeta.subject_code} onChange={e => setPdfMeta({...pdfMeta, subject_code: e.target.value.toUpperCase()})} style={{ width: "100%", padding: "0.75rem", borderRadius: "6px", border: "1px solid var(--color-border)" }} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--color-muted)", marginBottom: "0.4rem", display: "block", fontWeight: 600, textTransform: "uppercase" }}>Year</label>
                  <input type="number" className="input" placeholder="e.g. 2024" value={pdfMeta.year} onChange={e => setPdfMeta({...pdfMeta, year: parseInt(e.target.value) || 2024})} style={{ width: "100%", padding: "0.75rem", borderRadius: "6px", border: "1px solid var(--color-border)" }} />
                </div>
                <div>
                  <label style={{ fontSize: "0.8rem", color: "var(--color-muted)", marginBottom: "0.4rem", display: "block", fontWeight: 600, textTransform: "uppercase" }}>Paper Type</label>
                  <select className="input" value={pdfMeta.paper_type} onChange={e => setPdfMeta({...pdfMeta, paper_type: e.target.value})} style={{ width: "100%", padding: "0.75rem", borderRadius: "6px", border: "1px solid var(--color-border)" }}>
                    <option value="objective">Objective</option>
                    <option value="theory">Theory</option>
                  </select>
                </div>
              </div>
            </div>

            <div style={{ border: "2px dashed var(--color-primary)", padding: "2rem 1rem", borderRadius: "12px", textAlign: "center", position: "relative", background: "var(--color-primary-glow)", transition: "all 0.2s" }}>
              <input
                type="file"
                accept=".pdf"
                onChange={handlePdfUpload}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }}
                disabled={uploadingPdf || !pdfMeta.exam_body || !pdfMeta.subject_code}
              />
              <DocumentIcon width="36" height="36" style={{ color: "var(--color-primary)", margin: "0 auto 0.75rem" }} />
              <div style={{ fontWeight: 700, color: "var(--color-primary)", fontSize: "1rem" }}>
                {uploadingPdf ? "Parsing PDF... Please wait" : "Click or Drag to Upload PDF"}
              </div>
              <p style={{ fontSize: "0.75rem", color: "var(--color-primary)", marginTop: "0.5rem", opacity: 0.8 }}>
                Must be a standard numbered PDF format.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
