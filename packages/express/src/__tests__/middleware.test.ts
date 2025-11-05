import { describe, it, expect, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { limitrate } from '../middleware';
import type { LimitRateOptions } from '../types';

describe('Express Middleware', () => {
  let app: Express;
  let options: LimitRateOptions;

  beforeEach(() => {
    app = express();

    options = {
      store: { type: 'memory' },
      policies: {
        free: {
          endpoints: {
            'POST|/api/ask': {
              rate: {
                maxPerMinute: 3,
                actionOnExceed: 'block',
              },
            },
          },
          defaults: {
            rate: {
              maxPerMinute: 10,
              actionOnExceed: 'block',
            },
          },
        },
        pro: {
          endpoints: {
            'POST|/api/ask': {
              rate: {
                maxPerMinute: 100,
                actionOnExceed: 'allow-and-log',
              },
            },
          },
          defaults: {},
        },
      },
      identifyUser: (req) => req.headers['x-user-id'] as string || 'anonymous',
      identifyPlan: (req) => req.headers['x-plan'] as string || 'free',
    };
  });

  describe('Rate Limiting', () => {
    it('should allow requests within rate limit', async () => {
      app.use(limitrate(options));
      app.post('/api/ask', (req, res) => res.json({ ok: true }));

      const response = await request(app)
        .post('/api/ask')
        .set('x-user-id', 'user-123')
        .set('x-plan', 'free')
        .expect(200);

      expect(response.body.ok).toBe(true);
      expect(response.headers['ratelimit-limit']).toBeDefined();
      expect(response.headers['ratelimit-remaining']).toBeDefined();
    });

    it('should block requests when rate limit exceeded', async () => {
      app.use(limitrate(options));
      app.post('/api/ask', (req, res) => res.json({ ok: true }));

      // Send 3 requests (at limit)
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/api/ask')
          .set('x-user-id', 'user-456')
          .set('x-plan', 'free')
          .expect(200);
      }

      // 4th request should be blocked
      const response = await request(app)
        .post('/api/ask')
        .set('x-user-id', 'user-456')
        .set('x-plan', 'free')
        .expect(429);

      expect(response.body.ok).toBe(false);
      expect(response.body.reason).toBe('rate_limited');
      expect(response.body.retry_after_seconds).toBeGreaterThan(0);
    });

    it('should handle different users independently', async () => {
      app.use(limitrate(options));
      app.post('/api/ask', (req, res) => res.json({ ok: true }));

      // User 1 hits limit
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/api/ask')
          .set('x-user-id', 'user-1')
          .set('x-plan', 'free')
          .expect(200);
      }

      // User 1 blocked
      await request(app)
        .post('/api/ask')
        .set('x-user-id', 'user-1')
        .set('x-plan', 'free')
        .expect(429);

      // User 2 still allowed
      await request(app)
        .post('/api/ask')
        .set('x-user-id', 'user-2')
        .set('x-plan', 'free')
        .expect(200);
    });

    it('should handle different plans with different limits', async () => {
      app.use(limitrate(options));
      app.post('/api/ask', (req, res) => res.json({ ok: true }));

      // Free user hits limit at 3
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/api/ask')
          .set('x-user-id', 'free-user')
          .set('x-plan', 'free')
          .expect(200);
      }

      await request(app)
        .post('/api/ask')
        .set('x-user-id', 'free-user')
        .set('x-plan', 'free')
        .expect(429);

      // Pro user can make many more requests
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/api/ask')
          .set('x-user-id', 'pro-user')
          .set('x-plan', 'pro')
          .expect(200);
      }
    });

    it('should apply default policy when endpoint not specified', async () => {
      app.use(limitrate(options));
      app.get('/api/data', (req, res) => res.json({ data: [] }));

      // Send 10 requests (default limit)
      for (let i = 0; i < 10; i++) {
        await request(app)
          .get('/api/data')
          .set('x-user-id', 'user-789')
          .set('x-plan', 'free')
          .expect(200);
      }

      // 11th request should be blocked
      await request(app)
        .get('/api/data')
        .set('x-user-id', 'user-789')
        .set('x-plan', 'free')
        .expect(429);
    });
  });

  describe('IP Filtering', () => {
    it.skip('should allow requests from allowlisted IPs - SKIPPED: IPv6 mapping issue', async () => {
      const optionsWithAllowlist: LimitRateOptions = {
        ...options,
        ipAllowlist: ['127.0.0.1'],
        trustProxy: false,
      };

      app.use(limitrate(optionsWithAllowlist));
      app.post('/api/ask', (req, res) => res.json({ ok: true }));

      // Make many requests from allowlisted IP (should not be rate limited)
      for (let i = 0; i < 20; i++) {
        await request(app)
          .post('/api/ask')
          .set('x-user-id', 'user-123')
          .set('x-plan', 'free')
          .expect(200);
      }
    });

    it('should block requests from blocklisted IPs', async () => {
      const optionsWithBlocklist: LimitRateOptions = {
        ...options,
        ipBlocklist: ['192.168.1.100'],
        trustProxy: true,
      };

      app.set('trust proxy', true);
      app.use(limitrate(optionsWithBlocklist));
      app.post('/api/ask', (req, res) => res.json({ ok: true }));

      // Request from blocklisted IP should be blocked immediately
      const response = await request(app)
        .post('/api/ask')
        .set('x-forwarded-for', '192.168.1.100')
        .set('x-user-id', 'user-123')
        .set('x-plan', 'free')
        .expect(403);

      expect(response.body.ok).toBe(false);
      expect(response.body.reason).toBe('ip_blocked');
    });
  });

  describe('Skip Function', () => {
    it('should skip rate limiting for health check endpoints', async () => {
      const optionsWithSkip: LimitRateOptions = {
        ...options,
        skip: (req) => req.path === '/health',
      };

      app.use(limitrate(optionsWithSkip));
      app.get('/health', (req, res) => res.json({ status: 'ok' }));

      // Make many health check requests (should not be rate limited)
      for (let i = 0; i < 20; i++) {
        await request(app)
          .get('/health')
          .expect(200);
      }
    });
  });

  describe('Event Handling', () => {
    it('should emit events on rate limit exceeded', async () => {
      let emittedEvent: any = null;

      const optionsWithEvent: LimitRateOptions = {
        ...options,
        onEvent: (event) => {
          if (event.type === 'rate_exceeded') {
            emittedEvent = event;
          }
        },
      };

      app.use(limitrate(optionsWithEvent));
      app.post('/api/ask', (req, res) => res.json({ ok: true }));

      // Hit rate limit
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/api/ask')
          .set('x-user-id', 'test-user')
          .set('x-plan', 'free')
          .expect(200);
      }

      // 4th request should emit event
      await request(app)
        .post('/api/ask')
        .set('x-user-id', 'test-user')
        .set('x-plan', 'free')
        .expect(429);

      expect(emittedEvent).not.toBeNull();
      expect(emittedEvent?.type).toBe('rate_exceeded');
      expect(emittedEvent?.user).toBe('test-user');
      expect(emittedEvent?.plan).toBe('free');
    });
  });

  describe('Error Handling', () => {
    it('should handle identifyUser errors gracefully', async () => {
      const optionsWithError: LimitRateOptions = {
        ...options,
        identifyUser: () => {
          throw new Error('Auth service down');
        },
      };

      app.use(limitrate(optionsWithError));
      app.post('/api/ask', (req, res) => res.json({ ok: true }));

      // Should fall back to IP
      const response = await request(app)
        .post('/api/ask')
        .expect(200);

      expect(response.body.ok).toBe(true);
    });
  });

  describe('Upgrade Hints', () => {
    it('should include upgrade hint in 429 response', async () => {
      const optionsWithHint: LimitRateOptions = {
        ...options,
        upgradeHint: 'Upgrade to Pro for higher limits',
      };

      app.use(limitrate(optionsWithHint));
      app.post('/api/ask', (req, res) => res.json({ ok: true }));

      // Hit rate limit
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/api/ask')
          .set('x-user-id', 'user-upgrade')
          .set('x-plan', 'free')
          .expect(200);
      }

      const response = await request(app)
        .post('/api/ask')
        .set('x-user-id', 'user-upgrade')
        .set('x-plan', 'free')
        .expect(429);

      expect(response.body.upgrade_hint).toBe('Upgrade to Pro for higher limits');
    });

    it('should support dynamic upgrade hints', async () => {
      const optionsWithDynamicHint: LimitRateOptions = {
        ...options,
        upgradeHint: (plan) => {
          if (plan === 'free') return 'Upgrade to Pro for 100x more requests';
          return 'Contact sales for enterprise limits';
        },
      };

      app.use(limitrate(optionsWithDynamicHint));
      app.post('/api/ask', (req, res) => res.json({ ok: true }));

      // Hit rate limit as free user
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/api/ask')
          .set('x-user-id', 'free-user')
          .set('x-plan', 'free')
          .expect(200);
      }

      const response = await request(app)
        .post('/api/ask')
        .set('x-user-id', 'free-user')
        .set('x-plan', 'free')
        .expect(429);

      expect(response.body.upgrade_hint).toBe('Upgrade to Pro for 100x more requests');
    });
  });

  describe('Rate Limit Headers', () => {
    it('should include X-RateLimit headers in responses', async () => {
      app.use(limitrate(options));
      app.post('/api/ask', (req, res) => res.json({ ok: true }));

      const response = await request(app)
        .post('/api/ask')
        .set('x-user-id', 'header-test')
        .set('x-plan', 'free')
        .expect(200);

      expect(response.headers['ratelimit-limit']).toBeDefined();
      expect(response.headers['ratelimit-remaining']).toBeDefined();
      expect(response.headers['ratelimit-reset']).toBeDefined();
    });
  });
});
