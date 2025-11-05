/**
 * @limitrate/express
 * Express middleware for LimitRate rate limiting and cost control
 */

export { limitrate, withPolicy } from './middleware';
export type { LimitRateOptions, BlockedResponse } from './types';

// Re-export core types for convenience
export type {
  PlanName,
  EnforcementAction,
  RateRule,
  CostRule,
  EndpointPolicy,
  PolicyConfig,
  StoreConfig,
} from '@limitrate/core';
