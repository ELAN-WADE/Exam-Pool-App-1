import { HttpError } from "../utils/http-error";
import { AuthService } from "../services/auth.service";
import { TokenBlacklistRepository } from "../repositories/token.repository";
import { UserRepository } from "../repositories/user.repository";
import { rateLimiter, RATE_LIMIT_CONFIGS } from "../redis";
import { config } from "../config";
import { log, logRateLimit } from "../logging";
import type { Role, TokenPayload } from "../types";

export interface AuthContext {
  userId: number;
  role: Role;
  token: string;
}

export class AuthMiddleware {
  private authService: AuthService;
  private tokenBlacklist: TokenBlacklistRepository;
  private userRepo: UserRepository;

  constructor(authService: AuthService, db: any) {
    this.authService = authService;
    this.tokenBlacklist = new TokenBlacklistRepository(db);
    this.userRepo = new UserRepository(db);
  }

  parseCookies(cookieHeader: string | null): Record<string, string> {
    if (!cookieHeader) return {};
    const out: Record<string, string> = {};
    for (const pair of cookieHeader.split(";")) {
      const [k, ...rest] = pair.trim().split("=");
      const key = k?.trim();
      if (!key) continue;
      try {
        out[key] = decodeURIComponent(rest.join("="));
      } catch {
        out[key] = rest.join("=");
      }
    }
    return out;
  }

  getClientIp(headers: Headers): string {
    if (config.env.TRUST_PROXY === "true") {
      const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
      if (forwarded) return forwarded;
    }
    return "unknown";
  }

  requireAuth(req: Request): AuthContext {
    const cookies = this.parseCookies(req.headers.get("cookie"));
    const cookieToken = cookies.__exampool_session;
    const authHeader = req.headers.get("authorization");
    const headerToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const token = cookieToken || headerToken;

    if (!token) throw new HttpError(401, "Not authenticated");

    if (this.tokenBlacklist.has(token)) {
      throw new HttpError(401, "Session invalidated (Logged out)");
    }

    const decoded = this.authService.verifyToken(token);
    if (!decoded) throw new HttpError(401, "Not authenticated");

    const user = this.userRepo.findById(decoded.userId);
    if (!user || user.is_active !== 1 || user.role !== decoded.role) {
      throw new HttpError(401, "Session invalidated or user suspended");
    }

    return { ...decoded, token };
  }

  requireRole(role: Role, allowed: Role[]): void {
    if (!allowed.includes(role)) throw new HttpError(403, "Forbidden");
  }

  async checkRateLimit(key: string, limit: number, windowMs: number): Promise<void> {
    const result = await rateLimiter.checkLimit(key, { maxRequests: limit, windowMs });
    
    logRateLimit(key, result.allowed, limit, result.remaining, windowMs);
    
    if (!result.allowed) {
      throw new HttpError(429, "Too Many Requests");
    }
  }

  async checkRateLimitConfig(configKey: keyof typeof RATE_LIMIT_CONFIGS, identifier: string): Promise<void> {
    const config = RATE_LIMIT_CONFIGS[configKey];
    const result = await rateLimiter.checkLimit(identifier, config);
    
    logRateLimit(identifier, result.allowed, config.maxRequests, result.remaining, config.windowMs);
    
    if (!result.allowed) {
      throw new HttpError(429, "Too Many Requests");
    }
  }

  getClientIpFromReq(req: Request): string {
    return this.getClientIp(req.headers);
  }
}

export function createAuthMiddleware(authService: AuthService, db: any): AuthMiddleware {
  return new AuthMiddleware(authService, db);
}