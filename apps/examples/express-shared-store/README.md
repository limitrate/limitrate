# LimitRate Shared Store Example

This example demonstrates **shared store instances** - the #1 most requested feature in LimitRate.

## The Problem

When you create multiple rate limiters in your app, each one typically creates its own store instance:

```typescript
// ❌ PROBLEM: 4 limiters = 4 stores = 4 Redis connections
app.use(limitrate({ store: { type: 'redis', url: REDIS_URL }, policies: {...} }));         // Connection 1
app.use('/api', limitrate({ store: { type: 'redis', url: REDIS_URL }, policies: {...} })); // Connection 2 ❌
app.use('/admin', limitrate({ store: { type: 'redis', url: REDIS_URL }, policies: {...} })); // Connection 3 ❌
app.use('/webhooks', limitrate({ store: { type: 'redis', url: REDIS_URL }, policies: {...} })); // Connection 4 ❌
```

**Result:**
- 🔴 4 Redis connections (wastes connection pool)
- 🔴 4x memory usage
- 🔴 Connection pool exhaustion in production
- 🔴 Higher Redis costs

## The Solution

Create a shared store ONCE and reuse it across all limiters:

```typescript
import { createSharedRedisStore, limitrate } from '@limitrate/express';

// ✅ Create shared store ONCE
const store = createSharedRedisStore({ url: process.env.REDIS_URL });

// ✅ Reuse everywhere
app.use(limitrate({ store, policies: {...} }));         // Connection 1 ✅
app.use('/api', limitrate({ store, policies: {...} })); // Reuses connection 1 ✅
app.use('/admin', limitrate({ store, policies: {...} })); // Reuses connection 1 ✅
app.use('/webhooks', limitrate({ store, policies: {...} })); // Reuses connection 1 ✅
```

**Result:**
- ✅ 1 Redis connection (saves 75% connections)
- ✅ 1x memory usage (75% reduction)
- ✅ No connection pool exhaustion
- ✅ Lower Redis costs

## Quick Start

```bash
# Install dependencies
pnpm install

# Run the example
pnpm dev
```

Server runs on http://localhost:3010

## API Endpoints

### `GET /`
Shows example information and available endpoints.

```bash
curl http://localhost:3010/
```

### `GET /api/data`
Rate limit: **30 requests/minute**

```bash
curl http://localhost:3010/api/data
```

### `GET /admin/users`
Rate limit: **10 requests/minute** (strictest)

```bash
curl http://localhost:3010/admin/users
```

### `POST /webhooks/stripe`
Rate limit: **100 requests/minute** (lenient)

```bash
curl -X POST http://localhost:3010/webhooks/stripe
```

## Testing the Shared Store

### Test 1: Different Endpoints, Same Store

```bash
# Make 15 requests to /api/data (limit: 30)
for i in {1..15}; do curl http://localhost:3010/api/data; done

# Make 5 requests to /admin/users (limit: 10)
for i in {1..5}; do curl http://localhost:3010/admin/users; done
```

All requests are counted in the **same shared store**, but with **different rate limits** per endpoint.

### Test 2: Monitor with CLI Dashboard

```bash
npx limitrate inspect
```

You'll see all events from all limiters stored in a single database.

## Shared Store Factory Functions

LimitRate provides three factory functions for creating shared stores:

### 1. Memory Store (Development)

```typescript
import { createSharedMemoryStore } from '@limitrate/express';

const store = createSharedMemoryStore({
  maxKeys: 10000,
  cleanupIntervalMs: 60000
});
```

**Best for:**
- Development and testing
- Single-server deployments
- Low-traffic applications

### 2. Redis Store (Production)

```typescript
import { createSharedRedisStore } from '@limitrate/express';

// Option 1: From URL
const store = createSharedRedisStore({
  url: process.env.REDIS_URL,
  keyPrefix: 'limitrate:',
  redisOptions: {
    tls: { rejectUnauthorized: false }
  }
});

// Option 2: Pass existing Redis client
import Redis from 'ioredis';
const redisClient = new Redis(process.env.REDIS_URL);
const store = createSharedRedisStore({ client: redisClient });
```

**Best for:**
- Production deployments
- Multi-server setups
- High-traffic applications
- Distributed rate limiting

**Key Benefit:** **1 connection instead of N** (critical for production)

### 3. Upstash Store (Serverless)

```typescript
import { createSharedUpstashStore } from '@limitrate/express';

const store = createSharedUpstashStore({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
  keyPrefix: 'limitrate:'
});
```

**Best for:**
- Vercel Edge Functions
- Cloudflare Workers
- AWS Lambda
- Any serverless environment

**Key Benefit:** HTTP-based, no persistent connections needed

## Real-World Example: E-commerce API

```typescript
import express from 'express';
import { createSharedRedisStore, limitrate } from '@limitrate/express';

const app = express();

// Create shared Redis store ONCE
const store = createSharedRedisStore({
  url: process.env.REDIS_URL
});

// Global rate limit (100 req/min for free users)
app.use(limitrate({
  store,
  identifyUser: (req) => req.user?.id || req.ip,
  identifyPlan: (req) => req.user?.plan || 'free',
  policies: {
    free: {
      defaults: { rate: { maxPerMinute: 100 } }
    },
    pro: {
      defaults: { rate: { maxPerMinute: 500 } }
    }
  }
}));

// Stricter limit for checkout (10 req/min)
app.use('/checkout', limitrate({
  store, // ✅ Reuses same connection
  identifyUser: (req) => req.user?.id || req.ip,
  identifyPlan: () => 'checkout',
  policies: {
    checkout: {
      defaults: { rate: { maxPerMinute: 10 } }
    }
  }
}));

// Lenient limit for product search (500 req/min)
app.use('/search', limitrate({
  store, // ✅ Reuses same connection
  identifyUser: (req) => req.user?.id || req.ip,
  identifyPlan: () => 'search',
  policies: {
    search: {
      defaults: { rate: { maxPerMinute: 500 } }
    }
  }
}));

// Very strict limit for admin (5 req/min)
app.use('/admin', limitrate({
  store, // ✅ Reuses same connection
  identifyUser: (req) => req.user?.id || req.ip,
  identifyPlan: () => 'admin',
  policies: {
    admin: {
      defaults: { rate: { maxPerMinute: 5 } }
    }
  }
}));

// Result: 1 Redis connection for 4 limiters
app.listen(3000);
```

## Performance Comparison

| Metric | Without Shared Store | With Shared Store | Savings |
|--------|---------------------|-------------------|---------|
| **Redis Connections** | 4 connections | 1 connection | **75%** ⬇️ |
| **Memory Usage** | ~40 MB | ~10 MB | **75%** ⬇️ |
| **Cleanup Intervals** | 4 intervals | 1 interval | **75%** ⬇️ |
| **Connection Pool Usage** | 4 slots | 1 slot | **75%** ⬇️ |

### Real Production Impact

For a typical API with:
- 4 limiters (global, API, admin, webhooks)
- 10 application instances
- Redis connection limit: 100

**Without shared stores:**
- Total connections: 4 limiters × 10 instances = **40 connections**
- Remaining capacity: 60 connections

**With shared stores:**
- Total connections: 1 store × 10 instances = **10 connections**
- Remaining capacity: 90 connections
- **Result: 75% more capacity for other services!**

## When to Use Shared Stores

✅ **Use shared stores when:**
- You have multiple rate limiters in the same app
- You're using Redis (to reduce connections)
- You're hitting connection pool limits
- You want to reduce memory usage
- You want consistent rate limiting state

❌ **Don't use shared stores when:**
- You only have one limiter (no benefit)
- Different limiters need completely isolated stores
- You want independent cleanup schedules

## Troubleshooting

### Issue: "Too many Redis connections"

**Solution:** Use shared stores to reduce connections from N to 1.

```typescript
// Before: 4 connections
app.use(limitrate({ store: { type: 'redis', url: REDIS_URL }, ... }));
app.use('/api', limitrate({ store: { type: 'redis', url: REDIS_URL }, ... }));
app.use('/admin', limitrate({ store: { type: 'redis', url: REDIS_URL }, ... }));
app.use('/webhooks', limitrate({ store: { type: 'redis', url: REDIS_URL }, ... }));

// After: 1 connection ✅
const store = createSharedRedisStore({ url: REDIS_URL });
app.use(limitrate({ store, ... }));
app.use('/api', limitrate({ store, ... }));
app.use('/admin', limitrate({ store, ... }));
app.use('/webhooks', limitrate({ store, ... }));
```

### Issue: "Rate limits not working correctly"

Make sure you're using the **same store instance** (not creating new ones):

```typescript
// ❌ Wrong: Creates 2 separate stores
const store1 = createSharedRedisStore({ url: REDIS_URL });
const store2 = createSharedRedisStore({ url: REDIS_URL }); // Duplicate!

// ✅ Correct: Create once, reuse everywhere
const store = createSharedRedisStore({ url: REDIS_URL });
app.use(limitrate({ store, ... }));
app.use('/api', limitrate({ store, ... })); // Same instance
```

### Issue: "Memory leak"

If you create shared stores in a loop or on every request, you'll leak memory:

```typescript
// ❌ Wrong: Creates new store on every request
app.use((req, res, next) => {
  const store = createSharedMemoryStore(); // Memory leak!
  next();
});

// ✅ Correct: Create once at startup
const store = createSharedMemoryStore();
app.use(limitrate({ store, ... }));
```

## Learn More

- [LimitRate Documentation](https://github.com/limitrate/limitrate)
- [express-basic example](../express-basic) - Basic rate limiting
- [express-ai example](../express-ai) - AI cost tracking
- [vercel-upstash example](../vercel-upstash) - Serverless deployment

## License

Apache-2.0
