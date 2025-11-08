/**
 * Express adapter for RateLimiter
 * Converts Express Request/Response to RateLimitRequest/RateLimitResult
 *
 * @since v3.2.0 - Framework Agnostic Refactor
 */

import type { Request, Response } from 'express';
import type {
  FrameworkAdapter,
  AdapterOptions,
  RateLimitRequest,
  RateLimitResult,
} from '@limitrate/core';
import { createEndpointKey } from '@limitrate/core';
import { sleep } from '../utils/sleep';

/**
 * Express adapter for framework-agnostic RateLimiter
 *
 * Converts Express requests to RateLimitRequest and applies
 * RateLimitResult to Express responses.
 */
export class ExpressAdapter implements FrameworkAdapter<Request, Response> {
  /**
   * Convert Express request to RateLimitRequest
   */
  toRateLimitRequest(req: Request, options: AdapterOptions<Request>): RateLimitRequest {
    // Extract route path (use route.path if available, fallback to req.path)
    const routePath = (req.route?.path as string) || undefined;
    const method = req.method;

    // Create endpoint key (METHOD|/path)
    const endpoint = createEndpointKey(method, req.path, routePath);

    // Build rate limit request
    const request: RateLimitRequest = {
      userId: options.identifyUser(req),
      plan: options.identifyPlan(req),
      endpoint,
      method,
      path: req.path,
      timestamp: Date.now(),
    };

    // Add optional fields if provided
    if (options.estimateCost) {
      request.estimatedCost = options.estimateCost(req);
    }

    if (options.estimateTokens) {
      request.estimatedTokens = options.estimateTokens(req);
    }

    if (options.getUserOverride) {
      request.userOverride = options.getUserOverride(req);
    }

    if (options.getPolicyOverride) {
      request.policyOverride = options.getPolicyOverride(req);
    }

    if (options.getMetadata) {
      request.metadata = options.getMetadata(req);
    }

    return request;
  }

  /**
   * Apply RateLimitResult to Express response
   *
   * Returns true if request should be blocked, false if allowed
   */
  async applyResult(
    req: Request,
    res: Response,
    result: RateLimitResult,
    options: AdapterOptions<Request>
  ): Promise<boolean> {
    // Set rate limit headers from result
    Object.entries(result.headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    // Handle slowdown if specified
    if (result.slowdownMs && result.slowdownMs > 0) {
      await sleep(result.slowdownMs);
    }

    // If blocked, send error response
    if (!result.allowed) {
      // Use custom handler if provided
      if (options.onRateLimited) {
        const customResponse = options.onRateLimited(req, result);
        if (customResponse) {
          res.status(result.statusCode).json(customResponse);
          return true;
        }
      }

      // Default error response
      const errorResponse = {
        error: result.error?.message || 'Rate limit exceeded',
        code: result.error?.code || 'RATE_LIMIT_EXCEEDED',
        details: result.error?.details,
        upgradeHint: result.upgradeHint,
      };

      res.status(result.statusCode).json(errorResponse);
      return true;
    }

    // If allowed, call custom handler if provided
    if (options.onAllowed) {
      options.onAllowed(req, result);
    }

    return false;
  }
}
