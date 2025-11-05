/**
 * Redis store for distributed rate limiting
 * Uses atomic Lua scripts for correctness
 */

import Redis from 'ioredis';
import type { Store, RateCheckResult, CostCheckResult } from '../types';

// Lua script for atomic rate check and increment
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

// Lua script for atomic cost increment and check
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

export interface RedisStoreOptions {
  /** Redis connection URL or ioredis instance */
  client?: Redis | string;
  /** Key prefix for all FairGate keys */
  keyPrefix?: string;
  /** Redis client options (if URL provided) */
  redisOptions?: any;
}

export class RedisStore implements Store {
  private client: Redis;
  private ownClient: boolean;
  private keyPrefix: string;

  constructor(options: RedisStoreOptions = {}) {
    this.keyPrefix = options.keyPrefix ?? 'fairgate:';
    this.ownClient = false;

    if (options.client instanceof Redis) {
      // Use provided client
      this.client = options.client;
    } else if (typeof options.client === 'string') {
      // Create new client from URL
      this.client = new Redis(options.client, options.redisOptions);
      this.ownClient = true;
    } else {
      throw new Error('RedisStore requires either a Redis URL or ioredis instance');
    }
  }

  async checkRate(key: string, limit: number, windowSeconds: number): Promise<RateCheckResult> {
    const prefixedKey = `${this.keyPrefix}rate:${key}`;
    const now = Math.floor(Date.now() / 1000);

    try {
      const result = await this.client.eval(
        RATE_CHECK_SCRIPT,
        1,
        prefixedKey,
        limit.toString(),
        windowSeconds.toString(),
        now.toString()
      );

      const [current, remaining, resetInSeconds, returnedLimit] = result as number[];

      return {
        allowed: current <= limit,
        current,
        remaining: Math.max(0, remaining),
        resetInSeconds: Math.max(1, resetInSeconds),
        limit: returnedLimit,
      };
    } catch (error) {
      // Log error and rethrow
      console.error('[LimitRate] Redis rate check error:', error);
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
      const result = await this.client.eval(
        COST_INCREMENT_SCRIPT,
        1,
        prefixedKey,
        cost.toString(),
        windowSeconds.toString(),
        cap.toString()
      );

      const [current, allowed, remaining, resetInSeconds, returnedCap] = result as [
        number,
        number,
        number,
        number,
        number
      ];

      return {
        allowed: allowed === 1,
        current,
        remaining: Math.max(0, remaining),
        resetInSeconds: Math.max(1, resetInSeconds),
        cap: returnedCap,
      };
    } catch (error) {
      console.error('[LimitRate] Redis cost increment error:', error);
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
    if (this.ownClient) {
      await this.client.quit();
    }
  }

  /**
   * Get underlying Redis client (for advanced use cases)
   */
  getClient(): Redis {
    return this.client;
  }
}
