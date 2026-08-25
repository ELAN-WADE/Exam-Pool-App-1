"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import {
  PageHeader,
  Badge,
  Button,
  EmptyState,
  Modal,
} from "../../../components/ui";
import {
  DocumentIcon,
  SearchIcon,
  WarningIcon,
  CheckCircleIcon,
  PlusIcon,
  BookIcon,
  LayersIcon,
  RefreshIcon,
  ShieldCheckIcon,
  CheckIcon,
} from "../../../components/icons/Icons";
import styles from "./page.module.css";

interface ContentPackage {
  id?: string;
  exam_body: string;
  year: number;
  subject: string;
  subject_code?: string;
  version?: string;
  content_count: number;
  paper_type?: string;
}

const COMMON_BODIES = ["JAMB", "WAEC", "NECO", "BECE", "NABTEB", "INTERNAL"];

const COMMON_SUBJECTS = [
  { code: "MTH", name: "Mathematics" },
  { code: "ENG", name: "English Language" },
  { code: "BIO", name: "Biology" },
  { code: "CHE", name: "Chemistry" },
  { code: "PHY", name: "Physics" },
  { code: "ECN", name: "Economics" },
  { code: "GOV", name: "Government" },
  { code: "LIT", name: "Literature in English" },
  { code: "CRS", name: "Christian Religious Studies" },
  { code: "AGR", name: "Agricultural Science" },
  { code: "CIV", name: "Civic Education" },
];

export default function OperatorContentPage() {
  return (
    <RequireRole role="operator">
      <ContentLibraryContent />
    </RequireRole>
  );
}

function ContentLibraryContent() {
  const [packages, setPackages] = useState<ContentPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedBodyFilter, setSelectedBodyFilter] = useState("ALL");
  
  // Centered Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // PDF form metadata
  const [pdfMeta, setPdfMeta] = useState({
    exam_body: "WAEC",
    year: new Date().getFullYear(),
    subject_code: "MTH",
    paper_type: "objective",
  });

  const loadPackages = useCallback(async (signal?: AbortSignal, isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");

      const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
      const res = await fetch(`${API_BASE}/api/sync/content/manifest`, {
        credentials: "include",
        signal,
      });

      if (signal?.aborted) return;
      if (res.ok) {
        const data = await res.json();
        if (!signal?.aborted) {
          setPackages(data.packages || []);
        }
      } else {
        throw new Error("Failed to load content manifest");
      }
    } catch (err: any) {
      if (!signal?.aborted) {
        setError(err.message || "Failed to load content packages");
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
    loadPackages(controller.signal);
    return () => controller.abort();
  }, [loadPackages]);

  // Distinct exam bodies for filter chips
  const distinctExamBodies = useMemo(() => {
    const set = new Set<string>();
    packages.forEach((pkg) => {
      if (pkg.exam_body) set.add(pkg.exam_body.toUpperCase());
    });
    return Array.from(set);
  }, [packages]);

  // Filtered packages
  const filteredPackages = useMemo(() => {
    const q = search.trim().toLowerCase();
    return packages.filter((pkg) => {
      const matchSearch =
        !q ||
        pkg.exam_body?.toLowerCase().includes(q) ||
        pkg.subject?.toLowerCase().includes(q) ||
        pkg.subject_code?.toLowerCase().includes(q) ||
        String(pkg.year).includes(q);

      const matchBody =
        selectedBodyFilter === "ALL" ||
        pkg.exam_body?.toUpperCase() === selectedBodyFilter.toUpperCase();

      return matchSearch && matchBody;
    });
  }, [packages, search, selectedBodyFilter]);

  // Key performance statistics
  const stats = useMemo(() => {
    const totalPackages = packages.length;
    const totalQuestions = packages.reduce(
      (acc, curr) => acc + (Number(curr.content_count) || 0),
      0
    );
    const totalBodies = distinctExamBodies.length;
    return { totalPackages, totalQuestions, totalBodies };
  }, [packages, distinctExamBodies]);

  // Handle PDF Past Question Upload & Auto-Parsing
  const handlePdfUpload = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedFile) {
      setError("Please select a PDF question paper to upload.");
      return;
    }
    if (!pdfMeta.exam_body.trim() || !pdfMeta.subject_code.trim()) {
      setError("Please fill in Exam Body and Subject Code.");
      return;
    }

    setUploadingPdf(true);
    setError("");
    setSuccess("");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("exam_body", pdfMeta.exam_body.trim().toUpperCase());
      formData.append("year", String(pdfMeta.year));
      formData.append("subject_code", pdfMeta.subject_code.trim().toUpperCase());
      formData.append("paper_type", pdfMeta.paper_type);

      const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
      const res = await fetch(`${API_BASE}/api/content/pdf-upload`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to auto-parse PDF question paper");
      }

      const d = await res.json();
      setSuccess(d.message || `Successfully parsed and ingested past questions from: ${selectedFile.name}`);
      setIsModalOpen(false);
      setSelectedFile(null);
      await loadPackages(undefined, true);
    } catch (err: any) {
      setError("PDF parsing failed: " + err.message);
    } finally {
      setUploadingPdf(false);
    }
  };

  return (
    <div className={styles.container}>
      {/* ── Page Header ── */}
      <PageHeader
        eyebrow="Content Management"
        title="Content Library"
        subtitle="Manage standardized curriculum question banks and import past examination papers."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<RefreshIcon width="14" height="14" />}
              loading={refreshing}
              onClick={() => loadPackages(undefined, true)}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<PlusIcon width="14" height="14" />}
              onClick={() => {
                setError("");
                setSelectedFile(null);
                setIsModalOpen(true);
              }}
            >
              Import Past Questions
            </Button>
          </div>
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

      {/* ── KPI Summary Cards (Neutral-first Palette) ── */}
      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiIconWrapper} style={{ color: "#06B6D4" }}>
            <LayersIcon width="20" height="20" />
          </div>
          <div className={styles.kpiContent}>
            <span className={styles.kpiLabel}>Installed Question Sets</span>
            <span className={styles.kpiValue}>{stats.totalPackages}</span>
          </div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiIconWrapper} style={{ color: "#6366F1" }}>
            <BookIcon width="20" height="20" />
          </div>
          <div className={styles.kpiContent}>
            <span className={styles.kpiLabel}>Questions in Bank</span>
            <span className={styles.kpiValue}>{stats.totalQuestions.toLocaleString()}</span>
          </div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiIconWrapper} style={{ color: "#8B5CF6" }}>
            <ShieldCheckIcon width="20" height="20" />
          </div>
          <div className={styles.kpiContent}>
            <span className={styles.kpiLabel}>Exam Bodies</span>
            <span className={styles.kpiValue}>{stats.totalBodies}</span>
          </div>
        </div>
      </div>

      {/* ── Content Table & Filter Container ── */}
      <div className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <div className={styles.cardTitleArea}>
            <div>
              <h2 className={styles.cardTitle}>Question Paper Repository</h2>
              <p className={styles.cardSubtitle}>
                Standardized curriculum past papers available for exam scheduling and classroom assessments.
              </p>
            </div>
          </div>

          <div className={styles.controlsArea}>
            {/* Search Input */}
            <div className={styles.searchBox}>
              <span className={styles.searchIcon}>
                <SearchIcon width="15" height="15" />
              </span>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search body, subject, year..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search question banks"
              />
            </div>

            {/* Exam Body Filter Chips */}
            {distinctExamBodies.length > 0 && (
              <div className={styles.filterChips}>
                <button
                  type="button"
                  className={`${styles.chip} ${selectedBodyFilter === "ALL" ? styles.chipActive : ""}`}
                  onClick={() => setSelectedBodyFilter("ALL")}
                >
                  All
                </button>
                {distinctExamBodies.map((body) => (
                  <button
                    key={body}
                    type="button"
                    className={`${styles.chip} ${selectedBodyFilter === body ? styles.chipActive : ""}`}
                    onClick={() => setSelectedBodyFilter(body)}
                  >
                    {body}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Table / Loading / Empty State ── */}
        {loading ? (
          <div className={styles.loadingContainer}>
            <div className="w-8 h-8 border-2 border-slate-700 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-medium text-slate-500">Loading question repository...</span>
          </div>
        ) : filteredPackages.length === 0 ? (
          <div className={styles.emptyContainer}>
            <EmptyState
              title={search || selectedBodyFilter !== "ALL" ? "No Matching Question Papers" : "Content Bank is Empty"}
              description={
                search || selectedBodyFilter !== "ALL"
                  ? "No question sets match your search filters. Try clearing your search query."
                  : "Upload your first past examination paper PDF to auto-populate the institution's question repository."
              }
              action={
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<PlusIcon width="14" height="14" />}
                  onClick={() => {
                    setError("");
                    setSelectedFile(null);
                    setIsModalOpen(true);
                  }}
                >
                  Import Past Questions (PDF)
                </Button>
              }
            />
          </div>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Exam Body</th>
                  <th scope="col">Subject & Code</th>
                  <th scope="col">Year</th>
                  <th scope="col">Paper Type</th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Total Questions
                  </th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredPackages.map((pkg, idx) => {
                  const bodyName = (pkg.exam_body || "OTHER").toUpperCase();
                  return (
                    <tr key={pkg.id || `${pkg.exam_body}_${pkg.year}_${pkg.subject}_${idx}`}>
                      {/* Exam Body Badge */}
                      <td>
                        <span className={styles.bodyBadge}>{bodyName}</span>
                      </td>

                      {/* Subject Name & Code */}
                      <td>
                        <div className={styles.subjectCell}>
                          <span className={styles.subjectName}>{pkg.subject}</span>
                          {pkg.subject_code && pkg.subject_code !== pkg.subject && (
                            <span className={styles.subjectCodeBadge}>{pkg.subject_code}</span>
                          )}
                        </div>
                      </td>

                      {/* Examination Year */}
                      <td>
                        <span className={styles.yearText}>{pkg.year}</span>
                      </td>

                      {/* Paper Type */}
                      <td>
                        <span className={styles.paperTypeBadge}>
                          {pkg.paper_type === "theory" ? "Theory / Essay" : "Objective (MCQ)"}
                        </span>
                      </td>

                      {/* Total Questions */}
                      <td style={{ textAlign: "right" }}>
                        <span className={styles.countNumber}>
                          {Number(pkg.content_count || 0).toLocaleString()}
                        </span>
                        <span className={styles.countLabel}> Qs</span>
                      </td>

                      {/* Status */}
                      <td style={{ textAlign: "right" }}>
                        <Badge variant="success" size="sm" dot>
                          Ready
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── CENTERED MODAL: PDF PAST QUESTION PAPER AUTO-PARSER ── */}
      <Modal
        open={isModalOpen}
        onClose={() => {
          if (!uploadingPdf) {
            setIsModalOpen(false);
            setSelectedFile(null);
          }
        }}
        title="Import Past Question Paper"
        size="lg"
      >
        <form onSubmit={handlePdfUpload} className={styles.modalForm}>
          <p className={styles.modalIntro}>
            Upload a past question paper in PDF format. The server automatically scans and extracts numbered questions, multiple-choice options (A, B, C, D), and answer keys directly into the question bank.
          </p>

          {/* Form Grid */}
          <div className={styles.modalFormGrid}>
            {/* Exam Body */}
            <div className={styles.modalFormGroup}>
              <label className={styles.modalLabel}>
                Examination Body <span className="text-red-500">*</span>
              </label>
              <div className={styles.bodyChipSelector}>
                {COMMON_BODIES.map((body) => (
                  <button
                    key={body}
                    type="button"
                    className={`${styles.bodySelectChip} ${pdfMeta.exam_body === body ? styles.bodySelectChipActive : ""}`}
                    onClick={() => setPdfMeta({ ...pdfMeta, exam_body: body })}
                  >
                    {body}
                  </button>
                ))}
              </div>
              <input
                type="text"
                placeholder="Or custom body e.g. GCE, CAMBRIDGE"
                value={pdfMeta.exam_body}
                onChange={(e) => setPdfMeta({ ...pdfMeta, exam_body: e.target.value.toUpperCase() })}
                className={styles.modalInput}
                required
              />
            </div>

            {/* Subject Code */}
            <div className={styles.modalFormGroup}>
              <label className={styles.modalLabel}>
                Subject Code <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. MTH, ENG, BIO, CHE, PHY"
                value={pdfMeta.subject_code}
                onChange={(e) => setPdfMeta({ ...pdfMeta, subject_code: e.target.value.toUpperCase() })}
                className={styles.modalInput}
                required
              />
              {/* Quick Subject Suggestions */}
              <div className={styles.subjectSuggestions}>
                {COMMON_SUBJECTS.slice(0, 6).map((sub) => (
                  <button
                    key={sub.code}
                    type="button"
                    className={styles.subjectHintBtn}
                    onClick={() => setPdfMeta({ ...pdfMeta, subject_code: sub.code })}
                  >
                    {sub.code} ({sub.name})
                  </button>
                ))}
              </div>
            </div>

            {/* Examination Year */}
            <div className={styles.modalFormGroup}>
              <label className={styles.modalLabel}>
                Exam Year <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                placeholder="2024"
                min={1990}
                max={2035}
                value={pdfMeta.year}
                onChange={(e) => setPdfMeta({ ...pdfMeta, year: parseInt(e.target.value) || new Date().getFullYear() })}
                className={styles.modalInput}
                required
              />
            </div>

            {/* Paper Type */}
            <div className={styles.modalFormGroup}>
              <label className={styles.modalLabel}>Paper Format</label>
              <select
                value={pdfMeta.paper_type}
                onChange={(e) => setPdfMeta({ ...pdfMeta, paper_type: e.target.value })}
                className={styles.modalInput}
              >
                <option value="objective">Objective (Multiple Choice A-D)</option>
                <option value="theory">Theory / Structured Questions</option>
              </select>
            </div>
          </div>

          {/* PDF Drag-and-Drop Dropzone */}
          <div className={styles.dropzoneContainer}>
            <label className={styles.modalLabel}>
              Question Paper Document (.pdf) <span className="text-red-500">*</span>
            </label>
            <div
              className={`${styles.dropzone} ${uploadingPdf ? styles.dropzoneActive : ""} ${selectedFile ? styles.dropzoneHasFile : ""}`}
            >
              <input
                type="file"
                accept=".pdf,application/pdf"
                className={styles.dropzoneFileInput}
                disabled={uploadingPdf}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setSelectedFile(file);
                }}
                aria-label="Upload PDF question paper"
              />
              <div className={styles.dropzoneIcon}>
                <DocumentIcon width="24" height="24" />
              </div>
              <div className={styles.dropzoneTitle}>
                {uploadingPdf
                  ? "Parsing and extracting past questions..."
                  : selectedFile
                  ? `Selected: ${selectedFile.name}`
                  : "Click or drag past question PDF here"}
              </div>
              <div className={styles.dropzoneSub}>
                {selectedFile
                  ? `${(selectedFile.size / 1024).toFixed(1)} KB — Ready to parse`
                  : "Standard PDF with numbered questions and options (A-E), max 10MB"}
              </div>
            </div>
          </div>

          {/* Modal Actions */}
          <div className={styles.modalActions}>
            <Button
              type="button"
              variant="outline"
              size="md"
              disabled={uploadingPdf}
              onClick={() => {
                setIsModalOpen(false);
                setSelectedFile(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              leftIcon={<CheckIcon width="16" height="16" />}
              loading={uploadingPdf}
              disabled={uploadingPdf || !selectedFile || !pdfMeta.exam_body.trim() || !pdfMeta.subject_code.trim()}
            >
              {uploadingPdf ? "Parsing PDF..." : "Extract & Ingest Questions"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
