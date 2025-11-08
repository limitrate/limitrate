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
  logger,
} from '@limitrate/core';
import type { Store } from '@limitrate/core';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { LimitRateOptions } from './types';
import { send429Response, send403Response, setRateLimitHeaders } from './response';
import { sendToWebhook, validateWebhookUrl } from './webhook';
import { sleep } from './utils/sleep';
import { createHash } from 'crypto';

/**
 * Wrap a promise with a timeout
 * @param promise - Promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param errorMessage - Error message if timeout occurs
 * @returns Promise that rejects if timeout is reached
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
}

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
    logger.info('[LimitRate] CLI detected - events will be saved to SQLite for inspection');
    return cli.saveEvent;
  } catch (error) {
    // @limitrate/cli not installed - skip silently
    if ((error as any).code !== 'ERR_MODULE_NOT_FOUND' && !(error as Error).message.includes('Cannot find module')) {
      logger.warn('[LimitRate] Failed to load CLI:', (error as Error).message);
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

  // Validate webhook URL at startup (SSRF protection)
  if (options.webhookUrl) {
    validateWebhookUrl(options.webhookUrl);
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

  // Fix #5: Track event handlers for cleanup to prevent memory leaks
  const eventHandlers: Array<(event: any) => void | Promise<void>> = [];

  // Auto-detect CLI and register event handler (async)
  initCliStorage().then(cliSaveEvent => {
    if (cliSaveEvent) {
      engine.onEvent(cliSaveEvent);
      eventHandlers.push(cliSaveEvent);
    }
  }).catch(() => {
    // Silently ignore CLI loading errors
  });

  // Register webhook handler if provided
  if (options.webhookUrl) {
    const webhookHandler = (event: any) => {
      sendToWebhook(event, { url: options.webhookUrl! }).catch(err => {
        logger.error('[LimitRate] Webhook error:', err);
      });
    };
    engine.onEvent(webhookHandler);
    eventHandlers.push(webhookHandler);
  }

  // Register custom event handler if provided
  if (options.onEvent) {
    engine.onEvent(options.onEvent);
    eventHandlers.push(options.onEvent);
  }

  // Fix #5: Add cleanup function that can be called when middleware is no longer needed
  // Store it on the middleware function itself so it can be accessed
  const middleware = async (req: Request, res: Response, next: NextFunction) => {

  // Warn if using memory store in production (only if config was provided, not instance)
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
        options.trustedProxyCount // V4: Pass trustedProxyCount to prevent IP spoofing
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

      // Identify user and plan
      let user: string;
      let plan: string;

      try {
        user = options.identifyUser(req);
        plan = options.identifyPlan(req);
      } catch (error) {
        // If adapter throws, fall back to IP
        logger.warn('[LimitRate] identifyUser/identifyPlan failed, using IP:', error);
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
              // Validate priority: must be a finite positive number (not NaN or Infinity)
              if (
                typeof priority !== 'number' ||
                Number.isNaN(priority) ||
                !Number.isFinite(priority) ||
                priority < 0
              ) {
                logger.warn('[LimitRate] Invalid priority value:', priority, '- using default (5)');
                priority = 5;
              }
            } catch (error) {
              logger.warn('[LimitRate] priority() function failed:', error, '- using default (5)');
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
        // V2: Validate userId format BEFORE calling getUserOverride to prevent slow query attacks
        // Allow alphanumeric, underscore, hyphen, max 64 chars
        const userIdFormatValid = /^[a-zA-Z0-9_-]{1,64}$/.test(user);
        if (!userIdFormatValid) {
          // BUG FIX #2: Hash invalid IDs instead of bucketing to 'invalid'
          // This prevents different invalid users from sharing rate limits
          const hash = createHash('sha256').update(user).digest('hex');
          const hashedId = `hashed_${hash.substring(0, 32)}`;
          logger.warn(`[LimitRate] Invalid userId format: "${user}" - using hashed ID: ${hashedId}`);
          user = hashedId;
        }

        // Try static overrides first
        if (options.userOverrides && options.userOverrides[user]) {
          userOverride = options.userOverrides[user];
        }
        // Try dynamic override resolver (takes precedence over static)
        else if (options.getUserOverride) {
          // Add 1-second timeout to prevent slow database queries from hanging requests
          userOverride = await withTimeout(
            Promise.resolve(options.getUserOverride(user, req)),
            1000,
            '[LimitRate] getUserOverride timeout after 1000ms'
          );
        }
      } catch (error) {
        logger.warn('[LimitRate] getUserOverride failed:', error);
        // Continue without override
      }

      // Extract token count if provided (v1.4.0 - AI feature)
      let tokens: number | undefined;
      if (options.identifyTokenUsage) {
        try {
          tokens = await Promise.resolve(options.identifyTokenUsage(req));
          // Validate token count: must be a finite, safe integer between 0 and 10,000,000
          if (
            tokens !== undefined && (
              typeof tokens !== 'number' ||
              Number.isNaN(tokens) ||
              !Number.isFinite(tokens) ||
              tokens < 0 ||
              tokens > 10_000_000 || // Reasonable max for token counts
              !Number.isSafeInteger(tokens)
            )
          ) {
            logger.warn('[LimitRate] Invalid token count:', tokens, '- must be safe integer 0-10,000,000');
            tokens = undefined;
          }
        } catch (error) {
          logger.warn('[LimitRate] identifyTokenUsage failed:', error);
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
      // Now opt-in only (v3.0.0)
      if (options.trackEndpoints === true) {
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
          logger.info(`[LimitRate] DRY-RUN: Would slowdown ${user} on ${endpoint} (${dryRunEvent.current}/${dryRunEvent.limit})`);

          // Call custom logger if provided (catch errors to prevent disruption)
          if (options.dryRunLogger) {
            try {
              await Promise.resolve(options.dryRunLogger(dryRunEvent));
            } catch (loggerError) {
              logger.error('[LimitRate] Unexpected error:', loggerError);
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
          logger.info(`[LimitRate] DRY-RUN: Would block ${user} on ${endpoint} (${dryRunEvent.current}/${dryRunEvent.limit})`);

          // Call custom logger if provided (catch errors to prevent disruption)
          if (options.dryRunLogger) {
            try {
              await Promise.resolve(options.dryRunLogger(dryRunEvent));
            } catch (loggerError) {
              logger.error('[LimitRate] Unexpected error:', loggerError);
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

        // BUG FIX #4: Use error handler to catch errors and release slot
        const errorHandler = (err: any) => {
          if (!released) {
            releaseOnce();
          }
          // Remove this handler after use to prevent memory leaks
          res.off('error', errorHandler);
          // Pass error to next error handler
          next(err);
        };

        res.on('error', errorHandler);
      }

      // Allow request
      next();
    } catch (error) {
      // Handle store errors
      if (error instanceof Error && error.message.includes('Redis')) {
        const action = options.onRedisError || 'allow';

        if (action === 'allow') {
          logger.error('[LimitRate] Store error, allowing request:', error);
          return next();
        } else {
          logger.error('[LimitRate] Store error, blocking request:', error);
          res.status(503).json({
            ok: false,
            error: 'Service temporarily unavailable',
          });
          return;
        }
      }

      // Other errors
      logger.error('[LimitRate] Unexpected error:', error);
      next(error);
    }
  };

  // Fix #5: Attach cleanup method to middleware function
  (middleware as any).cleanup = async () => {
    for (const handler of eventHandlers) {
      engine.getEventEmitter().off(handler);
    }
    eventHandlers.length = 0; // Clear array
    await engine.close();
  };

  return middleware;
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
