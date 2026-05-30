import { useState } from "react";
import { api } from "../../lib/api";

type ReviewModalProps = {
  activeSubjectName: string;
  studentName: string;
  reviewData: any;
  reviewLoading: boolean;
  onClose: () => void;
  onGradeUpdate?: (examId: number, newTotal: number) => void;
};

export function ReviewModal({
  activeSubjectName,
  studentName,
  reviewData,
  reviewLoading,
  onClose,
  onGradeUpdate,
}: ReviewModalProps) {
  const [gradingQuestion, setGradingQuestion] = useState<number | null>(null);
  const [marksToAward, setMarksToAward] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localReviewData, setLocalReviewData] = useState<any>(reviewData);

  // Sync local data if props change
  if (reviewData && reviewData !== localReviewData && !gradingQuestion && !isSubmitting) {
    setLocalReviewData(reviewData);
  }

  const handleGradeSubmit = async (questionId: number, maxMarks: number) => {
    const marks = Number(marksToAward);
    if (isNaN(marks) || marks < 0 || marks > maxMarks) {
      alert(`Invalid marks. Must be between 0 and ${maxMarks}.`);
      return;
    }
    
    setIsSubmitting(true);
    try {
      const examId = localReviewData.exam.id;
      const res = await api.gradeEssay(examId, questionId, marks);
      
      // Optimistically update local review data
      const updatedAnswers = localReviewData.answers.map((a: any) => {
        if (a.question_id === questionId) {
          return {
            ...a,
            marks_awarded: marks,
            is_correct: marks >= a.marks ? 1 : 0
          };
        }
        return a;
      });
      
      const newTotal = (res as any).new_total ?? localReviewData.exam.score;
      setLocalReviewData({
        ...localReviewData,
        exam: { ...localReviewData.exam, score: newTotal },
        answers: updatedAnswers
      });
      
      setGradingQuestion(null);
      if (onGradeUpdate) {
        onGradeUpdate(examId, newTotal);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to grade essay");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 680, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
          <div>
            <h2>Exam Review</h2>
            <p style={{ color: "var(--color-muted)", fontSize: "0.85rem" }}>
              {studentName} — {activeSubjectName}
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        
        {reviewLoading ? (
          <div className="loadingWrap"><div className="spinner" /></div>
        ) : localReviewData ? (
          <>
            <div style={{ display: "flex", gap: "1rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
              {[
                { label: "Score",     value: `${localReviewData.exam?.score ?? 0} / ${localReviewData.exam?.total_score ?? 0}` },
                { label: "Duration",  value: localReviewData.exam?.end_time && localReviewData.exam?.start_time
                    ? `${Math.round((new Date(localReviewData.exam.end_time).getTime() - new Date(localReviewData.exam.start_time).getTime()) / 60000)} min` : "—" },
                { label: "Submitted", value: localReviewData.exam?.end_time
                    ? new Date(localReviewData.exam.end_time).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—" },
              ].map((s) => (
                <div key={s.label} style={{ background: "var(--color-surface-2)", borderRadius: 8, padding: "0.6rem 1rem", minWidth: 100 }}>
                  <div style={{ fontSize: "0.72rem", color: "var(--color-muted)", marginBottom: 2 }}>{s.label}</div>
                  <div style={{ fontWeight: 700, fontSize: "1rem" }}>{s.value}</div>
                </div>
              ))}
            </div>
            {(localReviewData.answers ?? []).length === 0 ? (
              <p style={{ color: "var(--color-muted)", fontSize: "0.875rem" }}>No per-question data available.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {(localReviewData.answers as any[]).map((a, idx) => {
                  const opts = (() => { try { return JSON.parse(a.options_json || "[]"); } catch { return []; } })();
                  const isEssay = a.question_type === "essay";
                  
                  return (
                    <div key={a.id} style={{ background: a.is_correct ? "rgba(34,197,94,0.07)" : "rgba(239,68,68,0.07)", border: `1px solid ${a.is_correct ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.22)"}`, borderRadius: 10, padding: "0.9rem 1.1rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                        <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>Q{idx + 1}. {a.question_text}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <span style={{ fontSize: "0.8rem", fontWeight: 700, color: a.is_correct ? "var(--color-success)" : "var(--color-danger)" }}>
                            {a.marks_awarded} / {a.marks}
                          </span>
                          {isEssay && gradingQuestion !== a.question_id && (
                            <button 
                              className="btn btn-ghost btn-sm" 
                              style={{ padding: "0.2rem 0.4rem", fontSize: "0.7rem", height: "auto" }}
                              onClick={() => {
                                setGradingQuestion(a.question_id);
                                setMarksToAward(String(a.marks_awarded ?? 0));
                              }}
                            >
                              Grade
                            </button>
                          )}
                        </div>
                      </div>
                      
                      {isEssay ? (
                        <div style={{ fontSize: "0.82rem", color: "var(--color-muted)" }}>
                          <div><strong>Student response:</strong> {a.essay_response || <em>No response</em>}</div>
                          {a.teacher_answer && <div style={{ marginTop: 4 }}><strong>Expected:</strong> {a.teacher_answer}</div>}
                          
                          {gradingQuestion === a.question_id && (
                            <div style={{ marginTop: "0.75rem", padding: "0.75rem", background: "var(--color-surface)", borderRadius: "6px", border: "1px solid var(--color-border)" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Award Marks (0-{a.marks}):</label>
                                <input 
                                  type="number" 
                                  min="0" 
                                  max={a.marks} 
                                  value={marksToAward}
                                  onChange={(e) => setMarksToAward(e.target.value)}
                                  className="form-control"
                                  style={{ width: "80px", padding: "0.25rem 0.5rem" }}
                                  autoFocus
                                />
                                <button 
                                  className="btn btn-primary btn-sm" 
                                  disabled={isSubmitting}
                                  onClick={() => handleGradeSubmit(a.question_id, Number(a.marks))}
                                >
                                  {isSubmitting ? "Saving..." : "Save"}
                                </button>
                                <button 
                                  className="btn btn-ghost btn-sm"
                                  disabled={isSubmitting}
                                  onClick={() => setGradingQuestion(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div style={{ fontSize: "0.82rem", color: "var(--color-muted)" }}>
                          <span>Student chose: <strong>{a.selected_option !== null ? (opts[a.selected_option] || `Option ${a.selected_option}`) : "No answer"}</strong></span>
                          {!a.is_correct && <span style={{ marginLeft: "0.75rem" }}>· Correct: <strong style={{ color: "var(--color-success)" }}>{opts[a.correct_answer] || `Option ${a.correct_answer}`}</strong></span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
