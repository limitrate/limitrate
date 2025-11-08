/**
 * Prometheus Integration Example
 *
 * This example shows how to integrate LimitRate with Prometheus metrics
 * for monitoring rate limits, cost tracking, and enforcement actions.
 */

import express from 'express';
import { limitrate } from '@limitrate/express';
import { Counter, Histogram, Gauge, register } from 'prom-client';

// Define Prometheus metrics
const rateLimitCounter = new Counter({
  name: 'limitrate_requests_total',
  help: 'Total number of rate-limited requests',
  labelNames: ['user', 'plan', 'endpoint', 'action', 'allowed'],
});

const costGauge = new Gauge({
  name: 'limitrate_cost_current',
  help: 'Current cost consumption per user',
  labelNames: ['user', 'plan', 'endpoint'],
});

const requestDurationHistogram = new Histogram({
  name: 'limitrate_request_duration_seconds',
  help: 'Request duration for rate limit checks',
  labelNames: ['plan', 'endpoint'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
});

const blockedRequestsCounter = new Counter({
  name: 'limitrate_blocked_requests_total',
  help: 'Total number of blocked requests',
  labelNames: ['user', 'plan', 'endpoint', 'reason'],
});

const app = express();
app.use(express.json());

// LimitRate middleware with Prometheus integration
app.use(limitrate({
  identifyUser: (req) => req.user?.id || req.ip || 'anonymous',
  identifyPlan: (req) => req.user?.plan || 'free',

  store: {
    type: 'redis',
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  policies: {
    free: {
      endpoints: {
        'POST|/api/generate': {
          rate: { maxPerMinute: 10, actionOnExceed: 'block' },
          cost: {
            estimateCost: (req) => {
              const prompt = req.body?.prompt || '';
              const tokens = Math.ceil(prompt.length / 4);
              return tokens * 0.0000015; // $0.0015 per 1k tokens
            },
            hourlyCap: 0.10,
            actionOnExceed: 'block',
          },
        },
      },
      defaults: {
        rate: { maxPerMinute: 60, actionOnExceed: 'block' },
      },
    },
    pro: {
      endpoints: {
        'POST|/api/generate': {
          rate: { maxPerMinute: 100, actionOnExceed: 'slowdown', slowdownMs: 500 },
          cost: {
            estimateCost: (req) => {
              const prompt = req.body?.prompt || '';
              const tokens = Math.ceil(prompt.length / 4);
              return tokens * 0.0000015;
            },
            hourlyCap: 5.00,
            actionOnExceed: 'block',
          },
        },
      },
    },
  },

  // Event handler to export metrics to Prometheus
  onEvent: async (event) => {
    const startTime = Date.now();

    // Record all requests
    rateLimitCounter.inc({
      user: event.user,
      plan: event.plan,
      endpoint: event.endpoint,
      action: event.action || 'unknown',
      allowed: event.allowed ? 'true' : 'false',
    });

    // Track cost consumption
    if (event.type === 'cost_exceeded' || event.type === 'allowed') {
      costGauge.set(
        {
          user: event.user,
          plan: event.plan,
          endpoint: event.endpoint,
        },
        event.value || 0
      );
    }

    // Track blocked requests
    if (!event.allowed) {
      blockedRequestsCounter.inc({
        user: event.user,
        plan: event.plan,
        endpoint: event.endpoint,
        reason: event.type,
      });
    }

    // Track request duration
    const duration = (Date.now() - startTime) / 1000;
    requestDurationHistogram.observe(
      {
        plan: event.plan,
        endpoint: event.endpoint,
      },
      duration
    );
  },
}));

// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Example API endpoint
app.post('/api/generate', async (req, res) => {
  // If we get here, rate limits passed
  res.json({
    ok: true,
    message: 'Generation started',
    prompt: req.body.prompt,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Prometheus metrics available at http://localhost:${PORT}/metrics`);
});

/**
 * Example Prometheus queries:
 *
 * 1. Rate of blocked requests per plan:
 *    rate(limitrate_blocked_requests_total[5m])
 *
 * 2. P95 latency of rate limit checks:
 *    histogram_quantile(0.95, rate(limitrate_request_duration_seconds_bucket[5m]))
 *
 * 3. Current cost consumption by user:
 *    limitrate_cost_current
 *
 * 4. Alert on high blocked rate:
 *    rate(limitrate_blocked_requests_total{plan="free"}[5m]) > 10
 */
