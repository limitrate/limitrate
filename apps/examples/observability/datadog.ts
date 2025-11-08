/**
 * Datadog Integration Example
 *
 * This example shows how to integrate LimitRate with Datadog APM and metrics
 * for comprehensive monitoring and alerting.
 */

import express from 'express';
import { limitrate } from '@limitrate/express';
import { StatsD } from 'hot-shots';

// Initialize Datadog StatsD client
const dogstatsd = new StatsD({
  host: process.env.DD_AGENT_HOST || 'localhost',
  port: 8125,
  prefix: 'limitrate.',
  globalTags: {
    env: process.env.NODE_ENV || 'development',
    service: 'api',
  },
});

const app = express();
app.use(express.json());

// LimitRate middleware with Datadog integration
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
              return tokens * 0.0000015;
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

  // Event handler to send metrics to Datadog
  onEvent: async (event) => {
    const tags = [
      `user:${event.user}`,
      `plan:${event.plan}`,
      `endpoint:${event.endpoint}`,
      `action:${event.action || 'unknown'}`,
    ];

    // Increment request counter
    dogstatsd.increment('requests.total', 1, tags);

    // Track allowed vs blocked
    if (event.allowed) {
      dogstatsd.increment('requests.allowed', 1, tags);
    } else {
      dogstatsd.increment('requests.blocked', 1, tags);
      dogstatsd.increment(`requests.blocked.${event.type}`, 1, tags);
    }

    // Track cost metrics
    if (event.type === 'cost_exceeded' || (event.type === 'allowed' && event.value)) {
      dogstatsd.gauge('cost.current', event.value || 0, tags);

      if (event.type === 'cost_exceeded') {
        dogstatsd.increment('cost.exceeded', 1, tags);

        // Send event to Datadog Events API
        dogstatsd.event(
          'Rate Limit Cost Exceeded',
          `User ${event.user} on ${event.plan} plan exceeded cost cap for ${event.endpoint}. Current: $${event.value}`,
          {
            alert_type: 'warning',
            tags,
          }
        );
      }
    }

    // Track rate limit metrics
    if (event.type === 'rate_exceeded') {
      dogstatsd.increment('rate.exceeded', 1, tags);

      // Send event for high-value users
      if (event.plan === 'enterprise') {
        dogstatsd.event(
          'Enterprise User Rate Limited',
          `Enterprise user ${event.user} hit rate limit on ${event.endpoint}`,
          {
            alert_type: 'info',
            tags,
          }
        );
      }
    }

    // Track slowdown actions
    if (event.action === 'slowdown') {
      dogstatsd.increment('slowdown.applied', 1, tags);
      dogstatsd.histogram('slowdown.duration', event.slowdownMs || 0, tags);
    }

    // Track IP blocks
    if (event.type === 'ip_blocked') {
      dogstatsd.increment('ip.blocked', 1, tags);

      dogstatsd.event(
        'IP Blocked',
        `IP ${event.ip} was blocked from accessing ${event.endpoint}`,
        {
          alert_type: 'error',
          tags: [...tags, `ip:${event.ip}`],
        }
      );
    }

    // Distribution metrics for better percentile tracking
    if (event.value !== undefined) {
      dogstatsd.distribution('event.value', event.value, tags);
    }
  },
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Example API endpoint
app.post('/api/generate', async (req, res) => {
  const startTime = Date.now();

  try {
    // Simulate AI generation
    await new Promise((resolve) => setTimeout(resolve, 100));

    const duration = Date.now() - startTime;
    dogstatsd.timing('api.generate.duration', duration, [
      `user:${req.user?.id || 'anonymous'}`,
      `plan:${req.user?.plan || 'free'}`,
    ]);

    res.json({
      ok: true,
      message: 'Generation started',
      prompt: req.body.prompt,
    });
  } catch (error) {
    dogstatsd.increment('api.generate.error', 1);
    throw error;
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Datadog metrics enabled');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  dogstatsd.close(() => {
    console.log('StatsD client closed');
    process.exit(0);
  });
});

/**
 * Example Datadog Monitors:
 *
 * 1. Alert on high blocked rate:
 *    avg(last_5m):sum:limitrate.requests.blocked{plan:free}.as_rate() > 10
 *
 * 2. Alert on cost cap exceeded:
 *    sum(last_15m):limitrate.cost.exceeded{plan:pro} > 5
 *
 * 3. Alert on enterprise users hitting limits:
 *    sum(last_1h):limitrate.rate.exceeded{plan:enterprise} > 0
 *
 * 4. Track P95 latency:
 *    p95(last_5m):limitrate.api.generate.duration
 */
