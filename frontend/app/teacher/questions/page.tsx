"use client";

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useAcademic } from "../../../components/context/AcademicContext";
import { api } from "../../../lib/api";
import dynamic from "next/dynamic";
const Modal = dynamic(() => import("../../../components/ui/Modal").then((mod) => mod.Modal), { ssr: false });
import {
  PageHeader,
  Button,
} from "../../../components/ui";
import {
  SettingsIcon,
  PlusIcon,
  TrashIcon,
  EditIcon,
  CheckCircleIcon,
  DocumentIcon,
  LockIcon,
  ClockIcon,
  BookIcon,
} from "../../../components/icons/Icons";
import { BulkUploadModal } from "../../../components/teacher/BulkUploadModal";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import styles from "./page.module.css";

export default function TeacherQuestionsPage() {
  return (
    <RequireRole role="teacher">
      <Suspense fallback={<div className="loadingWrap"><div className="spinner" /></div>}>
        <QuestionsContent />
      </Suspense>
    </RequireRole>
  );
}

function parseOptions(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : ["", "", "", ""];
  } catch {
    return ["", "", "", ""];
  }
}

const OPTION_LABELS = ["A", "B", "C", "D"];
type EditorMode = "list" | "create" | "edit";
type ImageInputMode = "url" | "upload";

function QuestionsContent() {
  const searchParams = useSearchParams();
  const subjectId = Number(searchParams.get("subjectId") || 0);

  const [subjects, setSubjects] = useState<any[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const { selectedSession, selectedTerm } = useAcademic();
  const [loading, setLoading] = useState(true);
  const [questionsReady, setQuestionsReady] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editorMode, setEditorMode] = useState<EditorMode>("list");
  const [editSubjectOpen, setEditSubjectOpen] = useState(false);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const actionHandled = useRef(false);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    message: string;
    variant: "danger" | "primary";
    loading: boolean;
  }>({ open: false, title: "", message: "", variant: "danger", loading: false });
  const confirmActionRef = useRef<(() => Promise<void>) | null>(null);

  // Editor form fields
  const [questionText, setQuestionText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageMode, setImageMode] = useState<ImageInputMode>("url");
  const [isDragging, setIsDragging] = useState(false);
  const [questionType, setQuestionType] = useState("objective");
  const [teacherAnswer, setTeacherAnswer] = useState("");
  const [explanation, setExplanation] = useState("");
  const [solution, setSolution] = useState("");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [correctAnswer, setCorrectAnswer] = useState(0);
  const [marks, setMarks] = useState(1);
  const [isFileUpload, setIsFileUpload] = useState(false);
  const [attachedFileUrl, setAttachedFileUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  const [subjDatetime, setSubjDatetime] = useState("");
  const [subjDuration, setSubjDuration] = useState(60);
  const [subjInstructions, setSubjInstructions] = useState("");
  const [subjCanRetake, setSubjCanRetake] = useState(true);
  const [subjResultPolicy, setSubjResultPolicy] = useState("immediate");
  const [subjReleaseTime, setSubjReleaseTime] = useState("");

  const subject = useMemo(() => subjects.find((s) => Number(s.id) === subjectId), [subjects, subjectId]);
  const isLocked = Boolean(subject?.is_published);

  const showToast = useCallback((type: "success" | "error", text: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ type, text });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  const loadSubjects = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const data = (await api.getSubjects(selectedSession?.id, selectedTerm?.id)) as any[];
        if (signal?.aborted) return;
        setSubjects(data ?? []);
      } catch (err) {
        if (signal?.aborted) return;
        setError(err instanceof Error ? err.message : "Failed loading subjects");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [selectedSession?.id, selectedTerm?.id]
  );

  const loadQuestions = useCallback(
    async (signal?: AbortSignal) => {
      if (!subjectId) return;
      try {
        const data = (await api.getQuestions(subjectId)) as any[];
        if (signal?.aborted) return;
        setQuestions(data ?? []);
      } catch (err) {
        if (signal?.aborted) return;
        setError(err instanceof Error ? err.message : "Failed loading questions");
      } finally {
        if (!signal?.aborted) setQuestionsReady(true);
      }
    },
    [subjectId]
  );

  useEffect(() => {
    const controller = new AbortController();
    loadSubjects(controller.signal);
    return () => controller.abort();
  }, [loadSubjects]);

  useEffect(() => {
    if (!subjectId) return;
    const controller = new AbortController();
    loadQuestions(controller.signal);
    return () => controller.abort();
  }, [subjectId, loadQuestions]);

  useEffect(() => {
    if (actionHandled.current || !subjectId) return;
    const action = searchParams.get("action");
    if (action === "create") {
      actionHandled.current = true;
      resetForm();
      setEditorMode("create");
    }
  }, [searchParams, subjectId]);

  function resetForm() {
    setEditing(null);
    setQuestionText("");
    setImageUrl("");
    setImageMode("url");
    setQuestionType("objective");
    setTeacherAnswer("");
    setExplanation("");
    setSolution("");
    setOptions(["", "", "", ""]);
    setCorrectAnswer(0);
    setMarks(1);
    setIsFileUpload(false);
    setAttachedFileUrl("");
  }

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith("image/")) {
      showToast("error", "Please select an image file (JPG, PNG, GIF, WebP).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast("error", "Image must be smaller than 5MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setImageUrl(result);
    };
    reader.readAsDataURL(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleDocFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        showToast("error", "Document must be smaller than 10MB");
        return;
      }
      try {
        setSaving(true);
        const { url } = await api.uploadFile(file);
        setAttachedFileUrl(url);
        showToast("success", "Document attached.");
      } catch {
        showToast("error", "Failed to upload document");
      } finally {
        setSaving(false);
      }
    }
  };

  const openCreate = () => {
    if (isLocked) return;
    resetForm();
    setEditorMode("create");
  };

  const openEdit = (q: any) => {
    if (isLocked) return;
    setEditing(q);
    setQuestionText(q.question_text ?? "");
    setImageUrl(q.image_url ?? "");
    setImageMode(q.image_url?.startsWith("data:") ? "upload" : "url");
    setQuestionType(q.question_type ?? "objective");
    setTeacherAnswer(q.teacher_answer ?? "");
    setExplanation(q.explanation ?? "");
    setSolution(q.solution ?? "");
    setOptions(parseOptions(q.options_json));
    setCorrectAnswer(Number(q.correct_answer ?? 0));
    setMarks(Number(q.marks ?? 1));
    setIsFileUpload(q.is_file_upload === 1);
    setAttachedFileUrl(q.attached_file_url ?? "");
    setEditorMode("edit");
  };

  const openEditSubject = () => {
    if (isLocked || !subject) return;
    setSubjDatetime(subject.exam_datetime ? new Date(subject.exam_datetime).toISOString().slice(0, 16) : "");
    setSubjDuration(subject.duration ?? 60);
    setSubjInstructions(subject.instructions ?? "");
    setSubjCanRetake(subject.can_retake !== 0);
    setSubjResultPolicy(subject.result_policy || "immediate");
    setSubjReleaseTime(subject.result_release_time ? new Date(subject.result_release_time).toISOString().slice(0, 16) : "");
    setEditSubjectOpen(true);
  };

  const onSubmitSubject = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateSubject(subjectId, {
        exam_datetime: new Date(subjDatetime).toISOString(),
        duration: Number(subjDuration),
        instructions: subjInstructions,
        can_retake: subjCanRetake ? 1 : 0,
        result_policy: subjResultPolicy,
        result_release_time: subjResultPolicy === "scheduled" && subjReleaseTime ? new Date(subjReleaseTime).toISOString() : null,
      });
      showToast("success", "Subject settings saved.");
      setEditSubjectOpen(false);
      await loadSubjects();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  const onPublishSubject = async () => {
    confirmActionRef.current = async () => {
      setConfirmState((prev) => ({ ...prev, loading: true }));
      try {
        await api.updateSubject(subjectId, { is_published: 1 });
        showToast("success", "Subject marked as ready!");
        await loadSubjects();
      } catch (err) {
        showToast("error", err instanceof Error ? err.message : "Failed to publish.");
      } finally {
        setConfirmState({ open: false, title: "", message: "", variant: "danger", loading: false });
        confirmActionRef.current = null;
      }
    };
    setConfirmState({
      open: true,
      title: "Mark Subject as Ready?",
      message: "Are you sure you have finished setting all questions? This will lock the assessment from further editing and notify the administrator.",
      variant: "primary",
      loading: false,
    });
  };

  const onSubmitQuestion = async (e: FormEvent) => {
    e.preventDefault();
    if (!questionText.trim()) {
      showToast("error", "Question text is required.");
      return;
    }
    if (questionType === "objective" && options.some((o) => !o.trim())) {
      showToast("error", "Please fill in all 4 choices for multiple choice.");
      return;
    }
    setSaving(true);
    try {
      const payloadOptions =
        questionType === "true_false" ? ["True", "False", "", ""] : questionType === "essay" ? ["", "", "", ""] : options;
      const payloadCorrect = questionType === "essay" ? 0 : correctAnswer;
      const payload = {
        question_text: questionText,
        image_url: imageUrl || null,
        question_type: questionType,
        teacher_answer: teacherAnswer,
        explanation: explanation.trim() || null,
        solution: solution.trim() || null,
        options: payloadOptions,
        correct_answer: payloadCorrect,
        marks,
        is_file_upload: isFileUpload ? 1 : 0,
        attached_file_url: attachedFileUrl || null,
      };

      if (editing) {
        await api.updateQuestion(editing.id, payload);
        showToast("success", "Question updated.");
      } else {
        await api.createQuestion({ subject_id: subjectId, order_index: questions.length, ...payload });
        showToast("success", "Question created!");
      }
      await loadQuestions();
      resetForm();
      setEditorMode("list");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to save question.");
    } finally {
      setSaving(false);
    }
  };

  const onDeleteQuestion = async (q: any) => {
    try {
      await api.deleteQuestion(q.id);
      showToast("success", "Question deleted.");
      setDeleting(null);
      if (editorMode === "edit") setEditorMode("list");
      await loadQuestions();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to delete question.");
    }
  };

  // Assessment Total Marks computation
  const totalScore = useMemo(() => {
    return questions.reduce((acc, q) => acc + (Number(q.marks) || 1), 0);
  }, [questions]);

  if (loading) return <div className="loadingWrap"><div className="spinner" /></div>;

  if (!subjectId) {
    return (
      <div className={styles.emptyState}>
        <LockIcon width="36" height="36" style={{ color: "var(--color-muted)" }} />
        <div className={styles.emptyTitle}>No Subject Selected</div>
        <div className={styles.emptySubtitle}>
          Select a subject from your faculty dashboard to view or author examination questions.
        </div>
        <Link href="/teacher/dashboard" style={{ marginTop: "0.5rem" }}>
          <Button variant="primary" size="sm">
            Back to Dashboard
          </Button>
        </Link>
      </div>
    );
  }

  // ── FULL-PAGE AUTHORING STUDIO ──────────────────────────────────
  if (editorMode === "create" || editorMode === "edit") {
    return (
      <div className={styles.container}>
        {toast && <div className={styles.toast}>{toast.text}</div>}

        <PageHeader
          eyebrow={subject?.name || "Subject Item Bank"}
          title={editorMode === "edit" ? "Edit Question" : "Author New Question"}
          subtitle="Craft questions, attach diagrams, and define model answers or marking rubrics."
          actions={
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  resetForm();
                  setEditorMode("list");
                }}
              >
                Back to Item List
              </Button>
              {editorMode === "edit" && !isLocked && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setDeleting(editing)}
                >
                  Delete Item
                </Button>
              )}
            </div>
          }
        />

        <div className={styles.editorContainer}>
          {/* Main Question Stem Editor */}
          <div className={styles.editorMain}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Question Text / Stem *</label>
              <textarea
                className={styles.richTextarea}
                placeholder="Type the question stem clearly. Ensure unambiguous phrasing for candidates…"
                value={questionText}
                onChange={(e) => setQuestionText(e.target.value)}
                autoFocus
              />
              <div style={{ fontSize: "0.6875rem", color: "var(--color-muted)", alignSelf: "flex-end" }}>
                {questionText.length} characters
              </div>
            </div>

            {/* Image / Diagram Attachment */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Diagram / Illustration (Optional)</label>
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                <button
                  type="button"
                  onClick={() => setImageMode("url")}
                  style={{
                    padding: "0.25rem 0.65rem",
                    borderRadius: "4px",
                    border: "1px solid var(--color-border)",
                    background: imageMode === "url" ? "var(--color-surface-2)" : "#FFFFFF",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Image URL
                </button>
                <button
                  type="button"
                  onClick={() => setImageMode("upload")}
                  style={{
                    padding: "0.25rem 0.65rem",
                    borderRadius: "4px",
                    border: "1px solid var(--color-border)",
                    background: imageMode === "upload" ? "var(--color-surface-2)" : "#FFFFFF",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Upload from Device
                </button>
              </div>

              {imageMode === "url" && (
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    type="url"
                    className={styles.formInput}
                    placeholder="https://example.com/diagram.png"
                    value={imageUrl.startsWith("data:") ? "" : imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                  />
                  {imageUrl && (
                    <Button variant="secondary" size="xs" onClick={() => setImageUrl("")}>
                      Clear
                    </Button>
                  )}
                </div>
              )}

              {imageMode === "upload" && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileInputChange}
                    style={{ display: "none" }}
                  />
                  <div
                    className={styles.dropZone}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                  >
                    <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--color-text)" }}>
                      {imageUrl?.startsWith("data:") ? "Image loaded — click to replace" : "Click to browse image or drag and drop"}
                    </div>
                    <div style={{ fontSize: "0.6875rem", color: "var(--color-muted)" }}>PNG, JPG, WebP · Max 5MB</div>
                  </div>
                  {imageUrl?.startsWith("data:") && (
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => setImageUrl("")}
                      style={{ alignSelf: "flex-start", marginTop: "0.35rem" }}
                    >
                      Remove Image
                    </Button>
                  )}
                </>
              )}

              {imageUrl && (
                <div style={{ marginTop: "0.75rem" }}>
                  <img
                    src={imageUrl}
                    alt="Question Diagram"
                    className={styles.qImage}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Right Parameters Sidebar */}
          <aside className={styles.editorSidebar}>
            <div className={styles.sidebarHeader}>Item Configuration</div>
            <form onSubmit={onSubmitQuestion} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Question Type</label>
                <select
                  className={styles.formSelect}
                  value={questionType}
                  onChange={(e) => setQuestionType(e.target.value)}
                >
                  <option value="objective">Multiple Choice (MCQ)</option>
                  <option value="true_false">True / False</option>
                  <option value="essay">Essay / Free Response</option>
                </select>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Score / Marks</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  className={styles.formInput}
                  value={marks}
                  onChange={(e) => setMarks(Number(e.target.value))}
                  required
                />
              </div>

              {/* MCQ Choices */}
              {questionType === "objective" && (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Answer Choices (Click Letter to Set Correct)</label>
                  {options.map((o, i) => (
                    <div key={i} className={styles.optionRow}>
                      <button
                        type="button"
                        className={`${styles.optionRadioBtn} ${correctAnswer === i ? styles.optionRadioBtnActive : ""}`}
                        onClick={() => setCorrectAnswer(i)}
                        title="Mark as correct answer"
                      >
                        {OPTION_LABELS[i]}
                      </button>
                      <input
                        className={styles.formInput}
                        value={o}
                        onChange={(e) => {
                          const n = [...options];
                          n[i] = e.target.value;
                          setOptions(n);
                        }}
                        placeholder={`Option ${OPTION_LABELS[i]}`}
                        required
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* True / False */}
              {questionType === "true_false" && (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Correct Answer</label>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <Button
                      type="button"
                      variant={correctAnswer === 0 ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => setCorrectAnswer(0)}
                      style={{ flex: 1 }}
                    >
                      True
                    </Button>
                    <Button
                      type="button"
                      variant={correctAnswer === 1 ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => setCorrectAnswer(1)}
                      style={{ flex: 1 }}
                    >
                      False
                    </Button>
                  </div>
                </div>
              )}

              {/* Essay Marking Rubric */}
              {questionType === "essay" && (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Model Answer / Grading Rubric</label>
                  <textarea
                    rows={4}
                    className={styles.formInput}
                    value={teacherAnswer}
                    onChange={(e) => setTeacherAnswer(e.target.value)}
                    placeholder="Key concepts or rubrics expected in candidate answers…"
                  />
                  <label style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.75rem", marginTop: "0.35rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={isFileUpload}
                      onChange={(e) => setIsFileUpload(e.target.checked)}
                    />
                    Require candidate document upload (PDF)
                  </label>
                </div>
              )}

              {/* Concept Explanation (Concise Key) */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Concept Explanation (Concise reason for correct answer)</label>
                <textarea
                  rows={2}
                  className={styles.formInput}
                  value={explanation}
                  onChange={(e) => setExplanation(e.target.value)}
                  placeholder="e.g. Photosynthesis converts light energy into chemical energy stored in glucose."
                />
              </div>

              {/* Step-by-Step Worked Solution (For Learning Mode Reveals) */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Step-by-Step Worked Solution (For Learning Mode Reveals)</label>
                <textarea
                  rows={3}
                  className={styles.formInput}
                  value={solution}
                  onChange={(e) => setSolution(e.target.value)}
                  placeholder="Step 1: Identify given variables...&#10;Step 2: Apply formula...&#10;Step 3: Solve for unknown..."
                />
              </div>

              {/* Supplementary Document */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Attach Reading PDF (Optional)</label>
                <input
                  type="file"
                  ref={docInputRef}
                  accept=".pdf,.doc,.docx"
                  style={{ display: "none" }}
                  onChange={handleDocFileSelect}
                />
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    onClick={() => docInputRef.current?.click()}
                    disabled={saving}
                  >
                    <DocumentIcon width="13" height="13" />
                    {attachedFileUrl ? "Change Document" : "Attach PDF"}
                  </Button>
                  {attachedFileUrl && (
                    <span style={{ fontSize: "0.6875rem", color: "var(--color-text)", fontWeight: 600 }}>
                      ✓ Attached
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", paddingTop: "0.75rem", borderTop: "1px solid var(--color-border)" }}>
                <Button type="submit" variant="primary" size="sm" loading={saving}>
                  {editorMode === "edit" ? "Save Changes" : "Create Item"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    resetForm();
                    setEditorMode("list");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </aside>
        </div>

        {/* Delete Modal */}
        <Modal open={Boolean(deleting)} onClose={() => setDeleting(null)} size="sm">
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--color-text)" }}>Delete Question?</div>
            <div style={{ fontSize: "0.8125rem", color: "var(--color-muted)" }}>
              This question will be permanently removed from this subject's item pool.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", paddingTop: "0.75rem", borderTop: "1px solid var(--color-border)" }}>
              <Button variant="secondary" size="sm" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="secondary" size="sm" onClick={() => onDeleteQuestion(deleting)}>
                Delete
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    );
  }

  // ── ITEM BANK LIST VIEW ─────────────────────────────────────────
  return (
    <div className={styles.container}>
      {toast && <div className={styles.toast}>{toast.text}</div>}

      {/* ── Page Header ───────────────────────────────────── */}
      <PageHeader
        eyebrow="Assessment Item Bank"
        title={subject?.name ?? "Questions"}
        subtitle={`Subject Code: ${subject?.code || "—"} · Term: ${subject?.term || "—"}`}
        actions={
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<SettingsIcon width="13" height="13" />}
              onClick={openEditSubject}
              disabled={isLocked}
            >
              Exam Settings
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<DocumentIcon width="13" height="13" />}
              onClick={() => setBulkUploadOpen(true)}
              disabled={isLocked}
            >
              Bulk Import
            </Button>
            {!isLocked && (
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<CheckCircleIcon width="13" height="13" />}
                onClick={onPublishSubject}
              >
                Publish Exam
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              leftIcon={<PlusIcon width="13" height="13" />}
              onClick={openCreate}
              disabled={isLocked}
            >
              Add Question
            </Button>
          </div>
        }
      />

      {isLocked && (
        <div className={styles.lockedBanner}>
          <LockIcon width="16" height="16" />
          <span>
            <strong>Subject is Live / Published:</strong> Question editing is locked to preserve candidate integrity.
          </span>
        </div>
      )}

      {error && (
        <div style={{ padding: "0.875rem 1rem", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: "8px", color: "var(--color-danger, #DC2626)", fontSize: "0.8125rem" }}>
          {error}
        </div>
      )}

      {/* ── Minimalist KPI Metrics Row ──────────────────────── */}
      <section className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Configured Items</span>
            <div className={styles.statIcon} style={{ color: "#06B6D4" }}><BookIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{questions.length}</div>
            <div className={styles.statFootnote}>Questions in pool</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Maximum Score</span>
            <div className={styles.statIcon} style={{ color: "#10B981" }}><CheckCircleIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{totalScore}</div>
            <div className={styles.statFootnote}>Cumulative points</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTop}>
            <span className={styles.statLabel}>Assessment Duration</span>
            <div className={styles.statIcon} style={{ color: "#F97316" }}><ClockIcon width="15" height="15" /></div>
          </div>
          <div>
            <div className={styles.statValue}>{subject?.duration || 60}m</div>
            <div className={styles.statFootnote}>Testing time limit</div>
          </div>
        </div>
      </section>

      {/* ── Question List / Empty State ───────────────────────── */}
      {questionsReady && questions.length === 0 ? (
        <div className={styles.emptyState}>
          <DocumentIcon width="40" height="40" style={{ color: "var(--color-muted)" }} />
          <div className={styles.emptyTitle}>No Questions Configured Yet</div>
          <div className={styles.emptySubtitle}>
            Build your assessment by creating single items or importing bulk spreadsheets.
          </div>
          {!isLocked && (
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
              <Button variant="secondary" size="sm" onClick={() => setBulkUploadOpen(true)}>
                Bulk Upload
              </Button>
              <Button variant="primary" size="sm" onClick={openCreate}>
                Create First Item
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className={styles.questionList}>
          {questions.map((q: any, idx: number) => {
            const opts = parseOptions(q.options_json);
            return (
              <div key={q.id} className={styles.qCard}>
                <div className={styles.qCardBody}>
                  <div className={styles.qHeader}>
                    <span className={styles.qNumBadge}>Item {idx + 1}</span>
                    <div className={styles.qMetaGroup}>
                      <span className={styles.qTypeTag}>
                        {q.question_type === "essay" ? "Essay" : q.question_type === "true_false" ? "True/False" : "MCQ"}
                      </span>
                      <span className={styles.qMarksTag}>{q.marks} {q.marks === 1 ? "Mark" : "Marks"}</span>
                    </div>
                  </div>

                  {q.image_url && (
                    <img src={q.image_url} alt={`Diagram ${idx + 1}`} className={styles.qImage} />
                  )}

                  <p className={styles.qText}>{q.question_text}</p>

                  {q.question_type !== "essay" ? (
                    <div className={styles.optionsGrid}>
                      {opts.slice(0, q.question_type === "true_false" ? 2 : 4).map((o, i) => (
                        <div
                          key={i}
                          className={`${styles.optionItem} ${Number(q.correct_answer) === i ? styles.optionItemCorrect : ""}`}
                        >
                          <span className={styles.optionKey}>
                            {q.question_type === "true_false" ? (i === 0 ? "T" : "F") : OPTION_LABELS[i]}
                          </span>
                          <span style={{ flex: 1 }}>{o || (q.question_type === "true_false" ? (i === 0 ? "True" : "False") : "")}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.rubricBox}>
                      <span style={{ fontWeight: 600, color: "var(--color-text)" }}>Model Answer / Rubric:</span>
                      <span style={{ color: "var(--color-muted)" }}>{q.teacher_answer || "No specific rubric specified."}</span>
                    </div>
                  )}
                </div>

                <div className={styles.qFooter}>
                  <button
                    type="button"
                    className={styles.actionBtnSecondary}
                    onClick={() => openEdit(q)}
                    disabled={isLocked}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={styles.actionBtnDanger}
                    onClick={() => !isLocked && setDeleting(q)}
                    disabled={isLocked}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Item Modal */}
      <Modal open={Boolean(deleting)} onClose={() => setDeleting(null)} size="sm">
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--color-text)" }}>Delete Question?</div>
          <div style={{ fontSize: "0.8125rem", color: "var(--color-muted)" }}>
            This question will be permanently removed.
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", paddingTop: "0.75rem", borderTop: "1px solid var(--color-border)" }}>
            <Button variant="secondary" size="sm" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onDeleteQuestion(deleting)}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      {/* Bulk Upload Modal */}
      {bulkUploadOpen && (
        <BulkUploadModal
          subjectId={subjectId}
          onClose={() => setBulkUploadOpen(false)}
          onSuccess={() => {
            setBulkUploadOpen(false);
            showToast("success", "Questions uploaded successfully!");
            loadQuestions();
          }}
        />
      )}

      {/* Edit Subject Settings Modal */}
      <Modal open={editSubjectOpen} onClose={() => setEditSubjectOpen(false)} size="md">
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div>
            <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--color-text)" }}>Exam Schedule & Guidelines</div>
            <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", marginTop: "0.15rem" }}>
              Configure examination time limits, target dates, and instructions.
            </div>
          </div>

          <form onSubmit={onSubmitSubject} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Exam Date & Time *</label>
                <input
                  className={styles.formInput}
                  type="datetime-local"
                  value={subjDatetime}
                  onChange={(e) => setSubjDatetime(e.target.value)}
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Duration (Minutes) *</label>
                <input
                  className={styles.formInput}
                  type="number"
                  min={1}
                  max={360}
                  value={subjDuration}
                  onChange={(e) => setSubjDuration(Number(e.target.value))}
                  required
                />
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Exam Guidelines & Candidate Instructions</label>
              <textarea
                rows={4}
                className={styles.formInput}
                placeholder="Guidelines for candidates taking this examination…"
                value={subjInstructions}
                onChange={(e) => setSubjInstructions(e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Assessment Result Release Policy</label>
              <select
                className={styles.formInput}
                value={subjResultPolicy}
                onChange={(e) => setSubjResultPolicy(e.target.value)}
              >
                <option value="immediate">Immediate Release (Candidates & Guardians see score right away)</option>
                <option value="scheduled">Scheduled Release (Withhold scores until scheduled date & time)</option>
                <option value="manual">Manual Approval (Withhold scores until teacher/admin clicks 'Publish Results')</option>
              </select>
            </div>

            {subjResultPolicy === "scheduled" && (
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Results Release Date & Time *</label>
                <input
                  type="datetime-local"
                  className={styles.formInput}
                  value={subjReleaseTime}
                  onChange={(e) => setSubjReleaseTime(e.target.value)}
                  required
                />
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                id="subjRetake"
                checked={subjCanRetake}
                onChange={(e) => setSubjCanRetake(e.target.checked)}
              />
              <label htmlFor="subjRetake" style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--color-text)", cursor: "pointer" }}>
                Allow Candidates to Retake Exam
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", paddingTop: "0.75rem", borderTop: "1px solid var(--color-border)" }}>
              <Button type="button" variant="secondary" size="sm" onClick={() => setEditSubjectOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" loading={saving}>
                Save Settings
              </Button>
            </div>
          </form>
        </div>
      </Modal>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={confirmState.open}
        onClose={() => {
          setConfirmState({ open: false, title: "", message: "", variant: "danger", loading: false });
          confirmActionRef.current = null;
        }}
        onConfirm={() => confirmActionRef.current?.()}
        title={confirmState.title}
        message={confirmState.message}
        variant={confirmState.variant}
        loading={confirmState.loading}
      />
    </div>
  );
}
