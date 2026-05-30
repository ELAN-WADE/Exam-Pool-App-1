"use client";

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { RequireRole } from "../../../components/auth/RequireRole";
import { api } from "../../../lib/api";
import { Modal } from "../../../components/ui/Modal";
import { SettingsIcon, PlusIcon, TrashIcon, EditIcon, CheckCircleIcon, DocumentIcon, LockIcon } from "../../../components/icons/Icons";
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
  } catch { return ["", "", "", ""]; }
}

const OPTION_LABELS = ["A", "B", "C", "D"];
type EditorMode = "list" | "create" | "edit";
type ImageInputMode = "url" | "upload";

function QuestionsContent() {
  const searchParams = useSearchParams();
  const subjectId = Number(searchParams.get("subjectId") || 0);

  const [subjects,       setSubjects]       = useState<any[]>([]);
  const [questions,      setQuestions]      = useState<any[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [questionsReady, setQuestionsReady] = useState(false);
  const [error,          setError]          = useState("");
  const [toast,          setToast]          = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [editorMode,      setEditorMode]      = useState<EditorMode>("list");
  const [editSubjectOpen, setEditSubjectOpen] = useState(false);
  const [editing,         setEditing]         = useState<any | null>(null);
  const [deleting,        setDeleting]        = useState<any | null>(null);
  const [saving,          setSaving]          = useState(false);
  const actionHandled = useRef(false);

  // Editor form fields
  const [questionText,  setQuestionText]  = useState("");
  const [imageUrl,      setImageUrl]      = useState("");
  const [imageMode,     setImageMode]     = useState<ImageInputMode>("url");
  const [isDragging,    setIsDragging]    = useState(false);
  const [questionType,  setQuestionType]  = useState("objective");
  const [teacherAnswer, setTeacherAnswer] = useState("");
  const [options,       setOptions]       = useState(["", "", "", ""]);
  const [correctAnswer, setCorrectAnswer] = useState(0);
  const [marks,         setMarks]         = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Subject edit fields
  const [subjDatetime, setSubjDatetime] = useState("");
  const [subjDuration, setSubjDuration] = useState(60);

  const subject  = useMemo(() => subjects.find((s) => Number(s.id) === subjectId), [subjects, subjectId]);
  const isLocked = Boolean(subject?.is_published);

  const showToast = useCallback((type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const loadSubjects = useCallback(async () => {
    try {
      const data = (await api.getSubjects()) as any[];
      setSubjects(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed loading subjects");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadQuestions = useCallback(async () => {
    if (!subjectId) return;
    try {
      const data = (await api.getQuestions(subjectId)) as any[];
      setQuestions(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed loading questions");
    } finally {
      setQuestionsReady(true);
    }
  }, [subjectId]);

  useEffect(() => { loadSubjects(); }, [loadSubjects]);
  useEffect(() => { if (subjectId) loadQuestions(); }, [subjectId, loadQuestions]);

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
    setOptions(["", "", "", ""]);
    setCorrectAnswer(0);
    setMarks(1);
  }

  // ── Image handling ──────────────────────────────
  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith("image/")) {
      showToast("error", "Please select a valid image file (JPG, PNG, GIF, WebP).");
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

  const openCreate = () => { if (isLocked) return; resetForm(); setEditorMode("create"); };
  const openEdit = (q: any) => {
    if (isLocked) return;
    setEditing(q);
    setQuestionText(q.question_text ?? "");
    setImageUrl(q.image_url ?? "");
    // Detect if saved url is base64 data url
    setImageMode(q.image_url?.startsWith("data:") ? "upload" : "url");
    setQuestionType(q.question_type ?? "objective");
    setTeacherAnswer(q.teacher_answer ?? "");
    setOptions(parseOptions(q.options_json));
    setCorrectAnswer(Number(q.correct_answer ?? 0));
    setMarks(Number(q.marks ?? 1));
    setEditorMode("edit");
  };

  const openEditSubject = () => {
    if (isLocked || !subject) return;
    setSubjDatetime(subject.exam_datetime ? new Date(subject.exam_datetime).toISOString().slice(0, 16) : "");
    setSubjDuration(subject.duration ?? 60);
    setEditSubjectOpen(true);
  };

  const onSubmitSubject = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateSubject(subjectId, {
        exam_datetime: new Date(subjDatetime).toISOString(),
        duration: Number(subjDuration),
      });
      showToast("success", "Subject settings saved.");
      setEditSubjectOpen(false);
      await loadSubjects();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const onSubmitQuestion = async (e: FormEvent) => {
    e.preventDefault();
    if (!questionText.trim()) { showToast("error", "Question text is required."); return; }
    if (questionType === "objective" && options.some((o) => !o.trim())) {
      showToast("error", "Fill in all 4 options for multiple-choice."); return;
    }
    setSaving(true);
    try {
      const payloadOptions =
        questionType === "true_false" ? ["True", "False", "", ""] :
        questionType === "essay"      ? ["", "", "", ""] : options;
      const payloadCorrect = questionType === "essay" ? 0 : correctAnswer;
      const payload = {
        question_text: questionText,
        image_url: imageUrl || null,
        question_type: questionType,
        teacher_answer: teacherAnswer,
        options: payloadOptions,
        correct_answer: payloadCorrect,
        marks,
      };
      if (editing) {
        await api.updateQuestion(editing.id, payload);
        showToast("success", "Question updated successfully.");
      } else {
        await api.createQuestion({ subject_id: subjectId, order_index: questions.length, ...payload });
        showToast("success", "Question created!");
      }
      await loadQuestions();
      resetForm();
      setEditorMode("list");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Save failed.");
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
      showToast("error", err instanceof Error ? err.message : "Delete failed.");
    }
  };

  if (loading) return <div className="loadingWrap"><div className="spinner" /></div>;

  if (!subjectId) {
    return (
      <div className={styles.noSubjectState}>
        <LockIcon width="48" height="48" />
        <h2>No Subject Selected</h2>
        <p>Go to your dashboard and click "Manage Questions" on a subject.</p>
        <Link href="/teacher/dashboard" className="btn btn-primary" style={{ marginTop: "0.5rem" }}>
          Go to Dashboard
        </Link>
      </div>
    );
  }

  // ── FULL-PAGE SPLIT EDITOR ───────────────────────────────────────────
  if (editorMode === "create" || editorMode === "edit") {
    return (
      <div className={styles.editorContainer}>
        {toast && <div className={`toast ${toast.type === "success" ? "toast-success" : "toast-error"}`}>{toast.text}</div>}

        {/* Left: Document */}
        <div className={styles.editorMain}>
          <header className={styles.editorHeader}>
            <div className={styles.editorHeaderLeft}>
              <button className="btn btn-ghost btn-sm inline" onClick={() => { resetForm(); setEditorMode("list"); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
                Back
              </button>
              <div style={{ height: "20px", width: "1px", background: "var(--color-border)" }} />
              <div>
                <div className={styles.editorBreadcrumb}>{subject?.name ?? "Subject"}</div>
                <h2 className={styles.editorTitle}>{editorMode === "edit" ? "Edit Question" : "New Question"}</h2>
              </div>
            </div>
            {editorMode === "edit" && !isLocked && (
              <button className="btn btn-sm btn-ghost inline" style={{ color: "var(--color-danger)", borderColor: "var(--color-danger-bg)" }} onClick={() => setDeleting(editing)}>
                <TrashIcon width="14" height="14" /> Delete
              </button>
            )}
          </header>

          <div className={styles.docBody}>
            {/* Question Text */}
            <textarea
              className={styles.richTextarea}
              placeholder="Type your question here…&#10;&#10;Be clear and specific. Avoid ambiguous phrasing."
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              autoFocus
            />
            <div className={styles.charCount}>{questionText.length} characters</div>

            {/* Image Section */}
            <div className={styles.imgSection}>
              <div className={styles.imgSectionLabel}>Attach an image (optional)</div>

              {/* Tabs */}
              <div className={styles.imgTabs}>
                <button
                  type="button"
                  className={`${styles.imgTab} ${imageMode === "url" ? styles.imgTabActive : ""}`}
                  onClick={() => setImageMode("url")}
                >
                  🔗 Image URL
                </button>
                <button
                  type="button"
                  className={`${styles.imgTab} ${imageMode === "upload" ? styles.imgTabActive : ""}`}
                  onClick={() => setImageMode("upload")}
                >
                  📁 Upload from PC
                </button>
              </div>

              {/* URL Mode */}
              {imageMode === "url" && (
                <div className={styles.imageUrlRow}>
                  <input
                    type="url"
                    className={`input ${styles.imageUrlInput}`}
                    placeholder="https://example.com/image.png"
                    value={imageUrl.startsWith("data:") ? "" : imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                  />
                  {imageUrl && (
                    <button type="button" className={`btn btn-ghost btn-sm ${styles.imgClearBtn}`} onClick={() => setImageUrl("")}>
                      ✕ Clear
                    </button>
                  )}
                </div>
              )}

              {/* Upload Mode */}
              {imageMode === "upload" && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                    className={styles.fileInput}
                    onChange={handleFileInputChange}
                  />
                  <div
                    className={`${styles.dropZone} ${isDragging ? styles.dropZoneActive : ""}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                  >
                    <div className={styles.dropZoneIcon}>
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                      </svg>
                    </div>
                    <div className={styles.dropZoneText}>{imageUrl?.startsWith("data:") ? "Image loaded — click to change" : "Click to browse or drag & drop"}</div>
                    <div className={styles.dropZoneSubtext}>PNG, JPG, GIF, WebP · Max 5 MB</div>
                  </div>
                  {imageUrl?.startsWith("data:") && (
                    <button type="button" className="btn btn-ghost btn-sm inline" style={{ alignSelf: "flex-start" }} onClick={() => setImageUrl("")}>
                      ✕ Remove image
                    </button>
                  )}
                </>
              )}

              {/* Preview */}
              {imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="Question image preview" className={styles.imgPreview} />
              )}
            </div>
          </div>
        </div>

        {/* Right: Settings Sidebar */}
        <aside className={styles.editorSidebar}>
          <div className={styles.sidebarHeader}>Question Settings</div>
          <form id="qEditorForm" onSubmit={onSubmitQuestion} className={styles.sidebarForm}>

            {/* Type & Marks */}
            <div className={styles.sidebarSection}>
              <div className={styles.sidebarSectionTitle}>Type & Scoring</div>
              <div className="field">
                <label>Question Type</label>
                <select className="select" value={questionType} onChange={(e) => setQuestionType(e.target.value)}>
                  <option value="objective">Multiple Choice (MCQ)</option>
                  <option value="true_false">True / False</option>
                  <option value="essay">Essay / Written</option>
                </select>
              </div>
              <div className="field">
                <label>Marks</label>
                <input className="input" type="number" min={1} max={100} value={marks} onChange={(e) => setMarks(Number(e.target.value))} required />
              </div>
            </div>

            {/* Options for MCQ */}
            {questionType === "objective" && (
              <div className={styles.sidebarSection}>
                <div className={styles.sidebarSectionTitle}>Answer Options — click letter to mark correct</div>
                <div className={styles.optionsList}>
                  {options.map((o, i) => (
                    <div key={i} className={styles.optionRow}>
                      <button
                        type="button"
                        className={`${styles.optionSelectBtn} ${correctAnswer === i ? styles.optionSelectBtnActive : ""}`}
                        onClick={() => setCorrectAnswer(i)}
                        title="Mark as correct"
                      >
                        {OPTION_LABELS[i]}
                      </button>
                      <input
                        className="input"
                        value={o}
                        onChange={(e) => { const n = [...options]; n[i] = e.target.value; setOptions(n); }}
                        placeholder={`Option ${OPTION_LABELS[i]}`}
                        required
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* True/False */}
            {questionType === "true_false" && (
              <div className={styles.sidebarSection}>
                <div className={styles.sidebarSectionTitle}>Correct Answer</div>
                <div className={styles.tfGrid}>
                  <button type="button" className={`btn ${correctAnswer === 0 ? "btn-primary" : "btn-ghost"}`} onClick={() => setCorrectAnswer(0)}>✓ True</button>
                  <button type="button" className={`btn ${correctAnswer === 1 ? "btn-primary" : "btn-ghost"}`} onClick={() => setCorrectAnswer(1)}>✗ False</button>
                </div>
              </div>
            )}

            {/* Essay rubric */}
            {questionType === "essay" && (
              <div className={styles.sidebarSection}>
                <div className={styles.sidebarSectionTitle}>Model Answer / Marking Rubric</div>
                <textarea className="input" value={teacherAnswer} onChange={(e) => setTeacherAnswer(e.target.value)} placeholder="Write the expected answer or marking guide…" rows={6} />
              </div>
            )}

            <div className={styles.sidebarFooter}>
              <button type="submit" form="qEditorForm" className="btn btn-primary" disabled={saving}>
                {saving ? "Saving…" : (editorMode === "edit" ? "Save Changes" : "Create Question")}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => { resetForm(); setEditorMode("list"); }}>
                Cancel
              </button>
            </div>
          </form>
        </aside>

        <Modal open={!!deleting} onClose={() => setDeleting(null)} size="sm">
          <h2>Delete Question?</h2>
          <p className="modal-desc">This question will be permanently removed and cannot be recovered.</p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setDeleting(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={() => onDeleteQuestion(deleting)}>Delete</button>
          </div>
        </Modal>
      </div>
    );
  }

  // ── LIST VIEW ──────────────────────────────────────────────────────────
  return (
    <>
      {toast && <div className={`toast ${toast.type === "success" ? "toast-success" : "toast-error"}`}>{toast.text}</div>}

      <div className="pageHeader">
        <div>
          <Link href="/teacher/dashboard" className={styles.backLink}>← Back to Dashboard</Link>
          <h1 className="pageTitle" style={{ marginTop: "0.25rem" }}>{subject?.name ?? "Questions"}</h1>
          {subject && (
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem", flexWrap: "wrap" }}>
              <code className={styles.code}>{subject.code}</code>
              <code className={styles.code}>Term {subject.term}</code>
              <span className={`badge ${subject.is_published ? "badge-success" : "badge-muted"}`}>
                {subject.is_published ? "● Published" : "Draft"}
              </span>
            </div>
          )}
        </div>
        <div className={styles.headerActions}>
          <button className="btn btn-ghost btn-sm inline" onClick={openEditSubject} disabled={isLocked} title={isLocked ? "Unpublish to edit" : "Exam settings"}>
            <SettingsIcon width="15" height="15" /> Settings
          </button>
          <button className="btn btn-primary btn-sm inline" onClick={openCreate} disabled={isLocked}>
            <PlusIcon width="15" height="15" /> Add Question
          </button>
        </div>
      </div>

      {isLocked && (
        <div className={styles.lockedBanner}>
          <LockIcon width="18" height="18" />
          <div>
            <strong>Subject is Published — Editing Locked</strong>
            <span>Ask the Operator to unpublish this subject before making changes.</span>
          </div>
        </div>
      )}

      {error && <div className={styles.errorBanner}>{error}</div>}

      {questionsReady && questions.length === 0 ? (
        <div className={styles.emptyList}>
          <DocumentIcon width="52" height="52" className={styles.emptyIcon} />
          <h3>No Questions Yet</h3>
          <p>Click "Add Question" to open the editor and build your exam.</p>
          {!isLocked && (
            <button className="btn btn-primary" onClick={openCreate} style={{ marginTop: "0.75rem" }}>
              <PlusIcon width="16" height="16" /> Create First Question
            </button>
          )}
        </div>
      ) : (
        <div className={styles.list}>
          {questions.map((q: any, idx: number) => {
            const opts = parseOptions(q.options_json);
            return (
              <div key={q.id} className={styles.qCard}>
                <div className={styles.qCardBody}>
                  <div className={styles.qTop}>
                    <span className={styles.qNum}>Q{idx + 1}</span>
                    <div className={styles.qTopRight}>
                      <span className={`badge ${q.question_type === "essay" ? "badge-info" : q.question_type === "true_false" ? "badge-warning" : "badge-success"}`}>
                        {q.question_type === "essay" ? "Essay" : q.question_type === "true_false" ? "True/False" : "MCQ"}
                      </span>
                      <span className={styles.qMarks}>{q.marks} {q.marks === 1 ? "mark" : "marks"}</span>
                    </div>
                  </div>

                  {q.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={q.image_url} alt={`Q${idx + 1} image`} className={styles.listImg} />
                  )}
                  <p className={styles.qText}>{q.question_text}</p>

                  {q.question_type !== "essay" ? (
                    <div className={styles.gridOptions}>
                      {opts.slice(0, q.question_type === "true_false" ? 2 : 4).map((o, i) => (
                        <div key={i} className={`${styles.gridOption} ${Number(q.correct_answer) === i ? styles.gridOptionCorrect : ""}`}>
                          <span className={styles.gridOptionLabel}>{q.question_type === "true_false" ? (i === 0 ? "T" : "F") : OPTION_LABELS[i]}</span>
                          <span style={{ flex: 1 }}>{o || (q.question_type === "true_false" ? (i === 0 ? "True" : "False") : "")}</span>
                          {Number(q.correct_answer) === i && <CheckCircleIcon width="15" height="15" className={styles.checkIcon} />}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.rubricBlock}>
                      <strong>Marking Rubric</strong>
                      <span>{q.teacher_answer || "No rubric provided."}</span>
                    </div>
                  )}
                </div>

                <div className={styles.qActions}>
                  <button className="btn btn-ghost btn-sm inline" onClick={() => openEdit(q)} disabled={isLocked}>
                    <EditIcon width="13" height="13" /> Edit
                  </button>
                  <button
                    className="btn btn-sm inline"
                    style={{ background: isLocked ? "var(--color-surface-2)" : "var(--color-danger-bg)", color: isLocked ? "var(--color-muted)" : "var(--color-danger)", border: "1px solid transparent" }}
                    onClick={() => !isLocked && setDeleting(q)}
                    disabled={isLocked}
                  >
                    <TrashIcon width="13" height="13" /> Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      <Modal open={!!deleting && editorMode === "list"} onClose={() => setDeleting(null)} size="sm">
        <h2>Delete Question?</h2>
        <p className="modal-desc">This question will be permanently removed.</p>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => setDeleting(null)}>Cancel</button>
          <button className="btn btn-danger" onClick={() => onDeleteQuestion(deleting)}>Delete</button>
        </div>
      </Modal>

      <Modal open={editSubjectOpen} onClose={() => setEditSubjectOpen(false)} size="sm">
        <h2>Subject Settings</h2>
        <p className="modal-desc">Configure exam date/time and duration.</p>
        <form onSubmit={onSubmitSubject} className={styles.modalForm}>
          <div className="field">
            <label>Exam Date & Time *</label>
            <input className="input" type="datetime-local" value={subjDatetime} onChange={(e) => setSubjDatetime(e.target.value)} required />
          </div>
          <div className="field">
            <label>Duration (minutes) *</label>
            <input className="input" type="number" min="1" max="360" value={subjDuration} onChange={(e) => setSubjDuration(Number(e.target.value))} required />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setEditSubjectOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save Settings"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
