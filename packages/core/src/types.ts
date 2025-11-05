/**
 * Core types for FairGate rate limiting and cost control
 */

export type PlanName = 'free' | 'pro' | 'enterprise' | string;

export type EnforcementAction = 'allow' | 'block' | 'slowdown' | 'allow-and-log';

export interface RateRule {
  /** Maximum requests per minute */
  maxPerMinute?: number;
  /** Maximum requests per second */
  maxPerSecond?: number;
  /** Burst allowance (extra tokens beyond steady rate) */
  burst?: number;
  /** Action to take when limit exceeded */
  actionOnExceed: EnforcementAction;
  /** Delay in milliseconds if action is 'slowdown' */
  slowdownMs?: number;
}

export interface CostRule {
  /** Function to estimate cost of a request */
  estimateCost: (context: any) => number;
  /** Maximum cost per hour */
  hourlyCap?: number;
  /** Maximum cost per day */
  dailyCap?: number;
  /** Action to take when cost cap exceeded */
  actionOnExceed: EnforcementAction;
}

export interface EndpointPolicy {
  /** Rate limiting rule */
  rate?: RateRule;
  /** Cost limiting rule */
  cost?: CostRule;
}

export type PolicyConfig = Record<
  PlanName,
  {
    /** Endpoint-specific policies (key = "METHOD|/path") */
    endpoints: Record<string, EndpointPolicy>;
    /** Default policy for endpoints not explicitly configured */
    defaults?: EndpointPolicy;
  }
>;

export interface StoreConfig {
  /** Store type */
  type: 'memory' | 'redis' | 'upstash';
  /** Redis connection URL (for redis/upstash) */
  url?: string;
  /** Upstash REST token (for upstash) */
  token?: string;
  /** Redis client options */
  options?: any;
}

export interface RateCheckResult {
  /** Whether request is allowed */
  allowed: boolean;
  /** Current usage count */
  current: number;
  /** Remaining requests in window */
  remaining: number;
  /** Seconds until window resets */
  resetInSeconds: number;
  /** Limit that was checked against */
  limit: number;
}

export interface CostCheckResult {
  /** Whether request is allowed */
  allowed: boolean;
  /** Current cost usage */
  current: number;
  /** Remaining cost in window */
  remaining: number;
  /** Seconds until window resets */
  resetInSeconds: number;
  /** Cap that was checked against */
  cap: number;
}

export interface LimitRateEvent {
  /** Event timestamp (Unix milliseconds) */
  timestamp: number;
  /** User identifier */
  user: string;
  /** User's plan */
  plan: PlanName;
  /** Endpoint (METHOD|/path) */
  endpoint: string;
  /** Event type */
  type: 'rate_exceeded' | 'cost_exceeded' | 'slowdown_applied' | 'allowed' | 'blocked';
  /** Time window (e.g., "1m", "1h", "1d") */
  window?: string;
  /** Current value (count or cost) */
  value?: number;
  /** Threshold that was checked */
  threshold?: number;
}

export interface Store {
  /**
   * Check rate limit for a key
   * @param key - Unique identifier (e.g., "user_123:POST|/api")
   * @param limit - Maximum requests allowed
   * @param windowSeconds - Time window in seconds
   * @returns Rate check result
   */
  checkRate(key: string, limit: number, windowSeconds: number): Promise<RateCheckResult>;

  /**
   * Increment cost for a key
   * @param key - Unique identifier (e.g., "user_123:POST|/api:cost")
   * @param cost - Cost to add
   * @param windowSeconds - Time window in seconds
   * @param cap - Maximum cost allowed in window
   * @returns Cost check result
   */
  incrementCost(
    key: string,
    cost: number,
    windowSeconds: number,
    cap: number
  ): Promise<CostCheckResult>;

  /**
   * Health check
   * @returns Whether store is healthy
   */
  ping(): Promise<boolean>;

  /**
   * Close connections
   */
  close(): Promise<void>;
}
