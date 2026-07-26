import { createHmac, timingSafeEqual } from "node:crypto";

const JWT_SECRET = Bun.env.JWT_SECRET || "exampool-lan-secret-change-me";
const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours — covers a full school day

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

/** Raw HMAC-SHA256 signing input `${header}.${payload}` (JWT HS256). */
function hmacSha256(signingInput: string): Buffer {
  return createHmac("sha256", JWT_SECRET).update(signingInput, "utf8").digest();
}

export async function hashPassword(password: string): Promise<string> {
  return await Bun.password.hash(password, {
    algorithm: "argon2id",
    memoryCost: 65536,
    timeCost: 2,
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await Bun.password.verify(password, hash);
}

export function generateToken(userId: number, role: string): string {
  const header = toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = toBase64Url(
    JSON.stringify({
      sub: userId,
      role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = bufferToBase64Url(hmacSha256(signingInput));
  return `${signingInput}.${signature}`;
}

function base64UrlToBuffer(seg: string): Buffer | null {
  try {
    const padLen = (4 - (seg.length % 4)) % 4;
    return Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLen), "base64");
  } catch {
    return null;
  }
}

export function verifyToken(token: string): { userId: number; role: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    if (!header || !payload || !signature) return null;

    const signingInput = `${header}.${payload}`;
    const expected = hmacSha256(signingInput);
    const received = base64UrlToBuffer(signature);

    /** Legacy hex signatures (pre–node:crypto migration) */
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

    return { userId: Number(decoded.sub), role: decoded.role };
  } catch {
    return null;
  }
}

export function buildSessionCookie(token: string): string {
  const secure = Bun.env.IS_HTTPS === "true" ? "; Secure" : "";
  return `__exampool_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}
