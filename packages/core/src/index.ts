/**
 * @limitrate/core
 * Core rate limiting and cost control engine
 */

// Types
export type {
  PlanName,
  EnforcementAction,
  RateRule,
  CostRule,
  EndpointPolicy,
  PolicyConfig,
  StoreConfig,
  RateCheckResult,
  CostCheckResult,
  LimitRateEvent,
  Store,
  UserOverride,
  UserOverridesConfig,
} from './types';

// Stores
export {
  MemoryStore,
  RedisStore,
  UpstashStore,
  createStore,
  // Shared store factories (v1.3.0)
  createSharedMemoryStore,
  createSharedRedisStore,
  createSharedUpstashStore,
} from './stores';
export type { RedisStoreOptions, UpstashStoreOptions } from './stores';

// Engine
export { PolicyEngine } from './engine';
export type { CheckContext, CheckResult } from './engine';

// Validation
export { ValidationError, validatePolicyConfig, validateStoreConfig, validateIPList } from './validation';

// Utilities
export { normalizeRoutePath, createEndpointKey, extractIP, isIPInList } from './utils/routes';
export { EventEmitter } from './utils/events';
export type { EventHandler } from './utils/events';

// Endpoint Tracking (v1.4.0 - B2)
export { EndpointTracker, getGlobalEndpointTracker, setGlobalEndpointTracker } from './tracking/endpoints';
export type { EndpointStats, EndpointTrackerOptions } from './tracking/endpoints';
