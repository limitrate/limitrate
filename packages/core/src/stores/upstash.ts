/**
 * Upstash store for serverless-friendly rate limiting
 * Uses HTTP REST API (no persistent connections)
 */

import { Redis } from '@upstash/redis';
import type { Store, RateCheckResult, CostCheckResult, TokenCheckResult } from '../types';

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

const RATE_CHECK_BURST_SCRIPT = `
local rateKey = KEYS[1]
local burstKey = KEYS[2]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local burst = tonumber(ARGV[4])

local current = redis.call('GET', rateKey)

if not current then
  redis.call('SETEX', rateKey, window, 1)
  redis.call('SETEX', burstKey, window, burst)
  return {1, limit - 1, window, limit, burst}
end

current = tonumber(current)

if current < limit then
  redis.call('INCR', rateKey)
  local ttl = redis.call('TTL', rateKey)
  local burstTokens = tonumber(redis.call('GET', burstKey) or 0)
  return {current + 1, limit - current - 1, ttl, limit, burstTokens}
end

local burstTokens = tonumber(redis.call('GET', burstKey) or 0)
if burstTokens > 0 then
  redis.call('DECR', burstKey)
  redis.call('INCR', rateKey)
  local ttl = redis.call('TTL', rateKey)
  return {current + 1, 0, ttl, limit, burstTokens - 1}
end

local ttl = redis.call('TTL', rateKey)
return {current, 0, ttl, limit, 0}
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

export interface UpstashStoreOptions {
  /** Upstash Redis REST URL */
  url: string;
  /** Upstash Redis REST token */
  token: string;
  /** Key prefix for all LimitRate keys */
  keyPrefix?: string;
}

export class UpstashStore implements Store {
  private client: Redis;
  private keyPrefix: string;
  private url: string;
  private token: string;

  constructor(options: UpstashStoreOptions) {
    if (!options.url || !options.token) {
      throw new Error('UpstashStore requires both url and token');
    }

    this.keyPrefix = options.keyPrefix ?? 'limitrate:';
    this.url = options.url;
    this.token = options.token;
    this.client = new Redis({
      url: options.url,
      token: options.token,
    });
  }

  async checkRate(key: string, limit: number, windowSeconds: number, burst?: number): Promise<RateCheckResult> {
    const now = Math.floor(Date.now() / 1000);

    try {
      // Use burst script if burst is defined
      if (burst !== undefined) {
        const rateKey = `${this.keyPrefix}rate:${key}`;
        const burstKey = `${this.keyPrefix}burst:${key}`;

        const result = (await this.client.eval(
          RATE_CHECK_BURST_SCRIPT,
          [rateKey, burstKey],
          [limit.toString(), windowSeconds.toString(), now.toString(), burst.toString()]
        )) as number[];

        const [current, remaining, resetInSeconds, returnedLimit, burstTokens] = result;

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

  async peekRate(key: string, limit: number, windowSeconds: number): Promise<RateCheckResult> {
    const prefixedKey = `${this.keyPrefix}rate:${key}`;

    try {
      // Use GET to peek without incrementing
      const response = await fetch(`${this.url}/get/${encodeURIComponent(prefixedKey)}`, {
        headers: { 'Authorization': `Bearer ${this.token}` },
      });

      if (!response.ok && response.status !== 404) {
        throw new Error(`Upstash API error: ${response.status}`);
      }

      const data = (await response.json()) as { result?: string | number };
      const current = data.result ? parseInt(String(data.result), 10) : 0;

      // Get TTL
      const ttlResponse = await fetch(`${this.url}/ttl/${encodeURIComponent(prefixedKey)}`, {
        headers: { 'Authorization': `Bearer ${this.token}` },
      });

      const ttlData = (await ttlResponse.json()) as { result?: number };
      const resetInSeconds = (ttlData.result && ttlData.result > 0) ? ttlData.result : windowSeconds;
      const remaining = Math.max(0, limit - current);

      return {
        allowed: current < limit,
        current,
        remaining,
        resetInSeconds,
        limit,
      };
    } catch (error) {
      console.error('[LimitRate] Upstash peek rate error:', error);
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

  async incrementTokens(
    key: string,
    tokens: number,
    windowSeconds: number,
    limit: number
  ): Promise<TokenCheckResult> {
    const prefixedKey = `${this.keyPrefix}tokens:${key}`;

    try {
      const result = (await this.client.eval(
        TOKEN_INCREMENT_SCRIPT,
        [prefixedKey],
        [tokens.toString(), windowSeconds.toString(), limit.toString()]
      )) as [number, number, number, number, number];

      const [current, allowed, remaining, resetInSeconds, returnedLimit] = result;

      return {
        allowed: allowed === 1,
        current,
        remaining: Math.max(0, remaining),
        resetInSeconds: Math.max(1, resetInSeconds),
        limit: returnedLimit,
      };
    } catch (error) {
      console.error('[LimitRate] Upstash token increment error:', error);
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
   * Generic get method for arbitrary data (v2.0.0 - D4)
   */
  async get<T = any>(key: string): Promise<T | null> {
    try {
      const prefixedKey = `${this.keyPrefix}generic:${key}`;
      const value = await this.client.get(prefixedKey);

      if (!value) {
        return null;
      }

      // Upstash returns deserialized JSON automatically
      return value as T;
    } catch (error) {
      console.error('[LimitRate] Upstash get error:', error);
      throw error;
    }
  }

  /**
   * Generic set method for arbitrary data (v2.0.0 - D4)
   */
  async set<T = any>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const prefixedKey = `${this.keyPrefix}generic:${key}`;
      const expirySeconds = ttl || 86400; // Default 24h TTL

      await this.client.setex(prefixedKey, expirySeconds, value);
    } catch (error) {
      console.error('[LimitRate] Upstash set error:', error);
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
      console.error('[LimitRate] Upstash delete error:', error);
      throw error;
    }
  }

  /**
   * Get underlying Upstash client (for advanced use cases)
   */
  getClient(): Redis {
    return this.client;
  }
}
