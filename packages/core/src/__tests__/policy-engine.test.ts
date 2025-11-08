import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyEngine } from '../engine';
import { MemoryStore } from '../stores/memory';
import type { PolicyConfig } from '../types';

describe('PolicyEngine', () => {
  let store: MemoryStore;
  let policies: PolicyConfig;

  beforeEach(() => {
    store = new MemoryStore();

    policies = {
      free: {
        endpoints: {
          'POST|/api/ask': {
            rate: {
              maxPerMinute: 10,
              actionOnExceed: 'block',
            },
          },
        },
        defaults: {
          rate: {
            maxPerMinute: 60,
            actionOnExceed: 'block',
          },
        },
      },
      pro: {
        endpoints: {
          'POST|/api/ask': {
            rate: {
              maxPerMinute: 100,
              actionOnExceed: 'slowdown',
              slowdownMs: 500,
            },
          },
        },
        defaults: {
          rate: {
            maxPerMinute: 300,
            actionOnExceed: 'allow-and-log',
          },
        },
      },
    };
  });

  describe('Rate Limiting', () => {
    it('should allow requests within limit', async () => {
      const engine = new PolicyEngine(store, policies);

      const result = await engine.check({
        user: 'user-123',
        plan: 'free',
        endpoint: 'POST|/api/ask',
        ip: '1.2.3.4',
      });

      expect(result.allowed).toBe(true);
      expect(result.action).toBe('allow');
    });

    it('should block requests when limit exceeded', async () => {
      const engine = new PolicyEngine(store, policies);

      // Send 10 requests (at limit)
      for (let i = 0; i < 10; i++) {
        await engine.check({
          user: 'user-123',
          plan: 'free',
          endpoint: 'POST|/api/ask',
          ip: '1.2.3.4',
        });
      }

      // 11th request should be blocked
      const result = await engine.check({
        user: 'user-123',
        plan: 'free',
        endpoint: 'POST|/api/ask',
        ip: '1.2.3.4',
      });

      expect(result.allowed).toBe(false);
      expect(result.action).toBe('block');
      expect(result.reason).toBe('rate_exceeded');
    });

    it('should apply slowdown action for pro tier - Fix #1: Now preserves details', async () => {
      const engine = new PolicyEngine(store, policies);

      // Send 100 requests (at limit)
      for (let i = 0; i < 100; i++) {
        await engine.check({
          user: 'pro-user',
          plan: 'pro',
          endpoint: 'POST|/api/ask',
        });
      }

      // 101st request should trigger slowdown
      const result = await engine.check({
        user: 'pro-user',
        plan: 'pro',
        endpoint: 'POST|/api/ask',
      });

      // Slowdown allows request but with delay
      expect(result.allowed).toBe(true);
      expect(result.action).toBe('slowdown');
      expect(result.slowdownMs).toBe(500);
      // Fix #1: Details should be preserved from rate check
      expect(result.details).toBeDefined();
      expect(result.details.limit).toBe(100);
      expect(result.details.used).toBeGreaterThan(0);
    });

    it('should apply default policy when endpoint not specified', async () => {
      const engine = new PolicyEngine(store, policies);

      // Send 60 requests (at default limit)
      for (let i = 0; i < 60; i++) {
        await engine.check({
          user: 'user-123',
          plan: 'free',
          endpoint: 'GET|/api/data',
          ip: '1.2.3.4',
        });
      }

      // 61st request should be blocked
      const result = await engine.check({
        user: 'user-123',
        plan: 'free',
        endpoint: 'GET|/api/data',
        ip: '1.2.3.4',
      });

      expect(result.allowed).toBe(false);
      expect(result.action).toBe('block');
    });

    it('should handle different users independently', async () => {
      const engine = new PolicyEngine(store, policies);

      // User 1 sends 10 requests
      for (let i = 0; i < 10; i++) {
        await engine.check({
          user: 'user-1',
          plan: 'free',
          endpoint: 'POST|/api/ask',
          ip: '1.2.3.4',
        });
      }

      // User 2 should still be able to make requests
      const result = await engine.check({
        user: 'user-2',
        plan: 'free',
        endpoint: 'POST|/api/ask',
        ip: '5.6.7.8',
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('Cost Tracking', () => {
    it('should allow requests within cost cap', async () => {
      const policiesWithCost: PolicyConfig = {
        free: {
          endpoints: {
            'POST|/api/ask': {
              cost: {
                estimateCost: () => 0.01,
                hourlyCap: 0.10,
                actionOnExceed: 'block',
              },
            },
          },
          defaults: {},
        },
      };

      const engine = new PolicyEngine(store, policiesWithCost);

      const result = await engine.check({
        user: 'user-123',
        plan: 'free',
        endpoint: 'POST|/api/ask',
        ip: '1.2.3.4',
        costContext: { prompt: 'test' },
      });

      expect(result.allowed).toBe(true);
      expect(result.action).toBe('allow');
    });

    it('should block when cost cap exceeded', async () => {
      const policiesWithCost: PolicyConfig = {
        free: {
          endpoints: {
            'POST|/api/ask': {
              cost: {
                estimateCost: () => 0.05,
                hourlyCap: 0.10,
                actionOnExceed: 'block',
              },
            },
          },
          defaults: {},
        },
      };

      const engine = new PolicyEngine(store, policiesWithCost);

      // Send 2 requests ($0.10 total)
      await engine.check({
        user: 'user-123',
        plan: 'free',
        endpoint: 'POST|/api/ask',
        ip: '1.2.3.4',
        costContext: {},
      });

      await engine.check({
        user: 'user-123',
        plan: 'free',
        endpoint: 'POST|/api/ask',
        ip: '1.2.3.4',
        costContext: {},
      });

      // 3rd request should exceed cap
      const result = await engine.check({
        user: 'user-123',
        plan: 'free',
        endpoint: 'POST|/api/ask',
        ip: '1.2.3.4',
        costContext: {},
      });

      expect(result.allowed).toBe(false);
      expect(result.action).toBe('block');
      expect(result.reason).toBe('cost_exceeded');
    });

    it('should use custom estimateCost function', async () => {
      let costCallCount = 0;

      const policiesWithCost: PolicyConfig = {
        free: {
          endpoints: {
            'POST|/api/ask': {
              cost: {
                estimateCost: (context: any) => {
                  costCallCount++;
                  const tokens = Math.ceil((context.prompt?.length || 0) / 4);
                  return tokens * 0.000001;
                },
                hourlyCap: 0.10,
                actionOnExceed: 'block',
              },
            },
          },
          defaults: {},
        },
      };

      const engine = new PolicyEngine(store, policiesWithCost);

      await engine.check({
        user: 'user-123',
        plan: 'free',
        endpoint: 'POST|/api/ask',
        ip: '1.2.3.4',
        costContext: { prompt: 'A'.repeat(1000) },
      });

      expect(costCallCount).toBe(1);
    });
  });

  describe('Event Emission', () => {
    it('should emit rate_exceeded event', async () => {
      const engine = new PolicyEngine(store, policies);
      let emittedEvent: any = null;

      engine.onEvent((event) => {
        if (event.type === 'rate_exceeded') {
          emittedEvent = event;
        }
      });

      // Send 10 requests (at limit)
      for (let i = 0; i < 10; i++) {
        await engine.check({
          user: 'user-123',
          plan: 'free',
          endpoint: 'POST|/api/ask',
          ip: '1.2.3.4',
        });
      }

      // 11th request should emit event
      await engine.check({
        user: 'user-123',
        plan: 'free',
        endpoint: 'POST|/api/ask',
        ip: '1.2.3.4',
      });

      expect(emittedEvent).not.toBeNull();
      expect(emittedEvent.type).toBe('rate_exceeded');
      expect(emittedEvent.user).toBe('user-123');
      expect(emittedEvent.plan).toBe('free');
    });

    it('should emit allowed event for successful requests', async () => {
      const engine = new PolicyEngine(store, policies);
      let emittedEvent: any = null;

      engine.onEvent((event) => {
        if (event.type === 'allowed') {
          emittedEvent = event;
        }
      });

      await engine.check({
        user: 'user-123',
        plan: 'free',
        endpoint: 'POST|/api/ask',
        ip: '1.2.3.4',
      });

      expect(emittedEvent).not.toBeNull();
      expect(emittedEvent.type).toBe('allowed');
    });
  });
});
