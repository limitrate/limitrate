import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { limitrate } from '../middleware';
import type { LimitRateOptions } from '../types';
import type { UserOverride } from '@limitrate/core';

describe('User Overrides (B4)', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
  });

  describe('Static User Overrides', () => {
    it('should apply static user override instead of plan limit', async () => {
      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            endpoints: {
              'POST|/api/generate': {
                rate: {
                  maxPerMinute: 10, // Plan limit: 10 req/min
                  actionOnExceed: 'block',
                },
              },
            },
            defaults: {},
          },
        },
        identifyUser: (req) => req.headers['x-user-id'] as string || 'anonymous',
        identifyPlan: () => 'free',
        userOverrides: {
          'vip-user': {
            maxPerMinute: 100, // Override: 100 req/min
            reason: 'VIP customer',
          },
        },
      };

      app.use(limitrate(options));
      app.post('/api/generate', (req, res) => res.json({ generated: true }));

      // Regular user: blocked after 10 requests
      for (let i = 0; i < 12; i++) {
        const response = await request(app)
          .post('/api/generate')
          .set('x-user-id', 'regular-user');

        if (i < 10) {
          expect(response.status).toBe(200);
        } else {
          expect(response.status).toBe(429); // Blocked
        }
      }

      // VIP user: should handle 50 requests without blocking (override: 100/min)
      for (let i = 0; i < 50; i++) {
        const response = await request(app)
          .post('/api/generate')
          .set('x-user-id', 'vip-user');

        expect(response.status).toBe(200); // All succeed
      }
    });

    it('should support multiple time window overrides', async () => {
      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            endpoints: {
              'POST|/api/upload': {
                rate: {
                  maxPerMinute: 5, // Only use minute window
                  actionOnExceed: 'block',
                },
              },
            },
            defaults: {},
          },
        },
        identifyUser: (req) => req.headers['x-user-id'] as string,
        identifyPlan: () => 'free',
        userOverrides: {
          'enterprise-acme': {
            maxPerMinute: 100,
            maxPerHour: 1000,
            maxPerDay: 5000,
            reason: 'Enterprise SLA contract',
          },
        },
      };

      app.use(limitrate(options));
      app.post('/api/upload', (req, res) => res.json({ uploaded: true }));

      // Enterprise user: should handle 50 req/min (override: 100/min)
      for (let i = 0; i < 50; i++) {
        const response = await request(app)
          .post('/api/upload')
          .set('x-user-id', 'enterprise-acme');

        expect(response.status).toBe(200);
      }

      // Regular user: blocked after 5 requests
      for (let i = 0; i < 7; i++) {
        const response = await request(app)
          .post('/api/upload')
          .set('x-user-id', 'free-user');

        if (i < 5) {
          expect(response.status).toBe(200);
        } else {
          expect(response.status).toBe(429);
        }
      }
    });

    it('should support endpoint-specific overrides', async () => {
      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            endpoints: {
              'POST|/api/chat': {
                rate: {
                  maxPerMinute: 10,
                  actionOnExceed: 'block',
                },
              },
              'POST|/api/search': {
                rate: {
                  maxPerMinute: 20,
                  actionOnExceed: 'block',
                },
              },
            },
            defaults: {},
          },
        },
        identifyUser: (req) => req.headers['x-user-id'] as string,
        identifyPlan: () => 'free',
        userOverrides: {
          'power-user': {
            maxPerMinute: 50, // Global override: 50 req/min
            endpoints: {
              'POST|/api/chat': {
                maxPerMinute: 200, // Endpoint-specific: 200 req/min for chat
              },
            },
          },
        },
      };

      app.use(limitrate(options));
      app.post('/api/chat', (req, res) => res.json({ chat: true }));
      app.post('/api/search', (req, res) => res.json({ search: true }));

      // Power user on /api/chat: should get 200 req/min (endpoint override)
      for (let i = 0; i < 100; i++) {
        const response = await request(app)
          .post('/api/chat')
          .set('x-user-id', 'power-user');

        expect(response.status).toBe(200);
      }

      // Power user on /api/search: should get 50 req/min (global override)
      for (let i = 0; i < 40; i++) {
        const response = await request(app)
          .post('/api/search')
          .set('x-user-id', 'power-user');

        expect(response.status).toBe(200);
      }
    });
  });

  describe('Dynamic User Overrides', () => {
    it('should call getUserOverride function and apply result', async () => {
      // Simulate database lookup
      const mockDatabase: Record<string, UserOverride> = {
        'db-user-1': {
          maxPerMinute: 75,
          reason: 'Custom limit from database',
        },
        'db-user-2': {
          maxPerMinute: 150,
          reason: 'Premium tier from database',
        },
      };

      const getUserOverride = vi.fn(async (userId: string) => {
        return mockDatabase[userId] || null;
      });

      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            endpoints: {
              'POST|/api/dynamic': {
                rate: {
                  maxPerMinute: 10, // Default plan limit
                  actionOnExceed: 'block',
                },
              },
            },
            defaults: {},
          },
        },
        identifyUser: (req) => req.headers['x-user-id'] as string,
        identifyPlan: () => 'free',
        getUserOverride,
      };

      app.use(limitrate(options));
      app.post('/api/dynamic', (req, res) => res.json({ dynamic: true }));

      // User with dynamic override (75 req/min)
      for (let i = 0; i < 40; i++) {
        const response = await request(app)
          .post('/api/dynamic')
          .set('x-user-id', 'db-user-1');

        expect(response.status).toBe(200);
      }

      // Verify getUserOverride was called
      expect(getUserOverride).toHaveBeenCalledWith('db-user-1', expect.anything());

      // User without override (falls back to plan: 10 req/min)
      for (let i = 0; i < 12; i++) {
        const response = await request(app)
          .post('/api/dynamic')
          .set('x-user-id', 'no-override-user');

        if (i < 10) {
          expect(response.status).toBe(200);
        } else {
          expect(response.status).toBe(429); // Blocked after 10
        }
      }
    });

    it('should handle getUserOverride returning null (no override)', async () => {
      const getUserOverride = vi.fn(async () => null);

      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            endpoints: {
              'POST|/api/fallback': {
                rate: {
                  maxPerMinute: 5,
                  actionOnExceed: 'block',
                },
              },
            },
            defaults: {},
          },
        },
        identifyUser: () => 'test-user',
        identifyPlan: () => 'free',
        getUserOverride,
      };

      app.use(limitrate(options));
      app.post('/api/fallback', (req, res) => res.json({ ok: true }));

      // Should fall back to plan limit (5 req/min)
      for (let i = 0; i < 7; i++) {
        const response = await request(app).post('/api/fallback');

        if (i < 5) {
          expect(response.status).toBe(200);
        } else {
          expect(response.status).toBe(429);
        }
      }

      expect(getUserOverride).toHaveBeenCalled();
    });

    it('should handle getUserOverride errors gracefully', async () => {
      const getUserOverride = vi.fn(async () => {
        throw new Error('Database connection failed');
      });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            endpoints: {
              'POST|/api/robust': {
                rate: {
                  maxPerMinute: 8,
                  actionOnExceed: 'block',
                },
              },
            },
            defaults: {},
          },
        },
        identifyUser: () => 'error-user',
        identifyPlan: () => 'free',
        getUserOverride,
      };

      app.use(limitrate(options));
      app.post('/api/robust', (req, res) => res.json({ robust: true }));

      // Should still work, falling back to plan limit
      for (let i = 0; i < 10; i++) {
        const response = await request(app).post('/api/robust');

        if (i < 8) {
          expect(response.status).toBe(200);
        } else {
          expect(response.status).toBe(429);
        }
      }

      // Should log warning
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('getUserOverride failed'),
        expect.any(Error)
      );

      consoleWarnSpy.mockRestore();
    });

    it('should support synchronous getUserOverride function', async () => {
      const getUserOverride = vi.fn((userId: string) => {
        if (userId === 'sync-vip') {
          return {
            maxPerMinute: 99,
            reason: 'Synchronous override',
          };
        }
        return null;
      });

      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            endpoints: {
              'POST|/api/sync': {
                rate: {
                  maxPerMinute: 3,
                  actionOnExceed: 'block',
                },
              },
            },
            defaults: {},
          },
        },
        identifyUser: (req) => req.headers['x-user-id'] as string,
        identifyPlan: () => 'free',
        getUserOverride,
      };

      app.use(limitrate(options));
      app.post('/api/sync', (req, res) => res.json({ sync: true }));

      // Sync VIP user: 99 req/min
      for (let i = 0; i < 50; i++) {
        const response = await request(app)
          .post('/api/sync')
          .set('x-user-id', 'sync-vip');

        expect(response.status).toBe(200);
      }

      expect(getUserOverride).toHaveBeenCalledWith('sync-vip', expect.anything());
    });
  });

  describe('Override Precedence', () => {
    it('should prioritize static override over dynamic override', async () => {
      const getUserOverride = vi.fn(async () => ({
        maxPerMinute: 25,
        reason: 'Dynamic override',
      }));

      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            endpoints: {
              'POST|/api/precedence': {
                rate: {
                  maxPerMinute: 5,
                  actionOnExceed: 'block',
                },
              },
            },
            defaults: {},
          },
        },
        identifyUser: () => 'precedence-user',
        identifyPlan: () => 'free',
        userOverrides: {
          'precedence-user': {
            maxPerMinute: 50, // Static override
            reason: 'Static configuration',
          },
        },
        getUserOverride,
      };

      app.use(limitrate(options));
      app.post('/api/precedence', (req, res) => res.json({ ok: true }));

      // Should use static override (50), not dynamic (25)
      for (let i = 0; i < 30; i++) {
        const response = await request(app).post('/api/precedence');
        expect(response.status).toBe(200);
      }

      // Dynamic function should NOT be called (static takes precedence)
      expect(getUserOverride).not.toHaveBeenCalled();
    });

    it('should call getUserOverride only when no static override exists', async () => {
      const getUserOverride = vi.fn(async (userId: string) => {
        if (userId === 'dynamic-user') {
          return { maxPerMinute: 30 };
        }
        return null;
      });

      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            endpoints: {
              'POST|/api/mixed': {
                rate: {
                  maxPerMinute: 10,
                  actionOnExceed: 'block',
                },
              },
            },
            defaults: {},
          },
        },
        identifyUser: (req) => req.headers['x-user-id'] as string,
        identifyPlan: () => 'free',
        userOverrides: {
          'static-user': {
            maxPerMinute: 40,
          },
        },
        getUserOverride,
      };

      app.use(limitrate(options));
      app.post('/api/mixed', (req, res) => res.json({ mixed: true }));

      // Static user: should NOT call getUserOverride
      await request(app).post('/api/mixed').set('x-user-id', 'static-user');
      expect(getUserOverride).not.toHaveBeenCalled();

      // Dynamic user: should call getUserOverride
      await request(app).post('/api/mixed').set('x-user-id', 'dynamic-user');
      expect(getUserOverride).toHaveBeenCalledWith('dynamic-user', expect.anything());
    });
  });

  describe('Override with Different Plans', () => {
    it('should override regardless of plan assignment', async () => {
      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            endpoints: {
              'POST|/api/tier': {
                rate: {
                  maxPerMinute: 10,
                  actionOnExceed: 'block',
                },
              },
            },
            defaults: {},
          },
          pro: {
            endpoints: {
              'POST|/api/tier': {
                rate: {
                  maxPerMinute: 50,
                  actionOnExceed: 'block',
                },
              },
            },
            defaults: {},
          },
        },
        identifyUser: (req) => req.headers['x-user-id'] as string,
        identifyPlan: (req) => req.headers['x-plan'] as string || 'free',
        userOverrides: {
          'special-free-user': {
            maxPerMinute: 100, // Override even though on free plan
            reason: 'Special arrangement',
          },
        },
      };

      app.use(limitrate(options));
      app.post('/api/tier', (req, res) => res.json({ tier: true }));

      // Free user with override: 100 req/min (overrides free: 10)
      for (let i = 0; i < 60; i++) {
        const response = await request(app)
          .post('/api/tier')
          .set('x-user-id', 'special-free-user')
          .set('x-plan', 'free');

        expect(response.status).toBe(200);
      }

      // Pro user without override: 50 req/min (plan limit)
      for (let i = 0; i < 52; i++) {
        const response = await request(app)
          .post('/api/tier')
          .set('x-user-id', 'regular-pro-user')
          .set('x-plan', 'pro');

        if (i < 50) {
          expect(response.status).toBe(200);
        } else {
          expect(response.status).toBe(429);
        }
      }
    });
  });

  describe('Override Validation', () => {
    it('should handle partial overrides (only some time windows)', async () => {
      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            endpoints: {
              'POST|/api/partial': {
                rate: {
                  maxPerMinute: 5, // Only use one time window per policy
                  actionOnExceed: 'block',
                },
              },
            },
            defaults: {},
          },
        },
        identifyUser: () => 'partial-user',
        identifyPlan: () => 'free',
        userOverrides: {
          'partial-user': {
            // Only override minute limit
            maxPerMinute: 50,
          },
        },
      };

      app.use(limitrate(options));
      app.post('/api/partial', (req, res) => res.json({ partial: true }));

      // Should use override for minute (50)
      for (let i = 0; i < 30; i++) {
        const response = await request(app).post('/api/partial');
        expect(response.status).toBe(200);
      }
    });

    it('should ignore invalid override values', async () => {
      const getUserOverride = vi.fn(async () => ({
        maxPerMinute: -10, // Invalid: negative
        maxPerHour: 0, // Invalid: zero
        maxPerDay: NaN, // Invalid: NaN
      }));

      const options: LimitRateOptions = {
        store: { type: 'memory' },
        policies: {
          free: {
            endpoints: {
              'POST|/api/invalid': {
                rate: {
                  maxPerMinute: 7,
                  actionOnExceed: 'block',
                },
              },
            },
            defaults: {},
          },
        },
        identifyUser: () => 'invalid-user',
        identifyPlan: () => 'free',
        getUserOverride,
      };

      app.use(limitrate(options));
      app.post('/api/invalid', (req, res) => res.json({ invalid: true }));

      // Should fall back to plan limit due to invalid override
      for (let i = 0; i < 9; i++) {
        const response = await request(app).post('/api/invalid');

        if (i < 7) {
          expect(response.status).toBe(200);
        } else {
          expect(response.status).toBe(429);
        }
      }
    });
  });
});
