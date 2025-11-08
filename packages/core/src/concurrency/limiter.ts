/**
 * Concurrency Limiter (v2.0.0 - D1)
 * Limit how many requests can run simultaneously
 */

/**
 * Concurrency configuration
 */
export interface ConcurrencyConfig {
  max: number;  // Maximum concurrent requests
  queueTimeout?: number;  // Max wait time in queue (ms), default 30000
  actionOnExceed?: 'queue' | 'block';  // Default 'queue'
}

/**
 * Queued request
 */
interface QueuedRequest {
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
  private readonly actionOnExceed: 'queue' | 'block';

  constructor(config: ConcurrencyConfig) {
    this.max = config.max;
    this.queueTimeout = config.queueTimeout ?? 30000; // 30 seconds default
    this.actionOnExceed = config.actionOnExceed ?? 'queue';
  }

  /**
   * Acquire a slot for execution
   * Returns a promise that resolves when a slot is available
   *
   * @param priority - Lower number = higher priority (default: 5)
   */
  async acquire(priority: number = 5): Promise<() => void> {
    // If under limit, acquire immediately
    if (this.running < this.max) {
      this.running++;
      return () => this.release();
    }

    // If blocking mode, throw error
    if (this.actionOnExceed === 'block') {
      throw new Error(`Concurrency limit reached: ${this.max} concurrent requests`);
    }

    // Queue mode: wait for a slot
    return new Promise((resolve, reject) => {
      const enqueueTime = Date.now();

      // Set timeout
      const timeout = setTimeout(() => {
        // Remove from queue
        const index = this.queue.findIndex((req) => req.enqueueTime === enqueueTime);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }

        reject(new Error(`Queue timeout: waited ${this.queueTimeout}ms for concurrency slot`));
      }, this.queueTimeout);

      // Create queued request
      const queuedRequest: QueuedRequest = {
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

      // Insert into queue based on priority
      // Lower priority number = higher priority (goes first)
      // If same priority, maintain FIFO order (use enqueueTime)
      const insertIndex = this.queue.findIndex(
        (req) => req.priority > priority || (req.priority === priority && req.enqueueTime > enqueueTime)
      );

      if (insertIndex === -1) {
        // No items with lower priority found, append to end
        this.queue.push(queuedRequest);
      } else {
        // Insert before the first item with lower priority
        this.queue.splice(insertIndex, 0, queuedRequest);
      }
    });
  }

  /**
   * Release a slot
   * Process next item in queue if available
   */
  private release(): void {
    // Process next in queue first (BEFORE decrementing)
    // This prevents race condition where multiple releases
    // could cause running count to temporarily exceed max
    if (this.queue.length > 0) {
      const next = this.queue.shift();
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
