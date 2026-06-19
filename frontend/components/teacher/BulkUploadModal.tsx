import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import { api } from "../../lib/api";
import { Modal } from "../ui/Modal";

type BulkUploadModalProps = {
  subjectId: number;
  onClose: () => void;
  onSuccess: () => void;
};

export function BulkUploadModal({ subjectId, onClose, onSuccess }: BulkUploadModalProps) {
  const [step, setStep] = useState<"upload" | "mapping" | "uploading">("upload");
  const [fileType, setFileType] = useState<"excel" | "word" | null>(null);
  
  // Excel states
  const [columns, setColumns] = useState<string[]>([]);
  const [data, setData] = useState<any[]>([]);
  const [mapping, setMapping] = useState<{
    question: string;
    optionA: string;
    optionB: string;
    optionC: string;
    optionD: string;
    correctAnswer: string;
    marks: string;
  }>({
    question: "", optionA: "", optionB: "", optionC: "", optionD: "", correctAnswer: "", marks: ""
  });

  // Word states
  const [wordData, setWordData] = useState<{ questionText: string; options: string[]; correctAnswer: number }[]>([]);

  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError("");
    const isWord = file.name.endsWith(".docx");
    const isExcel = file.name.endsWith(".xlsx") || file.name.endsWith(".csv");

    if (!isWord && !isExcel) {
      setError("Please upload a .xlsx, .csv, or .docx file");
      return;
    }

    setFileType(isExcel ? "excel" : "word");

    try {
      if (isExcel) {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
        
        if (jsonData.length < 2) throw new Error("File seems empty or missing headers");
        
        const headers = jsonData[0] as string[];
        setColumns(headers);
        
        const rows = XLSX.utils.sheet_to_json(firstSheet);
        setData(rows);
        
        // Auto-map if headers match common names
        const findMatch = (keywords: string[]) => headers.find(h => keywords.some(k => h.toLowerCase().includes(k))) || "";
        setMapping({
          question: findMatch(["question", "text", "query"]),
          optionA: findMatch(["option a", "opt a", "choice a", "a"]),
          optionB: findMatch(["option b", "opt b", "choice b", "b"]),
          optionC: findMatch(["option c", "opt c", "choice c", "c"]),
          optionD: findMatch(["option d", "opt d", "choice d", "d"]),
          correctAnswer: findMatch(["correct", "answer", "ans"]),
          marks: findMatch(["mark", "score", "point"])
        });
        
        setStep("mapping");
      } else if (isWord) {
        const buffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: buffer });
        const text = result.value;
        
        // Very basic parsing for word document:
        // Assumes format:
        // 1. Question text here?
        // A) Option 1
        // B) Option 2
        // C) Option 3
        // D) Option 4
        // Answer: A
        
        const blocks = text.split(/\n\s*\n/).filter(b => b.trim());
        const parsedQuestions = [];
        
        let currentQuestion = "";
        let currentOptions: string[] = [];
        let currentAnswer = 0;
        
        for (const block of blocks) {
          const lines = block.split("\n").map(l => l.trim()).filter(l => l);
          if (lines.length === 0) continue;
          
          let qText = "";
          let opts = [];
          let ans = 0;
          
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.match(/^[A-D][\.\)]\s/i)) {
              opts.push(line.replace(/^[A-D][\.\)]\s*/i, "").trim());
            } else if (line.match(/^Answer:/i)) {
              const letter = line.replace(/^Answer:\s*/i, "").trim().toUpperCase();
              if (letter === "A") ans = 0;
              if (letter === "B") ans = 1;
              if (letter === "C") ans = 2;
              if (letter === "D") ans = 3;
            } else {
              if (i === 0) qText = line.replace(/^\d+[\.\)]\s*/, "");
              else qText += "\n" + line;
            }
          }
          
          if (qText && opts.length > 0) {
            while (opts.length < 4) opts.push("");
            parsedQuestions.push({ questionText: qText, options: opts.slice(0,4), correctAnswer: ans });
          }
        }
        
        if (parsedQuestions.length === 0) {
          throw new Error("Could not detect any questions in the Word document. Make sure you use standard formatting (1. Question \\n A) Option \\n Answer: A). Try Excel/CSV for better reliability.");
        }
        
        setWordData(parsedQuestions);
        setStep("mapping");
      }
    } catch (err: any) {
      setError(err.message || "Failed to process file");
    }
  };

  const handleUpload = async () => {
    setStep("uploading");
    setError("");
    
    let total = 0;
    let completed = 0;
    
    try {
      if (fileType === "excel") {
        total = data.length;
        for (let i = 0; i < data.length; i++) {
          const row = data[i];
          const qText = row[mapping.question] || `Question ${i+1}`;
          const oA = row[mapping.optionA] || "";
          const oB = row[mapping.optionB] || "";
          const oC = row[mapping.optionC] || "";
          const oD = row[mapping.optionD] || "";
          
          let cAns = 0;
          const ansRaw = String(row[mapping.correctAnswer] || "").toUpperCase();
          if (ansRaw === "A" || ansRaw === "1" || ansRaw === oA) cAns = 0;
          else if (ansRaw === "B" || ansRaw === "2" || ansRaw === oB) cAns = 1;
          else if (ansRaw === "C" || ansRaw === "3" || ansRaw === oC) cAns = 2;
          else if (ansRaw === "D" || ansRaw === "4" || ansRaw === oD) cAns = 3;
          
          const marks = parseInt(row[mapping.marks]) || 1;
          
          await api.createQuestion({
            subject_id: subjectId,
            question_text: qText,
            question_type: "objective",
            options: [oA, oB, oC, oD],
            correct_answer: cAns,
            marks: marks
          });
          
          completed++;
          setProgress(Math.round((completed / total) * 100));
        }
      } else {
        total = wordData.length;
        for (let i = 0; i < wordData.length; i++) {
          const q = wordData[i];
          await api.createQuestion({
            subject_id: subjectId,
            question_text: q.questionText,
            question_type: "objective",
            options: q.options,
            correct_answer: q.correctAnswer,
            marks: 1
          });
          
          completed++;
          setProgress(Math.round((completed / total) * 100));
        }
      }
      
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Failed to upload questions");
      setStep("mapping"); // let them try again
    }
  };

  return (
    <Modal open={true} onClose={onClose} size="md">
      <h2>Bulk Upload Questions</h2>
      <p className="modal-desc">Upload questions from an Excel (.xlsx/.csv) or Word (.docx) file.</p>
      
      {error && <div style={{ background: "#fef2f2", color: "#dc2626", padding: "1rem", borderRadius: "8px", border: "1px solid #fecaca", marginBottom: "1rem", fontSize: "0.9rem" }}>{error}</div>}

      {step === "upload" && (
        <div style={{ marginTop: "1.5rem" }}>
          <div style={{ border: "2px dashed #cbd5e1", borderRadius: "12px", padding: "3rem 2rem", textAlign: "center", background: "#f8fafc", cursor: "pointer", transition: "all 0.2s" }} onClick={() => fileInputRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files?.[0]; if (file) { const dt = new DataTransfer(); dt.items.add(file); if (fileInputRef.current) { fileInputRef.current.files = dt.files; handleFileUpload({ target: { files: dt.files } } as any); } } }}>
            <div style={{ fontSize: "2rem", marginBottom: "1rem", opacity: 0.5 }}>📁</div>
            <div style={{ fontSize: "1rem", fontWeight: 600, color: "#334155" }}>Click to browse or drag & drop</div>
            <div style={{ fontSize: "0.85rem", color: "#64748b", marginTop: "0.5rem" }}>Supports .xlsx, .csv, and .docx files</div>
          </div>
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx,.csv,.docx" style={{ display: "none" }} />
          
          <div style={{ marginTop: "2rem", background: "#f1f5f9", padding: "1.25rem", borderRadius: "8px", fontSize: "0.85rem", color: "#475569" }}>
            <strong style={{ display: "block", marginBottom: "0.5rem", color: "#0f172a" }}>💡 Tips for successful upload:</strong>
            <ul style={{ margin: 0, paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <li><strong>Excel/CSV:</strong> Use columns for Question, Option A, Option B, Option C, Option D, and Correct Answer.</li>
              <li><strong>Word (.docx):</strong> Use strict formatting:<br/><code>1. What is 2+2?<br/>A) 1<br/>B) 4<br/>Answer: B</code></li>
            </ul>
          </div>
        </div>
      )}

      {step === "mapping" && fileType === "excel" && (
        <div style={{ marginTop: "1.5rem" }}>
          <div style={{ background: "#f8fafc", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0", marginBottom: "1.5rem" }}>
            <strong style={{ color: "#0f172a", fontSize: "0.9rem" }}>Map your columns</strong>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#64748b", marginTop: "0.25rem" }}>Select which column from your file corresponds to each field.</p>
          </div>
          
          <div style={{ display: "grid", gap: "1rem", maxHeight: "40vh", overflowY: "auto", paddingRight: "0.5rem" }}>
            {[
              { key: "question", label: "Question Text" },
              { key: "optionA", label: "Option A" },
              { key: "optionB", label: "Option B" },
              { key: "optionC", label: "Option C" },
              { key: "optionD", label: "Option D" },
              { key: "correctAnswer", label: "Correct Answer (A, B, C, D)" },
              { key: "marks", label: "Marks (Optional)" }
            ].map(f => (
              <div key={f.key} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", alignItems: "center" }}>
                <label style={{ fontSize: "0.9rem", fontWeight: 600, color: "#334155" }}>{f.label}</label>
                <select className="select" value={(mapping as any)[f.key]} onChange={(e) => setMapping({...mapping, [f.key]: e.target.value})}>
                  <option value="">-- Ignore / Empty --</option>
                  {columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === "mapping" && fileType === "word" && (
        <div style={{ marginTop: "1.5rem" }}>
          <div style={{ background: "#f0fdf4", padding: "1.5rem", borderRadius: "8px", border: "1px solid #bbf7d0", textAlign: "center" }}>
            <div style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>✅</div>
            <strong style={{ color: "#16a34a", fontSize: "1rem" }}>Successfully parsed {wordData.length} questions!</strong>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#15803d", marginTop: "0.25rem" }}>Ready to upload to your subject.</p>
          </div>
        </div>
      )}

      {step === "uploading" && (
        <div style={{ marginTop: "2.5rem", marginBottom: "1.5rem", textAlign: "center" }}>
          <div style={{ width: "100%", height: "8px", background: "#e2e8f0", borderRadius: "99px", overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", background: "#0f172a", transition: "width 0.2s" }} />
          </div>
          <div style={{ marginTop: "1rem", fontWeight: 600, color: "#0f172a" }}>Uploading... {progress}%</div>
        </div>
      )}

      <div className="modal-actions" style={{ marginTop: "2rem" }}>
        {step !== "uploading" && <button className="btn btn-ghost" onClick={onClose}>Cancel</button>}
        {step === "mapping" && <button className="btn btn-primary" onClick={handleUpload}>Start Upload</button>}
      </div>
    </Modal>
  );
}
