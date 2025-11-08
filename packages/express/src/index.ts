/**
 * @limitrate/express
 * Express middleware for LimitRate rate limiting and cost control
 */

export { limitrate, withPolicy } from './middleware';
export type { LimitRateOptions, BlockedResponse, DryRunEvent } from './types';

// Client-side SDK helpers (v1.7.0 - B5)
export { getRateLimitStatus, createStatusEndpoint } from './status';
export type { RateLimitStatus } from './status';

// Re-export core types for convenience
export type {
  PlanName,
  EnforcementAction,
  RateRule,
  CostRule,
  ConcurrencyConfig,
  EndpointPolicy,
  PolicyConfig,
  StoreConfig,
  RedisStoreOptions,
  UpstashStoreOptions,
} from '@limitrate/core';

// Re-export store factories for convenience (v1.3.0)
export {
  createSharedMemoryStore,
  createSharedRedisStore,
  createSharedUpstashStore,
} from '@limitrate/core';

// Re-export endpoint tracking for convenience (v1.4.0 - B2)
export { getGlobalEndpointTracker, setGlobalEndpointTracker, EndpointTracker } from '@limitrate/core';
export type { EndpointStats, EndpointTrackerOptions } from '@limitrate/core';

// Re-export concurrency limiter for convenience (v2.0.0 - D1)
export { getConcurrencyLimiter, clearAllLimiters, ConcurrencyLimiter } from '@limitrate/core';
