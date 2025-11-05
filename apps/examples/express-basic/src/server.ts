import express from 'express';
import { limitrate } from '@limitrate/express';
import { saveEvent } from '@limitrate/cli';

const app = express();
const port = 3001;

// Apply LimitRate middleware
app.use(
  limitrate({
    // Identify user (in real app, use req.user.id from auth middleware)
    identifyUser: (req) => req.get('x-user-id') || req.ip || 'anonymous',

    // Identify plan (in real app, use req.user.plan from database)
    identifyPlan: (req) => {
      const plan = req.get('x-user-plan');
      return plan === 'pro' || plan === 'enterprise' ? plan : 'free';
    },

    // Use in-memory store for this example (Redis for production)
    store: { type: 'memory' },

    // Trust proxy headers (if behind nginx/cloudflare)
    trustProxy: false,

    // Define policies per plan
    policies: {
      free: {
        endpoints: {
          // Strict rate limit on API endpoint for free users
          'GET|/api/data': {
            rate: {
              maxPerMinute: 10,
              actionOnExceed: 'block',
            },
          },
        },
        // Default for all other endpoints
        defaults: {
          rate: {
            maxPerMinute: 60,
            actionOnExceed: 'block',
          },
        },
      },
      pro: {
        endpoints: {
          'GET|/api/data': {
            rate: {
              maxPerMinute: 100,
              actionOnExceed: 'slowdown',
              slowdownMs: 500, // Slow down instead of block
            },
          },
        },
        defaults: {
          rate: {
            maxPerMinute: 300,
            actionOnExceed: 'allow-and-log',
          },
        },
      },
      enterprise: {
        endpoints: {},
        defaults: {
          rate: {
            maxPerMinute: 1000,
            actionOnExceed: 'allow-and-log',
          },
        },
      },
    },

    // Custom upgrade hint
    upgradeHint: (plan) => {
      if (plan === 'free') {
        return 'Upgrade to Pro for 10x higher limits: https://yourapp.com/pricing';
      }
      return undefined;
    },

    // Event handler - save to SQLite for CLI dashboard + console logging
    onEvent: (event) => {
      // Save to SQLite for `npx limitrate inspect` command
      saveEvent(event);

      // Also log blocked/exceeded events to console
      if (event.type !== 'allowed') {
        console.log('🚨 LimitRate Event:', JSON.stringify(event, null, 2));
      }
    },
  })
);

// Example routes
app.get('/', (req, res) => {
  res.json({
    message: 'LimitRate Example API',
    endpoints: {
      '/api/data': 'Rate limited endpoint (free: 10/min, pro: 100/min)',
      '/api/hello': 'Less strict endpoint (free: 60/min, pro: 300/min)',
    },
    tip: 'Send "x-user-plan: pro" header to test pro tier limits',
  });
});

app.get('/api/data', (req, res) => {
  res.json({
    success: true,
    data: {
      timestamp: new Date().toISOString(),
      random: Math.random(),
    },
    message: 'This endpoint has strict rate limits',
  });
});

app.get('/api/hello', (req, res) => {
  res.json({
    success: true,
    message: 'Hello from LimitRate!',
  });
});

app.listen(port, () => {
  console.log(`\n✨ LimitRate Example Server running on http://localhost:${port}\n`);
  console.log('Try these commands:');
  console.log('  # Free user (10 req/min on /api/data)');
  console.log(`  for i in {1..15}; do curl http://localhost:${port}/api/data; echo ""; done\n`);
  console.log('  # Pro user (100 req/min on /api/data)');
  console.log(`  for i in {1..15}; do curl -H "x-user-plan: pro" http://localhost:${port}/api/data; echo ""; done\n`);
});
