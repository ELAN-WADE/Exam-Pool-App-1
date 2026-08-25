import { Database } from "bun:sqlite";

const RATE_LIMIT_MAX_ENTRIES = 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export class RateLimiter {
  private rateLimits = new Map<string, { count: number; resetAt: number }>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private db: Database) {
    this.startCleanupInterval();
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.rateLimits.entries()) {
      if (now > record.resetAt) {
        this.rateLimits.delete(key);
      }
    }
    if (this.rateLimits.size > RATE_LIMIT_MAX_ENTRIES) {
      const entries = Array.from(this.rateLimits.entries()).sort((a, b) => a[1].resetAt - b[1].resetAt);
      this.rateLimits.clear();
      for (let i = entries.length - RATE_LIMIT_MAX_ENTRIES; i < entries.length; i++) {
        this.rateLimits.set(entries[i][0], entries[i][1]);
      }
    }
  }

  check(key: string, limit: number, windowMs: number): void {
    const now = Date.now();
    let record = this.rateLimits.get(key);
    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + windowMs };
      this.rateLimits.set(key, record);
    }
    record.count++;
    if (record.count > limit) {
      throw new Error("Too Many Requests");
    }
  }

  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}