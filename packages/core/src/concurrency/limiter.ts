/**
 * Concurrency Limiter (v2.0.0 - D1)
 * Limit how many requests can run simultaneously
 */

import type { ConcurrencyConfig } from '../types';

/**
 * Queued request
 */
interface QueuedRequest {
  id: number;  // BUG FIX #1: Unique ID to prevent queue leaks
  resolve: (transferSlot?: boolean) => void;
  reject: (error: Error) => void;
  enqueueTime: number;
  timeout: NodeJS.Timeout;
  priority: number;  // Lower number = higher priority
}

/**
 * Concurrency limiter
 * Controls how many operations can run simultaneously
 */
export class ConcurrencyLimiter {
  private running: number = 0;
  private queue: QueuedRequest[] = [];
  private readonly max: number;
  private readonly queueTimeout: number;
  private readonly maxQueueSize: number;
  private readonly actionOnExceed: 'queue' | 'block';
  private readonly priorityAgingSeconds: number; // Fix #7: Make configurable
  private lockQueue: Array<() => void> = []; // Queue-based lock (prevents spinlock DoS)
  private isLocked: boolean = false;
  private requestIdCounter: number = 0; // BUG FIX #1: Counter for unique request IDs

  constructor(config: ConcurrencyConfig) {
    this.max = config.max;
    this.queueTimeout = config.queueTimeout ?? 30000; // 30 seconds default
    this.maxQueueSize = config.maxQueueSize ?? 1000; // 1000 requests default (prevents memory exhaustion)
    this.actionOnExceed = config.actionOnExceed ?? 'queue';
    this.priorityAgingSeconds = config.priorityAgingSeconds ?? 5; // Fix #7: Default 5 seconds
  }

  /**
   * Acquire the internal lock using a queue-based approach (no spinlock)
   * This prevents CPU exhaustion from concurrent lock attempts
   */
  private async acquireInternalLock(): Promise<() => void> {
    return new Promise<() => void>((resolve) => {
      const release = () => {
        this.isLocked = false;
        // Process next queued lock request
        const next = this.lockQueue.shift();
        if (next) {
          this.isLocked = true;
          next();
        }
      };

      if (!this.isLocked) {
        this.isLocked = true;
        resolve(release);
      } else {
        // Queue this lock request
        this.lockQueue.push(() => resolve(release));
      }
    });
  }

  /**
   * Acquire a slot for execution
   * Returns a promise that resolves when a slot is available
   *
   * @param priority - Lower number = higher priority (default: 5)
   */
  async acquire(priority: number = 5): Promise<() => void> {
    // Acquire lock using queue-based approach (prevents spinlock DoS - V1 fix)
    const releaseLock = await this.acquireInternalLock();

    try {
      // If under limit, acquire immediately
      if (this.running < this.max) {
        this.running++;
        releaseLock(); // Release lock
        return () => this.release();
      }

      // Release lock before queuing (queue operations don't need lock)
      releaseLock();

      // If blocking mode, throw error
      if (this.actionOnExceed === 'block') {
        throw new Error(`Concurrency limit reached: ${this.max} concurrent requests`);
      }

      // Queue mode: check queue size first (prevents memory exhaustion)
      if (this.queue.length >= this.maxQueueSize) {
        throw new Error(`Queue full: ${this.queue.length} requests already queued (max: ${this.maxQueueSize})`);
      }

      // Queue mode: wait for a slot
      return new Promise((resolve, reject) => {
        const enqueueTime = Date.now();
        const requestId = this.requestIdCounter++; // BUG FIX #1: Generate unique ID

        // Set timeout
        const timeout = setTimeout(() => {
          // BUG FIX #1: Remove by ID instead of timestamp to prevent leaks
          const index = this.queue.findIndex((req) => req.id === requestId);
          if (index !== -1) {
            this.queue.splice(index, 1);
          }

          reject(new Error(`Queue timeout: waited ${this.queueTimeout}ms for concurrency slot`));
        }, this.queueTimeout);

        // Create queued request
        const queuedRequest: QueuedRequest = {
          id: requestId, // BUG FIX #1: Add unique ID
          resolve: (transferSlot: boolean = false) => {
            clearTimeout(timeout);
            // Only increment if not transferring from a finishing request
            if (!transferSlot) {
              this.running++;
            }
            resolve(() => this.release());
          },
          reject,
          enqueueTime,
          timeout,
          priority,
        };

        // V8: Insert into queue based on priority with aging
        // Lower priority number = higher priority (goes first)
        // Fix #7: Priority ages over time based on configurable interval
        // This prevents starvation of low-priority requests
        const insertIndex = this.queue.findIndex((req) => {
          const now = Date.now();

          // Calculate aged priorities (lower = higher priority)
          const ageInSeconds = (now - enqueueTime) / 1000;
          const agingBonus = Math.floor(ageInSeconds / this.priorityAgingSeconds);
          const effectiveNewPriority = Math.max(0, priority - agingBonus);

          const reqAgeInSeconds = (now - req.enqueueTime) / 1000;
          const reqAgingBonus = Math.floor(reqAgeInSeconds / this.priorityAgingSeconds);
          const reqEffectivePriority = Math.max(0, req.priority - reqAgingBonus);

          // Compare aged priorities
          if (reqEffectivePriority > effectiveNewPriority) {
            return true; // req has lower priority (higher number), insert before it
          }

          // Same aged priority: maintain FIFO (older requests go first)
          if (reqEffectivePriority === effectiveNewPriority && req.enqueueTime > enqueueTime) {
            return true;
          }

          return false;
        });

        if (insertIndex === -1) {
          // No items with lower priority found, append to end
          this.queue.push(queuedRequest);
        } else {
          // Insert before the first item with lower priority
          this.queue.splice(insertIndex, 0, queuedRequest);
        }
      });
    } catch (error) {
      // Ensure lock is always released on error
      releaseLock();
      throw error;
    }
  }

  /**
   * Release a slot
   * Process next item in queue if available
   * V8: Considers priority aging when selecting next request
   */
  private release(): void {
    // Process next in queue first (BEFORE decrementing)
    // This prevents race condition where multiple releases
    // could cause running count to temporarily exceed max
    if (this.queue.length > 0) {
      // V8: Find request with highest aged priority (lowest effective priority number)
      const now = Date.now();
      let bestIndex = 0;
      let bestEffectivePriority = Infinity;

      for (let i = 0; i < this.queue.length; i++) {
        const req = this.queue[i];
        const ageInSeconds = (now - req.enqueueTime) / 1000;
        const agingBonus = Math.floor(ageInSeconds / this.priorityAgingSeconds); // Fix #7: Use configurable interval
        const effectivePriority = Math.max(0, req.priority - agingBonus);

        // Lower effective priority number = higher priority
        if (effectivePriority < bestEffectivePriority ||
            (effectivePriority === bestEffectivePriority && req.enqueueTime < this.queue[bestIndex].enqueueTime)) {
          bestIndex = i;
          bestEffectivePriority = effectivePriority;
        }
      }

      // Remove the best request from queue
      const next = this.queue.splice(bestIndex, 1)[0];
      if (next) {
        // Don't decrement - the queued item takes this slot
        // Pass true to indicate we're transferring the slot
        next.resolve(true);
        return;
      }
    }

    // No queued items, actually release the slot
    this.running--;
  }

  /**
   * Get current stats
   */
  getStats(): { running: number; queued: number; available: number } {
    return {
      running: this.running,
      queued: this.queue.length,
      available: Math.max(0, this.max - this.running),
    };
  }

  /**
   * Clear queue (useful for cleanup)
   */
  clearQueue(): void {
    for (const req of this.queue) {
      clearTimeout(req.timeout);
      req.reject(new Error('Queue cleared'));
    }
    this.queue = [];
  }
}

/**
 * Global concurrency limiters registry
 * Key: endpoint identifier (e.g., "POST|/api/chat")
 */
const limiters = new Map<string, ConcurrencyLimiter>();

/**
 * Get or create a concurrency limiter for an endpoint
 *
 * IMPORTANT: The limiter is cached per endpoint AND config.
 * Different configs for the same endpoint will create separate limiters.
 * This allows tests to use the same endpoint with different concurrency configs.
 */
export function getConcurrencyLimiter(
  endpoint: string,
  config: ConcurrencyConfig
): ConcurrencyLimiter {
  // Create a unique key that includes the config to avoid reusing limiters
  // with different configs for the same endpoint
  const key = `${endpoint}:${config.max}:${config.actionOnExceed || 'queue'}`;

  let limiter = limiters.get(key);

  if (!limiter) {
    limiter = new ConcurrencyLimiter(config);
    limiters.set(key, limiter);
  }

  return limiter;
}

/**
 * Clear all limiters (useful for testing)
 */
export function clearAllLimiters(): void {
  for (const limiter of limiters.values()) {
    limiter.clearQueue();
  }
  limiters.clear();
}
