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
  UserOverride,
} from './types';
import { EventEmitter } from './utils/events';
import { PenaltyManager } from './penalty/manager';
import { normalizeIP } from './utils/ipv6';

export interface CheckContext {
  /** User identifier */
  user: string;
  /** User's plan */
  plan: PlanName;
  /** Endpoint key (METHOD|/path) */
  endpoint: string;
  /** Optional cost estimation context */
  costContext?: any;
  /** Optional route-specific policy override */
  policyOverride?: EndpointPolicy;
  /** Optional user override (v1.6.0 - B4) */
  userOverride?: UserOverride | null;
  /** Optional token count for this request (v1.4.0 - AI feature) */
  tokens?: number;
}

export interface CheckResult {
  /** Whether request should be allowed */
  allowed: boolean;
  /** Enforcement action to take */
  action: EnforcementAction;
  /** Reason for decision */
  reason?: 'rate_exceeded' | 'cost_exceeded' | 'token_limit_exceeded';
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
    burstTokens?: number;
  };
}

export class PolicyEngine {
  private store: Store;
  private policies: PolicyConfig;
  private events: EventEmitter;
  private penaltyManager: PenaltyManager;

  constructor(store: Store, policies: PolicyConfig) {
    this.store = store;
    this.policies = policies;
    this.events = new EventEmitter();
    this.penaltyManager = new PenaltyManager(store);
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
    // Use policy override if provided, otherwise resolve from config
    const policy = context.policyOverride || this.resolvePolicy(context.plan, context.endpoint);

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

    // Store details from checks
    let finalDetails = { used: 0, limit: 0, remaining: 0, resetInSeconds: 0 };

    // Check rate limit first (if defined)
    if (policy.rate) {
      const rateResult = await this.checkRate(context, policy);
      // Return early if blocked OR requires special handling (slowdown, allow-and-log)
      if (!rateResult.allowed || rateResult.action !== 'allow') {
        return rateResult;
      }
      // Preserve rate limit details for response headers
      finalDetails = rateResult.details;
    }

    // Check token limits (if defined and tokens provided) - v1.4.0
    if (policy.rate && context.tokens !== undefined && context.tokens > 0) {
      const tokenResult = await this.checkTokens(context, policy);
      // Return early if blocked OR requires special handling
      if (!tokenResult.allowed || tokenResult.action !== 'allow') {
        return tokenResult;
      }
      // Token checks are additional to rate limits
    }

    // Check cost limit (if defined)
    if (policy.cost) {
      const costResult = await this.checkCost(context, policy);
      // Return early if blocked OR requires special handling (slowdown, allow-and-log)
      if (!costResult.allowed || costResult.action !== 'allow') {
        return costResult;
      }
      // If both rate and cost exist, keep rate details for headers
      // Cost tracking is internal, rate limits are what users see
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
      details: finalDetails,
    };
  }

  /**
   * Check rate limit
   */
  private async checkRate(context: CheckContext, policy: EndpointPolicy): Promise<CheckResult> {
    if (!policy.rate) {
      return { allowed: true, action: 'allow', details: { used: 0, limit: 0, remaining: 0, resetInSeconds: 0 } };
    }

    let { maxPerSecond, maxPerMinute, maxPerHour, maxPerDay, burst, actionOnExceed, slowdownMs } = policy.rate;

    // Check for user override (v1.6.0 - B4)
    // User overrides take precedence over plan limits
    if (context.userOverride) {
      const override = context.userOverride;

      // Helper to validate override value
      const isValidLimit = (val: number | undefined): val is number => {
        return typeof val === 'number' && val > 0 && !isNaN(val) && isFinite(val);
      };

      // Check for endpoint-specific override first
      const endpointOverride = override.endpoints?.[context.endpoint];
      if (endpointOverride) {
        if (isValidLimit(endpointOverride.maxPerSecond)) maxPerSecond = endpointOverride.maxPerSecond;
        if (isValidLimit(endpointOverride.maxPerMinute)) maxPerMinute = endpointOverride.maxPerMinute;
        if (isValidLimit(endpointOverride.maxPerHour)) maxPerHour = endpointOverride.maxPerHour;
        if (isValidLimit(endpointOverride.maxPerDay)) maxPerDay = endpointOverride.maxPerDay;
      } else {
        // Use global user override
        if (isValidLimit(override.maxPerSecond)) maxPerSecond = override.maxPerSecond;
        if (isValidLimit(override.maxPerMinute)) maxPerMinute = override.maxPerMinute;
        if (isValidLimit(override.maxPerHour)) maxPerHour = override.maxPerHour;
        if (isValidLimit(override.maxPerDay)) maxPerDay = override.maxPerDay;
      }
    }

    // Determine limit and window based on specified time window
    let limit: number;
    let windowSeconds: number;
    let windowLabel: string;

    if (maxPerSecond !== undefined) {
      limit = maxPerSecond;
      windowSeconds = 1;
      windowLabel = '1s';
    } else if (maxPerMinute !== undefined) {
      limit = maxPerMinute;
      windowSeconds = 60;
      windowLabel = '1m';
    } else if (maxPerHour !== undefined) {
      limit = maxPerHour;
      windowSeconds = 3600;
      windowLabel = '1h';
    } else if (maxPerDay !== undefined) {
      limit = maxPerDay;
      windowSeconds = 86400;
      windowLabel = '1d';
    } else {
      // Should never reach here due to validation
      throw new Error('No time window specified in rate rule');
    }

    // Apply penalty/reward multiplier (v2.0.0 - D4)
    const originalLimit = limit;
    if (policy.penalty?.enabled) {
      const multiplier = await this.penaltyManager.getMultiplier(context.user, context.endpoint);
      limit = Math.floor(originalLimit * multiplier);
      // Ensure at least 1 request is allowed
      if (limit < 1) limit = 1;
    }

    // Apply IPv6 subnet normalization (v2.1.0 - D5)
    // If user is an IP address and ipv6Subnet is configured, normalize to subnet
    const normalizedUser = policy.ipv6Subnet ? normalizeIP(context.user, policy.ipv6Subnet) : context.user;

    // Build rate key: user:endpoint
    const rateKey = `${normalizedUser}:${context.endpoint}`;

    // Check with store (pass burst if defined)
    const result = await this.store.checkRate(rateKey, limit, windowSeconds, burst);

    if (result.allowed) {
      // Check for reward (v2.0.0 - D4)
      if (policy.penalty?.enabled && policy.penalty.rewards) {
        const shouldReward = this.penaltyManager.shouldGrantReward(
          result.current,
          originalLimit,
          policy.penalty.rewards
        );
        if (shouldReward) {
          await this.penaltyManager.applyReward(
            context.user,
            context.endpoint,
            policy.penalty.rewards
          );
        }
      }

      return {
        allowed: true,
        action: 'allow',
        details: {
          used: result.current,
          limit: result.limit,
          remaining: result.remaining,
          resetInSeconds: result.resetInSeconds,
          burstTokens: result.burstTokens,
        },
      };
    }

    // Rate limit exceeded - apply penalty (v2.0.0 - D4)
    if (policy.penalty?.enabled && policy.penalty.onViolation) {
      await this.penaltyManager.applyPenalty(
        context.user,
        context.endpoint,
        policy.penalty.onViolation
      );
    }

    await this.emitEvent({
      timestamp: Date.now(),
      user: context.user,
      plan: context.plan,
      endpoint: context.endpoint,
      type: 'rate_exceeded',
      window: windowLabel,
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
          burstTokens: result.burstTokens,
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
          burstTokens: result.burstTokens,
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
          burstTokens: result.burstTokens,
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
        burstTokens: result.burstTokens,
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

    // Apply IPv6 subnet normalization (v2.1.0 - D5)
    const normalizedUser = policy.ipv6Subnet ? normalizeIP(context.user, policy.ipv6Subnet) : context.user;

    // Build cost key: user:endpoint:cost
    const costKey = `${normalizedUser}:${context.endpoint}:cost`;

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
   * Check token limits (v1.4.0 - AI feature)
   */
  private async checkTokens(context: CheckContext, policy: EndpointPolicy): Promise<CheckResult> {
    if (!policy.rate || !context.tokens) {
      return { allowed: true, action: 'allow', details: { used: 0, limit: 0, remaining: 0, resetInSeconds: 0 } };
    }

    const { maxTokensPerMinute, maxTokensPerHour, maxTokensPerDay, actionOnExceed, slowdownMs } = policy.rate;

    // Check if any token limits are configured
    if (!maxTokensPerMinute && !maxTokensPerHour && !maxTokensPerDay) {
      return { allowed: true, action: 'allow', details: { used: 0, limit: 0, remaining: 0, resetInSeconds: 0 } };
    }

    // Apply IPv6 subnet normalization (v2.1.0 - D5)
    const normalizedUser = policy.ipv6Subnet ? normalizeIP(context.user, policy.ipv6Subnet) : context.user;

    // We check all time windows (per minute, per hour, per day)
    // If any limit is exceeded, block the request
    const checks: Array<{ limit: number; windowSeconds: number; windowLabel: string }> = [];

    if (maxTokensPerMinute) {
      checks.push({ limit: maxTokensPerMinute, windowSeconds: 60, windowLabel: '1m' });
    }
    if (maxTokensPerHour) {
      checks.push({ limit: maxTokensPerHour, windowSeconds: 3600, windowLabel: '1h' });
    }
    if (maxTokensPerDay) {
      checks.push({ limit: maxTokensPerDay, windowSeconds: 86400, windowLabel: '1d' });
    }

    // Check each time window
    for (const check of checks) {
      const tokenKey = `${normalizedUser}:${context.endpoint}:tokens:${check.windowLabel}`;
      const result = await this.store.incrementTokens(
        tokenKey,
        context.tokens,
        check.windowSeconds,
        check.limit
      );

      if (!result.allowed) {
        // Token limit exceeded
        await this.emitEvent({
          timestamp: Date.now(),
          user: context.user,
          plan: context.plan,
          endpoint: context.endpoint,
          type: 'token_limit_exceeded',
          window: check.windowLabel,
          value: result.current,
          threshold: check.limit,
          tokens: context.tokens,
        });

        // Determine action
        if (actionOnExceed === 'block') {
          return {
            allowed: false,
            action: 'block',
            reason: 'token_limit_exceeded',
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
    }

    // All token checks passed - emit tracking event
    await this.emitEvent({
      timestamp: Date.now(),
      user: context.user,
      plan: context.plan,
      endpoint: context.endpoint,
      type: 'token_usage_tracked',
      tokens: context.tokens,
    });

    return {
      allowed: true,
      action: 'allow',
      details: { used: 0, limit: 0, remaining: 0, resetInSeconds: 0 },
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

    // Check endpoint-specific policy first (v2.0.0: endpoints may not exist for defaults-only configs)
    if (planConfig.endpoints?.[endpoint]) {
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
