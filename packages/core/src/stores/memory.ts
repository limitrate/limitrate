/**
 * In-memory store for rate limiting (single instance only)
 * Uses LRU cache with auto-expiry
 */

import type { Store, RateCheckResult, CostCheckResult, TokenCheckResult } from '../types';

interface CacheEntry {
  count: number;
  expiresAt: number;
  burstTokens?: number;
}

export class MemoryStore implements Store {
  private cache: Map<string, CacheEntry>;
  private readonly maxKeys: number;
  private cleanupInterval: NodeJS.Timeout | null;

  constructor(options: { maxKeys?: number; cleanupIntervalMs?: number } = {}) {
    this.cache = new Map();
    this.maxKeys = options.maxKeys ?? 10000;
    this.cleanupInterval = null;

    // Auto-cleanup expired entries every minute
    const intervalMs = options.cleanupIntervalMs ?? 60000;
    this.cleanupInterval = setInterval(() => this.cleanup(), intervalMs);
  }

  async checkRate(key: string, limit: number, windowSeconds: number, burst?: number): Promise<RateCheckResult> {
    const now = Date.now();
    const entry = this.cache.get(key);

    // No entry or expired → allow and create new
    if (!entry || entry.expiresAt <= now) {
      const expiresAt = now + windowSeconds * 1000;
      const burstTokens = burst; // Initialize with full burst allowance
      this.cache.set(key, { count: 1, expiresAt, burstTokens });
      this.evictIfNeeded();

      return {
        allowed: true,
        current: 1,
        remaining: limit - 1,
        resetInSeconds: windowSeconds,
        limit,
        burstTokens,
      };
    }

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
      this.cache.set(key, { count: cost, expiresAt });
      this.evictIfNeeded();

      return {
        allowed: cost <= cap,
        current: cost,
        remaining: cap - cost,
        resetInSeconds: windowSeconds,
        cap,
      };
    }

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
      this.cache.set(key, { count: tokens, expiresAt });
      this.evictIfNeeded();

      return {
        allowed: tokens <= limit,
        current: tokens,
        remaining: Math.max(0, limit - tokens),
        resetInSeconds: windowSeconds,
        limit,
      };
    }

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
  }

  /**
   * Remove expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Evict oldest entry if cache is full (simple LRU)
   */
  private evictIfNeeded(): void {
    if (this.cache.size > this.maxKeys) {
      // Delete first (oldest) entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
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
