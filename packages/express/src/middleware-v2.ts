/**
 * LimitRate Express middleware (v3.2.0 - Framework Agnostic)
 * Simplified middleware using RateLimiter + ExpressAdapter
 *
 * This is the new recommended approach for Express integration.
 * Uses the framework-agnostic RateLimiter under the hood.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import {
  RateLimiter,
  type RateLimiterConfig,
  type AdapterOptions,
  validatePolicyConfig,
  validateStoreConfig,
  validateIPList,
  extractIP,
  isIPInList,
  logger,
} from '@limitrate/core';
import type { Store } from '@limitrate/core';
import { ExpressAdapter } from './adapters/express';
import { send403Response } from './response';
import type { LimitRateOptions } from './types';

/**
 * Type guard to check if store is a Store instance
 */
function isStoreInstance(store: any): store is Store {
  return (
    store &&
    typeof store === 'object' &&
    typeof store.checkRate === 'function' &&
    typeof store.incrementCost === 'function' &&
    typeof store.ping === 'function'
  );
}

/**
 * Create LimitRate middleware using new architecture
 *
 * @example
 * ```typescript
 * import { limitrateV2 } from '@limitrate/express';
 *
 * app.use(limitrateV2({
 *   store: { type: 'memory' },
 *   policies: {
 *     free: { rate: { maxPerMinute: 10 } }
 *   },
 *   identifyUser: (req) => req.user?.id || req.ip,
 *   identifyPlan: (req) => req.user?.plan || 'free'
 * }));
 * ```
 */
export function limitrateV2(options: LimitRateOptions): RequestHandler {
  // Validate configuration at startup (fail-fast)
  validatePolicyConfig(options.policies);

  if (options.ipAllowlist) {
    validateIPList(options.ipAllowlist, 'ipAllowlist');
  }

  if (options.ipBlocklist) {
    validateIPList(options.ipBlocklist, 'ipBlocklist');
  }

  // Handle store: either a Store instance (shared) or StoreConfig (auto-create)
  const storeConfig = isStoreInstance(options.store)
    ? options.store
    : (() => {
        validateStoreConfig(options.store);
        return options.store;
      })();

  // Create RateLimiter config
  const limiterConfig: RateLimiterConfig = {
    store: storeConfig,
    policies: options.policies,
    defaultPlan: 'free' as any,
    upgradeHint: typeof options.upgradeHint === 'function'
      ? options.upgradeHint('free' as any)
      : options.upgradeHint,
    dryRun: options.dryRun,
  };

  // Initialize RateLimiter
  const limiter = new RateLimiter(limiterConfig);

  // Create adapter
  const adapter = new ExpressAdapter();

  // Build adapter options
  const adapterOptions: AdapterOptions<Request> = {
    identifyUser: (req: Request) => {
      try {
        return options.identifyUser(req);
      } catch (error) {
        // Fall back to IP if identifyUser fails
        const forwardedFor = req.get('x-forwarded-for');
        const ip = extractIP(
          req.ip || req.socket.remoteAddress || 'unknown',
          forwardedFor,
          options.trustProxy,
          options.trustedProxyCount
        );
        logger.warn('[LimitRate] identifyUser failed, using IP:', error);
        return ip;
      }
    },
    identifyPlan: (req: Request) => {
      try {
        return options.identifyPlan(req);
      } catch (error) {
        logger.warn('[LimitRate] identifyPlan failed, using "free":', error);
        return 'free' as any;
      }
    },
    skip: options.skip,
    getPolicyOverride: (req: Request) => {
      return (req as any).__limitrate_policy;
    },
  };

  // Warn if using memory store in production
  if (!isStoreInstance(options.store) && options.store.type === 'memory' && process.env.NODE_ENV === 'production') {
    logger.warn(`
⚠️  [LimitRate] Memory store detected in production.
Limits won't be shared across instances.
Use Redis for distributed rate limiting:

  store: { type: 'redis', url: process.env.REDIS_URL }

Or use shared store factory:

  import { createSharedRedisStore } from '@limitrate/express';
  const store = createSharedRedisStore({ url: process.env.REDIS_URL });
    `);
  }

  // Return Express middleware
  const middleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Skip if skip function returns true
      if (options.skip && options.skip(req)) {
        return next();
      }

      // Extract IP address
      const forwardedFor = req.get('x-forwarded-for');
      const ip = extractIP(
        req.ip || req.socket.remoteAddress || 'unknown',
        forwardedFor,
        options.trustProxy,
        options.trustedProxyCount
      );

      // Check IP allowlist (skip all checks if match)
      if (options.ipAllowlist && isIPInList(ip, options.ipAllowlist)) {
        return next();
      }

      // Check IP blocklist (block immediately if match)
      if (options.ipBlocklist && isIPInList(ip, options.ipBlocklist)) {
        send403Response(res, ip);
        return;
      }

      // Convert Express request to RateLimitRequest
      const rateLimitRequest = adapter.toRateLimitRequest(req, adapterOptions);

      // Check rate limit
      const result = await limiter.check(rateLimitRequest);

      // Apply result to Express response
      const blocked = await adapter.applyResult(req, res, result, adapterOptions);

      // If blocked, don't call next()
      if (blocked) {
        return;
      }

      // If allowed, continue
      next();
    } catch (error) {
      logger.error('[LimitRate] Middleware error:', error);

      // Fail open: allow request on error
      next();
    }
  };

  // Add cleanup function
  (middleware as any).close = async () => {
    await limiter.close();
  };

  return middleware;
}
