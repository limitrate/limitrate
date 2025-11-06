/**
 * Configuration validation - fail fast at startup
 */

import type { PolicyConfig, RateRule, CostRule, StoreConfig } from './types';

export class ValidationError extends Error {
  constructor(message: string) {
    super(`[LimitRate] Invalid configuration: ${message}`);
    this.name = 'ValidationError';
  }
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && value > 0 && !isNaN(value);
}

function isFunction(value: unknown): value is Function {
  return typeof value === 'function';
}

function validateRateRule(rule: RateRule, path: string): void {
  // Validate time window values
  if (rule.maxPerSecond !== undefined && !isPositiveNumber(rule.maxPerSecond)) {
    throw new ValidationError(`${path}.maxPerSecond must be a positive number, got: ${rule.maxPerSecond}`);
  }

  if (rule.maxPerMinute !== undefined && !isPositiveNumber(rule.maxPerMinute)) {
    throw new ValidationError(`${path}.maxPerMinute must be a positive number, got: ${rule.maxPerMinute}`);
  }

  if (rule.maxPerHour !== undefined && !isPositiveNumber(rule.maxPerHour)) {
    throw new ValidationError(`${path}.maxPerHour must be a positive number, got: ${rule.maxPerHour}`);
  }

  if (rule.maxPerDay !== undefined && !isPositiveNumber(rule.maxPerDay)) {
    throw new ValidationError(`${path}.maxPerDay must be a positive number, got: ${rule.maxPerDay}`);
  }

  // Ensure exactly one time window is specified
  const timeWindows = [
    rule.maxPerSecond,
    rule.maxPerMinute,
    rule.maxPerHour,
    rule.maxPerDay,
  ].filter(w => w !== undefined);

  if (timeWindows.length === 0) {
    throw new ValidationError(
      `${path} must specify exactly one time window (maxPerSecond, maxPerMinute, maxPerHour, or maxPerDay)`
    );
  }

  if (timeWindows.length > 1) {
    throw new ValidationError(
      `${path} can only specify one time window, but found ${timeWindows.length}. Use separate endpoint policies for multiple limits.`
    );
  }

  if (rule.burst !== undefined && !isPositiveNumber(rule.burst)) {
    throw new ValidationError(`${path}.burst must be a positive number, got: ${rule.burst}`);
  }

  if (rule.slowdownMs !== undefined) {
    if (!isPositiveNumber(rule.slowdownMs)) {
      throw new ValidationError(`${path}.slowdownMs must be a positive number, got: ${rule.slowdownMs}`);
    }
    if (rule.slowdownMs > 60000) {
      throw new ValidationError(`${path}.slowdownMs must be <= 60000 (60 seconds), got: ${rule.slowdownMs}`);
    }
  }

  const validActions = ['allow', 'block', 'slowdown', 'allow-and-log'];
  if (!validActions.includes(rule.actionOnExceed)) {
    throw new ValidationError(
      `${path}.actionOnExceed must be one of: ${validActions.join(', ')}, got: ${rule.actionOnExceed}`
    );
  }

  if (rule.actionOnExceed === 'slowdown' && !rule.slowdownMs) {
    throw new ValidationError(`${path}.slowdownMs is required when actionOnExceed is 'slowdown'`);
  }
}

function validateCostRule(rule: CostRule, path: string): void {
  if (!isFunction(rule.estimateCost)) {
    throw new ValidationError(`${path}.estimateCost must be a function`);
  }

  if (rule.hourlyCap !== undefined && !isPositiveNumber(rule.hourlyCap)) {
    throw new ValidationError(`${path}.hourlyCap must be a positive number, got: ${rule.hourlyCap}`);
  }

  if (rule.dailyCap !== undefined && !isPositiveNumber(rule.dailyCap)) {
    throw new ValidationError(`${path}.dailyCap must be a positive number, got: ${rule.dailyCap}`);
  }

  const validActions = ['allow', 'block', 'slowdown', 'allow-and-log'];
  if (!validActions.includes(rule.actionOnExceed)) {
    throw new ValidationError(
      `${path}.actionOnExceed must be one of: ${validActions.join(', ')}, got: ${rule.actionOnExceed}`
    );
  }
}

export function validatePolicyConfig(config: PolicyConfig): void {
  if (!config || typeof config !== 'object') {
    throw new ValidationError('PolicyConfig must be an object');
  }

  for (const [plan, planConfig] of Object.entries(config)) {
    if (!planConfig || typeof planConfig !== 'object') {
      throw new ValidationError(`Plan '${plan}' config must be an object`);
    }

    if (!planConfig.endpoints || typeof planConfig.endpoints !== 'object') {
      throw new ValidationError(`Plan '${plan}' must have 'endpoints' object`);
    }

    // Validate endpoint policies
    for (const [endpoint, policy] of Object.entries(planConfig.endpoints)) {
      const basePath = `policies.${plan}.endpoints['${endpoint}']`;

      if (policy.rate) {
        validateRateRule(policy.rate, `${basePath}.rate`);
      }

      if (policy.cost) {
        validateCostRule(policy.cost, `${basePath}.cost`);
      }

      if (!policy.rate && !policy.cost) {
        throw new ValidationError(`${basePath} must have at least one of: rate, cost`);
      }
    }

    // Validate default policy
    if (planConfig.defaults) {
      const basePath = `policies.${plan}.defaults`;

      if (planConfig.defaults.rate) {
        validateRateRule(planConfig.defaults.rate, `${basePath}.rate`);
      }

      if (planConfig.defaults.cost) {
        validateCostRule(planConfig.defaults.cost, `${basePath}.cost`);
      }
    }
  }
}

export function validateStoreConfig(config: StoreConfig): void {
  if (!config || typeof config !== 'object') {
    throw new ValidationError('StoreConfig must be an object');
  }

  const validTypes = ['memory', 'redis', 'upstash'];
  if (!validTypes.includes(config.type)) {
    throw new ValidationError(`store.type must be one of: ${validTypes.join(', ')}, got: ${config.type}`);
  }

  if (config.type === 'redis' && !config.url) {
    throw new ValidationError('store.url is required when type is "redis"');
  }

  if (config.type === 'upstash') {
    if (!config.url) {
      throw new ValidationError('store.url is required when type is "upstash"');
    }
    if (!config.token) {
      throw new ValidationError('store.token is required when type is "upstash"');
    }
  }
}

export function validateIPAddress(ip: string): boolean {
  // Basic IPv4 validation
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(ip)) {
    const parts = ip.split('.');
    return parts.every(part => {
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255;
    });
  }

  // Basic IPv6 validation (simplified)
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
  return ipv6Regex.test(ip);
}

export function validateIPList(ips: string[], listName: string): void {
  if (!Array.isArray(ips)) {
    throw new ValidationError(`${listName} must be an array`);
  }

  for (const ip of ips) {
    if (typeof ip !== 'string') {
      throw new ValidationError(`${listName} must contain only strings, got: ${typeof ip}`);
    }

    // Support CIDR notation (basic check)
    const [ipPart] = ip.split('/');
    if (!validateIPAddress(ipPart)) {
      throw new ValidationError(`${listName} contains invalid IP: ${ip}`);
    }
  }
}
