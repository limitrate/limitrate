/**
 * In-memory store for rate limiting (single instance only)
 * Uses LRU cache with auto-expiry
 */

import type { Store, RateCheckResult, CostCheckResult, TokenCheckResult } from '../types';
import { logger } from '../logger';

interface CacheEntry {
  count: number;
  expiresAt: number;
  burstTokens?: number;
  lastAccess: number; // For LRU tracking (V3 fix)
}

const DEFAULT_MAX_KEYS = 10000;
const DEFAULT_CLEANUP_INTERVAL_MS = 60000; // 1 minute
const DEFAULT_MAX_KEYS_PER_USER = 100; // V3: Prevent cache pollution attack

export class MemoryStore implements Store {
  private cache: Map<string, CacheEntry>;
  private readonly maxKeys: number;
  private readonly maxKeysPerUser: number;
  private cleanupInterval: NodeJS.Timeout | null;
  private userKeyCounts: Map<string, number>; // O(1) lookup for per-user key counts

  constructor(options: { maxKeys?: number; cleanupIntervalMs?: number; maxKeysPerUser?: number; allowProduction?: boolean } = {}) {
    // CRITICAL PRODUCTION WARNING
    // Check for common production indicators (not just NODE_ENV which can be bypassed)
    const isProdIndicator =
      process.env.NODE_ENV === 'production' ||
      process.env.RAILWAY_ENVIRONMENT === 'production' ||
      process.env.VERCEL_ENV === 'production' ||
      process.env.FLY_APP_NAME !== undefined ||
      process.env.RENDER !== undefined;

    const allowProduction = options.allowProduction ?? false;

    if (isProdIndicator && !allowProduction) {
      const errorMessage = [
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '⚠️  CRITICAL: MemoryStore detected in production!',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '  MemoryStore is NOT SAFE for production deployments:',
        '',
        '  ❌ Multi-instance deployments: Limits are PER INSTANCE, not global',
        '  ❌ Load balancers: Different instances have different limits',
        '  ❌ Auto-scaling: New instances start with empty state',
        '  ❌ Restarts: All rate limit data is lost',
        '  ❌ Memory leaks: Unbounded growth in high-traffic scenarios',
        '',
        '  ✅ SOLUTION: Use RedisStore or UpstashStore in production',
        '',
        '  Example:',
        '    store: {',
        '      type: \'redis\',',
        '      url: process.env.REDIS_URL',
        '    }',
        '',
        '  Or bypass this error (NOT RECOMMENDED):',
        '    store: {',
        '      type: \'memory\',',
        '      allowProduction: true  // Only if single instance',
        '    }',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        ''
      ].join('\n');

      throw new Error(errorMessage);
    }

    // Warn in development too
    if (!isProdIndicator) {
      logger.warn(
        '\n⚠️  MemoryStore detected (development mode)\n' +
        '   - Data will be lost on restart\n' +
        '   - Use RedisStore or UpstashStore in production\n'
      );
    }

    this.cache = new Map();
    this.userKeyCounts = new Map();
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
    this.maxKeysPerUser = options.maxKeysPerUser ?? DEFAULT_MAX_KEYS_PER_USER;
    this.cleanupInterval = null;

    // Auto-cleanup expired entries every minute
    const intervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
    this.cleanupInterval = setInterval(() => this.cleanup(), intervalMs);
  }

  async checkRate(key: string, limit: number, windowSeconds: number, burst?: number): Promise<RateCheckResult> {
    const now = Date.now();
    const entry = this.cache.get(key);

    // No entry or expired → allow and create new
    if (!entry || entry.expiresAt <= now) {
      const expiresAt = now + windowSeconds * 1000;
      // NOTE: Burst tokens do NOT refill over time. They reset when the rate limit window resets.
      // This is a "fixed burst allowance per window" model, not a "token bucket" model.
      // Burst tokens are initialized with the full allowance at the start of each window.
      const burstTokens = burst; // Initialize with full burst allowance
      const wasExisting = entry && entry.expiresAt <= now; // Expired entry being replaced
      this.cache.set(key, { count: 1, expiresAt, burstTokens, lastAccess: now });
      if (!wasExisting) {
        // Only increment count if this is a genuinely new key (not an expired replacement)
        const user = this.extractUserFromKey(key);
        this.incrementUserKeyCount(user);
      }
      this.evictIfNeeded(key);

      return {
        allowed: true,
        current: 1,
        remaining: limit - 1,
        resetInSeconds: windowSeconds,
        limit,
        burstTokens,
      };
    }

    // V3: Update lastAccess timestamp for LRU tracking
    entry.lastAccess = now;

    // Entry exists and not expired
    const current = entry.count;
    const resetInSeconds = Math.ceil((entry.expiresAt - now) / 1000);

    // Try to use regular token first
    if (current < limit) {
      // Within limit - increment count
      entry.count += 1;
      return {
        allowed: true,
        current: entry.count,
        remaining: limit - entry.count,
        resetInSeconds,
        limit,
        burstTokens: entry.burstTokens,
      };
    }

    // Limit reached - try to use burst token
    if (burst !== undefined && entry.burstTokens !== undefined && entry.burstTokens > 0) {
      // Use burst token
      entry.burstTokens -= 1;
      entry.count += 1;
      return {
        allowed: true,
        current: entry.count,
        remaining: 0,
        resetInSeconds,
        limit,
        burstTokens: entry.burstTokens,
      };
    }

    // Both regular and burst tokens exhausted
    return {
      allowed: false,
      current,
      remaining: 0,
      resetInSeconds,
      limit,
      burstTokens: entry.burstTokens ?? 0,
    };
  }

  async peekRate(key: string, limit: number, windowSeconds: number): Promise<RateCheckResult> {
    const now = Date.now();
    const entry = this.cache.get(key);

    // No entry or expired → would be allowed
    if (!entry || entry.expiresAt <= now) {
      return {
        allowed: true,
        current: 0,
        remaining: limit,
        resetInSeconds: windowSeconds,
        limit,
      };
    }

    // Entry exists and not expired
    const current = entry.count;
    const resetInSeconds = Math.ceil((entry.expiresAt - now) / 1000);
    const remaining = Math.max(0, limit - current);

    return {
      allowed: current < limit,
      current,
      remaining,
      resetInSeconds,
      limit,
      burstTokens: entry.burstTokens,
    };
  }

  async incrementCost(
    key: string,
    cost: number,
    windowSeconds: number,
    cap: number
  ): Promise<CostCheckResult> {
    const now = Date.now();
    const entry = this.cache.get(key);

    // No entry or expired → allow and create new
    if (!entry || entry.expiresAt <= now) {
      const expiresAt = now + windowSeconds * 1000;
      const wasExisting = entry && entry.expiresAt <= now; // Expired entry being replaced
      this.cache.set(key, { count: cost, expiresAt, lastAccess: now });
      if (!wasExisting) {
        const user = this.extractUserFromKey(key);
        this.incrementUserKeyCount(user);
      }
      this.evictIfNeeded(key);

      return {
        allowed: cost <= cap,
        current: cost,
        remaining: cap - cost,
        resetInSeconds: windowSeconds,
        cap,
      };
    }

    // V3: Update lastAccess timestamp for LRU tracking
    entry.lastAccess = now;

    // Entry exists and not expired
    const newCost = entry.count + cost;
    const resetInSeconds = Math.ceil((entry.expiresAt - now) / 1000);

    if (newCost > cap) {
      // Cap exceeded (don't increment)
      return {
        allowed: false,
        current: entry.count,
        remaining: cap - entry.count,
        resetInSeconds,
        cap,
      };
    }

    // Increment cost
    entry.count = newCost;

    return {
      allowed: true,
      current: newCost,
      remaining: cap - newCost,
      resetInSeconds,
      cap,
    };
  }

  async incrementTokens(
    key: string,
    tokens: number,
    windowSeconds: number,
    limit: number
  ): Promise<TokenCheckResult> {
    const now = Date.now();
    const entry = this.cache.get(key);

    // No entry or expired → allow and create new
    if (!entry || entry.expiresAt <= now) {
      const expiresAt = now + windowSeconds * 1000;
      const wasExisting = entry && entry.expiresAt <= now; // Expired entry being replaced
      this.cache.set(key, { count: tokens, expiresAt, lastAccess: now });
      if (!wasExisting) {
        const user = this.extractUserFromKey(key);
        this.incrementUserKeyCount(user);
      }
      this.evictIfNeeded(key);

      return {
        allowed: tokens <= limit,
        current: tokens,
        remaining: Math.max(0, limit - tokens),
        resetInSeconds: windowSeconds,
        limit,
      };
    }

    // V3: Update lastAccess timestamp for LRU tracking
    entry.lastAccess = now;

    // Entry exists and not expired
    const newTokens = entry.count + tokens;
    const resetInSeconds = Math.ceil((entry.expiresAt - now) / 1000);

    if (newTokens > limit) {
      // Limit exceeded (don't increment)
      return {
        allowed: false,
        current: entry.count,
        remaining: Math.max(0, limit - entry.count),
        resetInSeconds,
        limit,
      };
    }

    // Increment tokens
    entry.count = newTokens;

    return {
      allowed: true,
      current: newTokens,
      remaining: limit - newTokens,
      resetInSeconds,
      limit,
    };
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
    this.userKeyCounts.clear();
  }

  /**
   * Remove expired entries and maintain user key counts
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
        const user = this.extractUserFromKey(key);
        this.decrementUserKeyCount(user);
      }
    }
  }

  /**
   * V3: Extract user from key format (keys are like "user:endpoint" or "user:endpoint:cost")
   * Returns the user portion of the key, or the entire key if no colon found
   */
  private extractUserFromKey(key: string): string {
    const colonIndex = key.indexOf(':');
    if (colonIndex === -1) {
      return key; // Entire key is the user
    }
    return key.substring(0, colonIndex);
  }

  /**
   * V3: Get how many keys belong to a specific user (O(1) lookup)
   */
  private getUserKeyCount(user: string): number {
    return this.userKeyCounts.get(user) ?? 0;
  }

  /**
   * Increment user key count when adding a new key
   */
  private incrementUserKeyCount(user: string): void {
    const current = this.userKeyCounts.get(user) ?? 0;
    this.userKeyCounts.set(user, current + 1);
  }

  /**
   * Decrement user key count when removing a key
   */
  private decrementUserKeyCount(user: string): void {
    const current = this.userKeyCounts.get(user) ?? 0;
    if (current <= 1) {
      this.userKeyCounts.delete(user);
    } else {
      this.userKeyCounts.set(user, current - 1);
    }
  }

  /**
   * V3: Evict least recently used entry if cache is full (true LRU)
   * Also enforces per-user key limits to prevent cache pollution attacks
   * PERFORMANCE FIX: Now O(1) per-user key count lookup instead of O(n)
   */
  private evictIfNeeded(newKey: string): void {
    // Check per-user limit first (V3: prevent single user from filling cache)
    const user = this.extractUserFromKey(newKey);
    const userKeyCount = this.getUserKeyCount(user);

    if (userKeyCount > this.maxKeysPerUser) {
      // User has too many keys - evict their least recently used entry
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [key, entry] of this.cache.entries()) {
        if (this.extractUserFromKey(key) === user && entry.lastAccess < oldestTime) {
          oldestKey = key;
          oldestTime = entry.lastAccess;
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey);
        this.decrementUserKeyCount(user);
      }
    }

    // Check global cache size limit
    if (this.cache.size > this.maxKeys) {
      // Find and evict least recently used entry across all users
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [key, entry] of this.cache.entries()) {
        if (entry.lastAccess < oldestTime) {
          oldestKey = key;
          oldestTime = entry.lastAccess;
        }
      }

      if (oldestKey) {
        const evictedUser = this.extractUserFromKey(oldestKey);
        this.cache.delete(oldestKey);
        this.decrementUserKeyCount(evictedUser);
      }
    }
  }

  /**
   * Get current cache size (for testing/debugging)
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}
