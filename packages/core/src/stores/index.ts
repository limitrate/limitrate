/**
 * Store factory and exports
 */

import type { Store, StoreConfig } from '../types';
import { MemoryStore } from './memory';
import { RedisStore, type RedisStoreOptions } from './redis';
import { UpstashStore, type UpstashStoreOptions } from './upstash';

export { MemoryStore, RedisStore, UpstashStore };
export type { RedisStoreOptions, UpstashStoreOptions };

/**
 * Create a store from config (internal, for middleware)
 * Fix #7: Pass configuration options to stores
 */
export function createStore(config: StoreConfig): Store {
  switch (config.type) {
    case 'memory':
      return new MemoryStore({
        maxKeys: config.maxKeys,
        cleanupIntervalMs: config.cleanupIntervalMs,
        maxKeysPerUser: config.maxKeysPerUser,
      });

    case 'redis':
      if (!config.url) {
        throw new Error('Redis store requires url');
      }
      return new RedisStore({
        client: config.url,
        redisOptions: config.options,
        circuitBreakerThreshold: config.circuitBreakerThreshold,
        circuitBreakerTimeoutMs: config.circuitBreakerTimeoutMs,
      });

    case 'upstash':
      if (!config.url || !config.token) {
        throw new Error('Upstash store requires url and token');
      }
      return new UpstashStore({
        url: config.url,
        token: config.token,
        circuitBreakerThreshold: config.circuitBreakerThreshold,
        circuitBreakerTimeoutMs: config.circuitBreakerTimeoutMs,
      });

    default:
      throw new Error(`Unknown store type: ${(config as any).type}`);
  }
}

// =============================================================================
// Shared Store Factory Functions (v1.3.0)
// =============================================================================

/**
 * Create a SHARED memory store that can be reused across multiple limitrate instances.
 *
 * **Benefits:**
 * - Reduces memory usage when using multiple limiters
 * - Single cleanup interval instead of N intervals
 * - Consistent cache across all limiters
 *
 * **Example:**
 * ```typescript
 * import { createSharedMemoryStore } from '@limitrate/core';
 * import { limitrate } from '@limitrate/express';
 *
 * // Create ONCE
 * const store = createSharedMemoryStore();
 *
 * // Reuse everywhere
 * app.use(limitrate({ store, policies: { free: {...} } }));
 * app.use('/api', limitrate({ store, policies: { api: {...} } }));
 * app.use('/admin', limitrate({ store, policies: { admin: {...} } }));
 * ```
 *
 * @param options - Optional memory store configuration
 * @returns Shared MemoryStore instance
 */
export function createSharedMemoryStore(options?: { maxKeys?: number; cleanupIntervalMs?: number }): MemoryStore {
  return new MemoryStore(options);
}

/**
 * Create a SHARED Redis store that can be reused across multiple limitrate instances.
 *
 * **Benefits:**
 * - **Reduces Redis connections from N → 1** (critical for production)
 * - Reduces memory usage by 75%+ when using multiple limiters
 * - Prevents connection pool exhaustion
 * - Single connection management instead of N connections
 *
 * **Example:**
 * ```typescript
 * import { createSharedRedisStore } from '@limitrate/core';
 * import { limitrate } from '@limitrate/express';
 *
 * // Create ONCE
 * const store = createSharedRedisStore({ url: process.env.REDIS_URL });
 *
 * // Reuse everywhere (1 connection, not 4!)
 * app.use(limitrate({ store, policies: { free: {...} } }));
 * app.use('/api', limitrate({ store, policies: { api: {...} } }));
 * app.use('/admin', limitrate({ store, policies: { admin: {...} } }));
 * app.use('/webhooks', limitrate({ store, policies: { webhooks: {...} } }));
 *
 * // Result: 1 Redis connection, 75% less memory
 * ```
 *
 * **Advanced - Pass existing Redis client:**
 * ```typescript
 * import Redis from 'ioredis';
 * import { createSharedRedisStore } from '@limitrate/core';
 *
 * const redisClient = new Redis(process.env.REDIS_URL);
 * const store = createSharedRedisStore({ client: redisClient });
 *
 * // LimitRate will NOT close this client when done
 * // You manage the lifecycle
 * ```
 *
 * @param options - Redis URL or existing client + options
 * @returns Shared RedisStore instance
 */
export function createSharedRedisStore(options: { url: string; keyPrefix?: string; redisOptions?: any } | { client: any; keyPrefix?: string }): RedisStore {
  if ('url' in options) {
    return new RedisStore({ client: options.url, keyPrefix: options.keyPrefix, redisOptions: options.redisOptions });
  }
  return new RedisStore({ client: options.client, keyPrefix: options.keyPrefix });
}

/**
 * Create a SHARED Upstash store that can be reused across multiple limitrate instances.
 *
 * **Benefits:**
 * - Serverless-friendly (HTTP-based, no persistent connections)
 * - Reduces HTTP client overhead when using multiple limiters
 * - Single token management
 * - Consistent configuration across all limiters
 *
 * **Example:**
 * ```typescript
 * import { createSharedUpstashStore } from '@limitrate/core';
 * import { limitrate } from '@limitrate/express';
 *
 * // Create ONCE
 * const store = createSharedUpstashStore({
 *   url: process.env.UPSTASH_REDIS_REST_URL,
 *   token: process.env.UPSTASH_REDIS_REST_TOKEN
 * });
 *
 * // Reuse everywhere
 * app.use(limitrate({ store, policies: { free: {...} } }));
 * app.use('/api', limitrate({ store, policies: { api: {...} } }));
 * app.use('/admin', limitrate({ store, policies: { admin: {...} } }));
 * ```
 *
 * **Perfect for:**
 * - Vercel Edge Functions
 * - Cloudflare Workers
 * - AWS Lambda
 * - Any serverless environment
 *
 * @param options - Upstash REST API URL and token
 * @returns Shared UpstashStore instance
 */
export function createSharedUpstashStore(options: { url: string; token: string; keyPrefix?: string }): UpstashStore {
  return new UpstashStore(options);
}
