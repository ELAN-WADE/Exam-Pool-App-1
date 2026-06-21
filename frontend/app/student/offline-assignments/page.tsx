"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useToast } from "../../../hooks/useToast";
import { BookIcon, CheckCircleIcon, DocumentIcon, LockIcon, PlayIcon, DownloadIcon } from "../../../components/icons/Icons";
import { getCachedAssignments, saveOfflineSubmission, cacheAssignments, getPendingSubmissions, clearPendingSubmissions, OfflineSubmission } from "../../../lib/offlineSync";
import { api } from "../../../lib/api";
import styles from "./page.module.css";

export default function StudentOfflineAssignmentPage() {
  return (
    <RequireRole role="student">
      <Suspense fallback={<div className="loadingWrap"><div className="spinner" /></div>}>
        <AssignmentContent />
      </Suspense>
    </RequireRole>
  );
}

function AssignmentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const subjectId = Number(searchParams.get("subjectId") || 0);
  const { showToast } = useToast();

  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Dashboard Sync State
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingSync, setPendingSync] = useState<OfflineSubmission[]>([]);

  // Viewer state
  const [subject, setSubject] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, any>>({});
  const [files, setFiles] = useState<Record<number, File>>({});
  const [isCompleted, setIsCompleted] = useState(false);

  useEffect(() => {
    getCachedAssignments().then((data) => {
      setAssignments(data);
      if (subjectId) {
        const found = data.find((a: any) => a.id === subjectId);
        if (found) {
          setSubject(found);
          // Feature: Randomly shuffle questions to prevent cheating
          let qs = [...(found.questions || [])];
          for (let i = qs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [qs[i], qs[j]] = [qs[j], qs[i]];
          }
          setQuestions(qs);
        }
      }
      setLoading(false);
    }).catch((err) => {
      console.error(err);
      setLoading(false);
    });

    getPendingSubmissions().then(setPendingSync).catch(console.error);
  }, [subjectId]);

  const handleDownloadAssignments = async () => {
    setIsDownloading(true);
    try {
      const data = await api.getOfflineAssignments();
      await cacheAssignments(data.assignments);
      
      let assetsToCache: string[] = [];
      data.assignments.forEach((a: any) => {
        if (a.questions && Array.isArray(a.questions)) {
          a.questions.forEach((q: any) => {
            if (q.attached_file_url) assetsToCache.push(q.attached_file_url);
            if (q.image_url && !q.image_url.startsWith("data:")) assetsToCache.push(q.image_url);
          });
        }
      });
      
      if (assetsToCache.length > 0) {
        await Promise.allSettled(assetsToCache.map(url => fetch(url)));
      }
      
      const updatedCache = await getCachedAssignments();
      setAssignments(updatedCache);
      showToast(`Successfully cached ${data.assignments.length} assignments.`, "success");
    } catch (err) {
      showToast("Failed to download. Are you connected to the internet?", "error");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSyncAssignments = async () => {
    if (pendingSync.length === 0) return;
    setIsSyncing(true);
    try {
      const res = await api.syncOfflineAssignments(pendingSync);
      await clearPendingSubmissions();
      setPendingSync([]);
      showToast(`Successfully synced ${res.synced} assignment(s).`, "success");
    } catch (err) {
      showToast("Failed to sync. Make sure you are connected to the network.", "error");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSelectOption = (qid: number, optIdx: number) => {
    setAnswers({ ...answers, [qid]: optIdx });
  };

  const handleEssayInput = (qid: number, text: string) => {
    setAnswers({ ...answers, [qid]: text });
  };

  const handleFileUpload = (qid: number, file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      showToast("File is too large (max 5MB)", "error");
      return;
    }
    setFiles({ ...files, [qid]: file });
  };

  const handleSaveAndExit = async () => {
    if (!subject) return;
    try {
      // Build responses array
      const responses = questions.map((q) => {
        const val = answers[q.id];
        return {
          question_id: q.id,
          selected_option: typeof val === "number" ? val : null,
          essay_response: typeof val === "string" ? val : null,
        };
      });

      // Files can't be easily serialized into IndexedDB without base64 or blob,
      // but for simplicity in this MVP, we save the text responses and rely on the student 
      // uploading files when they are online directly, or we serialize the file to base64.
      // We will base64 encode files for the offline submission.
      const responsesWithFiles = await Promise.all(responses.map(async (r) => {
        const file = files[r.question_id];
        let fileData = null;
        let fileName = null;
        if (file) {
          fileName = file.name;
          fileData = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(file);
          });
        }
        return { ...r, file_data: fileData, file_name: fileName };
      }));

      await saveOfflineSubmission({
        subject_id: subject.id,
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        score: 0,
        total_score: 0,
        answers: responsesWithFiles
      });
      showToast("Assignment saved locally. Please sync when you are back at school.", "success");
      setIsCompleted(true);
    } catch (err) {
      showToast("Failed to save assignment locally.", "error");
    }
  };

  if (loading) return <div className="loadingWrap"><div className="spinner" /></div>;

  // 1. If completed
  if (isCompleted) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <CheckCircleIcon width="48" height="48" style={{ color: "var(--color-success)" }} />
          <h2>Assignment Saved Offline</h2>
          <p>Your work has been securely cached on this device.</p>
          <div className={styles.warningBox}>
            <strong>Important:</strong> You must return to the school network and click "Sync" on your dashboard to submit this assignment to your teacher.
          </div>
          <Link href="/student/dashboard" className="btn btn-primary" style={{ marginTop: "1rem" }}>
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // 2. No subject selected => show list
  if (!subjectId) {
    return (
      <div className={styles.container}>
        <div className="pageHeader">
          <h1 className="pageTitle">Offline Assignments Hub</h1>
          <p className="pageSubtitle">Download assignments while online, take them offline, and sync when you return.</p>
        </div>

        <div className={styles.statsRow} style={{ marginTop: "1rem", marginBottom: "2rem" }}>
          <div className={styles.card} style={{ width: "100%", background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
            <div className={styles.cardContent}>
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
                <button className="btn btn-primary" onClick={handleDownloadAssignments} disabled={isDownloading}>
                  {isDownloading ? "Downloading..." : "⬇ Download Latest Assignments"}
                </button>
                <button className="btn" style={{ background: "var(--color-surface-2)" }} onClick={handleSyncAssignments} disabled={isSyncing || pendingSync.length === 0}>
                  {isSyncing ? "Syncing..." : `⬆ Sync Answers (${pendingSync.length} pending)`}
                </button>
              </div>
            </div>
          </div>
        </div>

        {assignments.length === 0 ? (
          <div className={styles.emptyState}>
            <DocumentIcon width="48" height="48" />
            <h3>No assignments downloaded</h3>
            <p>Click the download button above while connected to the school network.</p>
          </div>
        ) : (
          <div className={styles.grid}>
            {assignments.map((a: any) => (
              <div key={a.id} className={styles.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <h3>{a.name}</h3>
                    <code className={styles.code}>{a.code}</code>
                  </div>
                  <div className={styles.subjectIconBox} style={{ background: "var(--color-primary-bg)", color: "var(--color-primary)" }}>
                    <BookIcon width="20" height="20" />
                  </div>
                </div>
                <div style={{ marginTop: "1.5rem" }}>
                  <Link href={`/student/offline-assignments?subjectId=${a.id}`} className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}>
                    <PlayIcon width="13" height="13" /> Start Assignment
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (!subject) return <div className={styles.container}>Assignment not found in cache.</div>;

  // 3. Viewer
  const q = questions[currentIndex];
  if (!q) return <div className={styles.container}>No questions in this assignment.</div>;

  let options: string[] = ["", "", "", ""];
  try {
    const parsed = JSON.parse(q.options_json || "[]");
    options = Array.isArray(parsed) ? parsed : options;
  } catch (e) { /* ignore */ }
  const OPTION_LABELS = ["A", "B", "C", "D"];

  return (
    <div className={styles.viewerContainer}>
      <header className={styles.viewerHeader}>
        <div className={styles.headerLeft}>
          <Link href="/student/offline-assignments" className="btn btn-ghost btn-sm inline">← Exit</Link>
          <div className={styles.headerTitle}>
            <strong>{subject.name}</strong>
            <span className={styles.badge}>Offline Mode</span>
          </div>
        </div>
        <div className={styles.headerRight}>
          <button className="btn btn-primary btn-sm inline" onClick={handleSaveAndExit}>Save & Close</button>
        </div>
      </header>

      <main className={styles.viewerMain}>
        <div className={styles.sidebar}>
          <div className={styles.navGrid}>
            {questions.map((_, i) => (
              <button 
                key={i} 
                className={`${styles.navBtn} ${currentIndex === i ? styles.navBtnActive : ""} ${answers[questions[i].id] !== undefined || files[questions[i].id] !== undefined ? styles.navBtnAnswered : ""}`}
                onClick={() => setCurrentIndex(i)}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
        
        <div className={styles.qArea}>
          <div className={styles.qTopRow}>
            <h2>Question {currentIndex + 1} of {questions.length}</h2>
            <span className={styles.marks}>{q.marks} marks</span>
          </div>

          {q.attached_file_url && (
            <div className={styles.attachmentBox}>
              <DocumentIcon width="20" height="20" />
              <div>
                <strong>Attached Resource</strong>
                <a href={q.attached_file_url} target="_blank" rel="noreferrer" className="link" style={{ display: "block", fontSize: "0.9rem" }}>
                  Download PDF/Document
                </a>
              </div>
            </div>
          )}

          <div className={styles.qText}>{q.question_text}</div>
          {q.image_url && <img src={q.image_url} alt="Question" className={styles.qImage} />}

          <div className={styles.qInteractive}>
            {q.question_type === "objective" && (
              <div className={styles.optionsList}>
                {options.map((opt, i) => (
                  <button
                    key={i}
                    className={`${styles.optionBtn} ${answers[q.id] === i ? styles.optionBtnActive : ""}`}
                    onClick={() => handleSelectOption(q.id, i)}
                  >
                    <span className={styles.optionLetter}>{OPTION_LABELS[i]}</span>
                    <span className={styles.optionText}>{opt}</span>
                  </button>
                ))}
              </div>
            )}
            {q.question_type === "true_false" && (
              <div className={styles.optionsList}>
                <button className={`${styles.optionBtn} ${answers[q.id] === 0 ? styles.optionBtnActive : ""}`} onClick={() => handleSelectOption(q.id, 0)}>
                  <span className={styles.optionLetter}>T</span>
                  <span className={styles.optionText}>True</span>
                </button>
                <button className={`${styles.optionBtn} ${answers[q.id] === 1 ? styles.optionBtnActive : ""}`} onClick={() => handleSelectOption(q.id, 1)}>
                  <span className={styles.optionLetter}>F</span>
                  <span className={styles.optionText}>False</span>
                </button>
              </div>
            )}
            {q.question_type === "essay" && (
              <div>
                <textarea
                  className="input"
                  style={{ minHeight: "150px" }}
                  placeholder="Type your answer here..."
                  value={answers[q.id] || ""}
                  onChange={(e) => handleEssayInput(q.id, e.target.value)}
                />
              </div>
            )}
            {q.is_file_upload === 1 && (
              <div className={styles.fileUploadBox}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>Upload your work (PDF/Image):</label>
                <input 
                  type="file" 
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" 
                  className="input" 
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileUpload(q.id, e.target.files[0]);
                    }
                  }} 
                />
                {files[q.id] && <div style={{ marginTop: "0.5rem", color: "var(--color-success)", fontSize: "0.9rem" }}>✓ Attached: {files[q.id].name}</div>}
              </div>
            )}
          </div>

          <div className={styles.qActions}>
            <button className="btn btn-ghost" disabled={currentIndex === 0} onClick={() => setCurrentIndex(currentIndex - 1)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg> Previous
            </button>
            {currentIndex < questions.length - 1 ? (
              <button className="btn btn-primary" onClick={() => setCurrentIndex(currentIndex + 1)}>
                Next <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            ) : (
              <button className="btn btn-primary" onClick={handleSaveAndExit}>
                Finish & Save
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
