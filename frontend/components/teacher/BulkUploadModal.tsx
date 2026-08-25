import { useState, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import { API_BASE } from "../../lib/api";
import { api } from "../../lib/api";
import { Modal } from "../ui/Modal";

type ParsedQuestion = {
  questionText: string;
  options: string[];
  correctAnswer: number;
  marks: number;
  error?: string;
};

type BulkUploadModalProps = {
  subjectId: number;
  onClose: () => void;
  onSuccess: () => void;
};

const ACCEPTED_EXTENSIONS = [".xlsx", ".csv", ".docx", ".txt"];
const ACCEPTED_MIME =
  ".xlsx,.csv,.docx,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

export function BulkUploadModal({ subjectId, onClose, onSuccess }: BulkUploadModalProps) {
  const [step, setStep] = useState<"upload" | "mapping" | "preview" | "uploading">("upload");
  const [fileType, setFileType] = useState<"excel" | "word" | "text" | null>(null);

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
    question: "", optionA: "", optionB: "", optionC: "", optionD: "", correctAnswer: "", marks: "",
  });

  // Parsed questions (shared between word/text and excel after mapping)
  const [parsedQuestions, setParsedQuestions] = useState<ParsedQuestion[]>([]);

  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [uploadLog, setUploadLog] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ────────────────────── FILE TYPE HELPERS ────────────────────── */

  function detectFileType(file: File): "excel" | "word" | "text" | null {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "xlsx" || ext === "csv") return "excel";
    if (ext === "docx") return "word";
    if (ext === "txt") return "text";
    return null;
  }

  /* ────────────────────── VALIDATION ────────────────────── */

  function validateFile(file: File): string | null {
    const type = detectFileType(file);
    if (!type) return "Unsupported file format. Please upload .xlsx, .csv, .docx, or .txt";
    if (file.size > 5 * 1024 * 1024) return "File exceeds 5MB limit.";
    return null;
  }

  /* ────────────────────── EXCEL PARSING ────────────────────── */

  function parseExcel(buffer: ArrayBuffer, fileName: string): void {
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error("Workbook contains no sheets.");
    const sheet = workbook.Sheets[sheetName];

    const jsonData = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
    if (jsonData.length < 2) throw new Error("Sheet is empty or has no data rows (need at least a header + 1 row).");

    // Find the header row (first row with at least 3 non-empty cells)
    let headerIdx = 0;
    for (let i = 0; i < Math.min(5, jsonData.length); i++) {
      const nonEmpty = (jsonData[i] as any[]).filter((c) => c !== null && c !== undefined && String(c).trim() !== "").length;
      if (nonEmpty >= 3) { headerIdx = i; break; }
    }

    const rawHeaders = (jsonData[headerIdx] as any[]) ?? [];
    const headers = rawHeaders.map((h: any, i: number) => {
      const s = String(h ?? "").trim();
      return s || `Column ${i + 1}`;
    });
    setColumns(headers);

    const rows = XLSX.utils.sheet_to_json(sheet, { header: headerIdx + 1 });
    setData(rows);

    // Auto-map headers
    const findMatch = (keywords: string[]) =>
      headers.find((h) => keywords.some((k) => h.toLowerCase().includes(k))) || "";
    setMapping({
      question: findMatch(["question", "text", "query", "stem"]),
      optionA: findMatch(["option a", "opt a", "choice a", "a)", "a.", "(a)"]),
      optionB: findMatch(["option b", "opt b", "choice b", "b)", "b.", "(b)"]),
      optionC: findMatch(["option c", "opt c", "choice c", "c)", "c.", "(c)"]),
      optionD: findMatch(["option d", "opt d", "choice d", "d)", "d.", "(d)"]),
      correctAnswer: findMatch(["correct", "answer", "ans", "key"]),
      marks: findMatch(["mark", "score", "point", "pts"]),
    });
    setFileType("excel");
    setStep("mapping");
  }

  /* ────────────────────── WORD PARSING ────────────────────── */

  async function parseWord(buffer: ArrayBuffer): Promise<void> {
    // mammoth handles .docx only; returns raw text
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    const text = result.value;
    if (!text || !text.trim()) throw new Error("Word document appears to be empty.");

    const questions = parseStructuredText(text);
    if (questions.length === 0) {
      throw new Error(
        "Could not detect any questions. Expected format:\n\n" +
          "1. Question text here?\n" +
          "A) Option 1\n" +
          "B) Option 2\n" +
          "C) Option 3\n" +
          "D) Option 4\n" +
          "Answer: A\n\n" +
        "Tips: Questions must start with a number (1, 2, …) or 'Q'. " +
        "Options must start with A, B, C, or D. " +
        "Answer line must say 'Answer: X' where X is A–D."
      );
    }
    setParsedQuestions(questions);
    setFileType("word");
    setStep("preview");
  }

  /* ────────────────────── PLAIN TEXT PARSING ────────────────────── */

  function parseText(buffer: ArrayBuffer): void {
    const decoder = new TextDecoder("utf-8");
    const text = decoder.decode(buffer);
    if (!text.trim()) throw new Error("Text file appears to be empty.");

    const questions = parseStructuredText(text);
    if (questions.length === 0) {
      throw new Error(
        "Could not detect any questions. Expected format:\n\n" +
          "1. Question text here?\n" +
          "A) Option 1\n" +
          "B) Option 2\n" +
          "C) Option 3\n" +
          "D) Option 4\n" +
          "Answer: A\n\n" +
        "Questions must start with a number or 'Q'. Options start with A–D."
      );
    }
    setParsedQuestions(questions);
    setFileType("text");
    setStep("preview");
  }

  /* ────────────────────── SHARED TEXT PARSER (Word / TXT) ────────────────────── */

  function parseStructuredText(text: string): ParsedQuestion[] {
    // Normalise line endings, collapse Windows \r\n, and strip non-breaking / Unicode spaces
    const normalized = text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/[\u00a0\u2009\u200b\u202f\u2060\ufeff]/g, " "); // NBSP + other invisible chars

    // Split on lines that look like the START of a new question:
    //   "1." / "1)" / "Q1." / "Q1)" at the beginning of a line.
    // Use new RegExp() to avoid TS static-analysis errors on lookbehind in older targets.
    let blocks: string[];
    try {
      // ES2018 lookbehind – supported in all modern browsers/Node
      // eslint-disable-next-line prefer-regex-literals
      const blockSplitter = new RegExp("(?:^|(?<=\\n))(?=(?:\\d{1,3}[.)][\\s\\u00a0])|(?:Q\\s*\\d+[.)\\s]))", "gm");
      blocks = normalized.split(blockSplitter).filter((b) => b.trim().length > 0);
    } catch {
      // Fallback for environments without lookbehind support
      blocks = normalized.split(/\n(?=\d{1,3}[.)][\s]|Q\s*\d+[.)\s])/).filter((b) => b.trim().length > 0);
    }

    // If the split didn't work (e.g. no numeric prefixes found), try a line-by-line approach
    if (blocks.length <= 1) {
      return parseLineByLine(normalized);
    }

    return blocksToQuestions(blocks);
  }

  /** Fallback: group lines by detecting question-start patterns manually */
  function parseLineByLine(text: string): ParsedQuestion[] {
    const lines = text.split("\n").map((l) => l.trim()).filter((l) => l);
    const groups: string[][] = [];
    let current: string[] = [];

    for (const line of lines) {
      if (/^\d{1,3}[.)][\s]/.test(line) || /^Q\s*\d+[.)\s]/i.test(line)) {
        if (current.length > 0) groups.push(current);
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) groups.push(current);

    return blocksToQuestions(groups.map((g) => g.join("\n")));
  }

  function blocksToQuestions(blocks: string[]): ParsedQuestion[] {
    const questions: ParsedQuestion[] = [];

    for (const block of blocks) {
      const lines = block.split("\n").map((l) => l.trim()).filter((l) => l);
      if (lines.length === 0) continue;

      let qText = "";
      const opts: string[] = [];
      let ans = -1;
      let marks = 1;

      for (const line of lines) {
        // Option lines: "A) …" / "A. …" / "(A) …" / "A …" — allow optional space after bracket
        // Also handles cases where mammoth strips the space: "A)Option"
        if (/^[A-D][.)][\s]*/i.test(line) && !/^(?:Answer|Ans|Correct)/i.test(line)) {
          const cleaned = line
            .replace(/^\(?[A-D]\)?[.)][\s]*/i, "")
            .trim();
          if (cleaned) opts.push(cleaned);
        }
        // Parenthesised: (A) …
        else if (/^\([A-D]\)[\s]*/i.test(line)) {
          const cleaned = line.replace(/^\([A-D]\)[\s]*/i, "").trim();
          if (cleaned) opts.push(cleaned);
        }
        // Answer line
        else if (/^(?:Answer|Ans|Correct)[:\s]*([A-Da-d])\b/i.test(line)) {
          const m = line.match(/^(?:Answer|Ans|Correct)[:\s]*([A-Da-d])/i);
          if (m) {
            const letter = m[1].toUpperCase();
            ans = letter.charCodeAt(0) - 65; // A=0, B=1, …
          }
        }
        // Marks line
        else if (/^(?:Marks?|Score|Points?)[:\s]*(\d+)/i.test(line)) {
          const m = line.match(/^(?:Marks?|Score|Points?)[:\s]*(\d+)/i);
          if (m) marks = parseInt(m[1], 10) || 1;
        }
        // Otherwise: question text
        else {
          // Strip leading "1. " / "Q1. " numbering
          const stripped = line
            .replace(/^\d{1,3}[.)]\s*/, "")
            .replace(/^Q\s*\d+[.)\s]*/i, "")
            .trim();
          if (stripped) {
            if (qText) qText += " ";
            qText += stripped;
          }
        }
      }

      if (qText && opts.length >= 2) {
        while (opts.length < 4) opts.push("");
        if (ans < 0) ans = 0;
        questions.push({
          questionText: qText.trim(),
          options: opts.slice(0, 4),
          correctAnswer: ans,
          marks,
        });
      }
    }

    return questions;
  }

  /* ────────────────────── FILE HANDLER ────────────────────── */

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setUploadLog([]);

    const vErr = validateFile(file);
    if (vErr) { setError(vErr); return; }

    try {
      const buffer = await file.arrayBuffer();
      const type = detectFileType(file);

      if (type === "excel") {
        parseExcel(buffer, file.name);
      } else if (type === "word") {
        parseWord(buffer);
      } else if (type === "text") {
        parseText(buffer);
      }
    } catch (err: any) {
      setError(err.message || "Failed to process file.");
    }
  }, []);

  /* ────────────────────── EXCEL → MAPPED QUESTIONS ────────────────────── */

  function excelRowToQuestion(row: any, idx: number): ParsedQuestion {
    const qText = String(row[mapping.question] ?? "").trim();
    const oA = String(row[mapping.optionA] ?? "").trim();
    const oB = String(row[mapping.optionB] ?? "").trim();
    const oC = String(row[mapping.optionC] ?? "").trim();
    const oD = String(row[mapping.optionD] ?? "").trim();
    const ansRaw = String(row[mapping.correctAnswer] ?? "").trim().toUpperCase();
    const marksRaw = parseInt(String(row[mapping.marks] ?? ""), 10);

    let cAns = 0;
    if (ansRaw === "A" || ansRaw === "1") cAns = 0;
    else if (ansRaw === "B" || ansRaw === "2") cAns = 1;
    else if (ansRaw === "C" || ansRaw === "3") cAns = 2;
    else if (ansRaw === "D" || ansRaw === "4") cAns = 3;
    else if (ansRaw === oA.toUpperCase() && oA) cAns = 0;
    else if (ansRaw === oB.toUpperCase() && oB) cAns = 1;
    else if (ansRaw === oC.toUpperCase() && oC) cAns = 2;
    else if (ansRaw === oD.toUpperCase() && oD) cAns = 3;

    const q: ParsedQuestion = {
      questionText: qText || `Question ${idx + 1}`,
      options: [oA, oB, oC, oD],
      correctAnswer: cAns,
      marks: isNaN(marksRaw) || marksRaw < 1 ? 1 : marksRaw,
    };

    if (!qText) q.error = "Missing question text";
    if (!oA && !oB) q.error = "Missing options";

    return q;
  }

  /* ────────────────────── CONFIRM MAPPING → PREVIEW ────────────────────── */

  const handleMappingConfirm = () => {
    if (!mapping.question) {
      setError("Please map the Question column.");
      return;
    }
    const questions = data.map((row, i) => excelRowToQuestion(row, i));
    setParsedQuestions(questions);
    setStep("preview");
  };

  /* ────────────────────── UPLOAD (uses backend bulk endpoint) ────────────────────── */

  const handleUpload = async () => {
    setStep("uploading");
    setError("");
    setUploadLog([]);

    const total = parsedQuestions.length;
    let completed = 0;
    let failed = 0;
    const logs: string[] = [];

    try {
      // Try bulk endpoint first (faster, single request)
      const payload = parsedQuestions
        .filter((q) => !q.error)
        .map((q, i) => ({
          subject_id: subjectId,
          question_text: q.questionText,
          question_type: "objective" as const,
          options: q.options,
          correct_answer: q.correctAnswer,
          marks: q.marks,
          order_index: i,
        }));

      if (payload.length === 0) {
        setError("No valid questions to upload.");
        setStep("preview");
        return;
      }

      // Attempt bulk endpoint
      let bulkOk = false;
      try {
        const res = await fetch(`${API_BASE}/api/questions/bulk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ questions: payload }),
        });
        if (res.ok) {
          const body = await res.json().catch(() => ({}));
          const created = body?.data?.created ?? payload.length;
          completed = created;
          bulkOk = true;
          logs.push(`Bulk upload successful: ${created} questions created.`);
        }
      } catch {
        // Bulk endpoint may not exist — fall through to individual uploads
      }

      // Fallback: individual createQuestion calls
      if (!bulkOk) {
        for (let i = 0; i < payload.length; i++) {
          try {
            await api.createQuestion(payload[i]);
            completed++;
          } catch (err: any) {
            failed++;
            logs.push(`Q${i + 1}: ${err.message || "Failed"}`);
          }
          setProgress(Math.round(((i + 1) / payload.length) * 100));
        }
        if (failed > 0) logs.push(`${failed} question(s) failed to upload.`);
      }

      setUploadLog(logs);
      if (completed > 0 && failed === 0) {
        onSuccess();
      } else if (completed > 0) {
        setStep("preview"); // partial success — let them review
      } else {
        setError("All questions failed to upload.");
        setStep("preview");
      }
    } catch (err: any) {
      setError(err.message || "Upload failed");
      setStep("preview");
    }
  };

  /* ────────────────────── TEMPLATE DOWNLOAD ────────────────────── */

  const downloadTemplate = (format: "xlsx" | "csv" | "txt") => {
    if (format === "txt") {
      const content = [
        "1. What is the capital of Nigeria?",
        "A) Lagos",
        "B) Abuja",
        "C) Kano",
        "D) Ibadan",
        "Answer: B",
        "",
        "2. Which planet is closest to the Sun?",
        "A) Venus",
        "B) Earth",
        "C) Mercury",
        "D) Mars",
        "Answer: C",
        "",
        "3. What is 5 + 3?",
        "A) 6",
        "B) 7",
        "C) 8",
        "D) 9",
        "Answer: C",
      ].join("\n");
      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "question_template.txt";
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    // Excel / CSV
    const rows = [
      ["Question", "Option A", "Option B", "Option C", "Option D", "Correct Answer", "Marks"],
      [
        "What is the capital of Nigeria?",
        "Lagos",
        "Abuja",
        "Kano",
        "Ibadan",
        "B",
        1,
      ],
      [
        "Which planet is closest to the Sun?",
        "Venus",
        "Earth",
        "Mercury",
        "Mars",
        "C",
        1,
      ],
      [
        "What is 5 + 3?",
        "6",
        "7",
        "8",
        "9",
        "C",
        2,
      ],
    ];

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Questions");

    if (format === "csv") {
      XLSX.writeFile(wb, "question_template.csv", { bookType: "csv" });
    } else {
      XLSX.writeFile(wb, "question_template.xlsx");
    }
  };

  /* ────────────────────── RENDER HELPERS ────────────────────── */

  const validCount = parsedQuestions.filter((q) => !q.error).length;
  const errorCount = parsedQuestions.filter((q) => q.error).length;

  /* ────────────────────── RENDER ────────────────────── */

  return (
    <Modal open={true} onClose={onClose} size="md">
      <h2 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "0.25rem" }}>Bulk Upload Questions</h2>
      <p style={{ fontSize: "0.85rem", color: "var(--color-muted)", marginBottom: "1.5rem" }}>
        Import questions from Excel (.xlsx/.csv), Word (.docx), or plain text (.txt).
      </p>

      {error && (
        <div style={{ background: "#fef2f2", color: "#dc2626", padding: "0.75rem 1rem", borderRadius: "8px", border: "1px solid #fecaca", marginBottom: "1rem", fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>
          {error}
        </div>
      )}

      {/* ═══════════ STEP 1: UPLOAD ═══════════ */}
      {step === "upload" && (
        <div>
          {/* Drop zone */}
          <div
            style={{ border: "2px dashed #cbd5e1", borderRadius: "12px", padding: "2.5rem 2rem", textAlign: "center", background: "#f8fafc", cursor: "pointer", transition: "all 0.15s" }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) {
                const dt = new DataTransfer();
                dt.items.add(file);
                if (fileInputRef.current) { fileInputRef.current.files = dt.files; }
                handleFileUpload({ target: { files: dt.files } } as any);
              }
            }}
          >
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem", opacity: 0.4 }}>📄</div>
            <div style={{ fontWeight: 600, color: "#334155", fontSize: "0.95rem" }}>Click to browse or drag &amp; drop</div>
            <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: "0.4rem" }}>
              .xlsx &middot; .csv &middot; .docx &middot; .txt &nbsp; (max 5 MB)
            </div>
          </div>
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept={ACCEPTED_MIME} style={{ display: "none" }} />

          {/* Template downloads */}
          <div style={{ marginTop: "1.25rem", padding: "1rem", background: "#f1f5f9", borderRadius: "8px" }}>
            <strong style={{ fontSize: "0.85rem", color: "#0f172a" }}>Download a template:</strong>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
              <button className="btn btn-ghost btn-sm" style={{ fontSize: "0.8rem", border: "1px solid #e2e8f0" }} onClick={() => downloadTemplate("xlsx")}>
                📊 Excel (.xlsx)
              </button>
              <button className="btn btn-ghost btn-sm" style={{ fontSize: "0.8rem", border: "1px solid #e2e8f0" }} onClick={() => downloadTemplate("csv")}>
                📋 CSV (.csv)
              </button>
              <button className="btn btn-ghost btn-sm" style={{ fontSize: "0.8rem", border: "1px solid #e2e8f0" }} onClick={() => downloadTemplate("txt")}>
                📝 Text (.txt)
              </button>
            </div>
          </div>

          {/* Format tips */}
          <div style={{ marginTop: "1rem", padding: "1rem", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: "0.8rem", color: "#475569" }}>
            <strong style={{ display: "block", marginBottom: "0.35rem", color: "#0f172a" }}>Expected format for Word / Text files:</strong>
            <pre style={{ margin: 0, fontFamily: "monospace", fontSize: "0.78rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{`1. What is 2 + 2?
A) 3
B) 4
C) 5
D) 6
Answer: B

2. Which of these is a planet?
A) Sun
B) Moon
C) Mars
D) Star
Answer: C`}</pre>
          </div>
        </div>
      )}

      {/* ═══════════ STEP 2: COLUMN MAPPING (Excel only) ═══════════ */}
      {step === "mapping" && fileType === "excel" && (
        <div>
          <div style={{ padding: "0.75rem 1rem", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0", marginBottom: "1.25rem" }}>
            <strong style={{ fontSize: "0.9rem" }}>Map your columns</strong>
            <p style={{ margin: "0.2rem 0 0", fontSize: "0.8rem", color: "#64748b" }}>
              Match each field to a column in your spreadsheet. Rows with blank question text will be skipped.
            </p>
          </div>

          <div style={{ display: "grid", gap: "0.75rem", maxHeight: "38vh", overflowY: "auto", paddingRight: "0.25rem" }}>
            {([
              { key: "question", label: "Question Text", required: true },
              { key: "optionA", label: "Option A" },
              { key: "optionB", label: "Option B" },
              { key: "optionC", label: "Option C" },
              { key: "optionD", label: "Option D" },
              { key: "correctAnswer", label: "Correct Answer (A/B/C/D or 1/2/3/4)" },
              { key: "marks", label: "Marks (optional — defaults to 1)" },
            ] as const).map((f) => (
              <div key={f.key} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", alignItems: "center" }}>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#334155" }}>
                  {f.label}{(f as any).required && <span style={{ color: "#dc2626" }}> *</span>}
                </label>
                <select
                  className="select"
                  value={(mapping as any)[f.key]}
                  onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}
                  style={{ fontSize: "0.85rem" }}
                >
                  <option value="">— Skip this field —</option>
                  {columns.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div style={{ marginTop: "1rem", fontSize: "0.8rem", color: "#64748b" }}>
            {data.length} row(s) found. {data.length < 2 ? "⚠ Need at least 1 data row." : ""}
          </div>
        </div>
      )}

      {/* ═══════════ STEP 2b: PREVIEW (Word / Text) ═══════════ */}
      {step === "preview" && (fileType === "word" || fileType === "text") && parsedQuestions.length > 0 && (
        <div>
          <div style={{ padding: "0.75rem 1rem", background: "#f0fdf4", borderRadius: "8px", border: "1px solid #bbf7d0", marginBottom: "1rem" }}>
            <strong style={{ color: "#16a34a" }}>✅ Detected {parsedQuestions.length} question(s)</strong>
            <p style={{ margin: "0.2rem 0 0", fontSize: "0.8rem", color: "#15803d" }}>
              Review the parsed questions below before uploading.
            </p>
          </div>
          <div style={{ maxHeight: "40vh", overflowY: "auto" }}>
            {parsedQuestions.slice(0, 20).map((q, i) => (
              <div key={i} style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid #e2e8f0", fontSize: "0.82rem" }}>
                <div style={{ fontWeight: 600 }}>Q{i + 1}. {q.questionText.slice(0, 100)}{q.questionText.length > 100 ? "…" : ""}</div>
                <div style={{ color: "#64748b", marginTop: "0.2rem" }}>
                  {q.options.map((o, j) => o ? `${String.fromCharCode(65 + j)}) ${o}` : null).filter(Boolean).join(" · ")}
                  {" "}&nbsp;→ Answer: {String.fromCharCode(65 + q.correctAnswer)}
                </div>
              </div>
            ))}
            {parsedQuestions.length > 20 && (
              <div style={{ padding: "0.5rem", textAlign: "center", color: "#64748b", fontSize: "0.8rem" }}>
                … and {parsedQuestions.length - 20} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════ STEP 3: PREVIEW BEFORE UPLOAD ═══════════ */}
      {step === "preview" && (
        <div>
          {/* Summary bar */}
          <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 120, padding: "0.75rem", background: "#f0fdf4", borderRadius: "8px", border: "1px solid #bbf7d0", textAlign: "center" }}>
              <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#16a34a" }}>{validCount}</div>
              <div style={{ fontSize: "0.75rem", color: "#15803d" }}>Valid</div>
            </div>
            {errorCount > 0 && (
              <div style={{ flex: 1, minWidth: 120, padding: "0.75rem", background: "#fef2f2", borderRadius: "8px", border: "1px solid #fecaca", textAlign: "center" }}>
                <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#dc2626" }}>{errorCount}</div>
                <div style={{ fontSize: "0.75rem", color: "#991b1b" }}>Skipped</div>
              </div>
            )}
          </div>

          {/* Upload log */}
          {uploadLog.length > 0 && (
            <div style={{ padding: "0.75rem", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0", marginBottom: "1rem", fontSize: "0.8rem", maxHeight: "100px", overflowY: "auto" }}>
              {uploadLog.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          )}

          {/* Scrollable question list */}
          <div style={{ maxHeight: "35vh", overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: "8px" }}>
            {parsedQuestions.slice(0, 50).map((q, i) => (
              <div
                key={i}
                style={{
                  padding: "0.6rem 0.75rem",
                  borderBottom: "1px solid #f1f5f9",
                  fontSize: "0.82rem",
                  background: q.error ? "#fef2f2" : "#fff",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontWeight: 600, flex: 1 }}>
                    Q{i + 1}. {q.questionText.slice(0, 80)}{q.questionText.length > 80 ? "…" : ""}
                  </span>
                  {q.marks > 1 && <span style={{ fontSize: "0.7rem", color: "#64748b", marginLeft: "0.5rem" }}>{q.marks}m</span>}
                </div>
                {q.error ? (
                  <div style={{ color: "#dc2626", fontSize: "0.78rem", marginTop: "0.15rem" }}>⚠ {q.error}</div>
                ) : (
                  <div style={{ color: "#64748b", fontSize: "0.78rem", marginTop: "0.15rem" }}>
                    {q.options.map((o, j) => o ? `${String.fromCharCode(65 + j)}) ${o.slice(0, 30)}` : null).filter(Boolean).join(" · ")}
                    {" "}&nbsp;→ <strong>{String.fromCharCode(65 + q.correctAnswer)}</strong>
                  </div>
                )}
              </div>
            ))}
            {parsedQuestions.length > 50 && (
              <div style={{ padding: "0.5rem", textAlign: "center", color: "#64748b", fontSize: "0.8rem" }}>
                … and {parsedQuestions.length - 50} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════ STEP 4: UPLOADING ═══════════ */}
      {step === "uploading" && (
        <div style={{ padding: "2rem 0", textAlign: "center" }}>
          <div style={{ width: "100%", height: "8px", background: "#e2e8f0", borderRadius: "99px", overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", background: "#0f172a", transition: "width 0.2s" }} />
          </div>
          <div style={{ marginTop: "1rem", fontWeight: 600, color: "#0f172a", fontSize: "0.9rem" }}>
            Uploading… {progress}%
          </div>
        </div>
      )}

      {/* ═══════════ FOOTER ACTIONS ═══════════ */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid #f1f5f9" }}>
        {step !== "uploading" && (
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        )}
        {step === "mapping" && fileType === "excel" && (
          <button className="btn btn-primary" onClick={handleMappingConfirm}>
            Preview {data.length} Question{data.length !== 1 ? "s" : ""}
          </button>
        )}
        {step === "preview" && validCount > 0 && (
          <button className="btn btn-primary" onClick={handleUpload}>
            Upload {validCount} Question{validCount !== 1 ? "s" : ""}
          </button>
        )}
      </div>
    </Modal>
  );
}
