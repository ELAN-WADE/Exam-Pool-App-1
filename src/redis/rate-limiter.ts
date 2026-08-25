import { getRedisClient, connectRedis } from "./client";

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  total: number;
}

const DEFAULT_PREFIX = "ratelimit";

export class RedisRateLimiter {
  private redis = getRedisClient();
  private connected = false;

  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await connectRedis();
      this.connected = true;
    }
  }

  private getKey(identifier: string, prefix?: string): string {
    return `${prefix || DEFAULT_PREFIX}:${identifier}`;
  }

  async checkLimit(identifier: string, options: RateLimitOptions): Promise<RateLimitResult> {
    await this.ensureConnected();
    
    const { windowMs, maxRequests, keyPrefix } = options;
    const key = this.getKey(identifier, keyPrefix);
    const now = Date.now();
    const windowStart = now - windowMs;
    const resetAt = now + windowMs;

    try {
      const pipeline = this.redis.pipeline();
      
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zcard(key);
      pipeline.zadd(key, now, `${now}-${Math.random()}`);
      pipeline.expire(key, Math.ceil(windowMs / 1000) + 1);
      
      const results = await pipeline.exec();
      
      if (!results) {
        throw new Error("Redis pipeline returned null");
      }

      const currentCount = (results[1]?.[1] as number) || 0;
      const allowed = currentCount < maxRequests;
      const remaining = Math.max(0, maxRequests - currentCount - 1);

      if (!allowed) {
        await this.redis.zrem(key, `${now}-${Math.random()}`);
      }

      return {
        allowed,
        remaining,
        resetAt,
        total: maxRequests,
      };
    } catch (error) {
      console.error("[RateLimiter] Redis error, failing open:", error);
      return {
        allowed: true,
        remaining: maxRequests,
        resetAt,
        total: maxRequests,
      };
    }
  }

  async getCurrentCount(identifier: string, windowMs: number, keyPrefix?: string): Promise<number> {
    await this.ensureConnected();
    
    const key = this.getKey(identifier, keyPrefix);
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      await this.redis.zremrangebyscore(key, 0, windowStart);
      return await this.redis.zcard(key);
    } catch (error) {
      console.error("[RateLimiter] Error getting count:", error);
      return 0;
    }
  }

  async resetLimit(identifier: string, keyPrefix?: string): Promise<void> {
    await this.ensureConnected();
    
    const key = this.getKey(identifier, keyPrefix);
    try {
      await this.redis.del(key);
    } catch (error) {
      console.error("[RateLimiter] Error resetting limit:", error);
    }
  }

  async getTtl(identifier: string, keyPrefix?: string): Promise<number> {
    await this.ensureConnected();
    
    const key = this.getKey(identifier, keyPrefix);
    try {
      return await this.redis.ttl(key);
    } catch {
      return -1;
    }
  }
}

export const rateLimiter = new RedisRateLimiter();

export function createRateLimiterKey(parts: string[]): string {
  return parts.join(":");
}

export const RATE_LIMIT_CONFIGS = {
  login: { windowMs: 60_000, maxRequests: 10, prefix: "login" },
  register: { windowMs: 60_000, maxRequests: 5, prefix: "register" },
  passwordReset: { windowMs: 60_000, maxRequests: 5, prefix: "pwreset" },
  passwordResetTarget: { windowMs: 60_000, maxRequests: 5, prefix: "pwreset_target" },
  api: { windowMs: 60_000, maxRequests: 100, prefix: "api" },
  sse: { windowMs: 60_000, maxRequests: 5, prefix: "sse" },
  upload: { windowMs: 60_000, maxRequests: 10, prefix: "upload" },
} as const;