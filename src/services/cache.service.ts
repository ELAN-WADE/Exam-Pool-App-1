/**
 * ExamPool High-Performance Multi-Tier Caching Service
 * 
 * Provides zero-latency In-Memory caching (default for LAN / offline-first deployments)
 * with transparent fallback / switch to Redis for cloud / distributed clusters.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class CacheService {
  private memoryCache: Map<string, CacheEntry<any>> = new Map();
  private maxEntries: number;
  private cleanupIntervalMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private redisClient: any = null;
  private isRedisActive: boolean = false;

  constructor(options: { maxEntries?: number; cleanupIntervalMs?: number } = {}) {
    this.maxEntries = options.maxEntries || 10000;
    this.cleanupIntervalMs = options.cleanupIntervalMs || 30000; // 30s purge cycle

    // Start background cleanup timer
    this.cleanupTimer = setInterval(() => this.purgeExpired(), this.cleanupIntervalMs);
    if (this.cleanupTimer && typeof (this.cleanupTimer as any).unref === "function") {
      (this.cleanupTimer as any).unref();
    }
  }

  /** Set an optional Redis client for distributed cloud deployments */
  public setRedisClient(client: any) {
    this.redisClient = client;
    this.isRedisActive = !!client;
  }

  /**
   * Set a value in cache with a TTL (in seconds).
   */
  public set<T>(key: string, value: T, ttlSeconds: number = 60): void {
    if (this.memoryCache.size >= this.maxEntries) {
      // Evict oldest 10% when full
      const keysToEvict = Array.from(this.memoryCache.keys()).slice(0, Math.floor(this.maxEntries * 0.1));
      for (const k of keysToEvict) {
        this.memoryCache.delete(k);
      }
    }

    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.memoryCache.set(key, { value, expiresAt });

    if (this.isRedisActive && this.redisClient) {
      try {
        this.redisClient.set(key, JSON.stringify(value), "EX", ttlSeconds).catch(() => {});
      } catch {}
    }
  }

  /**
   * Get a cached value. Returns null if missing or expired.
   */
  public get<T>(key: string): T | null {
    const entry = this.memoryCache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.memoryCache.delete(key);
      return null;
    }

    return entry.value as T;
  }

  /**
   * Check if a key exists and is unexpired.
   */
  public has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * Delete a specific cache key.
   */
  public delete(key: string): void {
    this.memoryCache.delete(key);
    if (this.isRedisActive && this.redisClient) {
      try {
        this.redisClient.del(key).catch(() => {});
      } catch {}
    }
  }

  /**
   * Invalidate all keys matching a prefix pattern (e.g. "questions:")
   */
  public deletePattern(prefix: string): void {
    for (const key of this.memoryCache.keys()) {
      if (key.startsWith(prefix)) {
        this.memoryCache.delete(key);
      }
    }
    if (this.isRedisActive && this.redisClient) {
      try {
        this.redisClient.keys(`${prefix}*`).then((keys: string[]) => {
          if (keys && keys.length > 0) {
            this.redisClient.del(...keys).catch(() => {});
          }
        }).catch(() => {});
      } catch {}
    }
  }

  /**
   * Get or compute wrapper.
   * If `key` is cached, returns cached value.
   * Otherwise executes `fetcher()`, stores in cache with `ttlSeconds`, and returns result.
   */
  public async wrap<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T> | T): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }

    const fresh = await fetcher();
    if (fresh !== null && fresh !== undefined) {
      this.set(key, fresh, ttlSeconds);
    }
    return fresh;
  }

  /**
   * Synchronous get or compute wrapper for hot-path DB reads.
   */
  public wrapSync<T>(key: string, ttlSeconds: number, fetcher: () => T): T {
    const cached = this.get<T>(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }

    const fresh = fetcher();
    if (fresh !== null && fresh !== undefined) {
      this.set(key, fresh, ttlSeconds);
    }
    return fresh;
  }

  /**
   * Clear entire cache.
   */
  public clear(): void {
    this.memoryCache.clear();
  }

  /**
   * Purge expired entries from memory.
   */
  private purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.memoryCache.entries()) {
      if (now > entry.expiresAt) {
        this.memoryCache.delete(key);
      }
    }
  }
}

// Global Singleton Instance
export const cacheService = new CacheService();

// Common Cache Key Builders
export const CacheKeys = {
  setting: (key: string) => `setting:${key}`,
  currentTerm: () => `setting:CURRENT_TERM`,
  registrationOpen: () => `setting:REGISTRATION_OPEN`,
  schoolConfig: () => `config:singleton`,
  subjectQuestions: (subjectId: number | string) => `subject_questions:${subjectId}`,
  subject: (subjectId: number | string) => `subject:${subjectId}`,
  user: (userId: number | string) => `user:${userId}`,
  activeSession: () => `academic:active_session`,
  activeTerm: () => `academic:active_term`,
  timetableSubject: (subjectId: number | string) => `timetable:${subjectId}`,
};
