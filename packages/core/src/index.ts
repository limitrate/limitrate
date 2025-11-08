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
  ConcurrencyConfig,
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

// Tokenizers (v1.5.0 - C2)
export { createTokenizer, clearTokenizerCache } from './tokenizers';
export type { Tokenizer, TokenizerFunction } from './tokenizers';

// Pre-Flight Validation (v1.6.0 - C3)
export {
  validatePrompt,
  formatValidationError,
  getModelLimits,
  getSuggestedAlternatives,
  MODEL_LIMITS,
} from './validation/index.js';
export type { ValidationResult, ValidationOptions, ModelLimits } from './validation/index.js';

// Streaming Response Tracking (v1.7.0 - C4)
export {
  StreamingTracker,
  parseOpenAIChunk,
  parseAnthropicChunk,
  estimateTokens,
} from './streaming/index.js';

// Concurrency Limiting (v2.0.0 - D1)
export {
  ConcurrencyLimiter,
  getConcurrencyLimiter,
  clearAllLimiters,
} from './concurrency/index';

// Logger (v3.1.2)
export type { Logger } from './logger';
export { setLogger, getLogger, createSilentLogger, createConsoleLogger, logger } from './logger';
