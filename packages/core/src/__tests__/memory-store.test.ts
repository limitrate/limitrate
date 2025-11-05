import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../stores/memory';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  describe('checkRate', () => {
    it('should allow requests within limit', async () => {
      const result = await store.checkRate('user:test', 10, 60);

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
      expect(result.remaining).toBe(9);
      expect(result.resetInSeconds).toBeGreaterThan(0);
    });

    it('should block requests when limit exceeded', async () => {
      // Send 10 requests (at limit)
      for (let i = 0; i < 10; i++) {
        await store.checkRate('user:test', 10, 60);
      }

      // 11th request should be blocked
      const result = await store.checkRate('user:test', 10, 60);

      expect(result.allowed).toBe(false);
      expect(result.current).toBe(10);
      expect(result.remaining).toBe(0);
    });

    it('should reset after window expires', async () => {
      // Send 10 requests (at limit)
      for (let i = 0; i < 10; i++) {
        await store.checkRate('user:test', 10, 1); // 1 second window
      }

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should allow again
      const result = await store.checkRate('user:test', 10, 1);

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

    it('should handle different endpoints independently', async () => {
      await store.checkRate('user:test:GET|/api/data', 10, 60);
      await store.checkRate('user:test:POST|/api/data', 10, 60);

      const getResult = await store.checkRate('user:test:GET|/api/data', 10, 60);
      const postResult = await store.checkRate('user:test:POST|/api/data', 10, 60);

      expect(getResult.current).toBe(2);
      expect(postResult.current).toBe(2);
    });
  });

  describe('incrementCost', () => {
    it('should track cost and allow within cap', async () => {
      const result = await store.incrementCost('user:test:cost', 0.01, 3600, 0.10);

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(0.01);
      expect(result.remaining).toBeCloseTo(0.09, 2);
      expect(result.cap).toBe(0.10);
    });

    it('should block when cost cap exceeded', async () => {
      // Add costs up to cap
      await store.incrementCost('user:test:cost', 0.05, 3600, 0.10);
      await store.incrementCost('user:test:cost', 0.04, 3600, 0.10);

      // This should exceed cap
      const result = await store.incrementCost('user:test:cost', 0.02, 3600, 0.10);

      expect(result.allowed).toBe(false);
      expect(result.current).toBeCloseTo(0.09, 2);
      expect(result.remaining).toBeCloseTo(0.01, 2);
    });

    it('should reset cost after window expires', async () => {
      await store.incrementCost('user:test:cost', 0.09, 1, 0.10); // 1 second window

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const result = await store.incrementCost('user:test:cost', 0.05, 1, 0.10);

      expect(result.allowed).toBe(true);
      expect(result.current).toBeCloseTo(0.05, 2);
    });

    it('should handle multiple users independently', async () => {
      await store.incrementCost('user:alice:cost', 0.05, 3600, 0.10);
      await store.incrementCost('user:bob:cost', 0.08, 3600, 0.10);

      const aliceResult = await store.incrementCost('user:alice:cost', 0.03, 3600, 0.10);
      const bobResult = await store.incrementCost('user:bob:cost', 0.01, 3600, 0.10);

      expect(aliceResult.current).toBeCloseTo(0.08, 2);
      expect(bobResult.current).toBeCloseTo(0.09, 2);
    });
  });

  describe('ping', () => {
    it('should always return true for memory store', async () => {
      const result = await store.ping();
      expect(result).toBe(true);
    });
  });

  describe('close', () => {
    it('should clear cache on close', async () => {
      await store.checkRate('user:test', 10, 60);

      await store.close();

      const result = await store.checkRate('user:test', 10, 60);
      expect(result.current).toBe(1); // Should start fresh after close
    });
  });
});
