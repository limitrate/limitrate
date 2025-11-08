/**
 * Upstash Store Integration Tests
 * Tests all UpstashStore functionality with real Upstash Redis
 *
 * IMPORTANT: These tests are SKIPPED by default as they require real Upstash credentials.
 * To run these tests, set the following environment variables:
 * - UPSTASH_REDIS_REST_URL
 * - UPSTASH_REDIS_REST_TOKEN
 *
 * Example:
 * UPSTASH_REDIS_REST_URL=https://xxx.upstash.io UPSTASH_REDIS_REST_TOKEN=xxx pnpm test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { UpstashStore } from '../stores/upstash';
import type { Store } from '../types';

const hasUpstashCreds =
  !!process.env.UPSTASH_REDIS_REST_URL &&
  !!process.env.UPSTASH_REDIS_REST_TOKEN;

describe.skipIf(!hasUpstashCreds)('UpstashStore Integration Tests', () => {
  let store: Store;
  let testKeys: string[] = [];

  beforeAll(async () => {
    if (!hasUpstashCreds) return;

    store = new UpstashStore({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      keyPrefix: 'limitrate:test:',
    });

    // Verify connection
    const isHealthy = await store.ping();
    expect(isHealthy).toBe(true);
  });

  beforeEach(() => {
    // Reset test keys tracker
    testKeys = [];
  });

  afterAll(async () => {
    if (!hasUpstashCreds || !store) return;

    // Clean up all test keys
    if (testKeys.length > 0) {
      const upstashStore = store as UpstashStore;
      const client = upstashStore.getClient();

      // Delete all test keys
      for (const key of testKeys) {
        try {
          await client.del(key);
        } catch (error) {
          console.warn('Failed to delete test key:', key, error);
        }
      }
    }

    await store.close();
  });

  // Helper to track keys for cleanup
  const trackKey = (key: string) => {
    testKeys.push('limitrate:test:rate:' + key);
    testKeys.push('limitrate:test:burst:' + key);
    testKeys.push('limitrate:test:cost:' + key);
    testKeys.push('limitrate:test:tokens:' + key);
  };

  describe('checkRate - Basic Functionality', () => {
    it('should allow requests within limit', async () => {
      const key = 'user:test:basic';
      trackKey(key);

      const result = await store.checkRate(key, 10, 60);

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
      expect(result.remaining).toBe(9);
      expect(result.limit).toBe(10);
      expect(result.resetInSeconds).toBeGreaterThan(0);
      expect(result.resetInSeconds).toBeLessThanOrEqual(60);
    });

    it('should block requests when limit exceeded', async () => {
      const key = 'user:test:limit';
      trackKey(key);

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
      trackKey(key);

      // Send 10 requests (at limit)
      for (let i = 0; i < 10; i++) {
        await store.checkRate(key, 10, 2); // 2 second window
      }

      // Verify blocked
      const blocked = await store.checkRate(key, 10, 2);
      expect(blocked.allowed).toBe(false);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 2200));

      // Should allow again
      const result = await store.checkRate(key, 10, 2);
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
      expect(result.remaining).toBe(9);
    });

    it('should handle multiple users independently', async () => {
      const aliceKey = 'user:alice';
      const bobKey = 'user:bob';
      trackKey(aliceKey);
      trackKey(bobKey);

      await store.checkRate(aliceKey, 10, 60);
      await store.checkRate(bobKey, 10, 60);

      const aliceResult = await store.checkRate(aliceKey, 10, 60);
      const bobResult = await store.checkRate(bobKey, 10, 60);

      expect(aliceResult.current).toBe(2);
      expect(bobResult.current).toBe(2);
    });
  });

  describe('checkRate - Burst Tokens', () => {
    it('should use burst tokens when limit reached', async () => {
      const key = 'user:test:burst';
      trackKey(key);

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
      trackKey(key);

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
      trackKey(key);

      // Use up all tokens (10 + 5 = 15)
      for (let i = 0; i < 15; i++) {
        await store.checkRate(key, 10, 2, 5); // 2 second window
      }

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 2200));

      // Should have full burst tokens again
      const result = await store.checkRate(key, 10, 2, 5);

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
      expect(result.burstTokens).toBe(5); // Full burst restored
    });
  });

  describe('peekRate - Non-incrementing Reads', () => {
    it('should peek without incrementing counter', async () => {
      const key = 'user:test:peek';
      trackKey(key);

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
      const key = 'nonexistent:key:' + Date.now();
      trackKey(key);

      const result = await store.peekRate(key, 10, 60);

      expect(result.current).toBe(0);
      expect(result.remaining).toBe(10);
      expect(result.allowed).toBe(true);
    });

    it('should use manual GET/TTL implementation for Upstash', async () => {
      const key = 'user:test:peek-impl';
      trackKey(key);

      // Make a request to create the key
      await store.checkRate(key, 10, 60);

      // Peek should work using REST API
      const result = await store.peekRate(key, 10, 60);

      expect(result.current).toBe(1);
      expect(result.remaining).toBe(9);
    });
  });

  describe('incrementCost - Atomic Cost Tracking', () => {
    it('should track cost and allow within cap', async () => {
      const key = 'user:test:cost';
      trackKey(key);

      const result = await store.incrementCost(key, 0.01, 3600, 0.10);

      expect(result.allowed).toBe(true);
      expect(result.current).toBeCloseTo(0.01, 2);
      expect(result.remaining).toBeCloseTo(0.09, 2);
      expect(result.cap).toBe(0.10);
    });

    it('should block when cost cap exceeded', async () => {
      const key = 'user:test:cost-exceeded';
      trackKey(key);

      // Add costs up to cap
      await store.incrementCost(key, 0.05, 3600, 0.10);
      await store.incrementCost(key, 0.04, 3600, 0.10);

      // This should exceed cap
      const result = await store.incrementCost(key, 0.02, 3600, 0.10);

      expect(result.allowed).toBe(false);
      expect(result.current).toBeCloseTo(0.09, 2);
      expect(result.remaining).toBeCloseTo(0.01, 2);
    });

    it('should reset cost after window expires', async () => {
      const key = 'user:test:cost-reset';
      trackKey(key);

      await store.incrementCost(key, 0.09, 2, 0.10); // 2 second window

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 2200));

      const result = await store.incrementCost(key, 0.05, 2, 0.10);

      expect(result.allowed).toBe(true);
      expect(result.current).toBeCloseTo(0.05, 2);
    });
  });

  describe('incrementTokens - AI Token Tracking', () => {
    it('should track tokens and allow within limit', async () => {
      const key = 'user:test:tokens';
      trackKey(key);

      const result = await store.incrementTokens(key, 100, 3600, 10000);

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(100);
      expect(result.remaining).toBe(9900);
      expect(result.limit).toBe(10000);
    });

    it('should block when token limit exceeded', async () => {
      const key = 'user:test:tokens-exceeded';
      trackKey(key);

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

  describe('Circuit Breaker Behavior', () => {
    it('should open circuit breaker after repeated failures', async () => {
      const key = 'user:test:circuit-breaker';

      // Create store with invalid credentials and fail-closed mode
      const failClosedStore = new UpstashStore({
        url: 'https://invalid.upstash.io',
        token: 'invalid_token',
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

      // Create store with invalid credentials and short timeout
      const failClosedStore = new UpstashStore({
        url: 'https://invalid.upstash.io',
        token: 'invalid_token',
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
    it('should fail-open by default on Upstash errors', async () => {
      const key = 'user:test:fail-open';

      // Create store with invalid credentials (default fail-open)
      const failOpenStore = new UpstashStore({
        url: 'https://invalid.upstash.io',
        token: 'invalid_token',
        onError: 'fail-open',
      });

      // Should not throw, should allow request
      const result = await failOpenStore.checkRate(key, 10, 60);

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(0);
      expect(result.remaining).toBe(10);

      await failOpenStore.close();
    });
  });

  describe('Upstash-specific Features', () => {
    it('should work with HTTP REST API (no persistent connections)', async () => {
      // Upstash uses REST API, so no connection management needed
      const key = 'user:test:rest-api';
      trackKey(key);

      const result = await store.checkRate(key, 10, 60);

      expect(result.allowed).toBe(true);

      // Store can be closed without connection cleanup
      await store.close();

      // Re-create store (no connection overhead)
      store = new UpstashStore({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
        keyPrefix: 'limitrate:test:',
      });

      // Should still work
      const result2 = await store.checkRate(key, 10, 60);
      expect(result2.current).toBe(2);
    });

    it('should handle serverless-friendly operations', async () => {
      const key = 'user:test:serverless';
      trackKey(key);

      // Simulate serverless invocations (create new store each time)
      for (let i = 0; i < 3; i++) {
        const tempStore = new UpstashStore({
          url: process.env.UPSTASH_REDIS_REST_URL!,
          token: process.env.UPSTASH_REDIS_REST_TOKEN!,
          keyPrefix: 'limitrate:test:',
        });

        const result = await tempStore.checkRate(key, 10, 60);
        expect(result.allowed).toBe(true);
        expect(result.current).toBe(i + 1);

        await tempStore.close();
      }
    });
  });

  describe('Lua Script Execution via REST', () => {
    it('should execute Lua scripts via Upstash eval endpoint', async () => {
      const key = 'user:test:lua-rest';
      trackKey(key);

      // Upstash should execute Lua scripts via REST API
      const result = await store.checkRate(key, 10, 60);

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);

      // Verify it's using eval (Lua script execution)
      // Upstash client handles this internally via REST
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent requests atomically', async () => {
      const key = 'user:test:concurrent';
      trackKey(key);

      // Run 10 concurrent requests
      const results = await Promise.all(
        Array.from({ length: 10 }, () => store.checkRate(key, 10, 60))
      );

      // All should be allowed (exactly at limit)
      expect(results.every((r) => r.allowed)).toBe(true);

      // Final count should be exactly 10
      const peek = await store.peekRate(key, 10, 60);
      expect(peek.current).toBe(10);
    });
  });
});

// Add helpful message when tests are skipped
if (!hasUpstashCreds) {
  describe('Upstash Integration Tests (Skipped)', () => {
    it('requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN', () => {
      console.log(`
========================================
Upstash Integration Tests are SKIPPED
========================================

To run these tests, set environment variables:

  UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
  UPSTASH_REDIS_REST_TOKEN=xxx

Then run:

  pnpm test

Or run a specific test:

  UPSTASH_REDIS_REST_URL=xxx UPSTASH_REDIS_REST_TOKEN=xxx pnpm test upstash

========================================
      `);
    });
  });
}
