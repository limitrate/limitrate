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
} from '@limitrate/core';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { LimitRateOptions } from './types';
import { send429Response, send403Response, setRateLimitHeaders } from './response';
import { sendToWebhook } from './webhook';

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
  validateStoreConfig(options.store);
  validatePolicyConfig(options.policies);

  if (options.ipAllowlist) {
    validateIPList(options.ipAllowlist, 'ipAllowlist');
  }

  if (options.ipBlocklist) {
    validateIPList(options.ipBlocklist, 'ipBlocklist');
  }

  // Create store and policy engine
  const store = createStore(options.store);
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

  // Warn if using memory store in production
  if (options.store.type === 'memory' && process.env.NODE_ENV === 'production') {
    console.warn(`
⚠️  [LimitRate] Memory store detected in production.
Limits won't be shared across instances.
Use Redis for distributed rate limiting:

  store: { type: 'redis', url: process.env.REDIS_URL }
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

      // Check policy
      const result = await engine.check({
        user,
        plan,
        endpoint,
        costContext: req, // Pass request as cost context
      });

      // Set rate limit headers (even if allowed)
      if (result.details) {
        setRateLimitHeaders(
          res,
          result.details.limit,
          result.details.remaining,
          result.details.resetInSeconds
        );
      }

      // Handle slowdown
      if (result.action === 'slowdown' && result.slowdownMs) {
        await sleep(result.slowdownMs);
        return next();
      }

      // Handle block
      if (result.action === 'block' && !result.allowed) {
        const upgradeHint =
          typeof options.upgradeHint === 'function'
            ? options.upgradeHint(plan)
            : options.upgradeHint;

        const reason = result.reason === 'rate_exceeded' ? 'rate_limited' : (result.reason || 'rate_limited');
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
    (req as any).__fairgate_policy = _policy;
    next();
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
