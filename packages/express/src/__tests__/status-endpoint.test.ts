import { describe, it, expect, beforeEach } from 'vitest';
import express, { Express, Request } from 'express';
import request from 'supertest';
import { createStatusEndpoint, getRateLimitStatus } from '../status';
import { createSharedMemoryStore } from '@limitrate/core';
import type { Store } from '@limitrate/core';

describe('Client-Side SDK (B5)', () => {
  let app: Express;
  let store: Store;

  beforeEach(async () => {
    app = express();
    store = createSharedMemoryStore();
  });

  describe('getRateLimitStatus()', () => {
    it('should return accurate rate limit status', async () => {
      const user = 'test-user';
      const plan = 'free';
      const endpoint = 'POST|/api/chat';
      const limit = 100;
      const windowSeconds = 60;

      // Simulate some usage
      await store.checkRate(`${user}:${endpoint}`, limit, windowSeconds);
      await store.checkRate(`${user}:${endpoint}`, limit, windowSeconds);
      await store.checkRate(`${user}:${endpoint}`, limit, windowSeconds);

      const status = await getRateLimitStatus({
        user,
        plan,
        endpoint,
        store,
        limit,
        windowSeconds,
      });

      expect(status).toMatchObject({
        used: 3,
        limit: 100,
        remaining: 97,
        plan: 'free',
      });
      expect(status.percentage).toBe(3); // 3/100 = 3%
      expect(status.resetIn).toBeGreaterThan(0);
      expect(status.resetIn).toBeLessThanOrEqual(60);
    });

    it('should handle zero usage correctly', async () => {
      const status = await getRateLimitStatus({
        user: 'new-user',
        plan: 'pro',
        endpoint: 'GET|/api/data',
        store,
        limit: 50,
        windowSeconds: 60,
      });

      expect(status).toMatchObject({
        used: 0,
        limit: 50,
        remaining: 50,
        plan: 'pro',
        percentage: 0,
      });
    });

    it('should handle limit exceeded (remaining = 0)', async () => {
      const user = 'heavy-user';
      const endpoint = 'POST|/api/generate';
      const limit = 5;

      // Exceed the limit
      for (let i = 0; i < 7; i++) {
        await store.checkRate(`${user}:${endpoint}`, limit, 60);
      }

      const status = await getRateLimitStatus({
        user,
        plan: 'free',
        endpoint,
        store,
        limit,
        windowSeconds: 60,
      });

      expect(status.used).toBeGreaterThanOrEqual(5);
      expect(status.remaining).toBe(0); // Capped at 0
      expect(status.percentage).toBe(100); // Capped at 100
      expect(status.limit).toBe(5);
    });

    it('should calculate percentage correctly', async () => {
      const user = 'percentage-user';
      const endpoint = 'GET|/api/test';
      const limit = 200;

      // Use 100 out of 200 (50%)
      for (let i = 0; i < 100; i++) {
        await store.checkRate(`${user}:${endpoint}`, limit, 60);
      }

      const status = await getRateLimitStatus({
        user,
        plan: 'pro',
        endpoint,
        store,
        limit,
        windowSeconds: 60,
      });

      expect(status.percentage).toBe(50); // 100/200 = 50%
    });

    it('should handle different time windows', async () => {
      const user = 'time-user';
      const endpoint = 'POST|/api/upload';

      // 1-minute window
      await store.checkRate(`${user}:${endpoint}`, 10, 60);
      const status1Min = await getRateLimitStatus({
        user,
        plan: 'free',
        endpoint,
        store,
        limit: 10,
        windowSeconds: 60,
      });
      expect(status1Min.resetIn).toBeLessThanOrEqual(60);

      // 1-hour window (3600 seconds)
      const status1Hour = await getRateLimitStatus({
        user,
        plan: 'free',
        endpoint,
        store,
        limit: 100,
        windowSeconds: 3600,
      });
      expect(status1Hour.resetIn).toBeLessThanOrEqual(3600);
    });
  });

  describe('createStatusEndpoint()', () => {
    it('should create a working status endpoint', async () => {
      const statusEndpoint = createStatusEndpoint({
        store,
        identifyUser: (req) => req.headers['x-user-id'] as string || 'anonymous',
        identifyPlan: (req) => req.headers['x-plan'] as string || 'free',
        getLimit: (plan) => (plan === 'pro' ? 1000 : 100),
        windowSeconds: 60,
        endpoint: 'POST|/api/chat',
      });

      app.get('/api/rate-limit/status', statusEndpoint);

      const response = await request(app)
        .get('/api/rate-limit/status')
        .set('x-user-id', 'test-user')
        .set('x-plan', 'free');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        used: 0,
        limit: 100,
        remaining: 100,
        plan: 'free',
        percentage: 0,
      });
      expect(response.body.resetIn).toBeGreaterThan(0);
    });

    it('should use different limits for different plans', async () => {
      const statusEndpoint = createStatusEndpoint({
        store,
        identifyUser: () => 'any-user',
        identifyPlan: (req) => req.headers['x-plan'] as string || 'free',
        getLimit: (plan) => {
          if (plan === 'enterprise') return 10000;
          if (plan === 'pro') return 1000;
          return 100; // free
        },
        windowSeconds: 60,
        endpoint: 'POST|/api/generate',
      });

      app.get('/status', statusEndpoint);

      // Free plan: 100 limit
      const freeRes = await request(app).get('/status').set('x-plan', 'free');
      expect(freeRes.body.limit).toBe(100);

      // Pro plan: 1000 limit
      const proRes = await request(app).get('/status').set('x-plan', 'pro');
      expect(proRes.body.limit).toBe(1000);

      // Enterprise plan: 10000 limit
      const enterpriseRes = await request(app).get('/status').set('x-plan', 'enterprise');
      expect(enterpriseRes.body.limit).toBe(10000);
    });

    it('should track usage per user independently', async () => {
      const statusEndpoint = createStatusEndpoint({
        store,
        identifyUser: (req) => req.headers['x-user-id'] as string || 'anonymous',
        identifyPlan: () => 'free',
        getLimit: () => 50,
        windowSeconds: 60,
        endpoint: 'GET|/api/search',
      });

      app.get('/status', statusEndpoint);

      // Simulate usage for user A
      await store.checkRate('user-a:GET|/api/search', 50, 60);
      await store.checkRate('user-a:GET|/api/search', 50, 60);
      await store.checkRate('user-a:GET|/api/search', 50, 60);

      // Simulate usage for user B
      await store.checkRate('user-b:GET|/api/search', 50, 60);

      // Check user A status (3 used)
      const userARes = await request(app).get('/status').set('x-user-id', 'user-a');
      expect(userARes.body).toMatchObject({
        used: 3,
        remaining: 47,
        percentage: 6, // 3/50 = 6%
      });

      // Check user B status (1 used)
      const userBRes = await request(app).get('/status').set('x-user-id', 'user-b');
      expect(userBRes.body).toMatchObject({
        used: 1,
        remaining: 49,
        percentage: 2, // 1/50 = 2%
      });
    });

    it('should auto-detect endpoint from request when not specified', async () => {
      const statusEndpoint = createStatusEndpoint({
        store,
        identifyUser: () => 'test-user',
        identifyPlan: () => 'free',
        getLimit: () => 100,
        windowSeconds: 60,
        // No endpoint specified - should auto-detect
      });

      app.get('/api/my-status', statusEndpoint);

      // Simulate usage on the status endpoint itself
      await store.checkRate('test-user:GET|/api/my-status', 100, 60);

      const response = await request(app).get('/api/my-status');

      expect(response.status).toBe(200);
      expect(response.body.used).toBeGreaterThanOrEqual(1);
    });

    it('should handle errors gracefully', async () => {
      const statusEndpoint = createStatusEndpoint({
        store,
        identifyUser: () => {
          throw new Error('Auth failed');
        },
        identifyPlan: () => 'free',
        getLimit: () => 100,
        windowSeconds: 60,
        endpoint: 'POST|/api/test',
      });

      app.get('/status', statusEndpoint);

      const response = await request(app).get('/status');

      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({
        error: 'Failed to get rate limit status',
      });
    });

    it('should work with Express route parameters', async () => {
      const statusEndpoint = createStatusEndpoint({
        store,
        identifyUser: (req) => req.params.userId,
        identifyPlan: () => 'free',
        getLimit: () => 25,
        windowSeconds: 60,
        endpoint: 'POST|/api/chat',
      });

      app.get('/users/:userId/status', statusEndpoint);

      // Simulate usage
      await store.checkRate('alice:POST|/api/chat', 25, 60);
      await store.checkRate('alice:POST|/api/chat', 25, 60);

      const response = await request(app).get('/users/alice/status');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        used: 2,
        remaining: 23,
        limit: 25,
      });
    });
  });

  describe('Integration with Rate Limiting', () => {
    it('should show accurate status after rate-limited requests', async () => {
      const { limitrate } = await import('../middleware');

      // Set up rate limiting
      app.use(
        limitrate({
          store,
          policies: {
            free: {
              endpoints: {
                'POST|/api/action': {
                  rate: {
                    maxPerMinute: 5,
                    actionOnExceed: 'block',
                  },
                },
              },
              defaults: {},
            },
          },
          identifyUser: (req) => req.headers['x-user-id'] as string || 'test-user',
          identifyPlan: () => 'free',
        })
      );

      app.post('/api/action', (req, res) => res.json({ action: 'done' }));

      // Status endpoint
      app.get(
        '/api/status',
        createStatusEndpoint({
          store,
          identifyUser: (req) => req.headers['x-user-id'] as string || 'test-user',
          identifyPlan: () => 'free',
          getLimit: () => 5,
          windowSeconds: 60,
          endpoint: 'POST|/api/action',
        })
      );

      // Make 3 requests
      await request(app).post('/api/action').set('x-user-id', 'integration-user');
      await request(app).post('/api/action').set('x-user-id', 'integration-user');
      await request(app).post('/api/action').set('x-user-id', 'integration-user');

      // Check status
      const statusRes = await request(app)
        .get('/api/status')
        .set('x-user-id', 'integration-user');

      expect(statusRes.body).toMatchObject({
        used: 3,
        limit: 5,
        remaining: 2,
        percentage: 60, // 3/5 = 60%
      });
    });

    it('should reflect when user hits the limit', async () => {
      const { limitrate } = await import('../middleware');

      app.use(
        limitrate({
          store,
          policies: {
            free: {
              endpoints: {
                'POST|/api/limited': {
                  rate: {
                    maxPerMinute: 3,
                    actionOnExceed: 'block',
                  },
                },
              },
              defaults: {},
            },
          },
          identifyUser: () => 'limit-user',
          identifyPlan: () => 'free',
          skip: (req) => req.path === '/api/limit-status', // Don't rate limit status endpoint
        })
      );

      app.post('/api/limited', (req, res) => res.json({ ok: true }));

      app.get(
        '/api/limit-status',
        createStatusEndpoint({
          store,
          identifyUser: () => 'limit-user',
          identifyPlan: () => 'free',
          getLimit: () => 3,
          windowSeconds: 60,
          endpoint: 'POST|/api/limited',
        })
      );

      // Hit the limit (3 requests)
      await request(app).post('/api/limited');
      await request(app).post('/api/limited');
      await request(app).post('/api/limited');

      // 4th request should be blocked
      const blockedRes = await request(app).post('/api/limited');
      expect(blockedRes.status).toBe(429);

      // Status should show limit exceeded
      const statusRes = await request(app).get('/api/limit-status');
      expect(statusRes.body).toMatchObject({
        used: 3,
        limit: 3,
        remaining: 0,
        percentage: 100,
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle very high usage percentages correctly', async () => {
      const user = 'heavy-user';
      const endpoint = 'POST|/api/heavy';
      const limit = 10;

      // Exceed limit significantly
      for (let i = 0; i < 100; i++) {
        await store.checkRate(`${user}:${endpoint}`, limit, 60);
      }

      const status = await getRateLimitStatus({
        user,
        plan: 'free',
        endpoint,
        store,
        limit,
        windowSeconds: 60,
      });

      // Percentage should be capped at 100
      expect(status.percentage).toBe(100);
      expect(status.remaining).toBe(0);
    });

    it('should handle concurrent status requests', async () => {
      const statusEndpoint = createStatusEndpoint({
        store,
        identifyUser: () => 'concurrent-user',
        identifyPlan: () => 'free',
        getLimit: () => 1000,
        windowSeconds: 60,
        endpoint: 'POST|/api/concurrent',
      });

      app.get('/concurrent-status', statusEndpoint);

      // Make multiple concurrent status requests
      const promises = Array.from({ length: 10 }, () =>
        request(app).get('/concurrent-status')
      );

      const responses = await Promise.all(promises);

      // All should succeed
      responses.forEach((res) => {
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('used');
        expect(res.body).toHaveProperty('limit');
        expect(res.body).toHaveProperty('remaining');
      });
    });

    it('should handle zero limit edge case', async () => {
      const status = await getRateLimitStatus({
        user: 'zero-user',
        plan: 'blocked',
        endpoint: 'POST|/api/zero',
        store,
        limit: 0, // Edge case: zero limit
        windowSeconds: 60,
      });

      expect(status.limit).toBe(0);
      expect(status.remaining).toBe(0);
      expect(status.percentage).toBe(0); // 0/0 should not cause NaN
    });
  });
});
