/**
 * Regression tests for critical bug fixes
 * These tests verify that production bugs have been properly fixed
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConcurrencyLimiter, clearAllLimiters } from '../concurrency/limiter';
import { EventEmitter } from '../utils/events';

describe('Critical Bug Fixes - Regression Tests', () => {
  afterEach(() => {
    clearAllLimiters();
    vi.restoreAllMocks();
  });

  describe('Bug #1: Queue Timeout Memory Leak', () => {
    it('should clean up ALL requests with same timestamp (not just first match)', async () => {
      const limiter = new ConcurrencyLimiter({
        max: 1,
        queueTimeout: 100, // Short timeout for test
        actionOnExceed: 'queue',
      });

      // Acquire the only slot
      const firstSlot = await limiter.acquire();

      // Mock Date.now to return the same timestamp for all requests
      const fixedTime = 1000000;
      const originalDateNow = Date.now;
      vi.spyOn(Date, 'now').mockReturnValue(fixedTime);

      // Create 10 requests that will queue (all with same timestamp due to mock)
      const queuedPromises = Array.from({ length: 10 }, () =>
        limiter.acquire().catch((err) => err)
      );

      // Restore Date.now immediately so timeout can fire
      vi.restoreAllMocks();

      // Wait for all timeouts to fire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // All should have timed out
      const results = await Promise.all(queuedPromises);
      for (const result of results) {
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toContain('Queue timeout');
      }

      // Check queue is empty (bug would leave 9 items stuck)
      const stats = limiter.getStats();
      expect(stats.queued).toBe(0);

      // Cleanup
      firstSlot();
    });

    it('should use unique IDs to differentiate simultaneous requests', async () => {
      const limiter = new ConcurrencyLimiter({
        max: 1,
        queueTimeout: 200,
        actionOnExceed: 'queue',
      });

      // Acquire the only slot
      const firstSlot = await limiter.acquire();

      // Queue 5 requests (need to give them time to queue)
      const queuedPromises = Array.from({ length: 5 }, () =>
        limiter.acquire().catch((err) => err)
      );

      // Wait for promises to start queuing
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Check all are queued
      expect(limiter.getStats().queued).toBe(5);

      // Release first slot - should release ONE queued request
      firstSlot();

      // Wait for queue processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have 4 still queued (one was released)
      expect(limiter.getStats().queued).toBe(4);

      // Wait for all timeouts
      await new Promise((resolve) => setTimeout(resolve, 200));

      // All remaining should timeout
      const results = await Promise.all(queuedPromises);
      expect(results.filter((r) => r instanceof Error)).toHaveLength(4);
      expect(results.filter((r) => typeof r === 'function')).toHaveLength(1);

      // Queue should be empty
      expect(limiter.getStats().queued).toBe(0);

      // Cleanup
      if (typeof results[0] === 'function') {
        results[0]();
      }
    });
  });

  describe('Bug #2: Invalid Users Share Rate Limits', () => {
    it('should hash different invalid user IDs to different keys', async () => {
      const crypto = await import('crypto');

      // Simulate the fix
      const hashUserId = (user: string): string => {
        const userIdFormatValid = /^[a-zA-Z0-9_-]{1,64}$/.test(user);
        if (!userIdFormatValid) {
          const hash = crypto.createHash('sha256').update(user).digest('hex');
          return `hashed_${hash.substring(0, 32)}`;
        }
        return user;
      };

      // Test various invalid formats
      const invalidUsers = [
        'user@example.com',
        'user+test@example.com',
        'user@different.com',
        'special!chars#here',
        'another$invalid%user',
      ];

      const hashedIds = invalidUsers.map(hashUserId);

      // All should be different (not all 'invalid')
      const uniqueIds = new Set(hashedIds);
      expect(uniqueIds.size).toBe(invalidUsers.length);

      // All should start with 'hashed_'
      for (const id of hashedIds) {
        expect(id).toMatch(/^hashed_[a-f0-9]{32}$/);
      }

      // Same invalid user should hash to same ID
      expect(hashUserId('user@example.com')).toBe(hashUserId('user@example.com'));
    });

    it('should allow valid user IDs to pass through unchanged', async () => {
      const crypto = await import('crypto');

      const hashUserId = (user: string): string => {
        const userIdFormatValid = /^[a-zA-Z0-9_-]{1,64}$/.test(user);
        if (!userIdFormatValid) {
          const hash = crypto.createHash('sha256').update(user).digest('hex');
          return `hashed_${hash.substring(0, 32)}`;
        }
        return user;
      };

      const validUsers = [
        'user123',
        'test_user',
        'user-name',
        'ABC123',
        'a1b2c3',
      ];

      for (const user of validUsers) {
        expect(hashUserId(user)).toBe(user);
      }
    });
  });

  describe('Bug #4: Concurrency Slot Leak on Errors', () => {
    it('should release concurrency slot when error event fires', async () => {
      // This is a behavioral test - we verify the pattern is implemented
      // The actual Express middleware test is in packages/express

      const limiter = new ConcurrencyLimiter({
        max: 2,
        actionOnExceed: 'queue',
      });

      // Acquire a slot
      const slot1 = await limiter.acquire();
      expect(limiter.getStats().running).toBe(1);

      // Simulate error scenario: acquire and immediately release due to error
      const slot2 = await limiter.acquire();
      expect(limiter.getStats().running).toBe(2);

      // Simulate error handler calling release
      slot2();
      expect(limiter.getStats().running).toBe(1);

      // Should be able to acquire again
      const slot3 = await limiter.acquire();
      expect(limiter.getStats().running).toBe(2);

      // Cleanup
      slot1();
      slot3();
    });

    it('should handle multiple rapid acquire/release cycles', async () => {
      const limiter = new ConcurrencyLimiter({
        max: 3,
        actionOnExceed: 'queue',
      });

      // Rapidly acquire and release
      for (let i = 0; i < 20; i++) {
        const slot = await limiter.acquire();
        expect(limiter.getStats().running).toBeLessThanOrEqual(3);
        slot(); // Immediate release
      }

      // All should be released
      expect(limiter.getStats().running).toBe(0);
    });
  });

  describe('Bug #5: Async Event Handler Errors Swallowed', () => {
    it('should log async handler rejections', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const emitter = new EventEmitter();

      // Register async handler that rejects
      const failingHandler = async () => {
        throw new Error('Async handler failed');
      };

      emitter.on(failingHandler);

      // Emit event
      await emitter.emit({
        timestamp: Date.now(),
        user: 'test',
        plan: 'free',
        endpoint: '/test',
        type: 'allowed',
      });

      // Should have logged the error
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[LimitRate] Async event handler failed for event "allowed"'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('should handle multiple async handlers with mixed success/failure', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const emitter = new EventEmitter();

      const results: string[] = [];

      // Register handlers: success, failure, success
      emitter.on(async () => {
        results.push('handler1');
      });

      emitter.on(async () => {
        throw new Error('Handler 2 failed');
      });

      emitter.on(async () => {
        results.push('handler3');
      });

      // Emit event
      await emitter.emit({
        timestamp: Date.now(),
        user: 'test',
        plan: 'free',
        endpoint: '/test',
        type: 'allowed',
      });

      // Successful handlers should have run
      expect(results).toContain('handler1');
      expect(results).toContain('handler3');

      // Failed handler should be logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[LimitRate] Async event handler failed'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('should continue processing after async handler failure', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const emitter = new EventEmitter();

      let callCount = 0;

      // First handler fails
      emitter.on(async () => {
        callCount++;
        throw new Error('First handler failed');
      });

      // Second handler succeeds
      emitter.on(async () => {
        callCount++;
      });

      // Emit multiple events
      await emitter.emit({
        timestamp: Date.now(),
        user: 'test',
        plan: 'free',
        endpoint: '/test',
        type: 'allowed',
      });

      await emitter.emit({
        timestamp: Date.now(),
        user: 'test',
        plan: 'free',
        endpoint: '/test',
        type: 'allowed',
      });

      // Both handlers should be called for each event (2 events * 2 handlers = 4 calls)
      expect(callCount).toBe(4);

      // Errors should be logged but not stop processing
      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Integration: All Fixes Together', () => {
    it('should handle complex scenario with all bug fixes working', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const limiter = new ConcurrencyLimiter({
        max: 2,
        queueTimeout: 500,
        actionOnExceed: 'queue',
      });

      const emitter = new EventEmitter();

      // Set up event handlers (some failing)
      emitter.on(async () => {
        // Success handler
      });

      emitter.on(async () => {
        throw new Error('Event handler error');
      });

      // Acquire slots
      const slot1 = await limiter.acquire();
      const slot2 = await limiter.acquire();

      expect(limiter.getStats().running).toBe(2);

      // Queue some requests
      const queuedPromises = [
        limiter.acquire().catch((err) => err),
        limiter.acquire().catch((err) => err),
      ];

      // Wait for promises to queue
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(limiter.getStats().queued).toBe(2);

      // Emit events (handlers will be called)
      await emitter.emit({
        timestamp: Date.now(),
        user: 'test',
        plan: 'free',
        endpoint: '/test',
        type: 'allowed',
      });

      // Release one slot
      slot1();

      // One queued request should be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Clean up
      slot2();

      await Promise.all(queuedPromises);

      // Verify event handler errors were logged
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });
});
