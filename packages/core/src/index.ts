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
} from './types';

// Stores
export { MemoryStore, RedisStore, UpstashStore, createStore } from './stores';

// Engine
export { PolicyEngine } from './engine';
export type { CheckContext, CheckResult } from './engine';

// Validation
export { ValidationError, validatePolicyConfig, validateStoreConfig, validateIPList } from './validation';

// Utilities
export { normalizeRoutePath, createEndpointKey, extractIP, isIPInList } from './utils/routes';
export { EventEmitter } from './utils/events';
export type { EventHandler } from './utils/events';

// Backwards compatibility alias (deprecated)
export type { LimitRateEvent as FairGateEvent } from './types';
