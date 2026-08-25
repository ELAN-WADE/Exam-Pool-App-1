"use client";

import React, { useState } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useGuardian, type WardReportDocument } from "../../../components/guardian/GuardianContext";
import { api } from "../../../lib/api";
import styles from "./page.module.css";

export default function GuardianReportsPage() {
  return (
    <RequireRole role="guardian">
      <ReportsList />
    </RequireRole>
  );
}

function ReportsList() {
  const { activeWard } = useGuardian();
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [selectedDoc, setSelectedDoc] = useState<WardReportDocument | null>(null);
  const [reportCardData, setReportCardData] = useState<{ results: any[]; remarks: any[] } | null>(null);
  const [loadingCard, setLoadingCard] = useState(false);

  if (!activeWard) {
    return <div style={{ padding: "2rem", textAlign: "center" }}>No active ward selected.</div>;
  }

  const handleOpenDoc = async (doc: WardReportDocument) => {
    setSelectedDoc(doc);
    if (doc.category === "academic") {
      try {
        setLoadingCard(true);
        const res = await api.get<{ results: any[]; remarks: any[] }>(`/api/guardian/wards/${activeWard.id}/report-card`);
        setReportCardData(res);
      } catch {
        setReportCardData(null);
      } finally {
        setLoadingCard(false);
      }
    }
  };

  const reports = activeWard.reports || [];

  const filteredReports = reports.filter((r) => {
    if (activeCategory === "all") return true;
    return r.category === activeCategory;
  });

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>Academic Reports & Transcripts</h1>

      {/* Tabs */}
      <div className={styles.tabList}>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeCategory === "all" ? styles.tabBtnActive : ""}`}
          onClick={() => setActiveCategory("all")}
        >
          All ({reports.length})
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeCategory === "academic" ? styles.tabBtnActive : ""}`}
          onClick={() => setActiveCategory("academic")}
        >
          Academic
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeCategory === "attendance" ? styles.tabBtnActive : ""}`}
          onClick={() => setActiveCategory("attendance")}
        >
          Attendance
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeCategory === "behaviour" ? styles.tabBtnActive : ""}`}
          onClick={() => setActiveCategory("behaviour")}
        >
          Behaviour
        </button>
      </div>

      {/* List */}
      <div className={styles.reportList}>
        {filteredReports.map((doc) => (
          <div key={doc.id} className={styles.reportCard}>
            <div className={styles.cardTop}>
              <div className={styles.pdfIconBox}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
              </div>
              <div className={styles.reportInfo}>
                <span className={styles.reportTitle}>{doc.title}</span>
                <span className={styles.reportDesc}>{doc.description}</span>
                <span className={styles.reportDate}>{doc.date} • {doc.term}</span>
              </div>
            </div>

            <div className={styles.cardActions}>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => handleOpenDoc(doc)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span>View</span>
              </button>
              <a
                href={`/api/grading/report-card/${activeWard.id}`}
                target="_blank"
                rel="noreferrer"
                className={styles.actionBtn}
                style={{ textDecoration: "none" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Download</span>
              </a>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={async () => {
                  try {
                    const tokenRes = await api.get<{ share_url: string; token: string }>(`/api/guardian/wards/${activeWard.id}/share-token`);
                    const fullUrl = `${window.location.origin}${tokenRes.share_url}`;
                    await navigator.clipboard.writeText(fullUrl);
                    alert(`Verified transcript link for "${doc.title}" copied to clipboard! You can share this link with sponsors or scholarship boards.`);
                  } catch {
                    const fallbackUrl = `${window.location.origin}/student/report-card?student_id=${activeWard.id}`;
                    await navigator.clipboard.writeText(fallbackUrl);
                    alert(`Report link copied to clipboard!`);
                  }
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
                <span>Share</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal Preview */}
      {selectedDoc && (
        <div className={styles.modalBackdrop} onClick={() => setSelectedDoc(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontSize: "1rem", fontWeight: 700, margin: 0 }}>{selectedDoc.title}</h3>
              <button
                type="button"
                onClick={() => setSelectedDoc(null)}
                style={{ background: "#F1F5F9", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer" }}
              >
                ✕
              </button>
            </div>
            <div style={{ background: "#F8FAFC", padding: "1rem", borderRadius: 12, border: "1px solid #E2E8F0" }}>
              <p style={{ fontSize: "0.8125rem", color: "#475569", margin: "0 0 0.5rem 0" }}>
                <strong>Candidate:</strong> {activeWard.name} ({activeWard.grade})
              </p>
              <p style={{ fontSize: "0.8125rem", color: "#475569", margin: "0 0 0.5rem 0" }}>
                <strong>Admission No:</strong> {activeWard.admission_number}
              </p>
              <p style={{ fontSize: "0.8125rem", color: "#475569", margin: "0 0 0.5rem 0" }}>
                <strong>Overall Average:</strong> {activeWard.average_score}%
              </p>
              <p style={{ fontSize: "0.8125rem", color: "#475569", margin: "0 0 0.5rem 0" }}>
                <strong>Class Teacher Remarks:</strong> {reportCardData?.remarks?.[0]?.teacher_remarks || "Demonstrates strong attentiveness and active participation in class activities."}
              </p>
              <p style={{ fontSize: "0.8125rem", color: "#475569", margin: 0 }}>
                <strong>Principal's Endorsement:</strong> {reportCardData?.remarks?.[0]?.principal_remarks || "Satisfactory academic term. Encouraged to maintain consistency."}
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <a
                href={`/api/grading/report-card/${activeWard.id}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  flex: 1,
                  padding: "0.75rem",
                  background: "#165AF6",
                  color: "#FFFFFF",
                  borderRadius: 10,
                  border: "none",
                  fontWeight: 700,
                  cursor: "pointer",
                  textAlign: "center",
                  textDecoration: "none",
                  fontSize: "0.875rem",
                }}
              >
                Open Full Report Card ↗
              </a>
              <button
                type="button"
                onClick={() => setSelectedDoc(null)}
                style={{
                  padding: "0.75rem 1.25rem",
                  background: "#F1F5F9",
                  color: "#0F172A",
                  borderRadius: 10,
                  border: "1px solid #E2E8F0",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontSize: "0.875rem",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
