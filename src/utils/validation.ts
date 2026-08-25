export const MIN_PASSWORD_LENGTH = 8;

export function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

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

export function isValidSubjectDuration(n: number): boolean {
  return Number.isInteger(n) && n > 0 && n <= 360;
}

export function isValidExamDateTime(isoOrDate: string): boolean {
  if (!isoOrDate || typeof isoOrDate !== "string") return false;
  const t = Date.parse(isoOrDate);
  return Number.isFinite(t);
}

export function isExamDatetimeInFuture(isoOrDate: string): boolean {
  const t = Date.parse(isoOrDate);
  return Number.isFinite(t) && t >= Date.now() - 30_000;
}

export function isExamDatetimeEditValid(isoOrDate: string): boolean {
  return isValidExamDateTime(isoOrDate);
}

export function isValidRoleParam(role: string): role is "student" | "teacher" | "operator" | "guardian" {
  return role === "student" || role === "teacher" || role === "operator" || role === "guardian";
}

export function isPositiveIntId(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

export function sqlInt(value: unknown): number {
  if (value == null || value === "") return 0;
  return typeof value === "bigint" ? Number(value) : Number(value);
}

export function rowCount(row: { count?: unknown } | null | undefined): number {
  return sqlInt(row?.count ?? 0);
}

export function sameUserId(dbValue: unknown, tokenUserId: number): boolean {
  return sqlInt(dbValue) === tokenUserId;
}