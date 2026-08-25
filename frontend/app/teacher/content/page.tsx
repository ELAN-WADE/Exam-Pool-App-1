"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { RequireRole } from "../../../components/auth/RequireRole";
import {
  PageHeader,
  Button,
  Modal,
} from "../../../components/ui";
import {
  DocumentIcon,
  CheckCircleIcon,
  BookIcon,
  SubjectIcon,
  PlusIcon,
  TrashIcon,
  EyeIcon,
  SaveIcon,
  SearchIcon,
} from "../../../components/icons/Icons";
import { api } from "../../../lib/api";
import type { ContentPackage, ContentQuestion } from "../../../lib/types";
import styles from "./page.module.css";

const OPTION_KEYS = ["A", "B", "C", "D"] as const;

export default function TeacherContentPage() {
  return (
    <RequireRole role="teacher">
      <ContentLibrary />
    </RequireRole>
  );
}

function parseOptions(options_json?: string, options?: string[]): string[] {
  if (Array.isArray(options) && options.length > 0) {
    const res = [...options];
    while (res.length < 4) res.push("");
    return res.slice(0, 4);
  }
  if (!options_json) return ["", "", "", ""];
  try {
    const parsed = JSON.parse(options_json);
    if (Array.isArray(parsed)) {
      const res = [...parsed];
      while (res.length < 4) res.push("");
      return res.slice(0, 4);
    }
  } catch {}
  return ["", "", "", ""];
}

function ContentLibrary() {
  // ── Package Roster State ─────────────────────────────────
  const [packages, setPackages] = useState<ContentPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [bodyFilter, setBodyFilter] = useState("ALL");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Package Editor & Review State ────────────────────────
  const [selectedPackage, setSelectedPackage] = useState<ContentPackage | null>(null);
  const [questions, setQuestions] = useState<ContentQuestion[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [previewMode, setPreviewMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Active Question Edit State
  const [stemText, setStemText] = useState("");
  const [options, setOptions] = useState<string[]>(["", "", "", ""]);
  const [correctAnswer, setCorrectAnswer] = useState("A");
  const [solutionText, setSolutionText] = useState("");
  const [topicTag, setTopicTag] = useState("");
  const [difficulty, setDifficulty] = useState(3);

  // Modal State
  const [deleteModal, setDeleteModal] = useState<{
    open: boolean;
    type: "package" | "question";
    id: any;
    name: string;
  }>({ open: false, type: "question", id: null, name: "" });

  const [pdfMeta, setPdfMeta] = useState({
    exam_body: "JAMB",
    year: new Date().getFullYear(),
    subject_code: "",
    paper_type: "objective",
  });

  const showToast = useCallback((type: "success" | "error", text: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ type, text });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  const loadPackages = useCallback(async (signal?: AbortSignal) => {
    try {
      if (!signal?.aborted) setLoading(true);
      const data = await api.getContentManifest();
      if (signal?.aborted) return;
      setPackages(data?.packages || []);
    } catch (err: any) {
      if (!signal?.aborted) {
        setError(err.message || "Failed to load packages");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadPackages(controller.signal);
    return () => controller.abort();
  }, [loadPackages]);

  // Load questions for a selected package
  const openPackage = useCallback(
    async (pkg: ContentPackage) => {
      setSelectedPackage(pkg);
      setLoadingQuestions(true);
      setActiveIdx(0);
      setPreviewMode(false);
      try {
        const pkgId = String(pkg.id);
        const data = await api.getPackageQuestions(pkgId);
        const qList = data?.questions || [];
        setQuestions(qList);
        if (qList.length > 0) {
          const q0 = qList[0];
          setStemText(q0.question_text || "");
          setOptions(parseOptions(q0.options_json, q0.options));
          setCorrectAnswer(String(q0.correct_answer || "A").toUpperCase());
          setSolutionText(q0.solution_text || "");
          setTopicTag(q0.topic_tag || "");
          setDifficulty(Number(q0.difficulty) || 3);
        }
      } catch (err: any) {
        showToast("error", err.message || "Failed to load questions for this package.");
      } finally {
        setLoadingQuestions(false);
      }
    },
    [showToast]
  );

  // Sync form inputs when switching active question index
  const selectQuestionIndex = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= questions.length) return;
      setActiveIdx(idx);
      const q = questions[idx];
      setStemText(q.question_text || "");
      setOptions(parseOptions(q.options_json, q.options));
      setCorrectAnswer(String(q.correct_answer || "A").toUpperCase());
      setSolutionText(q.solution_text || "");
      setTopicTag(q.topic_tag || "");
      setDifficulty(Number(q.difficulty) || 3);
    },
    [questions]
  );

  // Save current question changes
  const handleSaveCurrentQuestion = async (jumpNext = false) => {
    if (!questions[activeIdx]) return;
    const currentQ = questions[activeIdx];
    if (!stemText.trim()) {
      showToast("error", "Question text cannot be empty.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        question_text: stemText.trim(),
        options,
        correct_answer: correctAnswer,
        solution_text: solutionText.trim() || null,
        difficulty,
        topic_tag: topicTag.trim() || null,
      };

      await api.updateContentQuestion(currentQ.id, payload);
      const nextQuestions = [...questions];
      nextQuestions[activeIdx] = {
        ...currentQ,
        ...payload,
        options_json: JSON.stringify(options),
      };
      setQuestions(nextQuestions);
      showToast("success", `Saved Question ${activeIdx + 1}`);

      if (jumpNext && activeIdx < questions.length - 1) {
        selectQuestionIndex(activeIdx + 1);
      }
    } catch (err: any) {
      showToast("error", err.message || "Failed to save question.");
    } finally {
      setSaving(false);
    }
  };

  // Add new question to the package
  const handleAddQuestion = async () => {
    if (!selectedPackage) return;
    setSaving(true);
    try {
      const parts = String(selectedPackage.id).split("_");
      const exam_body = parts[0] || selectedPackage.exam_body || "JAMB";
      const year = parseInt(parts[1] || String(selectedPackage.year || 2024), 10);
      const subject_code = parts.slice(2).join("_") || selectedPackage.subject_code || selectedPackage.subject || "GEN";

      const payload = {
        exam_body,
        year,
        subject_code,
        paper_type: selectedPackage.paper_type || "objective",
        question_text: `New Question ${questions.length + 1}`,
        options: ["Option A", "Option B", "Option C", "Option D"],
        correct_answer: "A",
        solution_text: "",
        difficulty: 3,
        topic_tag: "",
      };

      const created = await api.createContentQuestion(payload);
      const updatedList = [...questions, created];
      setQuestions(updatedList);
      showToast("success", "Added new question.");
      selectQuestionIndex(updatedList.length - 1);
      await loadPackages();
    } catch (err: any) {
      showToast("error", err.message || "Failed to add question.");
    } finally {
      setSaving(false);
    }
  };

  // Delete question
  const handleDeleteQuestionConfirm = async () => {
    const qId = deleteModal.id;
    if (!qId) return;
    try {
      await api.deleteContentQuestion(qId);
      const updatedList = questions.filter((q) => q.id !== qId);
      setQuestions(updatedList);
      showToast("success", "Question deleted.");
      setDeleteModal({ open: false, type: "question", id: null, name: "" });
      if (activeIdx >= updatedList.length) {
        selectQuestionIndex(Math.max(0, updatedList.length - 1));
      } else {
        selectQuestionIndex(activeIdx);
      }
      await loadPackages();
    } catch (err: any) {
      showToast("error", err.message || "Failed to delete question.");
    }
  };

  // Delete entire package
  const handleDeletePackageConfirm = async () => {
    const pkgId = deleteModal.id;
    if (!pkgId) return;
    try {
      await api.deleteContentPackage(pkgId);
      showToast("success", "Package deleted successfully.");
      setDeleteModal({ open: false, type: "package", id: null, name: "" });
      setSelectedPackage(null);
      await loadPackages();
    } catch (err: any) {
      showToast("error", err.message || "Failed to delete package.");
    }
  };

  // Handle PDF past question ingestion
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

      const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
      const res = await fetch(`${API_BASE}/api/content/pdf-upload`, {
        method: "POST",
        credentials: "include",
        body: formData,
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

  // Filtered packages
  const filteredPackages = useMemo(() => {
    return packages.filter((pkg) => {
      const matchesSearch =
        searchQuery === "" ||
        String(pkg.name || pkg.id || "")
          .toLowerCase()
          .includes(searchQuery.toLowerCase()) ||
        String(pkg.subject_code || pkg.subject || "")
          .toLowerCase()
          .includes(searchQuery.toLowerCase()) ||
        String(pkg.exam_body || "")
          .toLowerCase()
          .includes(searchQuery.toLowerCase());

      const matchesBody =
        bodyFilter === "ALL" ||
        (pkg.exam_body && pkg.exam_body.toUpperCase() === bodyFilter.toUpperCase());

      return matchesSearch && matchesBody;
    });
  }, [packages, searchQuery, bodyFilter]);

  // Current active question
  const currentQuestion = questions[activeIdx] || null;

  // ─────────────────────────────────────────────────────────
  // VIEW: EMBEDDED PACKAGE EDITOR & REVIEW STUDIO
  // ─────────────────────────────────────────────────────────
  if (selectedPackage) {
    const pkgTitle = `${selectedPackage.exam_body || "EXAM"} ${selectedPackage.year || ""} — ${selectedPackage.subject_code || selectedPackage.subject || "Subject"}`;

    return (
      <div className={styles.container}>
        {toast && <div className={styles.toast}>{toast.text}</div>}

        {/* ── Top Bar / Package Header ── */}
        <div className={styles.editorTopBar}>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <button
              type="button"
              className={styles.backBtn}
              onClick={() => setSelectedPackage(null)}
            >
              ← Back to Content Library
            </button>
            <div className={styles.editorPackageInfo}>
              <div className={styles.editorPackageTitle}>{pkgTitle}</div>
              <div className={styles.editorPackageSub}>
                <span className={`${styles.examBadge} ${styles[`badge${selectedPackage.exam_body}`] || styles.badgeCUSTOM}`}>
                  {selectedPackage.exam_body || "CUSTOM"}
                </span>
                <span>• {questions.length} Questions</span>
                <span>• Paper: {selectedPackage.paper_type || "Objective"}</span>
              </div>
            </div>
          </div>

          <div className={styles.editorActions}>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<EyeIcon width="14" height="14" />}
              onClick={() => setPreviewMode(!previewMode)}
            >
              {previewMode ? "Editor Mode" : "Student CBT Preview"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<PlusIcon width="14" height="14" />}
              onClick={handleAddQuestion}
              loading={saving}
            >
              Add Question
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<TrashIcon width="14" height="14" />}
              onClick={() =>
                setDeleteModal({
                  open: true,
                  type: "package",
                  id: selectedPackage.id,
                  name: pkgTitle,
                })
              }
            >
              Delete Package
            </Button>
          </div>
        </div>

        {loadingQuestions ? (
          <div className="loadingWrap">
            <div className="spinner" />
          </div>
        ) : questions.length === 0 ? (
          <div className={styles.ingestionCard} style={{ textAlign: "center", padding: "3rem" }}>
            <DocumentIcon width="40" height="40" style={{ color: "var(--color-muted)", margin: "0 auto" }} />
            <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--color-text)", marginTop: "0.5rem" }}>
              No Questions in this Package
            </div>
            <div style={{ fontSize: "0.8125rem", color: "var(--color-muted)", marginTop: "0.25rem" }}>
              Get started by adding questions or re-importing past question materials.
            </div>
            <div style={{ marginTop: "1rem" }}>
              <Button variant="primary" size="sm" onClick={handleAddQuestion}>
                Add First Question
              </Button>
            </div>
          </div>
        ) : (
          <div className={styles.editorWorkspace}>
            {/* ── Interactive Question Pill Navigator Strip ── */}
            <div className={styles.navigatorCard}>
              <span className={styles.navigatorLabel}>Question Navigator:</span>
              <div className={styles.pillsScrollArea}>
                {questions.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`${styles.questionPill} ${activeIdx === i ? styles.questionPillActive : ""}`}
                    onClick={() => selectQuestionIndex(i)}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Main Question Editor Studio ── */}
            {!previewMode ? (
              <div className={styles.editorCard}>
                <div className={styles.editorHeaderRow}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span className={styles.itemNumberBadge}>Item {activeIdx + 1} of {questions.length}</span>
                    <span style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>
                      Type: {selectedPackage.paper_type || "Objective MCQ"}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    leftIcon={<TrashIcon width="12" height="12" />}
                    onClick={() =>
                      setDeleteModal({
                        open: true,
                        type: "question",
                        id: currentQuestion?.id,
                        name: `Question ${activeIdx + 1}`,
                      })
                    }
                  >
                    Delete Item
                  </Button>
                </div>

                {/* Question Stem */}
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Question Text / Stem *</label>
                  <textarea
                    rows={4}
                    className={styles.richTextarea}
                    placeholder="Type the past question stem clearly…"
                    value={stemText}
                    onChange={(e) => setStemText(e.target.value)}
                  />
                  <div className={styles.charCount}>{stemText.length} characters</div>
                </div>

                {/* Options (A, B, C, D) with Correct Answer Selector */}
                <div className={styles.optionsSection}>
                  <div className={styles.optionsSectionTitle}>
                    <span>Multiple Choice Options</span>
                    <span style={{ fontSize: "0.75rem", color: "var(--color-muted)", fontWeight: 400 }}>
                      Select the green badge on the correct answer
                    </span>
                  </div>

                  <div className={styles.optionsList}>
                    {options.map((opt, optIdx) => {
                      const letter = OPTION_KEYS[optIdx];
                      const isCorrect = correctAnswer === letter || correctAnswer === String(optIdx);
                      return (
                        <div
                          key={letter}
                          className={`${styles.optionRow} ${isCorrect ? styles.optionRowCorrect : ""}`}
                        >
                          <div
                            className={`${styles.optionLetterBadge} ${isCorrect ? styles.optionLetterBadgeCorrect : ""}`}
                          >
                            {letter}
                          </div>
                          <input
                            type="text"
                            className={styles.optionTextInput}
                            placeholder={`Option ${letter} text…`}
                            value={opt}
                            onChange={(e) => {
                              const next = [...options];
                              next[optIdx] = e.target.value;
                              setOptions(next);
                            }}
                          />
                          <button
                            type="button"
                            className={`${styles.correctToggleBtn} ${isCorrect ? styles.correctToggleBtnActive : ""}`}
                            onClick={() => setCorrectAnswer(letter)}
                          >
                            {isCorrect ? "✓ Correct Answer" : "Set Correct"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Solution / Explanation */}
                <div className={styles.solutionContainer}>
                  <div className={styles.solutionHeader}>
                    <span className={styles.solutionTitle}>Teacher Solution & Step-by-Step Explanation</span>
                    <span className={styles.privateBadge}>Internal Solution · Hidden During Exams</span>
                  </div>
                  <textarea
                    rows={3}
                    className={styles.solutionTextarea}
                    placeholder="Provide the derivation, formula, or rationale for this solution…"
                    value={solutionText}
                    onChange={(e) => setSolutionText(e.target.value)}
                  />
                </div>

                {/* Metadata Row */}
                <div className={styles.metaGrid}>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Syllabus Topic / Tag</label>
                    <input
                      type="text"
                      className={styles.formInput}
                      placeholder="e.g. Calculus, Mechanics, Lexis"
                      value={topicTag}
                      onChange={(e) => setTopicTag(e.target.value)}
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Difficulty Rating</label>
                    <select
                      className={styles.formSelect}
                      value={difficulty}
                      onChange={(e) => setDifficulty(Number(e.target.value) || 3)}
                    >
                      <option value={1}>Level 1 — Beginner / Recall</option>
                      <option value={2}>Level 2 — Basic Application</option>
                      <option value={3}>Level 3 — Standard Intermediate</option>
                      <option value={4}>Level 4 — Advanced Problem</option>
                      <option value={5}>Level 5 — Mastery Challenge</option>
                    </select>
                  </div>
                </div>

                {/* Footer Navigation & Save Actions */}
                <div className={styles.editorFooter}>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={activeIdx === 0}
                      onClick={() => selectQuestionIndex(activeIdx - 1)}
                    >
                      ← Previous
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={activeIdx === questions.length - 1}
                      onClick={() => selectQuestionIndex(activeIdx + 1)}
                    >
                      Next →
                    </Button>
                  </div>

                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      loading={saving}
                      leftIcon={<SaveIcon width="13" height="13" />}
                      onClick={() => handleSaveCurrentQuestion(false)}
                    >
                      Save Changes
                    </Button>
                    {activeIdx < questions.length - 1 && (
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        loading={saving}
                        onClick={() => handleSaveCurrentQuestion(true)}
                      >
                        Save & Next →
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              /* ── Student CBT Preview Mode ── */
              <div className={styles.previewContainer}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--color-primary)" }}>
                    Student CBT Examination Preview — Question {activeIdx + 1}
                  </div>
                  <Button variant="secondary" size="xs" onClick={() => setPreviewMode(false)}>
                    Exit Preview
                  </Button>
                </div>

                <div className={styles.previewStem}>{stemText || "No question stem provided."}</div>

                <div className={styles.previewOptionsGrid}>
                  {options.map((opt, idx) => (
                    <div key={idx} className={styles.previewOptionItem}>
                      <span style={{ fontWeight: 700, color: "var(--color-primary)", minWidth: "20px" }}>
                        {OPTION_KEYS[idx]}.
                      </span>
                      <span>{opt || "—"}</span>
                    </div>
                  ))}
                </div>

                <div className={styles.previewNotice}>
                  <strong>Candidate View:</strong> Options are presented cleanly with radio choices. Internal solutions and marking rationales are hidden from test-takers.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Delete Confirmation Modal */}
        <Modal
          open={deleteModal.open}
          onClose={() => setDeleteModal({ open: false, type: "question", id: null, name: "" })}
          size="sm"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--color-text)" }}>
              Delete {deleteModal.type === "package" ? "Question Package" : "Question Item"}?
            </div>
            <div style={{ fontSize: "0.8125rem", color: "var(--color-muted)" }}>
              Are you sure you want to delete <strong>{deleteModal.name}</strong>? This action cannot be undone.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", paddingTop: "0.75rem", borderTop: "1px solid var(--color-border)" }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setDeleteModal({ open: false, type: "question", id: null, name: "" })}
              >
                Cancel
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={deleteModal.type === "package" ? handleDeletePackageConfirm : handleDeleteQuestionConfirm}
              >
                Delete
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────
  // VIEW: CONTENT LIBRARY PACKAGE ROSTER & INGESTION
  // ─────────────────────────────────────────────────────────
  return (
    <div className={styles.container}>
      {toast && <div className={styles.toast}>{toast.text}</div>}

      {/* ── Page Header ───────────────────────────────────── */}
      <PageHeader
        eyebrow="Assessment Ingestion & Item Repositories"
        title="Content Library & Question Packages"
        subtitle="Import standard past question documents, edit individual questions, and review item packages."
      />

      {error && (
        <div style={{ padding: "0.875rem 1rem", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: "8px", color: "var(--color-danger, #DC2626)", fontSize: "0.8125rem" }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ padding: "0.875rem 1rem", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: "8px", color: "var(--color-text, #0F172A)", fontSize: "0.8125rem", fontWeight: 600 }}>
          ✓ {success}
        </div>
      )}

      {/* ── Minimalist KPI Metrics Row ──────────────────────── */}
      <section className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Available Packages</span>
            <div className={styles.statIcon} style={{ color: "#06B6D4" }}><BookIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{packages.length}</div>
            <div className={styles.statFootnote}>Installed exam packages</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Ingestion Engine</span>
            <div className={styles.statIcon} style={{ color: "#10B981" }}><CheckCircleIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue} style={{ fontSize: "1.125rem" }}>
              OCR / Auto-Extract
            </div>
            <div className={styles.statFootnote}>PDF to Question Item</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Target Standards</span>
            <div className={styles.statIcon} style={{ color: "#6366F1" }}><SubjectIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue} style={{ fontSize: "1.125rem" }}>
              JAMB · WAEC · NECO
            </div>
            <div className={styles.statFootnote}>National syllabi</div>
          </div>
        </div>
      </section>

      {/* ── PDF Ingestion Workspace ───────────────────────────── */}
      <section className={styles.ingestionCard}>
        <div>
          <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--color-text)" }}>
            Import Past Question PDF (Auto-Parser)
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", marginTop: "0.15rem" }}>
            Upload a past question paper PDF. The system automatically parses stems and options into a manageable question package.
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Exam Body</label>
            <select
              className={styles.formSelect}
              value={pdfMeta.exam_body}
              onChange={(e) => setPdfMeta({ ...pdfMeta, exam_body: e.target.value })}
            >
              <option value="JAMB">JAMB (UTME)</option>
              <option value="WAEC">WAEC (SSCE)</option>
              <option value="NECO">NECO</option>
              <option value="NABTEB">NABTEB</option>
            </select>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Subject Code *</label>
            <input
              type="text"
              className={styles.formInput}
              placeholder="e.g. MTH, ENG, PHY"
              value={pdfMeta.subject_code}
              onChange={(e) => setPdfMeta({ ...pdfMeta, subject_code: e.target.value.toUpperCase() })}
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Examination Year</label>
            <input
              type="number"
              className={styles.formInput}
              value={pdfMeta.year}
              onChange={(e) => setPdfMeta({ ...pdfMeta, year: parseInt(e.target.value) || 2024 })}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Paper Type</label>
            <select
              className={styles.formSelect}
              value={pdfMeta.paper_type}
              onChange={(e) => setPdfMeta({ ...pdfMeta, paper_type: e.target.value })}
            >
              <option value="objective">Multiple Choice (Objective)</option>
              <option value="theory">Essay / Theory</option>
            </select>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          style={{ display: "none" }}
          onChange={handlePdfUpload}
        />

        <div
          className={styles.dropZone}
          onClick={() => !uploadingPdf && fileInputRef.current?.click()}
        >
          <DocumentIcon width="32" height="32" style={{ color: "var(--color-muted)" }} />
          <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text)" }}>
            {uploadingPdf ? "Parsing & Ingesting PDF…" : "Click to select PDF past question document"}
          </div>
          <div style={{ fontSize: "0.6875rem", color: "var(--color-muted)" }}>
            Standard layout PDF · Max 25 MB
          </div>
        </div>
      </section>

      {/* ── Installed Packages Roster ──────────────────────────── */}
      <section style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div className={styles.packagesHeader}>
          <div>
            <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--color-text)" }}>
              Installed Examination Packages
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>
              Click on any package card to view, edit, and review its questions.
            </div>
          </div>

          <div className={styles.searchFilterRow}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search packages…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <select
              className={styles.formSelect}
              style={{ width: "auto", padding: "0.4rem 0.65rem", fontSize: "0.75rem" }}
              value={bodyFilter}
              onChange={(e) => setBodyFilter(e.target.value)}
            >
              <option value="ALL">All Exam Bodies</option>
              <option value="JAMB">JAMB</option>
              <option value="WAEC">WAEC</option>
              <option value="NECO">NECO</option>
              <option value="NABTEB">NABTEB</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="loadingWrap">
            <div className="spinner" />
          </div>
        ) : filteredPackages.length === 0 ? (
          <div className={styles.ingestionCard} style={{ textAlign: "center", padding: "2.5rem" }}>
            <DocumentIcon width="36" height="36" style={{ color: "var(--color-muted)", margin: "0 auto" }} />
            <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--color-text)", marginTop: "0.5rem" }}>
              No Packages Found
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>
              Upload past question PDFs above to populate your content library.
            </div>
          </div>
        ) : (
          <div className={styles.packagesGrid}>
            {filteredPackages.map((pkg, idx) => {
              const body = pkg.exam_body || "JAMB";
              const title = `${body} ${pkg.year || ""} · ${pkg.subject_code || pkg.subject || "Subject"}`;
              const count = pkg.content_count ?? pkg.question_count ?? 0;

              return (
                <div
                  key={pkg.id || idx}
                  className={styles.packageCard}
                  onClick={() => openPackage(pkg)}
                >
                  <div className={styles.packageCardHeader}>
                    <span className={`${styles.examBadge} ${styles[`badge${body}`] || styles.badgeCUSTOM}`}>
                      {body}
                    </span>
                    <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--color-primary)" }}>
                      {count} {count === 1 ? "Item" : "Items"}
                    </span>
                  </div>

                  <div>
                    <div className={styles.packageCardTitle}>{title}</div>
                    <div className={styles.packageCardMeta} style={{ marginTop: "0.25rem" }}>
                      <span>Year {pkg.year || "—"}</span>
                      <span>•</span>
                      <span>Code: {pkg.subject_code || pkg.subject || "—"}</span>
                    </div>
                  </div>

                  <div className={styles.packageCardFooter}>
                    <button type="button" className={styles.openBtn}>
                      Open & Edit Questions →
                    </button>
                    <button
                      type="button"
                      className={styles.deleteIconBtn}
                      title="Delete package"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteModal({
                          open: true,
                          type: "package",
                          id: pkg.id,
                          name: title,
                        });
                      }}
                    >
                      <TrashIcon width="14" height="14" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, type: "package", id: null, name: "" })}
        size="sm"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--color-text)" }}>
            Delete {deleteModal.type === "package" ? "Question Package" : "Question Item"}?
          </div>
          <div style={{ fontSize: "0.8125rem", color: "var(--color-muted)" }}>
            Are you sure you want to delete <strong>{deleteModal.name}</strong>? This will remove the package and all its questions.
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", paddingTop: "0.75rem", borderTop: "1px solid var(--color-border)" }}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDeleteModal({ open: false, type: "package", id: null, name: "" })}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDeletePackageConfirm}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

