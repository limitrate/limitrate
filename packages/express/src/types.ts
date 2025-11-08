/**
 * Express-specific types for LimitRate
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { PolicyConfig, PlanName, StoreConfig, Store, UserOverride, UserOverridesConfig } from '@limitrate/core';

export interface LimitRateOptions {
  /**
   * Function to identify the user from request
   * @example (req) => req.user?.id || req.ip
   */
  identifyUser: (req: Request) => string;

  /**
   * Function to identify the user's plan from request
   * @example (req) => req.user?.plan || 'free'
   */
  identifyPlan: (req: Request) => PlanName;

  /**
   * Store configuration or pre-configured store instance (for sharing)
   *
   * **Option 1: Config (auto-creates store)**
   * ```typescript
   * store: { type: 'redis', url: process.env.REDIS_URL }
   * ```
   *
   * **Option 2: Shared store instance (recommended for multiple limiters)**
   * ```typescript
   * import { createSharedRedisStore } from '@limitrate/express';
   * const store = createSharedRedisStore({ url: process.env.REDIS_URL });
   * // Reuse this store in multiple limitrate() calls
   * ```
   */
  store: StoreConfig | Store;

  /**
   * Policy configuration (plan -> endpoints -> rules)
   */
  policies: PolicyConfig;

  /**
   * Trust proxy headers (X-Forwarded-For)
   * @default false
   */
  trustProxy?: boolean;

  /**
   * IP addresses that always pass (skip all checks)
   */
  ipAllowlist?: string[];

  /**
   * IP addresses that are always blocked (403)
   */
  ipBlocklist?: string[];

  /**
   * Webhook URL for events (optional)
   */
  webhookUrl?: string;

  /**
   * Event handler (alternative to webhook)
   */
  onEvent?: (event: any) => void | Promise<void>;

  /**
   * Action when Redis fails
   * @default 'allow'
   */
  onRedisError?: 'allow' | 'block';

  /**
   * Custom upgrade hint for 429 responses
   * @example "Upgrade to Pro: https://yourapp.com/pricing"
   */
  upgradeHint?: string | ((plan: PlanName) => string);

  /**
   * Skip rate limiting for certain paths (health checks, etc.)
   */
  skip?: (req: Request) => boolean;

  /**
   * Track endpoints for auto-discovery (v1.4.0 - B2)
   * Set to true to enable tracking
   * @default false
   */
  trackEndpoints?: boolean;

  /**
   * Dry-run mode (v1.5.0 - B3)
   * If true, logs would-be 429s but doesn't actually block requests
   * Perfect for testing new rate limits in production without risk
   * @default false
   */
  dryRun?: boolean;

  /**
   * Custom logger for dry-run mode (v1.5.0 - B3)
   * Called when a request would have been blocked in dry-run mode
   * @example (event) => console.log('Would block:', event.user, event.endpoint)
   */
  dryRunLogger?: (event: DryRunEvent) => void | Promise<void>;

  /**
   * Static user overrides (v1.6.0 - B4)
   * Map of userId to custom rate limits
   * @example { 'user_enterprise_acme': { maxPerMinute: 10000, reason: 'Enterprise SLA' } }
   */
  userOverrides?: UserOverridesConfig;

  /**
   * Dynamic user override resolver (v1.6.0 - B4)
   * Called for each request to get user-specific overrides
   * Useful for loading overrides from database
   * @example async (userId) => db.userLimits.findOne({ userId })
   */
  getUserOverride?: (userId: string, req: Request) => Promise<UserOverride | null> | UserOverride | null;

  /**
   * Extract token count from request/response (v1.4.0 - AI feature)
   * Called BEFORE request to estimate tokens (for pre-flight check)
   * Pass the request object when called before processing
   * @example (req) => req.body.max_tokens || 1000
   */
  identifyTokenUsage?: (req: Request) => number | Promise<number>;

  /**
   * Extract actual token count from response (v1.4.0 - AI feature)
   * Called AFTER request completes to track actual token usage
   * Use res.locals or intercepted response body to get actual tokens
   * @example (res) => res.locals.openai?.usage?.total_tokens || 0
   */
  extractTokenUsage?: (res: Response) => number | Promise<number>;

  /**
   * Priority function for concurrency queue (v2.0.0 - D2)
   * Lower number = higher priority (goes first in queue)
   * @default () => 5
   * @example (req) => req.user?.plan === 'enterprise' ? 1 : req.user?.plan === 'pro' ? 3 : 5
   */
  priority?: (req: Request) => number;
}

/**
 * Dry-run event data (v1.5.0 - B3)
 */
export interface DryRunEvent {
  /** Timestamp of the event */
  timestamp: Date;
  /** User ID */
  user: string;
  /** Plan name */
  plan: string;
  /** Endpoint */
  endpoint: string;
  /** What action would have been taken */
  action: 'block' | 'slowdown';
  /** Reason for the action */
  reason: 'rate_exceeded' | 'cost_exceeded';
  /** Current usage */
  current: number;
  /** Limit that was exceeded */
  limit: number;
  /** How many seconds until reset */
  retryAfter: number;
}

export interface BlockedResponse {
  ok: false;
  reason: 'rate_limited' | 'cost_exceeded' | 'token_limit_exceeded' | 'ip_blocked';
  message: string;
  retry_after_seconds?: number;
  used: number;
  allowed: number;
  plan: PlanName;
  endpoint: string;
  upgrade_hint?: string;
}

export { Request, Response, NextFunction, RequestHandler };
