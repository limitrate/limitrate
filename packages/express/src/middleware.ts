/**
 * LimitRate Express middleware
 */

import {
  createStore,
  PolicyEngine,
  validatePolicyConfig,
  validateStoreConfig,
  validateIPList,
  createEndpointKey,
  extractIP,
  isIPInList,
  getGlobalEndpointTracker,
  getConcurrencyLimiter,
} from '@limitrate/core';
import type { Store } from '@limitrate/core';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { LimitRateOptions } from './types';
import { send429Response, send403Response, setRateLimitHeaders } from './response';
import { sendToWebhook } from './webhook';

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
 * Auto-detect and initialize CLI storage if installed
 */
async function initCliStorage(): Promise<((event: any) => void) | null> {
  try {
    // Try to dynamically import @limitrate/cli (optional dependency)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cli = await import('@limitrate/cli' as any) as any;
    console.log('[LimitRate] CLI detected - events will be saved to SQLite for inspection');
    return cli.saveEvent;
  } catch (error) {
    // @limitrate/cli not installed - skip silently
    if ((error as any).code !== 'ERR_MODULE_NOT_FOUND' && !(error as Error).message.includes('Cannot find module')) {
      console.warn('[LimitRate] Failed to load CLI:', (error as Error).message);
    }
    return null;
  }
}

/**
 * Create LimitRate middleware
 */
export function limitrate(options: LimitRateOptions): RequestHandler {
  // Validate configuration at startup (fail-fast)
  validatePolicyConfig(options.policies);

  if (options.ipAllowlist) {
    validateIPList(options.ipAllowlist, 'ipAllowlist');
  }

  if (options.ipBlocklist) {
    validateIPList(options.ipBlocklist, 'ipBlocklist');
  }

  // Handle store: either a Store instance (shared) or StoreConfig (auto-create)
  const store: Store = isStoreInstance(options.store)
    ? options.store
    : (() => {
        // Validate and create store from config
        validateStoreConfig(options.store);
        return createStore(options.store);
      })();

  const engine = new PolicyEngine(store, options.policies);

  // Auto-detect CLI and register event handler (async)
  initCliStorage().then(cliSaveEvent => {
    if (cliSaveEvent) {
      engine.onEvent(cliSaveEvent);
    }
  }).catch(() => {
    // Silently ignore CLI loading errors
  });

  // Register webhook handler if provided
  if (options.webhookUrl) {
    engine.onEvent(event => {
      sendToWebhook(event, { url: options.webhookUrl! }).catch(err => {
        console.error('[LimitRate] Webhook error:', err);
      });
    });
  }

  // Register custom event handler if provided
  if (options.onEvent) {
    engine.onEvent(options.onEvent);
  }

  // Warn if using memory store in production (only if config was provided, not instance)
  if (!isStoreInstance(options.store) && options.store.type === 'memory' && process.env.NODE_ENV === 'production') {
    console.warn(`
⚠️  [LimitRate] Memory store detected in production.
Limits won't be shared across instances.
Use Redis for distributed rate limiting:

  store: { type: 'redis', url: process.env.REDIS_URL }

Or use shared store factory:

  import { createSharedRedisStore } from '@limitrate/express';
  const store = createSharedRedisStore({ url: process.env.REDIS_URL });
    `);
  }

  // Return middleware function
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Skip if skip function returns true
      if (options.skip && options.skip(req)) {
        return next();
      }

      // Extract IP address
      const forwardedFor = req.get('x-forwarded-for');
      const ip = extractIP(req.ip || req.socket.remoteAddress || 'unknown', forwardedFor, options.trustProxy);

      // Check IP allowlist (skip all checks if match)
      if (options.ipAllowlist && isIPInList(ip, options.ipAllowlist)) {
        return next();
      }

      // Check IP blocklist (block immediately if match)
      if (options.ipBlocklist && isIPInList(ip, options.ipBlocklist)) {
        send403Response(res, ip);
        return;
      }

      // Identify user and plan
      let user: string;
      let plan: string;

      try {
        user = options.identifyUser(req);
        plan = options.identifyPlan(req);
      } catch (error) {
        // If adapter throws, fall back to IP
        console.warn('[LimitRate] identifyUser/identifyPlan failed, using IP:', error);
        user = ip;
        plan = 'free';
      }

      // Normalize endpoint
      const endpoint = createEndpointKey(req.method, req.path, req.route?.path);

      // Check for route-specific policy override
      const policyOverride = (req as any).__limitrate_policy;

      // Get concurrency config from policy (v2.0.0 - D1)
      const concurrencyConfig = policyOverride?.concurrency ||
        options.policies[plan]?.endpoints?.[endpoint]?.concurrency ||
        options.policies[plan]?.defaults?.concurrency;

      // Acquire concurrency slot if configured
      let releaseConcurrency: (() => void) | null = null;
      if (concurrencyConfig) {
        try {
          const limiter = getConcurrencyLimiter(endpoint, concurrencyConfig);

          // Get priority from user function (v2.0.0 - D2)
          // Lower number = higher priority (default: 5)
          let priority = 5;
          if (options.priority) {
            try {
              priority = options.priority(req);
              // Validate priority
              if (typeof priority !== 'number' || priority < 0 || !isFinite(priority)) {
                console.warn('[LimitRate] Invalid priority value:', priority, '- using default (5)');
                priority = 5;
              }
            } catch (error) {
              console.warn('[LimitRate] priority() function failed:', error, '- using default (5)');
              priority = 5;
            }
          }

          releaseConcurrency = await limiter.acquire(priority);
        } catch (error) {
          // Concurrency limit reached (block mode) or queue timeout
          send429Response(res, {
            reason: 'rate_limited',
            plan,
            endpoint,
            used: concurrencyConfig.max,
            allowed: concurrencyConfig.max,
            retryAfterSeconds: 1,
            upgradeHint: typeof options.upgradeHint === 'function'
              ? options.upgradeHint(plan)
              : options.upgradeHint,
          });
          return;
        }
      }

      // Check for user override (v1.6.0 - B4)
      let userOverride = null;
      try {
        // Try static overrides first
        if (options.userOverrides && options.userOverrides[user]) {
          userOverride = options.userOverrides[user];
        }
        // Try dynamic override resolver (takes precedence over static)
        else if (options.getUserOverride) {
          userOverride = await Promise.resolve(options.getUserOverride(user, req));
        }
      } catch (error) {
        console.warn('[LimitRate] getUserOverride failed:', error);
        // Continue without override
      }

      // Extract token count if provided (v1.4.0 - AI feature)
      let tokens: number | undefined;
      if (options.identifyTokenUsage) {
        try {
          tokens = await Promise.resolve(options.identifyTokenUsage(req));
          // Validate token count
          if (tokens !== undefined && (typeof tokens !== 'number' || tokens < 0 || !isFinite(tokens))) {
            console.warn('[LimitRate] Invalid token count:', tokens);
            tokens = undefined;
          }
        } catch (error) {
          console.warn('[LimitRate] identifyTokenUsage failed:', error);
          tokens = undefined;
        }
      }

      // Check policy
      const result = await engine.check({
        user,
        plan,
        endpoint,
        costContext: req, // Pass request as cost context
        policyOverride, // Pass route-specific override if exists
        userOverride, // Pass user override if exists
        tokens, // Pass token count if extracted (v1.4.0)
      });

      // Track endpoint for auto-discovery (v1.4.0 - B2)
      if (options.trackEndpoints !== false) {
        const tracker = getGlobalEndpointTracker();
        tracker.trackRequest(req.method, req.path, {
          hasRateLimit: true, // This endpoint IS protected by limitrate
          wasRateLimited: result.action === 'block' && !result.allowed,
          policy: plan,
          limit: result.details?.limit,
        });
      }

      // Set rate limit headers (even if allowed)
      if (result.details) {
        setRateLimitHeaders(
          res,
          result.details.limit,
          result.details.remaining,
          result.details.resetInSeconds,
          result.details.burstTokens
        );
      }

      // Handle slowdown
      if (result.action === 'slowdown' && result.slowdownMs) {
        // Dry-run mode: Log instead of slowing down
        if (options.dryRun) {
          const dryRunEvent = {
            timestamp: new Date(),
            user,
            plan,
            endpoint,
            action: 'slowdown' as const,
            reason: (result.reason || 'rate_exceeded') as 'rate_exceeded' | 'cost_exceeded',
            current: result.details?.used || 0,
            limit: result.details?.limit || 0,
            retryAfter: result.retryAfterSeconds || result.details?.resetInSeconds || 0,
          };

          // Log to console (default behavior)
          console.log(`[LimitRate] DRY-RUN: Would slowdown ${user} on ${endpoint} (${dryRunEvent.current}/${dryRunEvent.limit})`);

          // Call custom logger if provided (catch errors to prevent disruption)
          if (options.dryRunLogger) {
            try {
              await Promise.resolve(options.dryRunLogger(dryRunEvent));
            } catch (loggerError) {
              console.error('[LimitRate] Unexpected error:', loggerError);
            }
          }

          return next(); // Allow request to continue
        }

        await sleep(result.slowdownMs);
        return next();
      }

      // Handle block
      if (result.action === 'block' && !result.allowed) {
        // Dry-run mode: Log instead of blocking
        if (options.dryRun) {
          const dryRunEvent = {
            timestamp: new Date(),
            user,
            plan,
            endpoint,
            action: 'block' as const,
            reason: (result.reason === 'rate_exceeded' ? 'rate_exceeded' : 'cost_exceeded') as 'rate_exceeded' | 'cost_exceeded',
            current: result.details?.used || 0,
            limit: result.details?.limit || 0,
            retryAfter: result.retryAfterSeconds || result.details?.resetInSeconds || 0,
          };

          // Log to console (default behavior)
          console.log(`[LimitRate] DRY-RUN: Would block ${user} on ${endpoint} (${dryRunEvent.current}/${dryRunEvent.limit})`);

          // Call custom logger if provided (catch errors to prevent disruption)
          if (options.dryRunLogger) {
            try {
              await Promise.resolve(options.dryRunLogger(dryRunEvent));
            } catch (loggerError) {
              console.error('[LimitRate] Unexpected error:', loggerError);
            }
          }

          return next(); // Allow request to continue
        }

        const upgradeHint =
          typeof options.upgradeHint === 'function'
            ? options.upgradeHint(plan)
            : options.upgradeHint;

        // Map internal reason to response reason
        let reason: 'rate_limited' | 'cost_exceeded' | 'token_limit_exceeded' = 'rate_limited';
        if (result.reason === 'rate_exceeded') {
          reason = 'rate_limited';
        } else if (result.reason === 'cost_exceeded') {
          reason = 'cost_exceeded';
        } else if (result.reason === 'token_limit_exceeded') {
          reason = 'token_limit_exceeded';
        }

        send429Response(res, {
          reason,
          plan,
          endpoint,
          used: result.details.used,
          allowed: result.details.limit,
          retryAfterSeconds: result.retryAfterSeconds || result.details.resetInSeconds,
          upgradeHint,
        });
        return;
      }

      // Wrap next() to ensure concurrency slot is released
      if (releaseConcurrency) {
        // Ensure release is only called once (both finish and close can fire)
        let released = false;
        const releaseOnce = () => {
          if (!released) {
            released = true;
            releaseConcurrency();
          }
        };

        // Release slot when response finishes or errors
        res.on('finish', releaseOnce);
        res.on('close', releaseOnce);
      }

      // Allow request
      next();
    } catch (error) {
      // Handle store errors
      if (error instanceof Error && error.message.includes('Redis')) {
        const action = options.onRedisError || 'allow';

        if (action === 'allow') {
          console.error('[LimitRate] Store error, allowing request:', error);
          return next();
        } else {
          console.error('[LimitRate] Store error, blocking request:', error);
          res.status(503).json({
            ok: false,
            error: 'Service temporarily unavailable',
          });
          return;
        }
      }

      // Other errors
      console.error('[LimitRate] Unexpected error:', error);
      next(error);
    }
  };
}

/**
 * Create per-route policy override
 */
export function withPolicy(_policy: any): RequestHandler {
  // This will be used to override policies for specific routes
  // Implementation: attach policy to req object, middleware checks it
  return (req: Request, _res: Response, next: NextFunction) => {
    (req as any).__limitrate_policy = _policy;
    next();
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
