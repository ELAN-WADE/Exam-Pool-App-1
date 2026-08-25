import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";
import type { TokenPayload, Role } from "../types";

const SESSION_TTL_SECONDS = 8 * 60 * 60;

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

function hmacSha256(signingInput: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(signingInput, "utf8").digest();
}

function base64UrlToBuffer(seg: string): Buffer | null {
  try {
    const padLen = (4 - (seg.length % 4)) % 4;
    return Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLen), "base64");
  } catch {
    return null;
  }
}

export class AuthService {
  private jwtSecret: string;

  constructor() {
    this.jwtSecret = config.env.JWT_SECRET;
  }

  async hashPassword(password: string): Promise<string> {
    return await Bun.password.hash(password, {
      algorithm: "argon2id",
      memoryCost: 8192,
      timeCost: 2,
    });
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return await Bun.password.verify(password, hash);
  }

  generateToken(userId: number, role: Role): string {
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
    const signature = bufferToBase64Url(hmacSha256(signingInput, this.jwtSecret));
    return `${signingInput}.${signature}`;
  }

  verifyToken(token: string): TokenPayload | null {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const [header, payload, signature] = parts;
      if (!header || !payload || !signature) return null;

      const signingInput = `${header}.${payload}`;
      const expected = hmacSha256(signingInput, this.jwtSecret);
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

      const decoded = JSON.parse(fromBase64Url(payload)) as TokenPayload;
      if (decoded.exp < Math.floor(Date.now() / 1000)) return null;

      return { userId: Number(decoded.sub), role: decoded.role, iat: decoded.iat, exp: decoded.exp };
    } catch {
      return null;
    }
  }

  buildSessionCookie(token: string): string {
    const secure = config.env.IS_HTTPS === "true" ? "; Secure" : "";
    return `__exampool_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
  }

  parseSessionCookie(cookieHeader: string | null): string | null {
    if (!cookieHeader) return null;
    const cookies = cookieHeader.split(";");
    for (const cookie of cookies) {
      const [name, ...rest] = cookie.trim().split("=");
      if (name === "__exampool_session") {
        return rest.join("=");
      }
    }
    return null;
  }

  extractBearerToken(authHeader: string | null): string | null {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return authHeader.slice(7);
  }

  getSessionTtlSeconds(): number {
    return SESSION_TTL_SECONDS;
  }
}

export const authService = new AuthService();