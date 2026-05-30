/**
 * Shared grade/score utilities used across teacher results,
 * teacher students roster, student results, and student dashboard.
 *
 * Centralising here eliminates the 5-way duplication of pct/letter/badge logic.
 */

/** Compute percentage from raw score and total. Returns 0 if total is 0. */
export function scorePct(score: number | null | undefined, totalScore: number | null | undefined): number {
  const s = Number(score ?? 0);
  const t = Number(totalScore ?? 0);
  return t > 0 ? Math.round((s / t) * 100) : 0;
}

/** Convert a percentage to a letter grade (A/B/C/F). */
export function letterGrade(pct: number): "A" | "B" | "C" | "F" {
  if (pct >= 70) return "A";
  if (pct >= 55) return "B";
  if (pct >= 40) return "C";
  return "F";
}

/** CSS class name for badge based on percentage. */
export function gradeBadgeClass(pct: number): string {
  if (pct >= 55) return "badge-success";
  if (pct >= 40) return "badge-warning";
  return "badge-danger";
}

/** CSS color variable string for a percentage value. */
export function gradeColor(pct: number): string {
  if (pct >= 55) return "var(--color-success)";
  if (pct >= 40) return "var(--color-warning)";
  return "var(--color-danger)";
}

/**
 * Determine the exam window status for a subject.
 * Returns one of: "completed" | "in-progress" | "open" | "closed" | "upcoming" | "unpublished"
 */
export type ExamWindowStatus =
  | "completed"
  | "in-progress"
  | "open"
  | "closed"
  | "upcoming"
  | "unpublished";

export function examWindowStatus(subject: {
  is_published?: number | boolean;
  exam_datetime?: string | null;
  duration?: number | string | null;
  exam_status?: string | null;
}): ExamWindowStatus {
  if (subject.exam_status === "completed")   return "completed";
  if (subject.exam_status === "in-progress") return "in-progress";
  if (!subject.is_published)                 return "unpublished";

  const now   = Date.now();
  const start = subject.exam_datetime ? Date.parse(subject.exam_datetime) : 0;
  const end   = start + Number(subject.duration ?? 0) * 60_000;

  if (!start)          return "unpublished";
  if (now >= start && now < end) return "open";
  if (now >= end)                return "closed";
  return "upcoming";
}

/** Format seconds as MM:SS (or H:MM:SS when >= 3600s). */
export function formatCountdown(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

/** Format an ISO date string for display in en-GB locale. */
export function fmtDate(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", opts ?? {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
