/** Shared input validation for HTTP handlers (keeps server.ts readable). */

export const MIN_PASSWORD_LENGTH = 8;

export function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Normalize for storage and lookup (SQLite comparisons are case-sensitive by default). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(normalizeEmail(email));
}

export function isValidPassword(password: unknown): password is string {
  return typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH;
}

/** Exam duration in minutes per schema: 1–360 inclusive. */
export function isValidSubjectDuration(n: number): boolean {
  return Number.isInteger(n) && n > 0 && n <= 360;
}

export function isValidExamDateTime(isoOrDate: string): boolean {
  if (!isoOrDate || typeof isoOrDate !== "string") return false;
  const t = Date.parse(isoOrDate);
  return Number.isFinite(t);
}

/**
 * Ensure the scheduled datetime is strictly in the future (with a small
 * network-latency grace of 30s). Use ONLY when CREATING a new subject.
 */
export function isExamDatetimeInFuture(isoOrDate: string): boolean {
  const t = Date.parse(isoOrDate);
  // 30-second grace for form submission latency; NOT 60s in the past
  return Number.isFinite(t) && t >= Date.now() - 30_000;
}

/**
 * Allow any valid date when EDITING an existing subject.
 * The date may already be in the past (subject was live, now being reviewed).
 * We only require it to parse correctly.
 */
export function isExamDatetimeEditValid(isoOrDate: string): boolean {
  return isValidExamDateTime(isoOrDate);
}

export function isValidRoleParam(role: string): role is "student" | "teacher" | "operator" {
  return role === "student" || role === "teacher" || role === "operator";
}

export function isPositiveIntId(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}
