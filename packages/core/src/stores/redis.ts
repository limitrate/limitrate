/**
 * Redis store for distributed rate limiting
 * Uses atomic Lua scripts for correctness
 */

import Redis from 'ioredis';
import type { Store, RateCheckResult, CostCheckResult, TokenCheckResult } from '../types';

// Lua script for peeking at rate without incrementing (v1.7.0 - B5)
const RATE_PEEK_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])

local current = redis.call('GET', key)

if not current then
  return {0, limit, window, limit}
end

current = tonumber(current)
local ttl = redis.call('TTL', key)
local remaining = math.max(0, limit - current)
return {current, remaining, ttl, limit}
`;

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

// Lua script for atomic rate check with burst support
const RATE_CHECK_BURST_SCRIPT = `
local rateKey = KEYS[1]
local burstKey = KEYS[2]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local burst = tonumber(ARGV[4])

local current = redis.call('GET', rateKey)

-- No entry: create new with initial burst tokens
if not current then
  redis.call('SETEX', rateKey, window, 1)
  redis.call('SETEX', burstKey, window, burst)
  return {1, limit - 1, window, limit, burst}
end

current = tonumber(current)

-- Within limit: increment and return
if current < limit then
  redis.call('INCR', rateKey)
  local ttl = redis.call('TTL', rateKey)
  local burstTokens = tonumber(redis.call('GET', burstKey) or 0)
  return {current + 1, limit - current - 1, ttl, limit, burstTokens}
end

-- Limit reached: try burst
local burstTokens = tonumber(redis.call('GET', burstKey) or 0)
if burstTokens > 0 then
  redis.call('DECR', burstKey)
  redis.call('INCR', rateKey)
  local ttl = redis.call('TTL', rateKey)
  return {current + 1, 0, ttl, limit, burstTokens - 1}
end

-- Both exhausted
local ttl = redis.call('TTL', rateKey)
return {current, 0, ttl, limit, 0}
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

// Lua script for atomic token increment (v1.4.0 - AI feature)
const TOKEN_INCREMENT_SCRIPT = `
local key = KEYS[1]
local tokens = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

local current = redis.call('GET', key)

if not current then
  if tokens > limit then
    redis.call('SETEX', key, window, 0)
    return {0, false, limit, window, limit}
  end
  redis.call('SETEX', key, window, tokens)
  return {tokens, true, limit - tokens, window, limit}
end

current = tonumber(current)
local newTokens = current + tokens

if newTokens > limit then
  local ttl = redis.call('TTL', key)
  return {current, false, math.max(0, limit - current), ttl, limit}
end

redis.call('SET', key, newTokens, 'KEEPTTL')
local ttl = redis.call('TTL', key)
return {newTokens, true, limit - newTokens, ttl, limit}
`;

export interface RedisStoreOptions {
  /** Redis connection URL or ioredis instance */
  client?: Redis | string;
  /** Key prefix for all LimitRate keys */
  keyPrefix?: string;
  /** Redis client options (if URL provided) */
  redisOptions?: any;
}

export class RedisStore implements Store {
  private client: Redis;
  private ownClient: boolean;
  private keyPrefix: string;

  constructor(options: RedisStoreOptions = {}) {
    this.keyPrefix = options.keyPrefix ?? 'limitrate:';
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

  async checkRate(key: string, limit: number, windowSeconds: number, burst?: number): Promise<RateCheckResult> {
    const now = Math.floor(Date.now() / 1000);

    try {
      // Use burst script if burst is defined
      if (burst !== undefined) {
        const rateKey = `${this.keyPrefix}rate:${key}`;
        const burstKey = `${this.keyPrefix}burst:${key}`;

        const result = await this.client.eval(
          RATE_CHECK_BURST_SCRIPT,
          2,
          rateKey,
          burstKey,
          limit.toString(),
          windowSeconds.toString(),
          now.toString(),
          burst.toString()
        );

        const [current, remaining, resetInSeconds, returnedLimit, burstTokens] = result as number[];

        return {
          allowed: current <= limit + burst,
          current,
          remaining: Math.max(0, remaining),
          resetInSeconds: Math.max(1, resetInSeconds),
          limit: returnedLimit,
          burstTokens,
        };
      }

      // No burst: use simple script
      const prefixedKey = `${this.keyPrefix}rate:${key}`;
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

  async peekRate(key: string, limit: number, windowSeconds: number): Promise<RateCheckResult> {
    const prefixedKey = `${this.keyPrefix}rate:${key}`;

    try {
      const result = await this.client.eval(
        RATE_PEEK_SCRIPT,
        1,
        prefixedKey,
        limit.toString(),
        windowSeconds.toString()
      );

      const [current, remaining, resetInSeconds, returnedLimit] = result as number[];

      return {
        allowed: current < limit,
        current,
        remaining: Math.max(0, remaining),
        resetInSeconds: Math.max(1, resetInSeconds),
        limit: returnedLimit,
      };
    } catch (error) {
      console.error('[LimitRate] Redis peek rate error:', error);
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

  async incrementTokens(
    key: string,
    tokens: number,
    windowSeconds: number,
    limit: number
  ): Promise<TokenCheckResult> {
    const prefixedKey = `${this.keyPrefix}tokens:${key}`;

    try {
      const result = await this.client.eval(
        TOKEN_INCREMENT_SCRIPT,
        1,
        prefixedKey,
        tokens.toString(),
        windowSeconds.toString(),
        limit.toString()
      );

      const [current, allowed, remaining, resetInSeconds, returnedLimit] = result as [
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
        limit: returnedLimit,
      };
    } catch (error) {
      console.error('[LimitRate] Redis token increment error:', error);
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
   * Generic get method for arbitrary data (v2.0.0 - D4)
   */
  async get<T = any>(key: string): Promise<T | null> {
    try {
      const prefixedKey = `${this.keyPrefix}generic:${key}`;
      const value = await this.client.get(prefixedKey);

      if (!value) {
        return null;
      }

      return JSON.parse(value) as T;
    } catch (error) {
      console.error('[LimitRate] Redis get error:', error);
      throw error;
    }
  }

  /**
   * Generic set method for arbitrary data (v2.0.0 - D4)
   */
  async set<T = any>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const prefixedKey = `${this.keyPrefix}generic:${key}`;
      const serialized = JSON.stringify(value);

      if (ttl) {
        await this.client.setex(prefixedKey, ttl, serialized);
      } else {
        // Default 24h TTL
        await this.client.setex(prefixedKey, 86400, serialized);
      }
    } catch (error) {
      console.error('[LimitRate] Redis set error:', error);
      throw error;
    }
  }

  /**
   * Generic delete method (v2.0.0 - D4)
   */
  async delete(key: string): Promise<void> {
    try {
      const prefixedKey = `${this.keyPrefix}generic:${key}`;
      await this.client.del(prefixedKey);
    } catch (error) {
      console.error('[LimitRate] Redis delete error:', error);
      throw error;
    }
  }

  /**
   * Get underlying Redis client (for advanced use cases)
   */
  getClient(): Redis {
    return this.client;
  }
}
