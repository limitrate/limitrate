/**
 * Upstash store for serverless-friendly rate limiting
 * Uses HTTP REST API (no persistent connections)
 */

import { Redis } from '@upstash/redis';
import type { Store, RateCheckResult, CostCheckResult } from '../types';

// Same Lua scripts as Redis store
const RATE_CHECK_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local current = redis.call('GET', key)

if not current then
  redis.call('SETEX', key, window, 1)
  return {1, limit - 1, window, limit}
end

current = tonumber(current)

if current >= limit then
  local ttl = redis.call('TTL', key)
  return {current, 0, ttl, limit}
end

redis.call('INCR', key)
local ttl = redis.call('TTL', key)
return {current + 1, limit - current - 1, ttl, limit}
`;

const COST_INCREMENT_SCRIPT = `
local key = KEYS[1]
local cost = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local cap = tonumber(ARGV[3])

local current = redis.call('GET', key)

if not current then
  if cost > cap then
    redis.call('SETEX', key, window, 0)
    return {0, false, cap, window, cap}
  end
  redis.call('SETEX', key, window, cost)
  return {cost, true, cap - cost, window, cap}
end

current = tonumber(current)
local newCost = current + cost

if newCost > cap then
  local ttl = redis.call('TTL', key)
  return {current, false, cap - current, ttl, cap}
end

redis.call('SET', key, newCost, 'KEEPTTL')
local ttl = redis.call('TTL', key)
return {newCost, true, cap - newCost, ttl, cap}
`;

export interface UpstashStoreOptions {
  /** Upstash Redis REST URL */
  url: string;
  /** Upstash Redis REST token */
  token: string;
  /** Key prefix for all FairGate keys */
  keyPrefix?: string;
}

export class UpstashStore implements Store {
  private client: Redis;
  private keyPrefix: string;

  constructor(options: UpstashStoreOptions) {
    if (!options.url || !options.token) {
      throw new Error('UpstashStore requires both url and token');
    }

    this.keyPrefix = options.keyPrefix ?? 'fairgate:';
    this.client = new Redis({
      url: options.url,
      token: options.token,
    });
  }

  async checkRate(key: string, limit: number, windowSeconds: number): Promise<RateCheckResult> {
    const prefixedKey = `${this.keyPrefix}rate:${key}`;
    const now = Math.floor(Date.now() / 1000);

    try {
      const result = (await this.client.eval(
        RATE_CHECK_SCRIPT,
        [prefixedKey],
        [limit.toString(), windowSeconds.toString(), now.toString()]
      )) as number[];

      const [current, remaining, resetInSeconds, returnedLimit] = result;

      return {
        allowed: current <= limit,
        current,
        remaining: Math.max(0, remaining),
        resetInSeconds: Math.max(1, resetInSeconds),
        limit: returnedLimit,
      };
    } catch (error) {
      console.error('[LimitRate] Upstash rate check error:', error);
      throw error;
    }
  }

  async incrementCost(
    key: string,
    cost: number,
    windowSeconds: number,
    cap: number
  ): Promise<CostCheckResult> {
    const prefixedKey = `${this.keyPrefix}cost:${key}`;

    try {
      const result = (await this.client.eval(
        COST_INCREMENT_SCRIPT,
        [prefixedKey],
        [cost.toString(), windowSeconds.toString(), cap.toString()]
      )) as [number, number, number, number, number];

      const [current, allowed, remaining, resetInSeconds, returnedCap] = result;

      return {
        allowed: allowed === 1,
        current,
        remaining: Math.max(0, remaining),
        resetInSeconds: Math.max(1, resetInSeconds),
        cap: returnedCap,
      };
    } catch (error) {
      console.error('[LimitRate] Upstash cost increment error:', error);
      throw error;
    }
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    // Upstash HTTP client doesn't need explicit closing
    return Promise.resolve();
  }

  /**
   * Get underlying Upstash client (for advanced use cases)
   */
  getClient(): Redis {
    return this.client;
  }
}
