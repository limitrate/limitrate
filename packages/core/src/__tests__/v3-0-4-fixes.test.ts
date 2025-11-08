/**
 * Tests for v3.0.4 critical fixes
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PolicyEngine } from '../engine';
import { MemoryStore } from '../stores/memory';
import { ConcurrencyLimiter } from '../concurrency/limiter';
import type { PolicyConfig } from '../types';

describe('v3.0.4 Critical Fixes', () => {
  describe('Event Listener Cleanup', () => {
    let store: MemoryStore;
    let engine: PolicyEngine;

    beforeEach(() => {
      store = new MemoryStore();
    });

    afterEach(async () => {
      await engine?.close();
      await store?.close();
    });

    it('should remove all event listeners', () => {
      const policies: PolicyConfig = {
        free: {
          defaults: {
            rate: { maxPerMinute: 10, actionOnExceed: 'block' }
          }
        }
      };

      engine = new PolicyEngine(store, policies);

      // Add event listeners
      const handler1 = () => {};
      const handler2 = () => {};
      engine.onEvent(handler1);
      engine.onEvent(handler2);

      // Verify listeners are registered
      expect(engine.getEventEmitter().getHandlerCount()).toBe(2);

      // Remove all listeners
      engine.removeAllListeners();

      // Verify all listeners removed
      expect(engine.getEventEmitter().getHandlerCount()).toBe(0);
    });

    it('should cleanup listeners on close()', async () => {
      const policies: PolicyConfig = {
        free: {
          defaults: {
            rate: { maxPerMinute: 10, actionOnExceed: 'block' }
          }
        }
      };

      engine = new PolicyEngine(store, policies);

      // Add event listener
      engine.onEvent(() => {});

      expect(engine.getEventEmitter().getHandlerCount()).toBe(1);

      // Close engine
      await engine.close();

      // Verify listeners removed
      expect(engine.getEventEmitter().getHandlerCount()).toBe(0);
    });
  });

  describe('Concurrency Queue Backpressure', () => {
    it('should throw error when queue is full', async () => {
      const limiter = new ConcurrencyLimiter({
        max: 1,
        maxQueueSize: 2, // Only allow 2 queued requests
        actionOnExceed: 'queue',
        queueTimeout: 5000
      });

      // Acquire the only slot
      const release1 = await limiter.acquire();

      // Queue 2 requests (fills queue)
      const promise2 = limiter.acquire();
      const promise3 = limiter.acquire();

      // 4th request should fail (queue full)
      await expect(limiter.acquire()).rejects.toThrow('Queue full: 2 requests already queued');

      // Cleanup
      release1();
      await promise2.then(r => r());
      await promise3.then(r => r());
    });

    it('should use default maxQueueSize of 1000', async () => {
      const limiter = new ConcurrencyLimiter({
        max: 1,
        actionOnExceed: 'queue'
      });

      // Acquire the only slot
      const release1 = await limiter.acquire();

      // Should be able to queue up to 1000 requests
      const promises = [];
      for (let i = 0; i < 1000; i++) {
        promises.push(limiter.acquire());
      }

      // 1001st request should fail
      await expect(limiter.acquire()).rejects.toThrow('Queue full: 1000 requests already queued');

      // Cleanup
      release1();
      for (const p of promises) {
        await p.then(r => r());
      }
    });
  });

  describe('Cost Tracking Atomicity', () => {
    let store: MemoryStore;

    beforeEach(() => {
      store = new MemoryStore();
    });

    afterEach(async () => {
      await store.close();
    });

    it('should not increment cost when cap is exceeded', async () => {
      const key = 'user:endpoint:cost';
      const cap = 100;
      const windowSeconds = 3600;

      // First request: 60 cost (allowed)
      const result1 = await store.incrementCost(key, 60, windowSeconds, cap);
      expect(result1.allowed).toBe(true);
      expect(result1.current).toBe(60);

      // Second request: 50 cost (would exceed cap - should NOT increment)
      const result2 = await store.incrementCost(key, 50, windowSeconds, cap);
      expect(result2.allowed).toBe(false);
      expect(result2.current).toBe(60); // Should still be 60, not 110

      // Third request: 30 cost (should be allowed)
      const result3 = await store.incrementCost(key, 30, windowSeconds, cap);
      expect(result3.allowed).toBe(true);
      expect(result3.current).toBe(90); // 60 + 30
    });

    it('should handle concurrent cost increments atomically', async () => {
      const key = 'user:endpoint:cost';
      const cap = 100;
      const windowSeconds = 3600;

      // Simulate concurrent requests
      const results = await Promise.all([
        store.incrementCost(key, 30, windowSeconds, cap),
        store.incrementCost(key, 40, windowSeconds, cap),
        store.incrementCost(key, 50, windowSeconds, cap),
      ]);

      // Only some should succeed
      const allowed = results.filter(r => r.allowed);
      const blocked = results.filter(r => !r.allowed);

      // At least one should be blocked (would exceed cap)
      expect(blocked.length).toBeGreaterThan(0);

      // Final cost should never exceed cap
      const finalResult = await store.incrementCost(key, 0, windowSeconds, cap);
      expect(finalResult.current).toBeLessThanOrEqual(cap);
    });
  });

  describe('MemoryStore Production Detection', () => {
    it('should detect Railway production environment', () => {
      const originalEnv = process.env.RAILWAY_ENVIRONMENT;
      process.env.RAILWAY_ENVIRONMENT = 'production';

      expect(() => new MemoryStore()).toThrow('MemoryStore detected in production');

      process.env.RAILWAY_ENVIRONMENT = originalEnv;
    });

    it('should detect Vercel production environment', () => {
      const originalEnv = process.env.VERCEL_ENV;
      process.env.VERCEL_ENV = 'production';

      expect(() => new MemoryStore()).toThrow('MemoryStore detected in production');

      process.env.VERCEL_ENV = originalEnv;
    });

    it('should detect Fly.io production environment', () => {
      const originalEnv = process.env.FLY_APP_NAME;
      process.env.FLY_APP_NAME = 'my-app';

      expect(() => new MemoryStore()).toThrow('MemoryStore detected in production');

      delete process.env.FLY_APP_NAME;
      if (originalEnv) process.env.FLY_APP_NAME = originalEnv;
    });

    it('should detect Render production environment', () => {
      const originalEnv = process.env.RENDER;
      process.env.RENDER = 'true';

      expect(() => new MemoryStore()).toThrow('MemoryStore detected in production');

      delete process.env.RENDER;
      if (originalEnv) process.env.RENDER = originalEnv;
    });

    it('should allow bypass with allowProduction flag', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      expect(() => new MemoryStore({ allowProduction: true })).not.toThrow();

      process.env.NODE_ENV = originalEnv;
    });
  });
});
