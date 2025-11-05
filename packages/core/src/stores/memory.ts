/**
 * In-memory store for rate limiting (single instance only)
 * Uses LRU cache with auto-expiry
 */

import type { Store, RateCheckResult, CostCheckResult } from '../types';

interface CacheEntry {
  count: number;
  expiresAt: number;
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

  async checkRate(key: string, limit: number, windowSeconds: number): Promise<RateCheckResult> {
    const now = Date.now();
    const entry = this.cache.get(key);

    // No entry or expired → allow and create new
    if (!entry || entry.expiresAt <= now) {
      const expiresAt = now + windowSeconds * 1000;
      this.cache.set(key, { count: 1, expiresAt });
      this.evictIfNeeded();

      return {
        allowed: true,
        current: 1,
        remaining: limit - 1,
        resetInSeconds: windowSeconds,
        limit,
      };
    }

    // Entry exists and not expired
    const current = entry.count;

    if (current >= limit) {
      // Limit exceeded
      const resetInSeconds = Math.ceil((entry.expiresAt - now) / 1000);
      return {
        allowed: false,
        current,
        remaining: 0,
        resetInSeconds,
        limit,
      };
    }

    // Increment count
    entry.count += 1;
    const resetInSeconds = Math.ceil((entry.expiresAt - now) / 1000);

    return {
      allowed: true,
      current: entry.count,
      remaining: limit - entry.count,
      resetInSeconds,
      limit,
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
