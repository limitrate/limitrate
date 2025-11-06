import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { limitrate } from '../middleware';
import type { LimitRateOptions, DryRunEvent } from '../types';

describe('Dry-Run Mode (B3)', () => {
  let app: Express;
  let dryRunEvents: DryRunEvent[];
  let dryRunLogger: (event: DryRunEvent) => void;

  beforeEach(() => {
    app = express();
    dryRunEvents = [];
    dryRunLogger = vi.fn((event: DryRunEvent) => {
      dryRunEvents.push(event);
    });
  });

  describe('Basic Dry-Run Behavior', () => {
    it('should allow all requests when dryRun=true even when limit exceeded', async () => {
      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            endpoints: {
              'POST|/api/test': {
                rate: {
                  maxPerMinute: 2, // Very low limit
                  actionOnExceed: 'block',
                },
              },
            },
            defaults: {},
          },
        },
        identifyUser: (req) => req.headers['x-user-id'] as string || 'test-user',
        identifyPlan: () => 'free',
        dryRun: true, // DRY-RUN MODE ENABLED
      };

      app.use(limitrate(options));
      app.post('/api/test', (req, res) => res.json({ success: true }));

      // Make 5 requests (exceeds limit of 2)
      for (let i = 0; i < 5; i++) {
        const response = await request(app)
          .post('/api/test')
          .set('x-user-id', 'user-123');

        // All requests should succeed (200, not 429)
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true });
      }
    });

    it.skip('should allow requests when dryRun=true with cost limits exceeded', async () => {
      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            endpoints: {
              'POST|/api/generate': {
                cost: {
                  maxPerDay: 0.10, // $0.10 daily limit
                  estimateCost: () => 0.05, // $0.05 per request
                  actionOnExceed: 'block',
                },
              },
            },
            defaults: {},
          },
        },
        identifyUser: (req) => req.headers['x-user-id'] as string || 'test-user',
        identifyPlan: () => 'free',
        dryRun: true,
      };

      app.use(limitrate(options));
      app.post('/api/generate', (req, res) => res.json({ generated: true }));

      // Make 5 requests (total cost $0.25, exceeds $0.10 limit)
      for (let i = 0; i < 5; i++) {
        const response = await request(app)
          .post('/api/generate')
          .set('x-user-id', 'big-spender');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ generated: true });
      }
    });
  });

  describe('Dry-Run Logger', () => {
    it('should call dryRunLogger when rate limit would be exceeded', async () => {
      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            endpoints: {
              'POST|/api/chat': {
                rate: {
                  maxPerMinute: 3,
                  actionOnExceed: 'block',
                },
              },
            },
            defaults: {},
          },
        },
        identifyUser: () => 'chat-user',
        identifyPlan: () => 'free',
        dryRun: true,
        dryRunLogger,
      };

      app.use(limitrate(options));
      app.post('/api/chat', (req, res) => res.json({ msg: 'ok' }));

      // Make 5 requests (limit is 3)
      for (let i = 0; i < 5; i++) {
        await request(app).post('/api/chat');
      }

      // Should log 2 would-be blocks (requests 4 and 5)
      expect(dryRunEvents.length).toBeGreaterThanOrEqual(1);

      const blockEvent = dryRunEvents[0];
      expect(blockEvent).toMatchObject({
        user: 'chat-user',
        plan: 'free',
        endpoint: 'POST|/api/chat',
        action: 'block',
        reason: 'rate_exceeded',
      });
      expect(blockEvent.timestamp).toBeInstanceOf(Date);
      expect(blockEvent.current).toBeGreaterThanOrEqual(3);
      expect(blockEvent.limit).toBe(3);
    });

    it.skip('should include cost_exceeded reason when cost limit would be hit', async () => {
      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            endpoints: {
              'POST|/api/ai': {
                rate: {
                  maxPerMinute: 100, // High rate limit so only cost matters
                  actionOnExceed: 'block',
                },
                cost: {
                  maxPerHour: 1.00,
                  estimateCost: () => 0.50,
                  actionOnExceed: 'block',
                },
              },
            },
            defaults: {},
          },
        },
        identifyUser: () => 'ai-user',
        identifyPlan: () => 'free',
        dryRun: true,
        dryRunLogger,
      };

      app.use(limitrate(options));
      app.post('/api/ai', (req, res) => res.json({ result: 'generated' }));

      // Make 3 requests (total $1.50, exceeds $1.00 limit)
      for (let i = 0; i < 3; i++) {
        await request(app).post('/api/ai');
      }

      const costEvent = dryRunEvents.find((e) => e.reason === 'cost_exceeded');
      expect(costEvent).toBeDefined();
      expect(costEvent?.action).toBe('block');
    });

    it('should log slowdown actions in dry-run mode', async () => {
      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            endpoints: {
              'GET|/api/data': {
                rate: {
                  maxPerMinute: 5,
                  actionOnExceed: 'slowdown', // SLOWDOWN action
                  slowdownMs: 1000,
                },
              },
            },
            defaults: {},
          },
        },
        identifyUser: () => 'data-user',
        identifyPlan: () => 'free',
        dryRun: true,
        dryRunLogger,
      };

      app.use(limitrate(options));
      app.get('/api/data', (req, res) => res.json({ data: [] }));

      // Make 10 requests (exceeds limit of 5, should trigger slowdown)
      for (let i = 0; i < 10; i++) {
        const startTime = Date.now();
        await request(app).get('/api/data');
        const duration = Date.now() - startTime;

        // In dry-run mode, slowdown should NOT actually delay
        expect(duration).toBeLessThan(500); // Should be fast (no 1000ms delay)
      }

      // But should still log slowdown events
      const slowdownEvent = dryRunEvents.find((e) => e.action === 'slowdown');
      expect(slowdownEvent).toBeDefined();
    });
  });

  describe('Dry-Run Logger Error Handling', () => {
    it('should continue processing if dryRunLogger throws an error', async () => {
      const errorLogger = vi.fn(() => {
        throw new Error('Logger crashed!');
      });

      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            endpoints: {
              'POST|/api/robust': {
                rate: {
                  maxPerMinute: 1,
                  actionOnExceed: 'block',
                },
              },
            },
            defaults: {},
          },
        },
        identifyUser: () => 'robust-user',
        identifyPlan: () => 'free',
        dryRun: true,
        dryRunLogger: errorLogger,
      };

      app.use(limitrate(options));
      app.post('/api/robust', (req, res) => res.json({ ok: true }));

      // Make 3 requests (exceeds limit, logger will throw)
      for (let i = 0; i < 3; i++) {
        const response = await request(app).post('/api/robust');

        // Should still succeed despite logger error
        expect(response.status).toBe(200);
      }

      // Logger was called (and failed)
      expect(errorLogger).toHaveBeenCalled();
    });

    it('should handle async dryRunLogger', async () => {
      const asyncEvents: DryRunEvent[] = [];
      const asyncLogger = async (event: DryRunEvent) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        asyncEvents.push(event);
      };

      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            endpoints: {
              'POST|/api/async': {
                rate: {
                  maxPerMinute: 2,
                  actionOnExceed: 'block',
                },
              },
            },
            defaults: {},
          },
        },
        identifyUser: () => 'async-user',
        identifyPlan: () => 'free',
        dryRun: true,
        dryRunLogger: asyncLogger,
      };

      app.use(limitrate(options));
      app.post('/api/async', (req, res) => res.json({ async: true }));

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        await request(app).post('/api/async');
      }

      // Wait for async logger to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Async logger should have been called
      expect(asyncEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Dry-Run with Default Console Logging', () => {
    it('should log to console when dryRunLogger not provided', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            endpoints: {
              'POST|/api/console': {
                rate: {
                  maxPerMinute: 1,
                  actionOnExceed: 'block',
                },
              },
            },
            defaults: {},
          },
        },
        identifyUser: () => 'console-user',
        identifyPlan: () => 'free',
        dryRun: true,
        // No dryRunLogger provided
      };

      app.use(limitrate(options));
      app.post('/api/console', (req, res) => res.json({ logged: true }));

      // Make 3 requests (exceeds limit)
      for (let i = 0; i < 3; i++) {
        await request(app).post('/api/console');
      }

      // Should log to console
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[LimitRate] DRY-RUN: Would block')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Dry-Run Event Structure', () => {
    it('should include all required fields in dry-run events', async () => {
      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          pro: {
            endpoints: {
              'POST|/api/premium': {
                rate: {
                  maxPerMinute: 10,
                  actionOnExceed: 'block',
                },
              },
            },
            defaults: {},
          },
        },
        identifyUser: () => 'premium-user',
        identifyPlan: () => 'pro',
        dryRun: true,
        dryRunLogger,
      };

      app.use(limitrate(options));
      app.post('/api/premium', (req, res) => res.json({ premium: true }));

      // Exceed limit
      for (let i = 0; i < 12; i++) {
        await request(app).post('/api/premium');
      }

      const event = dryRunEvents[0];

      // Verify all required fields exist
      expect(event).toHaveProperty('timestamp');
      expect(event).toHaveProperty('user');
      expect(event).toHaveProperty('plan');
      expect(event).toHaveProperty('endpoint');
      expect(event).toHaveProperty('action');
      expect(event).toHaveProperty('reason');
      expect(event).toHaveProperty('current');
      expect(event).toHaveProperty('limit');
      expect(event).toHaveProperty('retryAfter');

      // Verify types
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(typeof event.user).toBe('string');
      expect(typeof event.plan).toBe('string');
      expect(typeof event.endpoint).toBe('string');
      expect(['block', 'slowdown']).toContain(event.action);
      expect(['rate_exceeded', 'cost_exceeded']).toContain(event.reason);
      expect(typeof event.current).toBe('number');
      expect(typeof event.limit).toBe('number');
      expect(typeof event.retryAfter).toBe('number');
    });
  });

  describe('Dry-Run Mode Disabled', () => {
    it('should actually block requests when dryRun=false', async () => {
      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            endpoints: {
              'POST|/api/strict': {
                rate: {
                  maxPerMinute: 2,
                  actionOnExceed: 'block',
                },
              },
            },
            defaults: {},
          },
        },
        identifyUser: () => 'strict-user',
        identifyPlan: () => 'free',
        dryRun: false, // DISABLED
        dryRunLogger, // Logger provided but should not be called
      };

      app.use(limitrate(options));
      app.post('/api/strict', (req, res) => res.json({ strict: true }));

      // First 2 requests succeed
      const req1 = await request(app).post('/api/strict');
      const req2 = await request(app).post('/api/strict');
      expect(req1.status).toBe(200);
      expect(req2.status).toBe(200);

      // 3rd request blocked
      const req3 = await request(app).post('/api/strict');
      expect(req3.status).toBe(429);

      // Logger should NOT have been called (not in dry-run mode)
      expect(dryRunLogger).not.toHaveBeenCalled();
    });
  });
});
