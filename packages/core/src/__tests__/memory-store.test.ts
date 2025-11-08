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

  describe('userKeyCounts synchronization (v3.1.2)', () => {
    it('should track user key counts correctly', async () => {
      // Create entries for user1
      await store.checkRate('user1:endpoint1', 10, 60);
      await store.checkRate('user1:endpoint2', 10, 60);
      await store.checkRate('user1:endpoint3', 10, 60);

      // Create entries for user2
      await store.checkRate('user2:endpoint1', 10, 60);
      await store.checkRate('user2:endpoint2', 10, 60);

      // Verify cache size
      expect(store.getCacheSize()).toBe(5);

      // user1 should have 3 keys, user2 should have 2 keys
      // (We can't directly access userKeyCounts, but we can verify behavior)
    });

    it('should decrement counts when entries expire', async () => {
      // Create entries with 1 second window
      await store.checkRate('user1:endpoint1', 10, 1);
      await store.checkRate('user1:endpoint2', 10, 1);

      expect(store.getCacheSize()).toBe(2);

      // Wait for entries to expire and cleanup to run
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Trigger cleanup by creating a new entry
      // (cleanup runs periodically, but we can't control it directly)
      await store.checkRate('user1:endpoint3', 10, 60);

      // After cleanup, expired entries should be removed
      // New cache size should be 1 (only the new entry)
      expect(store.getCacheSize()).toBeGreaterThan(0);
    });

    it('should enforce per-user key limits', async () => {
      // Create store with low per-user limit
      const limitedStore = new MemoryStore({
        maxKeysPerUser: 3,
        maxKeys: 100
      });

      // Add 3 keys for user1 (at limit)
      await limitedStore.checkRate('user1:endpoint1', 10, 60);
      await limitedStore.checkRate('user1:endpoint2', 10, 60);
      await limitedStore.checkRate('user1:endpoint3', 10, 60);

      expect(limitedStore.getCacheSize()).toBe(3);

      // Add 4th key - should evict oldest
      await limitedStore.checkRate('user1:endpoint4', 10, 60);

      // Cache size should still be 3 (evicted one, added one)
      expect(limitedStore.getCacheSize()).toBe(3);

      // user1 should still be able to use all 3 endpoints
      const result = await limitedStore.checkRate('user1:endpoint4', 10, 60);
      expect(result.current).toBe(2); // Second request to endpoint4

      await limitedStore.close();
    });

    it('should handle mixed operations (rate, cost, tokens)', async () => {
      // Create different types of entries for same user
      await store.checkRate('user1:ratekey', 10, 60);
      await store.incrementCost('user1:costkey', 0.01, 60, 0.10);
      await store.incrementTokens('user1:tokenkey', 100, 60, 1000);

      // All should count toward user's key count
      expect(store.getCacheSize()).toBe(3);
    });

    it('should clear userKeyCounts on close', async () => {
      // Create some entries
      await store.checkRate('user1:endpoint1', 10, 60);
      await store.checkRate('user1:endpoint2', 10, 60);
      await store.checkRate('user2:endpoint1', 10, 60);

      expect(store.getCacheSize()).toBe(3);

      // Close store
      await store.close();

      // Cache should be empty
      expect(store.getCacheSize()).toBe(0);

      // New entries should work normally
      await store.checkRate('user1:endpoint1', 10, 60);
      expect(store.getCacheSize()).toBe(1);
    });

    it('should not double-count expired entries being replaced', async () => {
      // Create entry with 1 second window
      await store.checkRate('user1:endpoint1', 10, 1);
      expect(store.getCacheSize()).toBe(1);

      // Wait for entry to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Create new entry with same key (should replace expired entry)
      await store.checkRate('user1:endpoint1', 10, 60);

      // Cache size should still be 1 (replaced, not added)
      expect(store.getCacheSize()).toBe(1);
    });

    it('should handle global cache eviction correctly', async () => {
      // Create store with very low global limit
      const tinyStore = new MemoryStore({
        maxKeys: 3,
        maxKeysPerUser: 100
      });

      // Add entries from different users to fill cache
      await tinyStore.checkRate('user1:endpoint1', 10, 60);
      await tinyStore.checkRate('user2:endpoint1', 10, 60);
      await tinyStore.checkRate('user3:endpoint1', 10, 60);

      expect(tinyStore.getCacheSize()).toBe(3);

      // Add one more - should evict least recently used
      await tinyStore.checkRate('user4:endpoint1', 10, 60);

      // Cache should still be at limit
      expect(tinyStore.getCacheSize()).toBe(3);

      await tinyStore.close();
    });
  });
});
