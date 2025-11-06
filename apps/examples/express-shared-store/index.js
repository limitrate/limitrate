/**
 * LimitRate Shared Store Example
 *
 * Demonstrates how to reuse a single store across multiple limitrate instances.
 *
 * PROBLEM: Creating N limiters creates N Redis connections → connection pool exhaustion
 * SOLUTION: Share one store across all limiters → 1 connection, 75% less memory
 */

import express from 'express';
import { limitrate, createSharedMemoryStore } from '@limitrate/express';

const app = express();
const PORT = 3010;

// =============================================================================
// ❌ BEFORE: Each limiter creates its OWN store (wasteful)
// =============================================================================

// app.use(limitrate({ store: { type: 'memory' }, policies: { free: {...} } }));       // Store #1
// app.use('/api', limitrate({ store: { type: 'memory' }, policies: { api: {...} } })); // Store #2 (duplicate!)
// app.use('/admin', limitrate({ store: { type: 'memory' }, policies: { admin: {...} } })); // Store #3 (duplicate!)
// app.use('/webhooks', limitrate({ store: { type: 'memory' }, policies: { webhooks: {...} } })); // Store #4 (duplicate!)

// Result:
// - 4 separate stores in memory
// - 4 cleanup intervals running
// - If using Redis: 4 connections (wastes connection pool)

// =============================================================================
// ✅ AFTER: Create ONCE, reuse everywhere (efficient)
// =============================================================================

console.log('🚀 Creating shared memory store...');
const sharedStore = createSharedMemoryStore({ maxKeys: 10000 });
console.log('✅ Shared store created (will be reused across all limiters)\n');

// Global limiter: Applies to all endpoints (60 req/min)
app.use(
  limitrate({
    store: sharedStore, // ✅ Reusing same store
    identifyUser: (req) => req.get('x-user-id') || req.ip,
    identifyPlan: (req) => req.get('x-user-plan') || 'free',
    policies: {
      free: {
        endpoints: {},
        defaults: {
          rate: {
            maxPerMinute: 60,
            actionOnExceed: 'block',
          },
        },
      },
    },
  })
);

// API limiter: Stricter limits for /api/* endpoints (30 req/min)
app.use(
  '/api',
  limitrate({
    store: sharedStore, // ✅ Reusing same store
    identifyUser: (req) => req.get('x-user-id') || req.ip,
    identifyPlan: () => 'api',
    policies: {
      api: {
        endpoints: {},
        defaults: {
          rate: {
            maxPerMinute: 30,
            actionOnExceed: 'block',
          },
        },
      },
    },
  })
);

// Admin limiter: Even stricter for /admin/* (10 req/min)
app.use(
  '/admin',
  limitrate({
    store: sharedStore, // ✅ Reusing same store
    identifyUser: (req) => req.get('x-user-id') || req.ip,
    identifyPlan: () => 'admin',
    policies: {
      admin: {
        endpoints: {},
        defaults: {
          rate: {
            maxPerMinute: 10,
            actionOnExceed: 'block',
          },
        },
      },
    },
  })
);

// Webhook limiter: Lenient for webhooks (100 req/min)
app.use(
  '/webhooks',
  limitrate({
    store: sharedStore, // ✅ Reusing same store
    identifyUser: (req) => req.get('x-webhook-source') || req.ip,
    identifyPlan: () => 'webhook',
    policies: {
      webhook: {
        endpoints: {},
        defaults: {
          rate: {
            maxPerMinute: 100,
            actionOnExceed: 'block',
          },
        },
      },
    },
  })
);

// =============================================================================
// Routes
// =============================================================================

app.get('/', (req, res) => {
  res.json({
    message: 'LimitRate Shared Store Example',
    endpoints: {
      global: 'Any endpoint: 60 req/min',
      api: '/api/data: 30 req/min (stricter)',
      admin: '/admin/users: 10 req/min (strictest)',
      webhooks: '/webhooks/stripe: 100 req/min (lenient)',
    },
    benefit: '1 store, 4 limiters, shared memory',
    comparison: {
      before: '4 stores (4x memory, 4x cleanup intervals)',
      after: '1 store (shared across all limiters)',
      savings: '75% memory reduction',
    },
  });
});

app.get('/api/data', (req, res) => {
  res.json({ data: 'API data', limit: '30 req/min' });
});

app.get('/admin/users', (req, res) => {
  res.json({ users: ['admin1', 'admin2'], limit: '10 req/min' });
});

app.post('/webhooks/stripe', (req, res) => {
  res.json({ received: true, limit: '100 req/min' });
});

// =============================================================================
// Server
// =============================================================================

app.listen(PORT, () => {
  console.log(`📊 Server running on http://localhost:${PORT}`);
  console.log('');
  console.log('Test endpoints:');
  console.log(`  Global:   curl http://localhost:${PORT}/`);
  console.log(`  API:      curl http://localhost:${PORT}/api/data`);
  console.log(`  Admin:    curl http://localhost:${PORT}/admin/users`);
  console.log(`  Webhooks: curl -X POST http://localhost:${PORT}/webhooks/stripe`);
  console.log('');
  console.log('📈 Memory efficiency:');
  console.log('  ✅ 1 shared store across 4 limiters');
  console.log('  ✅ 1 cleanup interval instead of 4');
  console.log('  ✅ Consistent rate limiting state');
  console.log('  ✅ 75% memory reduction vs separate stores');
  console.log('');
  console.log('🔍 Monitor with: npx limitrate inspect');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\\n🛑 Shutting down gracefully...');
  await sharedStore.close();
  process.exit(0);
});
