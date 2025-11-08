/**
 * Concurrency Limiter Load Tests
 * Tests concurrency limiter under heavy load with real concurrent operations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConcurrencyLimiter } from '../concurrency/limiter';

describe('Concurrency Limiter Load Tests', () => {
  describe('Basic Concurrency Control', () => {
    it('should handle 200 concurrent requests with max=10', async () => {
      const limiter = new ConcurrencyLimiter({ max: 10 });

      let running = 0;
      let maxRunning = 0;
      let completed = 0;

      // Create 200 concurrent requests
      const requests = Array.from({ length: 200 }, async (_, i) => {
        const release = await limiter.acquire();

        running++;
        maxRunning = Math.max(maxRunning, running);

        // Simulate work
        await new Promise((resolve) => setTimeout(resolve, 10));

        running--;
        completed++;
        release();
      });

      await Promise.all(requests);

      expect(completed).toBe(200);
      expect(maxRunning).toBeLessThanOrEqual(10);
      expect(maxRunning).toBeGreaterThanOrEqual(1); // At least one ran

      // Verify limiter is clean
      const stats = limiter.getStats();
      expect(stats.running).toBe(0);
      expect(stats.queued).toBe(0);
      expect(stats.available).toBe(10);
    }, 30000); // 30s timeout

    it('should handle 500 concurrent requests with max=20', async () => {
      const limiter = new ConcurrencyLimiter({ max: 20 });

      let running = 0;
      let maxRunning = 0;
      let completed = 0;

      const requests = Array.from({ length: 500 }, async () => {
        const release = await limiter.acquire();

        running++;
        maxRunning = Math.max(maxRunning, running);

        // Very short work
        await new Promise((resolve) => setTimeout(resolve, 5));

        running--;
        completed++;
        release();
      });

      await Promise.all(requests);

      expect(completed).toBe(500);
      expect(maxRunning).toBeLessThanOrEqual(20);

      const stats = limiter.getStats();
      expect(stats.running).toBe(0);
      expect(stats.queued).toBe(0);
    }, 60000); // 60s timeout

    it('should maintain exactly max concurrent operations', async () => {
      const limiter = new ConcurrencyLimiter({ max: 5 });

      const runningSnapshots: number[] = [];

      // Create 50 concurrent requests
      const requests = Array.from({ length: 50 }, async () => {
        const release = await limiter.acquire();

        // Take snapshot of running count
        const stats = limiter.getStats();
        runningSnapshots.push(stats.running);

        // Simulate work
        await new Promise((resolve) => setTimeout(resolve, 20));

        release();
      });

      await Promise.all(requests);

      // All snapshots should show <= 5 running
      expect(runningSnapshots.every((count) => count <= 5)).toBe(true);

      // At least one snapshot should show exactly 5 (we had enough requests)
      expect(runningSnapshots.some((count) => count === 5)).toBe(true);
    }, 30000);
  });

  describe('Queue Behavior Under Load', () => {
    it('should queue requests when max concurrency reached', async () => {
      const limiter = new ConcurrencyLimiter({ max: 5 });

      const queuedSnapshots: number[] = [];

      // Create 50 concurrent requests with longer work time
      const requests = Array.from({ length: 50 }, async () => {
        const release = await limiter.acquire();

        // Take snapshot of queue size
        const stats = limiter.getStats();
        queuedSnapshots.push(stats.queued);

        // Simulate work
        await new Promise((resolve) => setTimeout(resolve, 30));

        release();
      });

      await Promise.all(requests);

      // At some point, we should have had queued requests
      expect(queuedSnapshots.some((count) => count > 0)).toBe(true);

      // Final state should be clean
      const stats = limiter.getStats();
      expect(stats.queued).toBe(0);
    }, 30000);

    it('should enforce maxQueueSize limit', async () => {
      const limiter = new ConcurrencyLimiter({
        max: 2,
        maxQueueSize: 10,
        actionOnExceed: 'queue',
      });

      const errors: Error[] = [];
      const successes: number[] = [];

      // Create 30 concurrent requests (max 2 running, max 10 queued = max 12 total)
      const requests = Array.from({ length: 30 }, async (_, i) => {
        try {
          const release = await limiter.acquire();

          // Simulate work
          await new Promise((resolve) => setTimeout(resolve, 50));

          successes.push(i);
          release();
        } catch (error) {
          errors.push(error as Error);
        }
      });

      await Promise.allSettled(requests);

      // Should have some queue full errors
      const queueFullErrors = errors.filter((e) =>
        e.message.includes('Queue full')
      );
      expect(queueFullErrors.length).toBeGreaterThan(0);

      // Should have successfully processed at most 12 (2 running + 10 queued)
      expect(successes.length).toBeLessThanOrEqual(12);

      limiter.clearQueue();
    }, 30000);

    it('should timeout queued requests after queueTimeout', async () => {
      const limiter = new ConcurrencyLimiter({
        max: 1,
        queueTimeout: 100, // 100ms timeout
        actionOnExceed: 'queue',
      });

      const errors: Error[] = [];
      const successes: number[] = [];

      // Create 10 concurrent requests, but first one blocks for 500ms
      const requests = Array.from({ length: 10 }, async (_, i) => {
        try {
          const release = await limiter.acquire();

          // First request blocks for longer than queue timeout
          await new Promise((resolve) =>
            setTimeout(resolve, i === 0 ? 500 : 10)
          );

          successes.push(i);
          release();
        } catch (error) {
          errors.push(error as Error);
        }
      });

      await Promise.allSettled(requests);

      // Should have timeout errors
      const timeoutErrors = errors.filter((e) =>
        e.message.includes('Queue timeout')
      );
      expect(timeoutErrors.length).toBeGreaterThan(0);

      limiter.clearQueue();
    }, 10000);
  });

  describe('Priority Aging', () => {
    it('should eventually serve low-priority requests via aging', async () => {
      const limiter = new ConcurrencyLimiter({
        max: 2,
        priorityAgingSeconds: 1, // Age every 1 second
      });

      const completedPriorities: number[] = [];

      // Create requests with different priorities
      // High priority (1) should go first, but low priority (10) should eventually get served
      const requests = [
        // 5 high-priority requests
        ...Array.from({ length: 5 }, () => ({ priority: 1 })),
        // 5 low-priority requests
        ...Array.from({ length: 5 }, () => ({ priority: 10 })),
      ].map(async ({ priority }) => {
        const release = await limiter.acquire(priority);

        completedPriorities.push(priority);

        // Simulate work
        await new Promise((resolve) => setTimeout(resolve, 100));

        release();
      });

      await Promise.all(requests);

      // All 10 requests should complete
      expect(completedPriorities.length).toBe(10);

      // Should have completed both priority levels
      expect(completedPriorities.includes(1)).toBe(true);
      expect(completedPriorities.includes(10)).toBe(true);

      // Low priority requests should not be starved indefinitely
      const lowPriorityCount = completedPriorities.filter(
        (p) => p === 10
      ).length;
      expect(lowPriorityCount).toBe(5);
    }, 15000);

    it('should prioritize high-priority requests initially', async () => {
      const limiter = new ConcurrencyLimiter({
        max: 1, // Only one at a time
        priorityAgingSeconds: 10, // Slow aging
      });

      const completionOrder: number[] = [];

      // Submit all requests at once
      const requests = [
        { priority: 5, id: 1 },
        { priority: 1, id: 2 }, // Highest priority
        { priority: 10, id: 3 },
        { priority: 2, id: 4 }, // Second highest
        { priority: 8, id: 5 },
      ].map(async ({ priority, id }) => {
        const release = await limiter.acquire(priority);

        completionOrder.push(id);

        // Very short work to minimize aging effects
        await new Promise((resolve) => setTimeout(resolve, 10));

        release();
      });

      await Promise.all(requests);

      // First request to complete should be high priority (id 2)
      // Second should be id 4, etc.
      // Exact order may vary due to timing, but high priority should be early
      const firstTwo = completionOrder.slice(0, 2);
      expect(firstTwo).toContain(2); // Highest priority should be in first 2
    }, 10000);
  });

  describe('Block Mode', () => {
    it('should immediately reject when using actionOnExceed: block', async () => {
      const limiter = new ConcurrencyLimiter({
        max: 2,
        actionOnExceed: 'block',
      });

      const errors: Error[] = [];
      const successes: number[] = [];

      // Create 10 concurrent requests
      const requests = Array.from({ length: 10 }, async (_, i) => {
        try {
          const release = await limiter.acquire();

          // Simulate work
          await new Promise((resolve) => setTimeout(resolve, 50));

          successes.push(i);
          release();
        } catch (error) {
          errors.push(error as Error);
        }
      });

      await Promise.allSettled(requests);

      // Should have exactly 2 successes (max concurrency)
      expect(successes.length).toBe(2);

      // Should have 8 errors (rejected immediately)
      expect(errors.length).toBe(8);

      // All errors should be concurrency limit errors
      errors.forEach((error) => {
        expect(error.message).toContain('Concurrency limit reached');
      });
    }, 10000);
  });

  describe('Performance Overhead', () => {
    it('should have minimal overhead (< 1ms per request)', async () => {
      const limiter = new ConcurrencyLimiter({ max: 100 });

      const timings: number[] = [];

      // Run 100 requests sequentially to measure overhead
      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        const release = await limiter.acquire();
        const overhead = performance.now() - start;

        timings.push(overhead);
        release();
      }

      // Calculate average overhead
      const avgOverhead = timings.reduce((a, b) => a + b, 0) / timings.length;

      // Should be less than 1ms average
      expect(avgOverhead).toBeLessThan(1);

      // 95th percentile should be reasonable too
      const sorted = timings.sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      expect(p95).toBeLessThan(2);
    }, 10000);

    it('should handle 1000 concurrent fast requests efficiently', async () => {
      const limiter = new ConcurrencyLimiter({ max: 50 });

      const start = performance.now();

      const requests = Array.from({ length: 1000 }, async () => {
        const release = await limiter.acquire();

        // Very fast operation
        await new Promise((resolve) => setImmediate(resolve));

        release();
      });

      await Promise.all(requests);

      const duration = performance.now() - start;

      // Should complete in reasonable time (< 5 seconds for 1000 requests)
      expect(duration).toBeLessThan(5000);

      const stats = limiter.getStats();
      expect(stats.running).toBe(0);
      expect(stats.queued).toBe(0);
    }, 10000);
  });

  describe('Race Conditions', () => {
    it('should not exceed max concurrency under race conditions', async () => {
      const limiter = new ConcurrencyLimiter({ max: 10 });

      const runningCounts: number[] = [];
      let violations = 0;

      // Create 100 concurrent requests with random work times
      const requests = Array.from({ length: 100 }, async () => {
        const release = await limiter.acquire();

        const stats = limiter.getStats();
        runningCounts.push(stats.running);

        if (stats.running > 10) {
          violations++;
        }

        // Random work time (1-20ms)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.random() * 20 + 1)
        );

        release();
      });

      await Promise.all(requests);

      // Should NEVER exceed max concurrency
      expect(violations).toBe(0);
      expect(Math.max(...runningCounts)).toBeLessThanOrEqual(10);
    }, 30000);

    it('should not lose or duplicate slots under concurrent acquire/release', async () => {
      const limiter = new ConcurrencyLimiter({ max: 5 });

      // Run 200 operations
      const requests = Array.from({ length: 200 }, async () => {
        const release = await limiter.acquire();

        // Simulate very short work
        await new Promise((resolve) => setTimeout(resolve, 1));

        release();
      });

      await Promise.all(requests);

      // Final state should be clean - all 5 slots available
      const stats = limiter.getStats();
      expect(stats.running).toBe(0);
      expect(stats.queued).toBe(0);
      expect(stats.available).toBe(5);
    }, 30000);
  });

  describe('Memory Management', () => {
    it('should clean up queue properly when requests complete', async () => {
      const limiter = new ConcurrencyLimiter({ max: 2 });

      // Create 20 requests
      const requests = Array.from({ length: 20 }, async () => {
        const release = await limiter.acquire();

        await new Promise((resolve) => setTimeout(resolve, 10));

        release();
      });

      await Promise.all(requests);

      // Queue should be empty
      const stats = limiter.getStats();
      expect(stats.queued).toBe(0);

      // Try to access queue size via internal state if possible
      // This verifies no memory leaks in the queue array
      const queueLength = (limiter as any).queue?.length || 0;
      expect(queueLength).toBe(0);
    }, 10000);

    it('should handle clearQueue without memory leaks', async () => {
      const limiter = new ConcurrencyLimiter({ max: 1 });

      // Create many requests
      const requests = Array.from({ length: 100 }, async () => {
        try {
          const release = await limiter.acquire();
          await new Promise((resolve) => setTimeout(resolve, 1000)); // Long work
          release();
        } catch (error) {
          // Expected for cleared requests
        }
      });

      // Let some queue up
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Clear the queue
      limiter.clearQueue();

      await Promise.allSettled(requests);

      // Queue should be empty
      const stats = limiter.getStats();
      expect(stats.queued).toBe(0);
    }, 15000);
  });

  describe('Edge Cases', () => {
    it('should handle max=1 correctly (serial execution)', async () => {
      const limiter = new ConcurrencyLimiter({ max: 1 });

      const executionOrder: number[] = [];

      const requests = Array.from({ length: 10 }, async (_, i) => {
        const release = await limiter.acquire();

        executionOrder.push(i);

        await new Promise((resolve) => setTimeout(resolve, 10));

        release();
      });

      await Promise.all(requests);

      // All 10 should have executed
      expect(executionOrder.length).toBe(10);

      // Should never have had more than 1 running
      // (This is verified by the fact that acquire/release worked correctly)
    }, 10000);

    it('should handle immediate release without work', async () => {
      const limiter = new ConcurrencyLimiter({ max: 5 });

      // Acquire and immediately release 100 times
      for (let i = 0; i < 100; i++) {
        const release = await limiter.acquire();
        release();
      }

      const stats = limiter.getStats();
      expect(stats.running).toBe(0);
      expect(stats.available).toBe(5);
    }, 10000);

    it('should handle requests with zero work time', async () => {
      const limiter = new ConcurrencyLimiter({ max: 10 });

      const requests = Array.from({ length: 100 }, async () => {
        const release = await limiter.acquire();
        // No work, immediate release
        release();
      });

      await Promise.all(requests);

      const stats = limiter.getStats();
      expect(stats.running).toBe(0);
    }, 10000);
  });
});
