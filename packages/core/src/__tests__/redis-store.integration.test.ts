/**
 * Redis Store Integration Tests
 * Tests all RedisStore functionality with real Redis using testcontainers
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { RedisStore } from '../stores/redis';
import type { Store } from '../types';

// Check if Docker is available
const hasDocker = async (): Promise<boolean> => {
  try {
    const { execSync } = await import('child_process');
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

describe('RedisStore Integration Tests', async () => {
  const dockerAvailable = await hasDocker();

  if (!dockerAvailable) {
    it.skip('Docker not available - skipping Redis integration tests', () => {});
    return;
  }

  let container: StartedRedisContainer;
  let store: Store;

  beforeAll(async () => {
    // Start Redis container
    console.log('Starting Redis container...');
    container = await new RedisContainer().start();
    console.log('Redis container started at:', container.getConnectionUrl());

    // Create store connected to container
    store = new RedisStore({
      client: container.getConnectionUrl(),
    });

    // Verify connection
    const isHealthy = await store.ping();
    expect(isHealthy).toBe(true);
  }, 60000); // 60s timeout for container startup

  afterAll(async () => {
    await store.close();
    await container.stop();
  });

  beforeEach(async () => {
    // Clear Redis between tests
    const redisStore = store as RedisStore;
    const client = redisStore.getClient();
    await client.flushdb();
  });

  describe('checkRate - Basic Functionality', () => {
    it('should allow requests within limit', async () => {
      const result = await store.checkRate('user:test', 10, 60);

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
      expect(result.remaining).toBe(9);
      expect(result.limit).toBe(10);
      expect(result.resetInSeconds).toBeGreaterThan(0);
      expect(result.resetInSeconds).toBeLessThanOrEqual(60);
    });

    it('should block requests when limit exceeded', async () => {
      const key = 'user:test:limit';

      // Send 10 requests (at limit)
      for (let i = 0; i < 10; i++) {
        await store.checkRate(key, 10, 60);
      }

      // 11th request should be blocked
      const result = await store.checkRate(key, 10, 60);

      expect(result.allowed).toBe(false);
      expect(result.current).toBe(10);
      expect(result.remaining).toBe(0);
    });

    it('should reset after window expires', async () => {
      const key = 'user:test:reset';

      // Send 10 requests (at limit)
      for (let i = 0; i < 10; i++) {
        await store.checkRate(key, 10, 1); // 1 second window
      }

      // Verify blocked
      const blocked = await store.checkRate(key, 10, 1);
      expect(blocked.allowed).toBe(false);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should allow again
      const result = await store.checkRate(key, 10, 1);
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
      expect(result.remaining).toBe(9);
    });

    it('should handle multiple users independently', async () => {
      await store.checkRate('user:alice', 10, 60);
      await store.checkRate('user:bob', 10, 60);

      const aliceResult = await store.checkRate('user:alice', 10, 60);
      const bobResult = await store.checkRate('user:bob', 10, 60);

      expect(aliceResult.current).toBe(2);
      expect(bobResult.current).toBe(2);
    });
  });

  describe('checkRate - Burst Tokens', () => {
    it('should use burst tokens when limit reached', async () => {
      const key = 'user:test:burst';

      // Use up regular limit (10 requests)
      for (let i = 0; i < 10; i++) {
        await store.checkRate(key, 10, 60, 5); // 5 burst tokens
      }

      // Regular limit reached, should use burst token
      const result = await store.checkRate(key, 10, 60, 5);

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(11);
      expect(result.remaining).toBe(0);
      expect(result.burstTokens).toBe(4); // 5 - 1 = 4 remaining
    });

    it('should block when both limit and burst exhausted', async () => {
      const key = 'user:test:burst-exhausted';

      // Use up regular limit + burst tokens (10 + 5 = 15 total)
      for (let i = 0; i < 15; i++) {
        await store.checkRate(key, 10, 60, 5);
      }

      // Should be blocked now
      const result = await store.checkRate(key, 10, 60, 5);

      expect(result.allowed).toBe(false);
      expect(result.current).toBe(15);
      expect(result.burstTokens).toBe(0);
    });

    it('should reset burst tokens when window resets', async () => {
      const key = 'user:test:burst-reset';

      // Use up all tokens (10 + 5 = 15)
      for (let i = 0; i < 15; i++) {
        await store.checkRate(key, 10, 1, 5); // 1 second window
      }

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should have full burst tokens again
      const result = await store.checkRate(key, 10, 1, 5);

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
      expect(result.burstTokens).toBe(5); // Full burst restored
    });

    it('should share TTL between rate and burst keys', async () => {
      const key = 'user:test:shared-ttl';
      const redisStore = store as RedisStore;
      const client = redisStore.getClient();

      // Make a request with burst enabled
      await store.checkRate(key, 10, 60, 5);

      // Check TTLs of both keys
      const rateTTL = await client.ttl('limitrate:rate:' + key);
      const burstTTL = await client.ttl('limitrate:burst:' + key);

      // TTLs should be identical (within 1 second tolerance)
      expect(Math.abs(rateTTL - burstTTL)).toBeLessThanOrEqual(1);
    });
  });

  describe('peekRate - Non-incrementing Reads', () => {
    it('should peek without incrementing counter', async () => {
      const key = 'user:test:peek';

      // Make one actual request
      await store.checkRate(key, 10, 60);

      // Peek multiple times
      const peek1 = await store.peekRate(key, 10, 60);
      const peek2 = await store.peekRate(key, 10, 60);
      const peek3 = await store.peekRate(key, 10, 60);

      // All peeks should show same count (1)
      expect(peek1.current).toBe(1);
      expect(peek2.current).toBe(1);
      expect(peek3.current).toBe(1);
      expect(peek1.remaining).toBe(9);
    });

    it('should return zero usage for non-existent key', async () => {
      const result = await store.peekRate('nonexistent:key', 10, 60);

      expect(result.current).toBe(0);
      expect(result.remaining).toBe(10);
      expect(result.allowed).toBe(true);
    });
  });

  describe('incrementCost - Atomic Cost Tracking', () => {
    it('should track cost and allow within cap', async () => {
      const key = 'user:test:cost';

      const result = await store.incrementCost(key, 0.01, 3600, 0.10);

      expect(result.allowed).toBe(true);
      expect(result.current).toBeCloseTo(0.01, 2);
      expect(result.remaining).toBeCloseTo(0.09, 2);
      expect(result.cap).toBe(0.10);
    });

    it('should block when cost cap exceeded', async () => {
      const key = 'user:test:cost-exceeded';

      // Add costs up to cap
      await store.incrementCost(key, 0.05, 3600, 0.10);
      await store.incrementCost(key, 0.04, 3600, 0.10);

      // This should exceed cap
      const result = await store.incrementCost(key, 0.02, 3600, 0.10);

      expect(result.allowed).toBe(false);
      expect(result.current).toBeCloseTo(0.09, 2);
      expect(result.remaining).toBeCloseTo(0.01, 2);
    });

    it('should preserve TTL on subsequent increments', async () => {
      const key = 'user:test:cost-ttl';
      const redisStore = store as RedisStore;
      const client = redisStore.getClient();

      // First increment sets TTL
      await store.incrementCost(key, 0.05, 60, 0.10);
      const firstTTL = await client.ttl('limitrate:cost:' + key);

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Second increment should preserve TTL (not reset it)
      await store.incrementCost(key, 0.02, 60, 0.10);
      const secondTTL = await client.ttl('limitrate:cost:' + key);

      // Second TTL should be less than first (time passed)
      expect(secondTTL).toBeLessThan(firstTTL);
    });
  });

  describe('incrementTokens - AI Token Tracking', () => {
    it('should track tokens and allow within limit', async () => {
      const key = 'user:test:tokens';

      const result = await store.incrementTokens(key, 100, 3600, 10000);

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(100);
      expect(result.remaining).toBe(9900);
      expect(result.limit).toBe(10000);
    });

    it('should block when token limit exceeded', async () => {
      const key = 'user:test:tokens-exceeded';

      // Add tokens up to limit
      await store.incrementTokens(key, 8000, 3600, 10000);
      await store.incrementTokens(key, 1500, 3600, 10000);

      // This should exceed limit
      const result = await store.incrementTokens(key, 1000, 3600, 10000);

      expect(result.allowed).toBe(false);
      expect(result.current).toBe(9500);
      expect(result.remaining).toBe(500);
    });
  });

  describe('Concurrent Operations - Atomicity', () => {
    it('should handle 10 concurrent checkRate calls atomically', async () => {
      const key = 'user:test:concurrent';

      // Run 10 concurrent requests
      const results = await Promise.all(
        Array.from({ length: 10 }, () => store.checkRate(key, 10, 60))
      );

      // All should be allowed (exactly at limit)
      expect(results.every(r => r.allowed)).toBe(true);

      // Final count should be exactly 10
      const peek = await store.peekRate(key, 10, 60);
      expect(peek.current).toBe(10);
    });

    it('should handle 20 concurrent checkRate calls with overflow', async () => {
      const key = 'user:test:concurrent-overflow';

      // Run 20 concurrent requests (limit is 10)
      const results = await Promise.all(
        Array.from({ length: 20 }, () => store.checkRate(key, 10, 60))
      );

      // Exactly 10 should be allowed, 10 should be blocked
      const allowed = results.filter(r => r.allowed).length;
      const blocked = results.filter(r => !r.allowed).length;

      expect(allowed).toBe(10);
      expect(blocked).toBe(10);

      // Final count should be exactly 10
      const peek = await store.peekRate(key, 10, 60);
      expect(peek.current).toBe(10);
    });

    it('should handle concurrent cost increments atomically', async () => {
      const key = 'user:test:cost-concurrent';

      // Run 10 concurrent cost increments (0.02 each = 0.20 total)
      const results = await Promise.all(
        Array.from({ length: 10 }, () => store.incrementCost(key, 0.02, 3600, 0.10))
      );

      // Exactly 5 should be allowed (5 * 0.02 = 0.10 cap)
      const allowed = results.filter(r => r.allowed).length;

      expect(allowed).toBe(5);

      // Final cost should be exactly 0.10
      const finalResult = results.find(r => !r.allowed);
      expect(finalResult?.current).toBeCloseTo(0.10, 2);
    });
  });

  describe('Circuit Breaker Behavior', () => {
    it('should open circuit breaker after repeated failures', async () => {
      const key = 'user:test:circuit-breaker';

      // Create store with fail-closed mode and low threshold
      const failClosedStore = new RedisStore({
        client: 'redis://localhost:9999', // Invalid connection
        onError: 'fail-closed',
        circuitBreakerThreshold: 3,
        circuitBreakerTimeoutMs: 5000,
      });

      // First 3 failures should throw errors
      await expect(failClosedStore.checkRate(key, 10, 60)).rejects.toThrow();
      await expect(failClosedStore.checkRate(key, 10, 60)).rejects.toThrow();
      await expect(failClosedStore.checkRate(key, 10, 60)).rejects.toThrow();

      // 4th call should be allowed (circuit breaker open)
      const result = await failClosedStore.checkRate(key, 10, 60);
      expect(result.allowed).toBe(true); // Fail-open when circuit breaker is open

      await failClosedStore.close();
    });

    it('should reset circuit breaker after timeout', async () => {
      const key = 'user:test:circuit-breaker-reset';

      // Create store with fail-closed mode and short timeout
      const failClosedStore = new RedisStore({
        client: 'redis://localhost:9999', // Invalid connection
        onError: 'fail-closed',
        circuitBreakerThreshold: 2,
        circuitBreakerTimeoutMs: 1000, // 1 second
      });

      // Trigger circuit breaker
      await expect(failClosedStore.checkRate(key, 10, 60)).rejects.toThrow();
      await expect(failClosedStore.checkRate(key, 10, 60)).rejects.toThrow();

      // Circuit breaker should be open
      const openResult = await failClosedStore.checkRate(key, 10, 60);
      expect(openResult.allowed).toBe(true);

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Circuit breaker should reset and try again (will fail)
      await expect(failClosedStore.checkRate(key, 10, 60)).rejects.toThrow();

      await failClosedStore.close();
    });
  });

  describe('Error Handling', () => {
    it('should fail-open by default on Redis errors', async () => {
      const key = 'user:test:fail-open';

      // Create store with invalid connection (default fail-open)
      const failOpenStore = new RedisStore({
        client: 'redis://localhost:9999',
        onError: 'fail-open', // Explicit fail-open
      });

      // Should not throw, should allow request
      const result = await failOpenStore.checkRate(key, 10, 60);

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(0);
      expect(result.remaining).toBe(10);

      await failOpenStore.close();
    });
  });

  describe('Key Expiry Behavior', () => {
    it('should automatically clean up expired keys', async () => {
      const key = 'user:test:expiry';
      const redisStore = store as RedisStore;
      const client = redisStore.getClient();

      // Create key with short TTL
      await store.checkRate(key, 10, 1); // 1 second window

      // Key should exist
      const exists = await client.exists('limitrate:rate:' + key);
      expect(exists).toBe(1);

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Key should be gone
      const existsAfter = await client.exists('limitrate:rate:' + key);
      expect(existsAfter).toBe(0);
    });
  });

  describe('Lua Script Execution', () => {
    it('should execute Lua scripts atomically for rate checking', async () => {
      const key = 'user:test:lua';

      // Spy on Redis eval method
      const redisStore = store as RedisStore;
      const client = redisStore.getClient();
      const evalSpy = vi.spyOn(client, 'eval');

      // Make a request
      await store.checkRate(key, 10, 60);

      // Should have called eval (Lua script)
      expect(evalSpy).toHaveBeenCalled();
      expect(evalSpy).toHaveBeenCalledWith(
        expect.stringContaining('redis.call'),
        expect.any(Number),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String)
      );

      evalSpy.mockRestore();
    });
  });
});
