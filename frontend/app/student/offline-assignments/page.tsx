"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { RequireRole } from "../../../components/auth/RequireRole";
import { useToast } from "../../../hooks/useToast";
import {
  BookIcon,
  CheckCircleIcon,
  DocumentIcon,
  PlayIcon,
  DownloadIcon,
  SparklesIcon,
  ArrowRightIcon,
  RefreshIcon,
  SubjectIcon,
} from "../../../components/icons/Icons";
import {
  getCachedAssignments,
  saveOfflineSubmission,
  cacheAssignments,
  getPendingSubmissions,
  clearPendingSubmissions,
  OfflineSubmission,
} from "../../../lib/offlineSync";
import { api } from "../../../lib/api";
import { ConfettiCelebration } from "../../../components/student/ConfettiCelebration";
import styles from "./page.module.css";

export default function StudentOfflineAssignmentPage() {
  return (
    <RequireRole role="student">
      <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "3rem" }}><div className="spinner" /></div>}>
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
  const startTimeRef = useRef<string>(new Date().toISOString());

  useEffect(() => {
    const controller = new AbortController();
    getCachedAssignments()
      .then((data) => {
        if (controller.signal.aborted) return;
        setAssignments(data);
        if (subjectId) {
          const found = data.find((a: any) => a.id === subjectId);
          if (found) {
            setSubject(found);
            let qs = [...(found.questions || [])];
            for (let i = qs.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [qs[i], qs[j]] = [qs[j], qs[i]];
            }
            setQuestions(qs);
          }
        }
        if (!controller.signal.aborted) setLoading(false);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          console.error(err);
          setLoading(false);
        }
      });

    getPendingSubmissions()
      .then(setPendingSync)
      .catch((err) => {
        if (!controller.signal.aborted) console.error(err);
      });

    return () => controller.abort();
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
        await Promise.allSettled(assetsToCache.map((url) => fetch(url)));
      }

      const updatedCache = await getCachedAssignments();
      setAssignments(updatedCache);
      showToast(`Successfully cached ${data.assignments.length} assignments.`, "success");
    } catch (err) {
      showToast("Failed to download. Are you connected to the network?", "error");
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
      const responses = questions.map((q) => {
        const val = answers[q.id];
        return {
          question_id: q.id,
          selected_option: typeof val === "number" ? val : null,
          essay_response: typeof val === "string" ? val : null,
        };
      });

      const responsesWithFiles = await Promise.all(
        responses.map(async (r) => {
          const file = files[r.question_id];
          let fileData = null;
          let fileName = null;
          if (file) {
            fileName = file.name;
            fileData = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => reject(new Error("Failed to read file"));
              reader.readAsDataURL(file);
            });
          }
          return { ...r, file_data: fileData, file_name: fileName };
        })
      );

      const startTime = startTimeRef.current;
      await saveOfflineSubmission({
        subject_id: subject.id,
        start_time: startTime,
        end_time: new Date().toISOString(),
        score: 0,
        total_score: 0,
        answers: responsesWithFiles,
      });
      showToast("Assignment saved locally. Please sync when you are back at school.", "success");
      setIsCompleted(true);
    } catch (err) {
      showToast("Failed to save assignment locally.", "error");
    }
  };

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "320px", gap: "0.75rem", color: "#64748B", fontSize: "0.875rem" }}>
        <div className="spinner" style={{ width: 22, height: 22, borderColor: "#E2E8F0", borderTopColor: "#165AF6" }} />
        <span>Loading offline assignments…</span>
      </div>
    );
  }

  // 1. If completed
  if (isCompleted) {
    return (
      <div className={styles.completionContainer}>
        <ConfettiCelebration trigger={true} durationMs={4500} particleCount={140} />
        <div className={styles.completionCard}>
          <div className={styles.completionIconBox}>
            <CheckCircleIcon width="24" height="24" />
          </div>
          <h2 className={styles.completionTitle}>Assignment Saved Locally</h2>
          <p className={styles.completionSub}>
            Your responses and attachments are securely cached on this device and ready to sync.
          </p>
          <div className={styles.syncNotice}>
            <strong>Sync Reminder:</strong> When connected to the school network, return to the hub and click <strong>Sync Answers</strong> to submit to your teacher.
          </div>
          <Link href="/student/dashboard" className={styles.returnBtn}>
            <span>Return to Dashboard</span>
            <ArrowRightIcon width="14" height="14" />
          </Link>
        </div>
      </div>
    );
  }

  // 2. No subject selected => show list
  if (!subjectId) {
    return (
      <div className={styles.container}>
        {/* ── 1. Hero Welcome & Telemetry Strip ── */}
        <section className={styles.heroSection}>
          <div className={styles.heroLeft}>
            <h1 className={styles.heroTitle}>Offline Assignments Hub</h1>
            <p className={styles.heroSubtitle}>
              Download assignments while connected, complete them anywhere offline, and sync your work when you return.
            </p>
          </div>

          <div className={styles.telemetryPillGroup}>
            <div className={styles.telemetryBadge}>
              <div className={styles.telemetryIcon}>
                <DownloadIcon width="18" height="18" />
              </div>
              <div className={styles.telemetryBadgeContent}>
                <span className={styles.telemetryNumber}>{assignments.length}</span>
                <span className={styles.telemetryText}>Cached Papers</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── 2. Sync & Download Action Toolbar ── */}
        <div className={styles.toolbarCard}>
          <div className={styles.toolbarContent}>
            <div className={styles.toolbarText}>
              <h3 className={styles.toolbarTitle}>Offline Sync Status</h3>
              <p className={styles.toolbarDesc}>Keep coursework updated and submit completed papers back to your teacher.</p>
            </div>
            <div className={styles.toolbarActions}>
              <button
                type="button"
                className={styles.downloadBtn}
                onClick={handleDownloadAssignments}
                disabled={isDownloading}
              >
                <DownloadIcon width="14" height="14" />
                <span>{isDownloading ? "Downloading…" : "Download Latest"}</span>
              </button>
              <button
                type="button"
                className={styles.syncBtn}
                onClick={handleSyncAssignments}
                disabled={isSyncing || pendingSync.length === 0}
              >
                <RefreshIcon
                  width="14"
                  height="14"
                  style={{ animation: isSyncing ? "spin 1s linear infinite" : "none" }}
                />
                <span>{isSyncing ? "Syncing…" : `Sync Answers (${pendingSync.length} pending)`}</span>
              </button>
            </div>
          </div>
        </div>

        {/* ── 3. Enrolled Assignments Track Container ── */}
        <section className={styles.assignmentsContainer}>
          <div className={styles.assignmentsHeader}>
            <div className={styles.assignmentsTitleGroup}>
              <div className={styles.hubIconBadge}>
                <BookIcon width="20" height="20" />
              </div>
              <div>
                <span className={styles.hubEyebrow}>Downloaded Coursework</span>
                <h2 className={styles.hubClassTitle}>
                  Offline Papers ({assignments.length})
                </h2>
              </div>
            </div>
          </div>

          {assignments.length === 0 ? (
            <div className={styles.emptyState}>
              <DocumentIcon width="36" height="36" style={{ color: "#94A3B8" }} />
              <h3>No assignments downloaded</h3>
              <p>Click the download button above while connected to the school network.</p>
            </div>
          ) : (
            <div className={styles.grid}>
              {assignments.map((a: any) => (
                <div key={a.id} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <div className={styles.subjectIconBox}>
                      <BookIcon width="16" height="16" />
                    </div>
                    <code className={styles.code}>{a.code || "ASSIGNMENT"}</code>
                  </div>

                  <div>
                    <h3 className={styles.cardTitle}>{a.name}</h3>
                  </div>

                  <div>
                    <Link
                      href={`/student/offline-assignments?subjectId=${a.id}`}
                      className={styles.startBtn}
                    >
                      <span>Start Assignment →</span>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  if (!subject) return <div className={styles.container}>Assignment not found in cache.</div>;

  // 3. In-Flight Offline Assignment Viewer
  const q = questions[currentIndex];
  if (!q) return <div className={styles.container}>No questions in this assignment.</div>;

  let options: string[] = ["", "", "", ""];
  try {
    const parsed = JSON.parse(q.options_json || "[]");
    options = Array.isArray(parsed) ? parsed : options;
  } catch (e) {
    /* ignore */
  }
  const OPTION_LABELS = ["A", "B", "C", "D"];

  return (
    <div className={styles.viewerContainer}>
      <header className={styles.viewerHeader}>
        <div className={styles.headerLeft}>
          <Link href="/student/offline-assignments" className={styles.exitBtn}>
            ← Exit
          </Link>
          <div className={styles.headerTitle}>
            <strong>{subject.name}</strong>
            <span className={styles.badge}>Offline Mode</span>
          </div>
        </div>
        <div className={styles.headerRight}>
          <button type="button" className={styles.saveBtn} onClick={handleSaveAndExit}>
            Save &amp; Close
          </button>
        </div>
      </header>

      <main className={styles.viewerMain}>
        <div className={styles.sidebar}>
          <div className={styles.navGrid}>
            {questions.map((_, i) => (
              <button
                key={i}
                type="button"
                className={`${styles.navBtn} ${currentIndex === i ? styles.navBtnActive : ""} ${
                  answers[questions[i].id] !== undefined || files[questions[i].id] !== undefined
                    ? styles.navBtnAnswered
                    : ""
                }`}
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
            <span className={styles.marks}>{q.marks || 1} mark{(q.marks || 1) > 1 ? "s" : ""}</span>
          </div>

          {q.attached_file_url && (
            <div className={styles.attachmentBox}>
              <DocumentIcon width="18" height="18" />
              <div>
                <strong>Attached Resource</strong>
                <a href={q.attached_file_url} target="_blank" rel="noreferrer" className="link" style={{ display: "block", fontSize: "0.85rem", color: "#165AF6" }}>
                  Download PDF/Document
                </a>
              </div>
            </div>
          )}

          <div className={styles.qText}>{q.question_text}</div>
          {q.image_url && <img src={q.image_url} alt="Question Diagram" className={styles.qImage} />}

          <div className={styles.qInteractive}>
            {q.question_type === "objective" && (
              <div className={styles.optionsList}>
                {options.map((opt, i) => (
                  <button
                    key={i}
                    type="button"
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
                <button type="button" className={`${styles.optionBtn} ${answers[q.id] === 0 ? styles.optionBtnActive : ""}`} onClick={() => handleSelectOption(q.id, 0)}>
                  <span className={styles.optionLetter}>T</span>
                  <span className={styles.optionText}>True</span>
                </button>
                <button type="button" className={`${styles.optionBtn} ${answers[q.id] === 1 ? styles.optionBtnActive : ""}`} onClick={() => handleSelectOption(q.id, 1)}>
                  <span className={styles.optionLetter}>F</span>
                  <span className={styles.optionText}>False</span>
                </button>
              </div>
            )}
            {q.question_type === "essay" && (
              <div>
                <textarea
                  className="input"
                  style={{ minHeight: "150px", width: "100%", padding: "0.85rem", borderRadius: "10px", border: "1px solid #CBD5E1", fontSize: "0.875rem" }}
                  placeholder="Type your answer here..."
                  value={answers[q.id] || ""}
                  onChange={(e) => handleEssayInput(q.id, e.target.value)}
                />
              </div>
            )}
            {q.is_file_upload === 1 && (
              <div className={styles.fileUploadBox}>
                <label style={{ display: "block", marginBottom: "0.4rem", fontWeight: 600, fontSize: "0.8125rem", color: "#0F172A" }}>
                  Upload your work (PDF/Image):
                </label>
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
                {files[q.id] && (
                  <div style={{ marginTop: "0.4rem", color: "#059669", fontSize: "0.8125rem", fontWeight: 600 }}>
                    ✓ Attached: {files[q.id].name}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className={styles.qActions}>
            <button
              type="button"
              className={styles.navActionBtn}
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex(currentIndex - 1)}
            >
              ← Previous
            </button>
            {currentIndex < questions.length - 1 ? (
              <button
                type="button"
                className={styles.nextActionBtn}
                onClick={() => setCurrentIndex(currentIndex + 1)}
              >
                <span>Next</span>
                <span>→</span>
              </button>
            ) : (
              <button type="button" className={styles.finishActionBtn} onClick={handleSaveAndExit}>
                Finish &amp; Save
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
