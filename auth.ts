import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { Database } from "bun:sqlite";

const JWT_SECRET = Bun.env.JWT_SECRET || (() => {
  const generated = Bun.env.JWT_SECRET_GENERATED;
  if (!generated) {
    console.warn("⚠️  JWT_SECRET not set generating temporary one for this session");
    const secret = randomBytes(32).toString("hex");
    console.warn("   Set JWT_SECRET env var for production use: `bun run env:setup`");
    return secret;
  }
  return generated;
})();

const ACCESS_TTL_SECONDS = 15 * 60;      // 15 minutes
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours — legacy cookie max-age

let db: Database | null = null;
export function setAuthDb(database: Database) { db = database; }

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bufferToBase64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function hmacSha256(signingInput: string): Buffer {
  return createHmac("sha256", JWT_SECRET).update(signingInput, "utf8").digest();
}

function generateFingerprint(req: Request): string {
  const ua = req.headers.get("user-agent") || "";
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const raw = `${ua}|${ip}`;
  return createHmac("sha256", JWT_SECRET).update(raw).digest("hex").slice(0, 32);
}

export async function hashPassword(password: string): Promise<string> {
  return await Bun.password.hash(password, {
    algorithm: "argon2id",
    memoryCost: 8192,
    timeCost: 2,
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await Bun.password.verify(password, hash);
}

function base64UrlToBuffer(seg: string): Buffer | null {
  try {
    const padLen = (4 - (seg.length % 4)) % 4;
    return Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLen), "base64");
  } catch {
    return null;
  }
}

export function generateAccessToken(userId: number, role: string, jti: string, fp: string): string {
  const header = toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = toBase64Url(
    JSON.stringify({
      sub: userId,
      role,
      jti,
      fp,
      typ: "access",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + ACCESS_TTL_SECONDS,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = bufferToBase64Url(hmacSha256(signingInput));
  return `${signingInput}.${signature}`;
}

export function generateRefreshToken(userId: number, role: string, jti: string, fp: string): string {
  const header = toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = toBase64Url(
    JSON.stringify({
      sub: userId,
      role,
      jti,
      fp,
      typ: "refresh",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + REFRESH_TTL_SECONDS,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = bufferToBase64Url(hmacSha256(signingInput));
  return `${signingInput}.${signature}`;
}

export function generateTokenPair(userId: number, role: string, req: Request): { access: string; refresh: string; jti: string } {
  const fp = generateFingerprint(req);
  const jti = randomBytes(16).toString("hex");
  
  if (db) {
    const stmt = db.prepare(`
      INSERT INTO user_devices (user_id, device_fingerprint, user_agent, ip, last_used, created_at)
      VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      ON CONFLICT(user_id, device_fingerprint) DO UPDATE SET
        user_agent = excluded.user_agent,
        ip = excluded.ip,
        last_used = strftime('%Y-%m-%dT%H:%M:%SZ','now')
    `);
    const ua = req.headers.get("user-agent") || "";
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    stmt.run(userId, fp, ua, ip);
  }
  
  return {
    access: generateAccessToken(userId, role, jti, fp),
    refresh: generateRefreshToken(userId, role, jti, fp),
    jti,
  };
}

export function verifyAccessToken(token: string, req: Request): { userId: number; role: string; jti: string } | null {
  return verifyTokenInternal(token, "access", req);
}

export function verifyRefreshToken(token: string, req: Request): { userId: number; role: string; jti: string } | null {
  return verifyTokenInternal(token, "refresh", req);
}

function verifyTokenInternal(token: string, expectedType: "access" | "refresh", req: Request): { userId: number; role: string; jti: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    if (!header || !payload || !signature) return null;

    const signingInput = `${header}.${payload}`;
    const expected = hmacSha256(signingInput);
    const received = base64UrlToBuffer(signature);

    let valid = false;
    if (received && received.length === expected.length) {
      valid = timingSafeEqual(received, expected);
    }
    if (!valid && /^[0-9a-f]+$/i.test(signature) && signature.length === expected.length * 2) {
      const legacy = Buffer.from(signature, "hex");
      if (legacy.length === expected.length) valid = timingSafeEqual(legacy, expected);
    }
    if (!valid) return null;

    const decoded = JSON.parse(fromBase64Url(payload));
    if (decoded.exp < Math.floor(Date.now() / 1000)) return null;
    if (decoded.typ !== expectedType) return null;

    const fp = generateFingerprint(req);
    if (decoded.fp !== fp) {
      if (db) {
        db.prepare("INSERT OR IGNORE INTO token_blacklist (token, invalidated_at, reason) VALUES (?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'fingerprint_mismatch')").run(token);
      }
      return null;
    }

    if (db) {
      const blacklisted = db.prepare("SELECT 1 FROM token_blacklist WHERE token = ? OR jti = ? LIMIT 1").get(token, decoded.jti);
      if (blacklisted) return null;
    }

    return { userId: Number(decoded.sub), role: decoded.role, jti: decoded.jti };
  } catch {
    return null;
  }
}

export function revokeToken(jti: string): void {
  if (db) {
    db.prepare("INSERT OR IGNORE INTO token_blacklist (jti, invalidated_at, reason) VALUES (?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'revoked')").run(jti);
  }
}

export function revokeAllUserTokens(userId: number): void {
  if (db) {
    db.prepare("INSERT OR IGNORE INTO token_blacklist (jti, invalidated_at, reason) SELECT jti, strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'revoked_all' FROM user_tokens WHERE user_id = ?").run(userId);
  }
}

export function buildSessionCookie(token: string): string {
  const secure = Bun.env.IS_HTTPS === "true" ? "; Secure" : "";
  return `__exampool_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

export function buildRefreshCookie(token: string): string {
  const secure = Bun.env.IS_HTTPS === "true" ? "; Secure" : "";
  return `__exampool_refresh=${token}; HttpOnly; SameSite=Strict; Path=/api/auth/refresh; Max-Age=${REFRESH_TTL_SECONDS}${secure}`;
}

export function clearSessionCookies(): string[] {
  const secure = Bun.env.IS_HTTPS === "true" ? "; Secure" : "";
  return [
    `__exampool_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`,
    `__exampool_refresh=; HttpOnly; SameSite=Strict; Path=/api/auth/refresh; Max-Age=0${secure}`,
  ];
}

export function parseCookies(req: Request): Record<string, string> {
  const cookieHeader = req.headers.get("cookie") || "";
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name && rest.length) cookies[name] = rest.join("=");
  }
  return cookies;
}

export { ACCESS_TTL_SECONDS, REFRESH_TTL_SECONDS, SESSION_TTL_SECONDS, generateFingerprint };

// ── Compatibility shims for server.ts (simple session-token flow) ────────────
// server.ts imports generateToken / verifyToken for its cookie-based login.
// These wrap the newer pair-based API so the legacy call-sites work without
// a Request object.

/** Simple session token (8-hour TTL, no device fingerprint) — used by root server.ts. */
export function generateToken(userId: number, role: string): string {
  const jti = randomBytes(16).toString("hex");
  // Use SESSION_TTL_SECONDS (8h) — NOT generateAccessToken which uses 15-minute access tokens.
  // The 15-minute TTL caused the middleware to redirect users back to login almost immediately.
  const header = toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = toBase64Url(
    JSON.stringify({
      sub: userId,
      role,
      jti,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = bufferToBase64Url(hmacSha256(signingInput));
  return `${signingInput}.${signature}`;
}

/** Verify a simple session token produced by {@link generateToken}.
 *  Re-exports the internal verifyToken with a dummy Request so it
 *  accepts tokens issued without a fingerprint. */
export function verifySimpleToken(token: string): { userId: number; role: string; jti: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    if (!header || !payload || !signature) return null;

    const signingInput = `${header}.${payload}`;
    const expected = hmacSha256(signingInput);

    // Support both base64url and hex signatures
    let received: Buffer | null = null;
    try {
      const padLen = (4 - (signature.length % 4)) % 4;
      received = Buffer.from(
        signature.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLen),
        "base64"
      );
    } catch { /* ignore */ }

    let valid = false;
    if (received && received.length === expected.length) {
      valid = timingSafeEqual(received, expected);
    }
    if (!valid && /^[0-9a-f]+$/i.test(signature) && signature.length === expected.length * 2) {
      const legacy = Buffer.from(signature, "hex");
      if (legacy.length === expected.length) valid = timingSafeEqual(legacy, expected);
    }
    if (!valid) return null;

    const padded = payload.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((payload.length + 3) % 4);
    const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    if (!decoded || decoded.exp < Math.floor(Date.now() / 1000)) return null;

    return { userId: Number(decoded.sub), role: decoded.role, jti: decoded.jti ?? "" };
  } catch {
    return null;
  }
}

/** Alias kept for server.ts's legacy import: `import { verifyToken } from "./auth"`. */
export function verifyToken(token: string): { userId: number; role: string; jti: string } | null {
  return verifySimpleToken(token);
}