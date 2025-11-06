/**
 * Endpoint Auto-Discovery System
 *
 * Tracks all endpoints that receive requests, showing which are protected
 * by rate limiting and which are not. Helps catch forgotten endpoints.
 */

export interface EndpointStats {
  /** HTTP method (GET, POST, etc.) */
  method: string;
  /** Endpoint path (e.g., /api/users/:id) */
  path: string;
  /** Whether this endpoint has rate limiting */
  hasRateLimit: boolean;
  /** Total request count */
  requestCount: number;
  /** Number of rate limited requests */
  rateLimitedCount: number;
  /** First seen timestamp */
  firstSeen: Date;
  /** Last seen timestamp */
  lastSeen: Date;
  /** Rate limit policy applied (if any) */
  policy?: string;
  /** Rate limit config (if any) */
  limit?: number;
}

export interface EndpointTrackerOptions {
  /** Max endpoints to track (default: 1000) */
  maxEndpoints?: number;
  /** How long to keep endpoint stats (default: 24h) */
  retentionMs?: number;
}

/**
 * Tracks discovered endpoints at runtime
 */
export class EndpointTracker {
  private endpoints = new Map<string, EndpointStats>();
  private options: Required<EndpointTrackerOptions>;

  constructor(options: EndpointTrackerOptions = {}) {
    this.options = {
      maxEndpoints: options.maxEndpoints ?? 1000,
      retentionMs: options.retentionMs ?? 24 * 60 * 60 * 1000, // 24 hours
    };
  }

  /**
   * Track a request to an endpoint
   */
  trackRequest(
    method: string,
    path: string,
    options: {
      hasRateLimit: boolean;
      wasRateLimited?: boolean;
      policy?: string;
      limit?: number;
    }
  ): void {
    const key = `${method}:${path}`;
    const now = new Date();

    const existing = this.endpoints.get(key);
    if (existing) {
      // Update existing endpoint stats
      existing.requestCount++;
      if (options.wasRateLimited) {
        existing.rateLimitedCount++;
      }
      existing.lastSeen = now;
      existing.hasRateLimit = options.hasRateLimit;
      if (options.policy) existing.policy = options.policy;
      if (options.limit) existing.limit = options.limit;
    } else {
      // Check if we've hit the max endpoints limit
      if (this.endpoints.size >= this.options.maxEndpoints) {
        // Remove oldest endpoint
        const oldestKey = this.findOldestEndpoint();
        if (oldestKey) {
          this.endpoints.delete(oldestKey);
        }
      }

      // Add new endpoint
      this.endpoints.set(key, {
        method,
        path,
        hasRateLimit: options.hasRateLimit,
        requestCount: 1,
        rateLimitedCount: options.wasRateLimited ? 1 : 0,
        firstSeen: now,
        lastSeen: now,
        policy: options.policy,
        limit: options.limit,
      });
    }
  }

  /**
   * Get all tracked endpoints
   */
  getEndpoints(): EndpointStats[] {
    this.cleanup();
    return Array.from(this.endpoints.values()).sort((a, b) => {
      // Sort by request count (descending)
      return b.requestCount - a.requestCount;
    });
  }

  /**
   * Get unprotected endpoints (those without rate limits)
   */
  getUnprotectedEndpoints(): EndpointStats[] {
    return this.getEndpoints().filter((e) => !e.hasRateLimit);
  }

  /**
   * Get protected endpoints (those with rate limits)
   */
  getProtectedEndpoints(): EndpointStats[] {
    return this.getEndpoints().filter((e) => e.hasRateLimit);
  }

  /**
   * Get stats summary
   */
  getStats(): {
    totalEndpoints: number;
    protectedEndpoints: number;
    unprotectedEndpoints: number;
    totalRequests: number;
    totalRateLimited: number;
  } {
    this.cleanup();
    const endpoints = Array.from(this.endpoints.values());
    return {
      totalEndpoints: endpoints.length,
      protectedEndpoints: endpoints.filter((e) => e.hasRateLimit).length,
      unprotectedEndpoints: endpoints.filter((e) => !e.hasRateLimit).length,
      totalRequests: endpoints.reduce((sum, e) => sum + e.requestCount, 0),
      totalRateLimited: endpoints.reduce((sum, e) => sum + e.rateLimitedCount, 0),
    };
  }

  /**
   * Clear all tracked endpoints
   */
  clear(): void {
    this.endpoints.clear();
  }

  /**
   * Clean up old endpoints based on retention policy
   */
  private cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.options.retentionMs;

    for (const [key, endpoint] of this.endpoints) {
      if (endpoint.lastSeen.getTime() < cutoff) {
        this.endpoints.delete(key);
      }
    }
  }

  /**
   * Find the oldest endpoint (by lastSeen)
   */
  private findOldestEndpoint(): string | null {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, endpoint] of this.endpoints) {
      if (endpoint.lastSeen.getTime() < oldestTime) {
        oldestTime = endpoint.lastSeen.getTime();
        oldestKey = key;
      }
    }

    return oldestKey;
  }
}

/**
 * Global endpoint tracker instance (singleton)
 */
let globalTracker: EndpointTracker | null = null;

/**
 * Get or create the global endpoint tracker
 */
export function getGlobalEndpointTracker(): EndpointTracker {
  if (!globalTracker) {
    globalTracker = new EndpointTracker();
  }
  return globalTracker;
}

/**
 * Set a custom global endpoint tracker
 */
export function setGlobalEndpointTracker(tracker: EndpointTracker): void {
  globalTracker = tracker;
}
