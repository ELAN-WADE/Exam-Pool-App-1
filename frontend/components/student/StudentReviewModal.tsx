import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type StudentReviewModalProps = {
  examId: number;
  subjectName: string;
  onClose: () => void;
};

export function StudentReviewModal({ examId, subjectName, onClose }: StudentReviewModalProps) {
  const [reviewData, setReviewData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    api.getExamReview(examId)
      .then((data) => {
        if (mounted) setReviewData(data);
      })
      .catch((err) => {
        if (mounted) setError(err.message || "Failed to load review data");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [examId]);

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 760, maxHeight: "90vh", overflowY: "auto", padding: "2.5rem", borderRadius: "12px", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem", borderBottom: "1px solid #e2e8f0", paddingBottom: "1.5rem" }}>
          <div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#0f172a", margin: 0 }}>Exam Review</h2>
            <p style={{ color: "#64748b", fontSize: "0.95rem", marginTop: "0.25rem" }}>
              {subjectName}
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ padding: "0.5rem" }}>✕</button>
        </div>
        
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "3rem 0" }}><div className="spinner" /></div>
        ) : error ? (
          <div style={{ textAlign: "center", color: "#dc2626", padding: "2rem" }}>{error}</div>
        ) : reviewData ? (
          <>
            <div style={{ display: "flex", gap: "1rem", marginBottom: "2rem", flexWrap: "wrap" }}>
              {[
                { label: "Score",     value: `${reviewData.exam?.score ?? 0} / ${reviewData.exam?.total_score ?? 0}` },
                { label: "Duration",  value: reviewData.exam?.end_time && reviewData.exam?.start_time
                    ? `${Math.round((new Date(reviewData.exam.end_time).getTime() - new Date(reviewData.exam.start_time).getTime()) / 60000)} min` : "—" },
                { label: "Submitted", value: reviewData.exam?.end_time
                    ? new Date(reviewData.exam.end_time).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—" },
              ].map((s) => (
                <div key={s.label} style={{ background: "#f8fafc", borderRadius: "8px", padding: "1rem 1.25rem", minWidth: "120px", border: "1px solid #e2e8f0", flex: 1 }}>
                  <div style={{ fontSize: "0.75rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600, marginBottom: "0.5rem" }}>{s.label}</div>
                  <div style={{ fontWeight: 700, fontSize: "1.25rem", color: "#0f172a" }}>{s.value}</div>
                </div>
              ))}
            </div>
            {(reviewData.answers ?? []).length === 0 ? (
              <p style={{ color: "#64748b", fontSize: "1rem", textAlign: "center", padding: "2rem 0" }}>No per-question data available.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                {(reviewData.answers as any[]).map((a, idx) => {
                  const opts = (() => { try { return JSON.parse(a.options_json || "[]"); } catch { return []; } })();
                  const isEssay = a.question_type === "essay";
                  
                  return (
                    <div key={a.id} style={{ background: a.is_correct ? "#f0fdf4" : "#fef2f2", border: `1px solid ${a.is_correct ? "#bbf7d0" : "#fecaca"}`, borderRadius: "8px", padding: "1.5rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem", gap: "1rem" }}>
                        <span style={{ fontWeight: 600, fontSize: "1.05rem", color: "#0f172a", lineHeight: 1.6 }}>
                          <span style={{ color: "#64748b", marginRight: "0.5rem" }}>Q{idx + 1}.</span>
                          {a.question_text}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                          <span style={{ fontSize: "0.85rem", fontWeight: 700, color: a.is_correct ? "#16a34a" : "#dc2626", background: a.is_correct ? "#dcfce7" : "#fee2e2", padding: "0.25rem 0.6rem", borderRadius: "999px" }}>
                            {a.marks_awarded} / {a.marks} marks
                          </span>
                        </div>
                      </div>
                      
                      {isEssay ? (
                        <div style={{ fontSize: "0.95rem", color: "#334155", background: "#ffffff", padding: "1rem", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                          <div style={{ marginBottom: "0.75rem" }}><strong style={{ color: "#0f172a" }}>Your response:</strong><br /> <span style={{ whiteSpace: "pre-wrap" }}>{a.essay_response || <em style={{ color: "#94a3b8" }}>No response provided</em>}</span></div>
                          {a.teacher_answer && <div style={{ paddingTop: "0.75rem", borderTop: "1px solid #f1f5f9" }}><strong style={{ color: "#0f172a" }}>Expected Answer/Rubric:</strong><br /> <span style={{ whiteSpace: "pre-wrap" }}>{a.teacher_answer}</span></div>}
                        </div>
                      ) : (
                        <div style={{ fontSize: "0.95rem", color: "#334155", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
                            <span style={{ color: "#64748b", width: "100px", flexShrink: 0 }}>Your Answer:</span>
                            <strong style={{ color: a.is_correct ? "#16a34a" : "#dc2626" }}>
                              {a.selected_option !== null ? (opts[a.selected_option] || `Option ${String.fromCharCode(65 + a.selected_option)}`) : "No answer"}
                            </strong>
                          </div>
                          {!a.is_correct && (
                            <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
                              <span style={{ color: "#64748b", width: "100px", flexShrink: 0 }}>Correct Answer:</span>
                              <strong style={{ color: "#16a34a" }}>
                                {opts[a.correct_answer] || `Option ${String.fromCharCode(65 + a.correct_answer)}`}
                              </strong>
                            </div>
                          )}
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
