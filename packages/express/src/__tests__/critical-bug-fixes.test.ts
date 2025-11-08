/**
 * Express middleware regression tests for critical bug fixes
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { limitrate } from '../middleware';
import type { LimitRateOptions } from '../types';

describe('Express Middleware - Critical Bug Fixes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
  });

  describe('Bug #2: Invalid Users Share Rate Limits', () => {
    it('should NOT share rate limits between different invalid user IDs', async () => {
      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            defaults: {
              rate: {
                maxPerMinute: 2,
                actionOnExceed: 'block',
              },
            },
          },
        },
        identifyUser: (req) => req.get('x-user-id') || 'anonymous',
        identifyPlan: () => 'free',
      };

      app.use(limitrate(options));
      app.get('/test', (_req, res) => res.json({ ok: true }));

      // User 1: Invalid email
      const user1 = 'user1@example.com';
      await request(app).get('/test').set('x-user-id', user1).expect(200);
      await request(app).get('/test').set('x-user-id', user1).expect(200);
      // User 1 exhausted (2/2)
      const user1Blocked = await request(app)
        .get('/test')
        .set('x-user-id', user1)
        .expect(429);

      expect(user1Blocked.body.ok).toBe(false);

      // User 2: Different invalid email (should NOT share limits with user1)
      const user2 = 'user2@example.com';
      const user2Response = await request(app)
        .get('/test')
        .set('x-user-id', user2)
        .expect(200); // Should succeed! Not blocked by user1's limit

      expect(user2Response.body.ok).toBe(true);

      // Verify user2 can make their own 2 requests
      await request(app).get('/test').set('x-user-id', user2).expect(200);
      // User 2 exhausted (2/2)
      await request(app).get('/test').set('x-user-id', user2).expect(429);
    });

    it('should hash consistent IDs for same invalid user', async () => {
      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            defaults: {
              rate: {
                maxPerMinute: 3,
                actionOnExceed: 'block',
              },
            },
          },
        },
        identifyUser: (req) => req.get('x-user-id') || 'anonymous',
        identifyPlan: () => 'free',
      };

      app.use(limitrate(options));
      app.get('/test', (_req, res) => res.json({ ok: true }));

      // Same invalid user makes multiple requests
      const user = 'same@example.com';
      await request(app).get('/test').set('x-user-id', user).expect(200);
      await request(app).get('/test').set('x-user-id', user).expect(200);
      await request(app).get('/test').set('x-user-id', user).expect(200);

      // 4th request should be blocked
      await request(app).get('/test').set('x-user-id', user).expect(429);
    });

    it('should allow valid user IDs to pass through unchanged', async () => {
      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            defaults: {
              rate: {
                maxPerMinute: 2,
                actionOnExceed: 'block',
              },
            },
          },
        },
        identifyUser: (req) => req.get('x-user-id') || 'anonymous',
        identifyPlan: () => 'free',
      };

      app.use(limitrate(options));
      app.get('/test', (_req, res) => res.json({ ok: true }));

      // Valid user IDs should work normally
      const validUsers = ['user123', 'test_user', 'user-name'];

      for (const userId of validUsers) {
        await request(app).get('/test').set('x-user-id', userId).expect(200);
        await request(app).get('/test').set('x-user-id', userId).expect(200);
        await request(app).get('/test').set('x-user-id', userId).expect(429);
      }
    });
  });

  describe('Bug #4: Concurrency Slot Leak on Errors', () => {
    it('should release concurrency slot when error occurs', async () => {
      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            defaults: {
              concurrency: {
                max: 1,
                actionOnExceed: 'queue',
                queueTimeout: 1000,
              },
            },
          },
        },
        identifyUser: () => 'testuser',
        identifyPlan: () => 'free',
      };

      app.use(limitrate(options));

      // Route that throws an error after acquiring concurrency slot
      app.get('/error', (_req, _res, next) => {
        // Simulate async error
        setTimeout(() => {
          next(new Error('Simulated error'));
        }, 50);
      });

      // Error handler
      app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
        res.status(500).json({ error: err.message });
      });

      // First request errors
      await request(app).get('/error').expect(500);

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Second request should succeed (slot should be released)
      // If bug exists, this would hang/timeout because slot is leaked
      await request(app).get('/error').expect(500);
    });

    it('should handle response close event to release slot', async () => {
      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            defaults: {
              concurrency: {
                max: 2,
                actionOnExceed: 'block',
              },
            },
          },
        },
        identifyUser: () => 'testuser',
        identifyPlan: () => 'free',
      };

      app.use(limitrate(options));

      app.get('/slow', async (_req, res) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        res.json({ ok: true });
      });

      // Make 2 concurrent requests (fills concurrency)
      const requests = [
        request(app).get('/slow'),
        request(app).get('/slow'),
      ];

      await Promise.all(requests);

      // Third request should succeed (slots released after finish)
      await request(app).get('/slow').expect(200);
    });
  });

  describe('Integration: Multiple Bug Fixes', () => {
    it('should handle invalid users with concurrency correctly', async () => {
      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            defaults: {
              rate: {
                maxPerMinute: 10,
                actionOnExceed: 'block',
              },
              concurrency: {
                max: 10, // High enough to not block
                actionOnExceed: 'block',
              },
            },
          },
        },
        identifyUser: (req) => req.get('x-user-id') || 'anonymous',
        identifyPlan: () => 'free',
      };

      app.use(limitrate(options));

      app.get('/test', (_req, res) => {
        res.json({ ok: true });
      });

      // Invalid user 1
      const user1 = 'user1@example.com';
      await request(app).get('/test').set('x-user-id', user1).expect(200);
      await request(app).get('/test').set('x-user-id', user1).expect(200);

      // Invalid user 2 (should not share limits with user1)
      const user2 = 'user2@example.com';
      const user2Response = await request(app)
        .get('/test')
        .set('x-user-id', user2)
        .expect(200);

      expect(user2Response.body.ok).toBe(true);

      // Both users have separate rate limits
      await request(app).get('/test').set('x-user-id', user2).expect(200);
    });
  });
});
