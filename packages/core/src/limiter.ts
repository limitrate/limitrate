/**
 * Framework-agnostic rate limiter
 * Pure business logic - no framework dependencies
 *
 * @since v3.2.0 - Framework Agnostic Refactor
 */

import { PolicyEngine, type CheckContext, type CheckResult } from './engine';
import { createStore } from './stores';
import type {
  Store,
  PolicyConfig,
  StoreConfig,
  PlanName,
  UserOverride,
  EndpointPolicy,
} from './types';
import { EventEmitter } from './utils/events';
import { logger } from './logger';

/**
 * Framework-agnostic request context
 * Adapters convert framework-specific requests to this format
 */
export interface RateLimitRequest {
  /** User identifier (email, ID, API key, etc.) */
  userId: string;

  /** User's plan/tier */
  plan: PlanName;

  /** Endpoint identifier (METHOD|/path) */
  endpoint: string;

  /** HTTP method (GET, POST, etc.) */
  method: string;

  /** Request path */
  path: string;

  /** Timestamp of request */
  timestamp: number;

  /** Optional: Cost estimation for AI requests */
  estimatedCost?: number;

  /** Optional: Token count for AI requests */
  estimatedTokens?: number;

  /** Optional: User override for this request */
  userOverride?: UserOverride | null;

  /** Optional: Per-route policy override */
  policyOverride?: EndpointPolicy;

  /** Optional: Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Framework-agnostic rate limit result
 * Adapters convert this to framework-specific responses
 */
export interface RateLimitResult {
  /** Whether request should be allowed */
  allowed: boolean;

  /** HTTP status code to return */
  statusCode: number;

  /** Current usage count */
  current: number;

  /** Maximum allowed */
  limit: number;

  /** Remaining quota */
  remaining: number;

  /** Seconds until limit resets */
  resetInSeconds: number;

  /** Seconds to wait before retrying (if blocked) */
  retryAfter?: number;

  /** Milliseconds to delay response (if slowdown) */
  slowdownMs?: number;

  /** Reason for blocking */
  reason?: 'rate_exceeded' | 'cost_exceeded' | 'token_limit_exceeded';

  /** Error details (if blocked) */
  error?: {
    message: string;
    code: string;
    details?: Record<string, any>;
  };

  /** Response headers to set */
  headers: Record<string, string>;

  /** Upgrade hint for blocked requests */
  upgradeHint?: string;
}

/**
 * Configuration for RateLimiter
 */
export interface RateLimiterConfig {
  /** Store configuration or instance */
  store: StoreConfig | Store;

  /** Policy configuration */
  policies: PolicyConfig;

  /** Default plan if not specified */
  defaultPlan?: PlanName;

  /** Upgrade hint message */
  upgradeHint?: string;

  /** Whether to emit events */
  emitEvents?: boolean;

  /** Event emitter instance */
  events?: EventEmitter;

  /** Dry run mode (log but don't enforce) */
  dryRun?: boolean;

  /** Custom logger */
  logger?: typeof logger;
}

/**
 * Framework-agnostic rate limiter
 *
 * This is the core rate limiting logic with no framework dependencies.
 * Framework adapters wrap this class to provide framework-specific middleware.
 *
 * @example
 * ```typescript
 * const limiter = new RateLimiter({
 *   store: { type: 'memory' },
 *   policies: {
 *     free: { rate: { maxPerMinute: 10 } }
 *   }
 * });
 *
 * const request: RateLimitRequest = {
 *   userId: 'user123',
 *   plan: 'free',
 *   endpoint: 'POST|/api/chat',
 *   method: 'POST',
 *   path: '/api/chat',
 *   timestamp: Date.now()
 * };
 *
 * const result = await limiter.check(request);
 * if (!result.allowed) {
 *   // Handle rate limit exceeded
 * }
 * ```
 */
export class RateLimiter {
  private store: Store;
  private engine: PolicyEngine;
  private config: RateLimiterConfig;
  private events: EventEmitter;

  constructor(config: RateLimiterConfig) {
    this.config = config;

    // Initialize store
    if ('checkRate' in config.store) {
      // Already a Store instance
      this.store = config.store as Store;
    } else {
      // Create store from config
      this.store = createStore(config.store as StoreConfig);
    }

    // Initialize policy engine
    this.engine = new PolicyEngine(this.store, config.policies);

    // Get or create event emitter
    this.events = config.events || this.engine['events'];
  }

  /**
   * Check if request should be rate limited
   *
   * This is the main entry point for rate limiting checks.
   * Returns a result indicating whether to allow/block the request.
   *
   * @param request - Framework-agnostic request context
   * @returns Rate limit result with decision and details
   */
  async check(request: RateLimitRequest): Promise<RateLimitResult> {
    const startTime = Date.now();

    try {
      // Build context for policy engine
      const context: CheckContext = {
        user: request.userId,
        plan: request.plan || this.config.defaultPlan || ('default' as PlanName),
        endpoint: request.endpoint,
        costContext: request.estimatedCost ? {
          cost: request.estimatedCost
        } : undefined,
        tokens: request.estimatedTokens,
        policyOverride: request.policyOverride,
        userOverride: request.userOverride,
      };

      // Check limits via policy engine
      const checkResult = await this.engine.check(context);

      // Build framework-agnostic result
      const result = this.buildResult(checkResult, request);

      // Log in dry run mode
      if (this.config.dryRun && !result.allowed) {
        logger.warn('[DRY RUN] Would rate limit:', {
          user: request.userId,
          endpoint: request.endpoint,
          reason: result.reason,
          current: result.current,
          limit: result.limit
        });
      }

      // Emit metrics
      const duration = Date.now() - startTime;
      this.emitMetrics(request, result, duration);

      return result;

    } catch (error) {
      logger.error('Rate limit check failed:', error);

      // Fail open: allow request on error
      return {
        allowed: true,
        statusCode: 200,
        current: 0,
        limit: 0,
        remaining: 0,
        resetInSeconds: 0,
        headers: {},
        error: {
          message: 'Rate limit check failed',
          code: 'INTERNAL_ERROR',
          details: { error: String(error) }
        }
      };
    }
  }

  /**
   * Check current usage without incrementing
   * Useful for checking status without consuming quota
   */
  async peek(request: RateLimitRequest): Promise<RateLimitResult> {
    // TODO: Implement peek method
    // This should check current usage without incrementing counters
    return this.check(request);
  }

  /**
   * Reset limits for a user
   * Useful for testing or manual overrides
   */
  async reset(_userId: string, _endpoint?: string): Promise<void> {
    // TODO: Implement reset method
    logger.info('Reset limits:', { userId: _userId, endpoint: _endpoint });
  }

  /**
   * Get current usage stats for a user
   */
  async getUsage(_userId: string, _endpoint?: string): Promise<{
    current: number;
    limit: number;
    remaining: number;
    resetInSeconds: number;
  }> {
    // TODO: Implement getUsage method
    return {
      current: 0,
      limit: 0,
      remaining: 0,
      resetInSeconds: 0
    };
  }

  /**
   * Close and cleanup resources
   */
  async close(): Promise<void> {
    await this.store.close();
  }

  /**
   * Build framework-agnostic result from policy engine check
   */
  private buildResult(
    checkResult: CheckResult,
    _request: RateLimitRequest
  ): RateLimitResult {
    const { allowed, reason, retryAfterSeconds, slowdownMs, details } = checkResult;

    // Determine status code
    let statusCode = 200;
    if (!allowed) {
      statusCode = 429; // Too Many Requests
    }

    // Build response headers
    const headers: Record<string, string> = {
      'X-RateLimit-Limit': String(details.limit),
      'X-RateLimit-Remaining': String(details.remaining),
      'X-RateLimit-Used': String(details.used),
      'X-RateLimit-Reset': String(Math.floor((Date.now() + details.resetInSeconds * 1000) / 1000)),
    };

    if (retryAfterSeconds) {
      headers['Retry-After'] = String(retryAfterSeconds);
    }

    // Build error message if blocked
    let error: RateLimitResult['error'] | undefined;
    let upgradeHint: string | undefined;

    if (!allowed) {
      const reasonText = reason === 'rate_exceeded' ? 'Rate limit exceeded' :
                        reason === 'cost_exceeded' ? 'Cost limit exceeded' :
                        reason === 'token_limit_exceeded' ? 'Token limit exceeded' :
                        'Limit exceeded';

      error = {
        message: `${reasonText}: ${details.used}/${details.limit} used. Resets in ${details.resetInSeconds}s.`,
        code: reason === 'rate_exceeded' ? 'RATE_LIMIT_EXCEEDED' :
              reason === 'cost_exceeded' ? 'COST_LIMIT_EXCEEDED' :
              reason === 'token_limit_exceeded' ? 'TOKEN_LIMIT_EXCEEDED' :
              'LIMIT_EXCEEDED',
        details: {
          current: details.used,
          limit: details.limit,
          remaining: details.remaining,
          resetInSeconds: details.resetInSeconds,
          retryAfter: retryAfterSeconds
        }
      };

      upgradeHint = this.config.upgradeHint;
    }

    return {
      allowed: this.config.dryRun ? true : allowed, // Always allow in dry run
      statusCode,
      current: details.used,
      limit: details.limit,
      remaining: details.remaining,
      resetInSeconds: details.resetInSeconds,
      retryAfter: retryAfterSeconds,
      slowdownMs,
      reason,
      error,
      headers,
      upgradeHint
    };
  }

  /**
   * Emit metrics for observability
   */
  private emitMetrics(
    request: RateLimitRequest,
    result: RateLimitResult,
    _duration: number
  ): void {
    // Determine event type
    const eventType = result.allowed ? 'allowed' : 'blocked';

    // Emit event
    this.events.emit({
      timestamp: Date.now(),
      user: request.userId,
      plan: request.plan,
      endpoint: request.endpoint,
      type: eventType,
      value: result.current,
      threshold: result.limit
    });
  }
}
