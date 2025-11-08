/**
 * Framework adapter interface
 * Converts framework-specific requests/responses to RateLimiter format
 *
 * @since v3.2.0 - Framework Agnostic Refactor
 */

import type { RateLimitRequest, RateLimitResult } from './limiter';

/**
 * Framework adapter interface
 *
 * Adapters convert framework-specific request/response objects
 * to the universal RateLimitRequest/RateLimitResult format.
 *
 * This enables the core RateLimiter to work with any framework
 * without knowing anything about Express, Fastify, Hono, etc.
 *
 * @example
 * ```typescript
 * class ExpressAdapter implements FrameworkAdapter<Request, Response> {
 *   toRateLimitRequest(req: Request, options: AdapterOptions): RateLimitRequest {
 *     return {
 *       userId: options.identifyUser(req),
 *       plan: options.identifyPlan(req),
 *       endpoint: `${req.method}|${req.route?.path || req.path}`,
 *       method: req.method,
 *       path: req.path,
 *       timestamp: Date.now()
 *     };
 *   }
 *
 *   applyResult(res: Response, result: RateLimitResult): void {
 *     Object.entries(result.headers).forEach(([key, value]) => {
 *       res.setHeader(key, value);
 *     });
 *
 *     if (!result.allowed) {
 *       res.status(result.statusCode).json({
 *         error: result.error
 *       });
 *     }
 *   }
 * }
 * ```
 */
export interface FrameworkAdapter<TRequest = any, TResponse = any> {
  /**
   * Convert framework request to RateLimitRequest
   *
   * @param req - Framework-specific request object
   * @param options - Adapter configuration options
   * @returns Universal rate limit request
   */
  toRateLimitRequest(req: TRequest, options: AdapterOptions<TRequest>): RateLimitRequest;

  /**
   * Apply RateLimitResult to framework response
   *
   * This method should:
   * 1. Set rate limit headers from result.headers
   * 2. If result.allowed === false, send error response with result.statusCode
   * 3. If result.slowdownMs, delay before continuing
   *
   * @param req - Framework-specific request object
   * @param res - Framework-specific response object
   * @param result - Rate limit result from core limiter
   * @param options - Adapter configuration options
   * @returns Promise that resolves when response is sent (if blocked) or undefined (if allowed)
   */
  applyResult(
    req: TRequest,
    res: TResponse,
    result: RateLimitResult,
    options: AdapterOptions<TRequest>
  ): Promise<boolean> | boolean;
}

/**
 * Configuration options for framework adapters
 */
export interface AdapterOptions<TRequest = any> {
  /**
   * Extract user ID from request
   * Required for all adapters
   */
  identifyUser: (req: TRequest) => string;

  /**
   * Extract plan name from request
   * Required for all adapters
   */
  identifyPlan: (req: TRequest) => string;

  /**
   * Custom response handler for rate limit errors
   * Optional - adapter will use default if not provided
   */
  onRateLimited?: (req: TRequest, result: RateLimitResult) => any;

  /**
   * Custom response handler for allowed requests
   * Optional - adapter will set headers and continue
   */
  onAllowed?: (req: TRequest, result: RateLimitResult) => void;

  /**
   * Skip rate limiting for certain requests
   * Optional - useful for health checks, admin routes, etc.
   */
  skip?: (req: TRequest) => boolean;

  /**
   * Extract estimated cost for AI requests
   * Optional - only needed for cost-based rate limiting
   */
  estimateCost?: (req: TRequest) => number | undefined;

  /**
   * Extract estimated tokens for AI requests
   * Optional - only needed for token-based rate limiting
   */
  estimateTokens?: (req: TRequest) => number | undefined;

  /**
   * Extract user override for this request
   * Optional - allows per-user custom limits
   */
  getUserOverride?: (req: TRequest) => any;

  /**
   * Extract policy override for this route
   * Optional - allows per-route custom policies
   */
  getPolicyOverride?: (req: TRequest) => any;

  /**
   * Additional metadata to attach to request
   * Optional - useful for debugging and analytics
   */
  getMetadata?: (req: TRequest) => Record<string, any> | undefined;
}

/**
 * Helper to create adapter options with defaults
 */
export function createAdapterOptions<TRequest>(
  options: Partial<AdapterOptions<TRequest>> & {
    identifyUser: (req: TRequest) => string;
    identifyPlan: (req: TRequest) => string;
  }
): AdapterOptions<TRequest> {
  return {
    identifyUser: options.identifyUser,
    identifyPlan: options.identifyPlan,
    onRateLimited: options.onRateLimited,
    onAllowed: options.onAllowed,
    skip: options.skip,
    estimateCost: options.estimateCost,
    estimateTokens: options.estimateTokens,
    getUserOverride: options.getUserOverride,
    getPolicyOverride: options.getPolicyOverride,
    getMetadata: options.getMetadata,
  };
}
