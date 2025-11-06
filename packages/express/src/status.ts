/**
 * Rate limit status helpers for client-side SDK (v1.7.0 - B5)
 */

import type { Request, Response } from 'express';
import type { Store } from '@limitrate/core';
import { createEndpointKey } from '@limitrate/core';

export interface RateLimitStatus {
  /** Current usage */
  used: number;
  /** Rate limit */
  limit: number;
  /** Remaining requests */
  remaining: number;
  /** Seconds until reset */
  resetIn: number;
  /** User's plan */
  plan: string;
  /** Percentage used (0-100) */
  percentage: number;
}

/**
 * Get rate limit status for a user
 * Use this to create a status endpoint for your frontend
 *
 * @example
 * ```typescript
 * import { getRateLimitStatus } from '@limitrate/express';
 *
 * app.get('/api/rate-limit/status', async (req, res) => {
 *   const status = await getRateLimitStatus({
 *     user: req.user?.id || req.ip,
 *     plan: req.user?.plan || 'free',
 *     endpoint: 'GET|/api/chat', // or use current endpoint
 *     store,
 *     limit: 100, // from your policy
 *     windowSeconds: 60,
 *   });
 *   res.json(status);
 * });
 * ```
 */
export async function getRateLimitStatus(options: {
  user: string;
  plan: string;
  endpoint: string;
  store: Store;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitStatus> {
  const { user, plan, endpoint, store, limit, windowSeconds } = options;

  // Build rate key
  const rateKey = `${user}:${endpoint}`;

  // Peek at current usage (without incrementing) - v1.7.0 B5
  const result = await store.peekRate(rateKey, limit, windowSeconds);

  const used = result.current;
  const remaining = Math.max(0, limit - used);
  const percentage = limit === 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));

  return {
    used,
    limit,
    remaining,
    resetIn: result.resetInSeconds,
    plan,
    percentage,
  };
}

/**
 * Create a status endpoint handler
 * Convenience wrapper for getRateLimitStatus
 *
 * @example
 * ```typescript
 * import { createStatusEndpoint } from '@limitrate/express';
 *
 * app.get('/api/rate-limit/status', createStatusEndpoint({
 *   store,
 *   identifyUser: (req) => req.user?.id || req.ip,
 *   identifyPlan: (req) => req.user?.plan || 'free',
 *   getLimit: (plan) => plan === 'pro' ? 1000 : 100,
 *   windowSeconds: 60,
 * }));
 * ```
 */
export function createStatusEndpoint(options: {
  store: Store;
  identifyUser: (req: Request) => string;
  identifyPlan: (req: Request) => string;
  getLimit: (plan: string) => number;
  windowSeconds: number;
  endpoint?: string;
}) {
  return async (req: Request, res: Response) => {
    try {
      const user = options.identifyUser(req);
      const plan = options.identifyPlan(req);
      const limit = options.getLimit(plan);
      const endpoint = options.endpoint || createEndpointKey(req.method, req.path, req.route?.path);

      const status = await getRateLimitStatus({
        user,
        plan,
        endpoint,
        store: options.store,
        limit,
        windowSeconds: options.windowSeconds,
      });

      res.json(status);
    } catch (error) {
      console.error('[LimitRate] Status endpoint error:', error);
      res.status(500).json({
        error: 'Failed to get rate limit status',
      });
    }
  };
}
