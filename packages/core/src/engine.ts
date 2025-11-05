/**
 * Policy evaluation engine
 * Evaluates rate and cost rules, determines enforcement actions
 */

import type {
  Store,
  PolicyConfig,
  EndpointPolicy,
  PlanName,
  EnforcementAction,
  LimitRateEvent,
} from './types';
import { EventEmitter } from './utils/events';

export interface CheckContext {
  /** User identifier */
  user: string;
  /** User's plan */
  plan: PlanName;
  /** Endpoint key (METHOD|/path) */
  endpoint: string;
  /** Optional cost estimation context */
  costContext?: any;
}

export interface CheckResult {
  /** Whether request should be allowed */
  allowed: boolean;
  /** Enforcement action to take */
  action: EnforcementAction;
  /** Reason for decision */
  reason?: 'rate_exceeded' | 'cost_exceeded';
  /** Seconds to retry after (if blocked) */
  retryAfterSeconds?: number;
  /** Delay in milliseconds (if slowdown) */
  slowdownMs?: number;
  /** Details for response */
  details: {
    used: number;
    limit: number;
    remaining: number;
    resetInSeconds: number;
  };
}

export class PolicyEngine {
  private store: Store;
  private policies: PolicyConfig;
  private events: EventEmitter;

  constructor(store: Store, policies: PolicyConfig) {
    this.store = store;
    this.policies = policies;
    this.events = new EventEmitter();
  }

  /**
   * Register event handler
   */
  onEvent(handler: (event: LimitRateEvent) => void | Promise<void>): void {
    this.events.on(handler);
  }

  /**
   * Check if request should be allowed
   */
  async check(context: CheckContext): Promise<CheckResult> {
    const policy = this.resolvePolicy(context.plan, context.endpoint);

    if (!policy) {
      // No policy = allow
      await this.emitEvent({
        timestamp: Date.now(),
        user: context.user,
        plan: context.plan,
        endpoint: context.endpoint,
        type: 'allowed',
      });

      return {
        allowed: true,
        action: 'allow',
        details: { used: 0, limit: Infinity, remaining: Infinity, resetInSeconds: 0 },
      };
    }

    // Check rate limit first (if defined)
    if (policy.rate) {
      const rateResult = await this.checkRate(context, policy);
      if (!rateResult.allowed) {
        return rateResult;
      }
    }

    // Check cost limit (if defined)
    if (policy.cost) {
      const costResult = await this.checkCost(context, policy);
      if (!costResult.allowed) {
        return costResult;
      }
    }

    // Both checks passed (or no checks defined)
    await this.emitEvent({
      timestamp: Date.now(),
      user: context.user,
      plan: context.plan,
      endpoint: context.endpoint,
      type: 'allowed',
    });

    return {
      allowed: true,
      action: 'allow',
      details: { used: 0, limit: 0, remaining: 0, resetInSeconds: 0 },
    };
  }

  /**
   * Check rate limit
   */
  private async checkRate(context: CheckContext, policy: EndpointPolicy): Promise<CheckResult> {
    if (!policy.rate) {
      return { allowed: true, action: 'allow', details: { used: 0, limit: 0, remaining: 0, resetInSeconds: 0 } };
    }

    const { maxPerMinute, maxPerSecond, actionOnExceed, slowdownMs } = policy.rate;

    // Use maxPerMinute by default, or maxPerSecond if specified
    const limit = maxPerSecond ?? maxPerMinute!;
    const windowSeconds = maxPerSecond ? 1 : 60;

    // Build rate key: user:endpoint
    const rateKey = `${context.user}:${context.endpoint}`;

    // Check with store
    const result = await this.store.checkRate(rateKey, limit, windowSeconds);

    if (result.allowed) {
      return {
        allowed: true,
        action: 'allow',
        details: {
          used: result.current,
          limit: result.limit,
          remaining: result.remaining,
          resetInSeconds: result.resetInSeconds,
        },
      };
    }

    // Rate limit exceeded
    await this.emitEvent({
      timestamp: Date.now(),
      user: context.user,
      plan: context.plan,
      endpoint: context.endpoint,
      type: 'rate_exceeded',
      window: maxPerSecond ? '1s' : '1m',
      value: result.current,
      threshold: limit,
    });

    // Determine action
    if (actionOnExceed === 'block') {
      return {
        allowed: false,
        action: 'block',
        reason: 'rate_exceeded',
        retryAfterSeconds: result.resetInSeconds,
        details: {
          used: result.current,
          limit: result.limit,
          remaining: 0,
          resetInSeconds: result.resetInSeconds,
        },
      };
    }

    if (actionOnExceed === 'slowdown') {
      await this.emitEvent({
        timestamp: Date.now(),
        user: context.user,
        plan: context.plan,
        endpoint: context.endpoint,
        type: 'slowdown_applied',
        value: slowdownMs,
      });

      return {
        allowed: true,
        action: 'slowdown',
        slowdownMs,
        details: {
          used: result.current,
          limit: result.limit,
          remaining: 0,
          resetInSeconds: result.resetInSeconds,
        },
      };
    }

    if (actionOnExceed === 'allow-and-log') {
      return {
        allowed: true,
        action: 'allow-and-log',
        details: {
          used: result.current,
          limit: result.limit,
          remaining: 0,
          resetInSeconds: result.resetInSeconds,
        },
      };
    }

    // Default: allow
    return {
      allowed: true,
      action: 'allow',
      details: {
        used: result.current,
        limit: result.limit,
        remaining: 0,
        resetInSeconds: result.resetInSeconds,
      },
    };
  }

  /**
   * Check cost limit
   */
  private async checkCost(context: CheckContext, policy: EndpointPolicy): Promise<CheckResult> {
    if (!policy.cost) {
      return { allowed: true, action: 'allow', details: { used: 0, limit: 0, remaining: 0, resetInSeconds: 0 } };
    }

    const { estimateCost, hourlyCap, dailyCap, actionOnExceed } = policy.cost;

    // Estimate cost for this request
    const cost = estimateCost(context.costContext);

    // Use daily cap if specified, otherwise hourly
    const cap = dailyCap ?? hourlyCap!;
    const windowSeconds = dailyCap ? 86400 : 3600;

    // Build cost key: user:endpoint:cost
    const costKey = `${context.user}:${context.endpoint}:cost`;

    // Check with store
    const result = await this.store.incrementCost(costKey, cost, windowSeconds, cap);

    if (result.allowed) {
      return {
        allowed: true,
        action: 'allow',
        details: {
          used: result.current,
          limit: cap,
          remaining: result.remaining,
          resetInSeconds: result.resetInSeconds,
        },
      };
    }

    // Cost cap exceeded
    await this.emitEvent({
      timestamp: Date.now(),
      user: context.user,
      plan: context.plan,
      endpoint: context.endpoint,
      type: 'cost_exceeded',
      window: dailyCap ? '1d' : '1h',
      value: result.current + cost,
      threshold: cap,
    });

    // Determine action
    if (actionOnExceed === 'block') {
      return {
        allowed: false,
        action: 'block',
        reason: 'cost_exceeded',
        retryAfterSeconds: result.resetInSeconds,
        details: {
          used: result.current,
          limit: cap,
          remaining: 0,
          resetInSeconds: result.resetInSeconds,
        },
      };
    }

    if (actionOnExceed === 'slowdown') {
      // For cost caps, we don't apply slowdown (doesn't make sense)
      // Treat as block instead
      return {
        allowed: false,
        action: 'block',
        reason: 'cost_exceeded',
        retryAfterSeconds: result.resetInSeconds,
        details: {
          used: result.current,
          limit: cap,
          remaining: 0,
          resetInSeconds: result.resetInSeconds,
        },
      };
    }

    if (actionOnExceed === 'allow-and-log') {
      return {
        allowed: true,
        action: 'allow-and-log',
        details: {
          used: result.current,
          limit: cap,
          remaining: 0,
          resetInSeconds: result.resetInSeconds,
        },
      };
    }

    // Default: allow
    return {
      allowed: true,
      action: 'allow',
      details: {
        used: result.current,
        limit: cap,
        remaining: 0,
        resetInSeconds: result.resetInSeconds,
      },
    };
  }

  /**
   * Resolve policy for plan and endpoint
   */
  private resolvePolicy(plan: PlanName, endpoint: string): EndpointPolicy | null {
    const planConfig = this.policies[plan];
    if (!planConfig) {
      return null;
    }

    // Check endpoint-specific policy first
    if (planConfig.endpoints[endpoint]) {
      return planConfig.endpoints[endpoint];
    }

    // Fall back to default policy
    return planConfig.defaults ?? null;
  }

  /**
   * Emit event
   */
  private async emitEvent(event: LimitRateEvent): Promise<void> {
    await this.events.emit(event);
  }

  /**
   * Get event emitter (for external handlers)
   */
  getEventEmitter(): EventEmitter {
    return this.events;
  }
}
