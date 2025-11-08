# LimitRate Roadmap: Path to Market Leadership

> **Mission**: Become the #1 rate limiting library by combining the best features of express-rate-limit and @upstash/ratelimit, while adding unique capabilities neither competitor has.

**Current Version**: v3.1.0
**Target**: v4.0.0 (Market Leader)
**Timeline**: 12 weeks
**Status**: 🟢 Planning Complete, Ready to Execute

---

## 📊 Competitive Analysis

### Current Market Position

| Metric | express-rate-limit | @upstash/ratelimit | LimitRate (Now) | LimitRate (Target) |
|--------|-------------------|-------------------|-----------------|-------------------|
| Weekly Downloads | 10M | 500K | 500 | 100K |
| GitHub Stars | 2.8K | 1.2K | 100 | 5K |
| Framework Support | ✅ Express | ✅ Universal | ❌ Express only | ✅ Universal |
| Algorithms | 1 | 4 | 1 | 4 |
| Plan-Aware | ❌ | ❌ | ✅ | ✅✅ |
| AI Cost Tracking | ❌ | ❌ | ✅ | ✅✅ |
| Observability | ❌ | ✅ Basic | ❌ | ✅✅ Advanced |
| Multi-Tenant | ❌ | ❌ | ❌ | ✅✅ |

### Our Advantages (Keep)
- ✅ Plan-aware policies (unique)
- ✅ AI cost tracking (unique)
- ✅ Webhook events (unique)
- ✅ CLI dashboard (unique)

### Gaps to Fill (Critical)
- ❌ Framework-agnostic architecture
- ❌ Multiple rate limiting algorithms
- ❌ Production-grade observability
- ❌ Test utilities
- ❌ Multi-tenant hierarchical limits

---

## 🎯 Phase 1: Framework Agnostic (v3.2.0)

**Goal**: Work with Express, Fastify, Hono, Next.js
**Timeline**: Weeks 1-3
**Status**: ⏸️ Not Started

### Architecture Changes

#### 1.1 Core Refactor
**File**: `packages/core/src/limiter.ts` (NEW)

```typescript
// Pure rate limiting logic - no framework dependencies
export class RateLimiter {
  async check(request: RateLimitRequest): Promise<RateLimitResult>;
  async checkCost(request: CostCheckRequest): Promise<CostCheckResult>;
}

interface RateLimitRequest {
  userId: string;
  endpoint: string;
  plan: string;
  method: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

interface RateLimitResult {
  allowed: boolean;
  current: number;
  limit: number;
  remaining: number;
  resetInSeconds: number;
  retryAfter?: number;
}
```

**Tasks**:
- [ ] Extract PolicyEngine to be framework-agnostic
- [ ] Create RateLimitRequest/Response interfaces
- [ ] Move all Express-specific code to adapter
- [ ] Add comprehensive tests for pure functions

---

#### 1.2 Adapter Pattern
**Package**: `@limitrate/adapters` (NEW)

```typescript
export interface FrameworkAdapter<TRequest, TResponse> {
  // Extract rate limit info from framework request
  extractRequest(req: TRequest): RateLimitRequest;

  // Send rate limit response via framework
  sendResponse(res: TResponse, result: RateLimitResult): void | Promise<void>;

  // Extract user identity
  extractUser(req: TRequest): string;

  // Extract plan/tier
  extractPlan(req: TRequest): string;
}
```

**Implementations**:
- [ ] ExpressAdapter (refactor existing)
- [ ] FastifyAdapter (new)
- [ ] HonoAdapter (new)
- [ ] NextAdapter (new)

---

#### 1.3 Framework Packages

##### Package: @limitrate/express (REFACTOR)
**Status**: ⏸️ Not Started

```typescript
import { RateLimiter } from '@limitrate/core';
import { ExpressAdapter } from '@limitrate/adapters';

export function limitrate(config: LimitRateConfig) {
  const limiter = new RateLimiter(config);
  const adapter = new ExpressAdapter(config.identifyUser, config.identifyPlan);

  return async (req: Request, res: Response, next: NextFunction) => {
    const request = adapter.extractRequest(req);
    const result = await limiter.check(request);

    if (!result.allowed) {
      return adapter.sendResponse(res, result);
    }

    next();
  };
}
```

**Tasks**:
- [ ] Refactor to use new RateLimiter class
- [ ] Move Express types to adapter
- [ ] Ensure backward compatibility
- [ ] Update all tests
- [ ] Update documentation

---

##### Package: @limitrate/fastify (NEW)
**Status**: ⏸️ Not Started

```typescript
import { RateLimiter } from '@limitrate/core';
import { FastifyAdapter } from '@limitrate/adapters';
import type { FastifyPluginAsync } from 'fastify';

export const limitrate: FastifyPluginAsync<LimitRateConfig> = async (fastify, opts) => {
  const limiter = new RateLimiter(opts);
  const adapter = new FastifyAdapter(opts.identifyUser, opts.identifyPlan);

  fastify.addHook('onRequest', async (request, reply) => {
    const req = adapter.extractRequest(request);
    const result = await limiter.check(req);

    if (!result.allowed) {
      return adapter.sendResponse(reply, result);
    }
  });
};
```

**Tasks**:
- [ ] Create package structure
- [ ] Implement FastifyAdapter
- [ ] Add Fastify-specific types
- [ ] Create example app
- [ ] Write tests
- [ ] Write documentation

**Example Usage**:
```typescript
import Fastify from 'fastify';
import { limitrate } from '@limitrate/fastify';

const app = Fastify();

await app.register(limitrate, {
  store: { type: 'memory' },
  policies: {
    free: { rate: { maxPerMinute: 10 } }
  }
});
```

---

##### Package: @limitrate/hono (NEW)
**Status**: ⏸️ Not Started

```typescript
import { RateLimiter } from '@limitrate/core';
import { HonoAdapter } from '@limitrate/adapters';
import type { MiddlewareHandler } from 'hono';

export function limitrate(config: LimitRateConfig): MiddlewareHandler {
  const limiter = new RateLimiter(config);
  const adapter = new HonoAdapter(config.identifyUser, config.identifyPlan);

  return async (c, next) => {
    const request = adapter.extractRequest(c.req);
    const result = await limiter.check(request);

    if (!result.allowed) {
      return c.json(result.error, { status: 429 });
    }

    await next();
  };
}
```

**Why Hono**: Perfect for Edge/Cloudflare Workers/Deno Deploy

**Tasks**:
- [ ] Create package structure
- [ ] Implement HonoAdapter
- [ ] Edge runtime compatibility
- [ ] Create Cloudflare Workers example
- [ ] Write tests
- [ ] Write documentation

**Example Usage**:
```typescript
import { Hono } from 'hono';
import { limitrate } from '@limitrate/hono';

const app = new Hono();

app.use('*', limitrate({
  store: { type: 'upstash', url: env.UPSTASH_REDIS_URL },
  policies: {
    free: { rate: { maxPerMinute: 10 } }
  }
}));
```

---

##### Package: @limitrate/nextjs (NEW)
**Status**: ⏸️ Not Started

```typescript
import { RateLimiter } from '@limitrate/core';
import { NextAdapter } from '@limitrate/adapters';
import { NextRequest, NextResponse } from 'next/server';

export function withRateLimit(config: LimitRateConfig) {
  const limiter = new RateLimiter(config);
  const adapter = new NextAdapter(config.identifyUser, config.identifyPlan);

  return function middleware(handler: NextHandler) {
    return async (request: NextRequest) => {
      const req = adapter.extractRequest(request);
      const result = await limiter.check(req);

      if (!result.allowed) {
        return NextResponse.json(result.error, { status: 429 });
      }

      return handler(request);
    };
  };
}
```

**Tasks**:
- [ ] Create package structure
- [ ] Implement NextAdapter for App Router
- [ ] Implement middleware pattern
- [ ] Create Next.js example app
- [ ] Write tests
- [ ] Write documentation

**Example Usage**:
```typescript
// app/api/chat/route.ts
import { withRateLimit } from '@limitrate/nextjs';

export const POST = withRateLimit({
  store: { type: 'upstash', url: process.env.UPSTASH_URL },
  policies: {
    free: { rate: { maxPerMinute: 10 } }
  }
})(async (request) => {
  // Your handler
});
```

---

### Success Criteria (v3.2.0)

- [ ] Core is 100% framework-agnostic
- [ ] All 4 framework packages working
- [ ] Backward compatibility maintained
- [ ] All existing tests passing
- [ ] New framework examples in /apps/examples
- [ ] Documentation updated
- [ ] Blog post: "One Rate Limiter, Four Frameworks"

**Deliverable**: LimitRate works with Express, Fastify, Hono, Next.js

---

## 🎯 Phase 2: Multiple Algorithms (v3.3.0)

**Goal**: Match @upstash/ratelimit's 4 algorithms
**Timeline**: Weeks 4-5
**Status**: ⏸️ Not Started

### 2.1 Sliding Window Algorithm
**File**: `packages/core/src/algorithms/sliding-window.ts` (NEW)

**Problem with Fixed Window**:
```
00:00 - 00:59: User makes 100 requests ✅ (window 1)
01:00 - 01:01: User makes 100 requests ✅ (window 2)
Result: 200 requests in 61 seconds (burst exploit!)
```

**Sliding Window Solution**:
```typescript
// Stores each request timestamp
// Counts requests in rolling N-second window
// More accurate, higher memory usage

interface SlidingWindowOptions {
  windowSeconds: number;
  maxRequests: number;
}

class SlidingWindowAlgorithm {
  async check(key: string, options: SlidingWindowOptions): Promise<AlgorithmResult> {
    const now = Date.now();
    const windowStart = now - (options.windowSeconds * 1000);

    // Remove old timestamps
    await this.store.removeOlderThan(key, windowStart);

    // Count requests in window
    const count = await this.store.count(key);

    if (count >= options.maxRequests) {
      return { allowed: false, current: count };
    }

    // Add timestamp
    await this.store.add(key, now);

    return { allowed: true, current: count + 1 };
  }
}
```

**Tasks**:
- [ ] Implement SlidingWindowAlgorithm class
- [ ] Add Redis sorted set support
- [ ] Add memory store support
- [ ] Write comprehensive tests
- [ ] Benchmark memory usage
- [ ] Document trade-offs

---

### 2.2 Token Bucket Algorithm
**File**: `packages/core/src/algorithms/token-bucket.ts` (NEW)

**Use Case**: Handling bursts gracefully

```typescript
interface TokenBucketOptions {
  capacity: number;      // Max tokens in bucket
  refillRate: number;    // Tokens added per second
  initialTokens?: number; // Starting tokens
}

class TokenBucketAlgorithm {
  async check(key: string, options: TokenBucketOptions): Promise<AlgorithmResult> {
    const bucket = await this.getBucket(key);

    // Refill tokens based on time elapsed
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000;
    const tokensToAdd = elapsed * options.refillRate;

    bucket.tokens = Math.min(
      options.capacity,
      bucket.tokens + tokensToAdd
    );
    bucket.lastRefill = now;

    // Check if we have a token
    if (bucket.tokens < 1) {
      return { allowed: false, current: 0 };
    }

    // Consume token
    bucket.tokens -= 1;
    await this.saveBucket(key, bucket);

    return { allowed: true, current: bucket.tokens };
  }
}
```

**Example**:
```typescript
// Perfect for AI image generation
rate: {
  algorithm: 'token-bucket',
  capacity: 10,      // Can burst 10 images
  refillRate: 0.1,   // Get 1 token every 10 seconds
}

// User behavior:
// t=0: Generate 5 images (5 tokens left)
// t=10: Generate 1 image (5 tokens left, got 1 back)
// t=100: Generate 10 images (bucket refilled)
```

**Tasks**:
- [ ] Implement TokenBucketAlgorithm class
- [ ] Add bucket state management
- [ ] Implement refill logic
- [ ] Write tests for edge cases
- [ ] Benchmark performance
- [ ] Document use cases

---

### 2.3 Leaky Bucket Algorithm
**File**: `packages/core/src/algorithms/leaky-bucket.ts` (NEW)

**Use Case**: Smooth traffic processing

```typescript
interface LeakyBucketOptions {
  capacity: number;    // Max requests in bucket
  leakRate: number;    // Requests processed per second
}

class LeakyBucketAlgorithm {
  async check(key: string, options: LeakyBucketOptions): Promise<AlgorithmResult> {
    const bucket = await this.getBucket(key);

    // Leak (process) requests based on time
    const now = Date.now();
    const elapsed = (now - bucket.lastLeak) / 1000;
    const leaked = elapsed * options.leakRate;

    bucket.count = Math.max(0, bucket.count - leaked);
    bucket.lastLeak = now;

    // Check capacity
    if (bucket.count >= options.capacity) {
      return { allowed: false, current: bucket.count };
    }

    // Add request to bucket
    bucket.count += 1;
    await this.saveBucket(key, bucket);

    return { allowed: true, current: bucket.count };
  }
}
```

**Tasks**:
- [ ] Implement LeakyBucketAlgorithm class
- [ ] Add queue management
- [ ] Implement leak logic
- [ ] Write tests
- [ ] Document use cases

---

### 2.4 Algorithm Selection API

**Configuration**:
```typescript
limitrate({
  policies: {
    free: {
      endpoints: {
        // High-traffic endpoint: Use sliding window for accuracy
        'GET|/api/users': {
          rate: {
            algorithm: 'sliding-window',
            maxPerMinute: 100
          }
        },

        // Burst-prone endpoint: Use token bucket
        'POST|/api/image': {
          rate: {
            algorithm: 'token-bucket',
            capacity: 10,
            refillRate: 0.1
          }
        },

        // Smooth processing: Use leaky bucket
        'POST|/api/process': {
          rate: {
            algorithm: 'leaky-bucket',
            capacity: 50,
            leakRate: 5
          }
        }
      },

      // Default: Fixed window (backward compatible)
      defaults: {
        rate: { maxPerMinute: 60 }
      }
    }
  }
})
```

**Smart Mode** (Auto-select algorithm):
```typescript
limitrate({
  smart: true,  // NEW: AI-powered algorithm selection
  policies: {
    free: {
      endpoints: {
        'POST|/api/chat': {
          rate: { maxPerMinute: 100 }
          // Smart mode analyzes traffic patterns and picks best algorithm
        }
      }
    }
  }
})
```

**Tasks**:
- [ ] Add algorithm field to RateRule type
- [ ] Implement algorithm factory
- [ ] Add algorithm selection logic
- [ ] Implement smart mode (basic heuristics)
- [ ] Write algorithm comparison docs

---

### Success Criteria (v3.3.0)

- [ ] 4 algorithms implemented
- [ ] All algorithms tested
- [ ] Performance benchmarks done
- [ ] Algorithm selection guide written
- [ ] Migration guide from fixed window
- [ ] Examples for each algorithm
- [ ] Blog post: "Choose the Right Rate Limiting Algorithm"

**Deliverable**: LimitRate has best-in-class algorithm support

---

## 🎯 Phase 3: Production Observability (v3.4.0)

**Goal**: Best observability in the category
**Timeline**: Weeks 6-7
**Status**: ⏸️ Not Started

### 3.1 Prometheus Metrics
**Package**: `@limitrate/prometheus` (NEW)

```typescript
import { limitrate } from '@limitrate/express';
import { prometheusMetrics } from '@limitrate/prometheus';

app.use(limitrate({
  metrics: prometheusMetrics({
    prefix: 'limitrate_',
    labels: ['plan', 'endpoint', 'user']
  })
}));

// Expose metrics endpoint
app.get('/metrics', prometheusMetrics.handler());
```

**Metrics to Export**:
```prometheus
# Request counters
limitrate_checks_total{plan="free",endpoint="POST|/api/chat",result="allowed"} 1523
limitrate_checks_total{plan="free",endpoint="POST|/api/chat",result="blocked"} 47

# Latency histogram
limitrate_check_duration_seconds_bucket{le="0.01"} 1200
limitrate_check_duration_seconds_bucket{le="0.05"} 1550
limitrate_check_duration_seconds_sum 45.2
limitrate_check_duration_seconds_count 1570

# Current usage gauge
limitrate_current_usage{user="user123",endpoint="POST|/api/chat"} 8
limitrate_limit{user="user123",endpoint="POST|/api/chat"} 10

# Cost tracking
limitrate_cost_total{user="user123",plan="free"} 0.45
limitrate_cost_cap{user="user123",plan="free"} 1.00

# Store health
limitrate_store_operations_total{store="redis",operation="get",status="success"} 1234
limitrate_store_operations_total{store="redis",operation="get",status="error"} 2
limitrate_store_latency_seconds_bucket{store="redis",operation="incr",le="0.01"} 980
```

**Tasks**:
- [ ] Create @limitrate/prometheus package
- [ ] Implement MetricsCollector interface
- [ ] Add Prometheus client dependency
- [ ] Export all key metrics
- [ ] Create Grafana dashboard JSON
- [ ] Write setup guide
- [ ] Add example queries

---

### 3.2 OpenTelemetry Tracing
**Package**: `@limitrate/opentelemetry` (NEW)

```typescript
import { opentelemetryTracing } from '@limitrate/opentelemetry';

app.use(limitrate({
  tracing: opentelemetryTracing({
    serviceName: 'my-api',
    exporter: 'jaeger' // or 'zipkin', 'datadog'
  })
}));
```

**Traces to Generate**:
```
Span: rate_limit_check
  ├─ Attributes:
  │  ├─ user.id: "user123"
  │  ├─ user.plan: "free"
  │  ├─ endpoint: "POST|/api/chat"
  │  ├─ algorithm: "fixed-window"
  │  ├─ result: "allowed"
  │  └─ limit.current: 8
  │
  ├─ Span: policy_lookup (0.2ms)
  ├─ Span: redis_get (1.1ms)
  ├─ Span: check_limit (0.3ms)
  └─ Span: redis_increment (0.4ms)
```

**Tasks**:
- [ ] Create @limitrate/opentelemetry package
- [ ] Add OpenTelemetry SDK
- [ ] Implement span creation
- [ ] Add context propagation
- [ ] Support multiple exporters
- [ ] Write setup guide

---

### 3.3 DataDog Integration
**Package**: `@limitrate/datadog` (NEW)

```typescript
import { datadogMetrics } from '@limitrate/datadog';

app.use(limitrate({
  metrics: datadogMetrics({
    apiKey: process.env.DD_API_KEY,
    site: 'datadoghq.com'
  })
}));
```

**Tasks**:
- [ ] Create @limitrate/datadog package
- [ ] Integrate DataDog client
- [ ] Send custom metrics
- [ ] Create default dashboard
- [ ] Write setup guide

---

### 3.4 Enhanced CLI Dashboard

**Current CLI**:
```bash
npx limitrate inspect
```

**New CLI**:
```bash
npx limitrate dashboard
```

**Dashboard UI**:
```
╔══════════════════════════════════════════════════════════════╗
║              LimitRate Live Dashboard                        ║
║              Last updated: 2025-01-08 14:23:45 PST           ║
╚══════════════════════════════════════════════════════════════╝

╔════════════════════════ SYSTEM STATUS ═══════════════════════╗
║  Store: Redis (upstash.com)                Status: ● Online  ║
║  Latency: 12ms (avg)  P99: 45ms                              ║
║  Total Requests: 15,234                    Uptime: 2d 5h     ║
║  Rate Limited: 523 (3.4%)                  Errors: 2 (0.01%) ║
╚══════════════════════════════════════════════════════════════╝

╔═════════════════════ TOP ENDPOINTS ══════════════════════════╗
┌────────────────────────────────┬─────────┬─────────┬─────────┐
│ Endpoint                       │ Allowed │ Blocked │ Block%  │
├────────────────────────────────┼─────────┼─────────┼─────────┤
│ POST|/api/chat                 │  8,234  │   234   │  2.8%   │
│ GET|/api/users/:id             │  4,123  │    45   │  1.1%   │
│ POST|/api/image                │  2,877  │   244   │  8.5%   │
└────────────────────────────────┴─────────┴─────────┴─────────┘

╔═════════════════════ TOP USERS ══════════════════════════════╗
┌──────────────┬──────────┬─────────┬─────────┬──────────┐
│ User         │ Plan     │ Requests│ Blocked │ Cost     │
├──────────────┼──────────┼─────────┼─────────┼──────────┤
│ user_abc123  │ pro      │  1,234  │    12   │  $0.45   │
│ user_def456  │ free     │    523  │    89   │  $0.12   │
│ user_ghi789  │ free     │    421  │   102   │  $0.08   │
└──────────────┴──────────┴─────────┴─────────┴──────────┘

╔═════════════════════ RECENT BLOCKS ══════════════════════════╗
  [14:23:45] user_xyz blocked on POST|/api/chat
             Reason: Rate limit exceeded (10/10 used)
             Plan: free | Retry in: 42s

  [14:23:42] user_abc blocked on POST|/api/image
             Reason: Cost cap reached ($1.00/$1.00)
             Plan: free | Resets in: 5h 32m

  [14:23:38] user_def blocked on GET|/api/data
             Reason: Rate limit exceeded (100/100 used)
             Plan: pro | Retry in: 15s

Press 'r' to refresh | 'q' to quit | 'e' to export CSV | 'f' to filter
```

**Features**:
- [ ] Real-time updates (refreshes every 5s)
- [ ] Colored output (green=good, red=blocked)
- [ ] Export to CSV
- [ ] Filter by user/endpoint/plan
- [ ] Historical view (past hour/day)
- [ ] Alert on threshold breach

**Tasks**:
- [ ] Enhance CLI with blessed/ink UI
- [ ] Add real-time data fetching
- [ ] Implement filtering
- [ ] Add export functionality
- [ ] Create alert system

---

### 3.5 Web Dashboard (Optional)
**Package**: `@limitrate/dashboard` (NEW)

```typescript
import { dashboard } from '@limitrate/dashboard';

// Standalone dashboard server
dashboard.start({
  port: 3001,
  store: { type: 'redis', url: process.env.REDIS_URL }
});

// Or mount in Express
app.use('/admin/limitrate', dashboard.middleware());
```

**Tasks**:
- [ ] Create React-based dashboard
- [ ] Real-time WebSocket updates
- [ ] User management UI
- [ ] Policy editor
- [ ] Analytics charts
- [ ] Alert configuration

---

### Success Criteria (v3.4.0)

- [ ] Prometheus package complete
- [ ] OpenTelemetry package complete
- [ ] DataDog package complete
- [ ] Enhanced CLI dashboard live
- [ ] Grafana dashboard templates
- [ ] Setup guides for all platforms
- [ ] Blog post: "Production-Grade Rate Limiting Observability"

**Deliverable**: Best observability in the category

---

## 🎯 Phase 4: Testing Framework (v3.5.0)

**Goal**: Best DX for testing
**Timeline**: Week 8
**Status**: ⏸️ Not Started

### 4.1 Test Utilities Package
**Package**: `@limitrate/testing` (NEW)

```typescript
import {
  createTestLimiter,
  advanceTime,
  resetLimits,
  makeRequests,
  expectBlocked,
  expectAllowed,
  snapshotLimits
} from '@limitrate/testing';

describe('My API Rate Limits', () => {
  const limiter = createTestLimiter({
    policies: {
      free: { rate: { maxPerMinute: 10 } }
    }
  });

  beforeEach(() => resetLimits(limiter));

  it('should block after 10 requests', async () => {
    await makeRequests(limiter, 10, {
      user: 'test-user',
      endpoint: 'POST|/api/chat'
    });

    await expectBlocked(limiter, {
      user: 'test-user',
      endpoint: 'POST|/api/chat'
    });
  });

  it('should reset after time window', async () => {
    await makeRequests(limiter, 10, { user: 'test-user' });

    advanceTime('1 minute');

    await expectAllowed(limiter, { user: 'test-user' });
  });

  it('should match snapshot', async () => {
    await makeRequests(limiter, 5, { user: 'test-user' });

    const state = snapshotLimits(limiter);
    expect(state).toMatchSnapshot();
  });
});
```

**Helper Functions**:

```typescript
// Create test limiter (in-memory, time-controllable)
function createTestLimiter(config: LimitRateConfig): TestLimiter;

// Time control
function advanceTime(duration: string): void;  // '1 minute', '30 seconds'
function setTime(timestamp: number): void;

// Request helpers
function makeRequests(limiter: TestLimiter, count: number, opts: RequestOpts): Promise<void>;
function simulateTraffic(limiter: TestLimiter, pattern: TrafficPattern): Promise<void>;

// Assertion helpers
function expectAllowed(limiter: TestLimiter, opts: RequestOpts): Promise<void>;
function expectBlocked(limiter: TestLimiter, opts: RequestOpts): Promise<void>;
function expectCostExceeded(limiter: TestLimiter, opts: RequestOpts): Promise<void>;

// State inspection
function getCurrentUsage(limiter: TestLimiter, user: string, endpoint: string): number;
function getRemainingTokens(limiter: TestLimiter, user: string): number;
function snapshotLimits(limiter: TestLimiter): LimitState;

// Reset helpers
function resetLimits(limiter: TestLimiter): void;
function resetUser(limiter: TestLimiter, user: string): void;
function resetEndpoint(limiter: TestLimiter, endpoint: string): void;
```

**Tasks**:
- [ ] Create @limitrate/testing package
- [ ] Implement TestLimiter class
- [ ] Add time manipulation
- [ ] Add assertion helpers
- [ ] Add state inspection
- [ ] Write comprehensive examples
- [ ] Document testing patterns

---

### 4.2 Mock Store
```typescript
import { mockRedis, mockUpstash } from '@limitrate/testing';

// Mock Redis with configurable behavior
const redis = mockRedis({
  latency: 10,        // 10ms latency
  failureRate: 0.01,  // 1% failure rate
  timeout: 5000       // 5s timeout
});

// Use in tests
const limiter = new RateLimiter({
  store: { client: redis }
});
```

**Tasks**:
- [ ] Implement mock Redis client
- [ ] Implement mock Upstash client
- [ ] Add failure simulation
- [ ] Add latency simulation
- [ ] Document usage

---

### 4.3 Integration Test Helpers
```typescript
import { createIntegrationTest } from '@limitrate/testing';

const test = createIntegrationTest({
  framework: 'express',
  store: 'redis',
  policies: { /* ... */ }
});

it('should rate limit in Express', async () => {
  const response = await test.request
    .post('/api/chat')
    .set('Authorization', 'Bearer test-token')
    .send({ message: 'Hello' });

  expect(response.status).toBe(200);
  expect(response.headers['x-ratelimit-remaining']).toBe('9');
});
```

**Tasks**:
- [ ] Create integration test framework
- [ ] Support all framework adapters
- [ ] Add supertest-like API
- [ ] Document patterns

---

### Success Criteria (v3.5.0)

- [ ] Testing package complete
- [ ] All helpers implemented
- [ ] Mock stores working
- [ ] Integration test framework ready
- [ ] Comprehensive examples
- [ ] Testing guide written
- [ ] Blog post: "Testing Rate Limits Made Easy"

**Deliverable**: Best testing DX in the category

---

## 🎯 Phase 5: Game-Changing Features (v4.0.0)

**Goal**: Features no competitor has
**Timeline**: Weeks 9-12
**Status**: ⏸️ Not Started

### 5.1 Multi-Tenant Hierarchical Limits

**Problem**: Current rate limiting is flat (per-user only)

**Solution**: Support org + user hierarchy

```typescript
limitrate({
  hierarchy: {
    enabled: true,
    levels: ['organization', 'user']
  },
  policies: {
    free: {
      organization: {
        rate: { maxPerDay: 10000 },
        cost: { maxPerMonth: 100 }
      },
      user: {
        rate: { maxPerMinute: 10 },
        cost: { maxPerDay: 1 }
      },
      endpoints: {
        'POST|/api/image': {
          organization: { rate: { maxPerDay: 1000 } },
          user: { rate: { maxPerDay: 50 } }
        }
      }
    }
  },
  identifyOrg: (req) => req.user.orgId,
  identifyUser: (req) => req.user.id
})
```

**How It Works**:
```
Request from user_123 in org_456:

1. Check org_456 limits:
   - org_456 daily: 8500/10000 ✅
   - org_456 for endpoint: 750/1000 ✅

2. Check user_123 limits:
   - user_123 per minute: 8/10 ✅
   - user_123 for endpoint: 45/50 ✅

3. Increment all counters:
   - org_456 daily: 8501
   - org_456 endpoint: 751
   - user_123 minute: 9
   - user_123 endpoint: 46

4. Allow request ✅

If org limit hit:
  → Block ALL users in org (org hit their quota)

If user limit hit:
  → Block only that user (other users can still make requests)
```

**API Design**:
```typescript
interface HierarchyConfig {
  enabled: boolean;
  levels: ('organization' | 'user' | 'team')[];
  identifyOrg?: (req: Request) => string;
  identifyTeam?: (req: Request) => string;
  identifyUser?: (req: Request) => string;
}

interface HierarchicalPolicy {
  organization?: RateLimitRule;
  team?: RateLimitRule;
  user?: RateLimitRule;
}
```

**Tasks**:
- [ ] Design hierarchy system
- [ ] Implement cascading checks
- [ ] Add counter management
- [ ] Handle edge cases (user without org)
- [ ] Write comprehensive tests
- [ ] Document patterns
- [ ] Create examples

---

### 5.2 Circuit Breaker

**Problem**: When downstream service fails, keep trying wastes resources

**Solution**: Stop calling failed services automatically

```typescript
limitrate({
  circuitBreaker: {
    enabled: true,
    errorThreshold: 0.5,        // Open after 50% errors
    timeout: 30000,              // Stay open 30s
    halfOpenRequests: 3,         // Try 3 requests when half-open
    resetTimeout: 60000,         // Reset to closed after 60s success
    onOpen: (endpoint, stats) => {
      logger.error(`Circuit opened for ${endpoint}`, stats);
      pagerduty.alert(`${endpoint} circuit breaker triggered`);
    },
    onHalfOpen: (endpoint) => {
      logger.warn(`Circuit half-open for ${endpoint}`);
    },
    onClose: (endpoint) => {
      logger.info(`Circuit closed for ${endpoint}`);
    }
  }
})
```

**Circuit States**:
```
CLOSED (Normal):
  ✅ All requests pass through
  📊 Track success/error rate
  ⚠️  If error rate > threshold → OPEN

OPEN (Failing):
  ❌ All requests fail fast (no downstream call)
  ⏱️  After timeout → HALF_OPEN

HALF_OPEN (Testing):
  ⚡ Allow N test requests
  ✅ If all succeed → CLOSED
  ❌ If any fail → OPEN
```

**Example Flow**:
```
t=0:   Circuit CLOSED, 90% success rate ✅
t=10:  Error spike, 60% error rate ⚠️
t=11:  Circuit OPENS (threshold exceeded) ❌
       → All requests fail fast for 30s
       → No load on downstream service
t=41:  Circuit HALF_OPEN, try 3 requests 🔄
t=42:  3 requests succeed ✅
t=43:  Circuit CLOSED, back to normal ✅
```

**Tasks**:
- [ ] Implement circuit breaker logic
- [ ] Add state machine
- [ ] Integrate with rate limiter
- [ ] Add metrics
- [ ] Write tests
- [ ] Document use cases

---

### 5.3 Geographic Distribution

**Problem**: Global apps need per-region limits

**Solution**: Region-aware rate limiting

```typescript
limitrate({
  geographic: {
    enabled: true,
    extractRegion: (req) => req.headers['cloudflare-region'] || 'unknown',
    regions: {
      'us-east': {
        rate: { maxPerMinute: 100 }
      },
      'eu-west': {
        rate: { maxPerMinute: 150 }  // Higher limit for EU
      },
      'ap-south': {
        rate: { maxPerMinute: 80 }
      }
    },
    global: {
      rate: { maxPerMinute: 250 }  // Total across all regions
    }
  }
})
```

**How It Works**:
```
Request from user_123 in us-east:

1. Check us-east limit: 85/100 ✅
2. Check global limit: 215/250 ✅
3. Increment both: us-east=86, global=216
4. Allow ✅

Request from user_123 in eu-west:

1. Check eu-west limit: 5/150 ✅
2. Check global limit: 216/250 ✅
3. Increment both: eu-west=6, global=217
4. Allow ✅

If global limit hit:
  → Block requests from ALL regions
```

**Tasks**:
- [ ] Design region extraction
- [ ] Implement regional counters
- [ ] Add global counter
- [ ] Handle unknown regions
- [ ] Write tests
- [ ] Document setup

---

### 5.4 Adaptive Limits (ML-Powered)

**Problem**: Fixed limits don't adapt to user behavior

**Solution**: Automatically adjust limits based on patterns

```typescript
limitrate({
  adaptive: {
    enabled: true,
    learnFrom: 'usage-patterns',
    adjustEvery: '1 hour',
    rules: [
      {
        name: 'reward-good-behavior',
        condition: {
          errorRate: { lt: 0.01 },     // <1% errors
          consistentUsage: true,         // Regular patterns
          minRequests: 100               // At least 100 req/day
        },
        action: {
          multiplyLimit: 1.5,            // Increase limit 50%
          maxLimit: 1000                 // Cap at 1000/min
        }
      },
      {
        name: 'penalize-abusers',
        condition: {
          errorRate: { gt: 0.10 },      // >10% errors
          burstTraffic: true,            // Sudden spikes
          irregularPatterns: true        // Non-human patterns
        },
        action: {
          multiplyLimit: 0.5,            // Reduce limit 50%
          minLimit: 10                   // Floor at 10/min
        }
      },
      {
        name: 'dynamic-business-hours',
        condition: {
          timeOfDay: { between: ['09:00', '17:00'] },
          dayOfWeek: { in: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] }
        },
        action: {
          multiplyLimit: 2.0             // Double limit during business hours
        }
      }
    ],
    notifications: {
      onAdjustment: (user, oldLimit, newLimit, reason) => {
        logger.info(`Adjusted ${user} limit: ${oldLimit} → ${newLimit} (${reason})`);
      }
    }
  }
})
```

**Learning Algorithm**:
```typescript
// Collect metrics:
- Request frequency (requests/hour)
- Error rate (4xx, 5xx responses)
- Traffic patterns (regular vs bursty)
- Time-of-day distribution
- Endpoint usage distribution

// Analyze patterns:
- Good user: Low errors, regular patterns → increase limit
- Suspicious user: High errors, irregular → decrease limit
- Business hours: Higher usage during work hours → temporary increase

// Apply adjustments:
- Gradual changes (max 50% per adjustment)
- Respect min/max bounds
- Log all adjustments for audit
```

**Tasks**:
- [ ] Design learning algorithm
- [ ] Implement pattern detection
- [ ] Add adjustment logic
- [ ] Create rule engine
- [ ] Write tests
- [ ] Document behavior
- [ ] Add safety limits

---

### 5.5 Smart Queueing

**Problem**: Blocking users is bad UX, but unlimited requests crash systems

**Solution**: Queue requests when limits hit

```typescript
limitrate({
  queueing: {
    enabled: true,
    maxQueueSize: 100,           // Max queued requests per user
    maxWaitTime: 30000,           // Max 30s wait
    strategy: 'fifo',             // or 'priority', 'fair'
    onQueued: (req, position) => {
      return {
        status: 202,
        message: `Request queued at position ${position}`,
        estimatedWait: position * 1000  // 1s per position
      };
    },
    onProcessed: (req, result) => {
      // Send result via webhook/SSE/WebSocket
    }
  }
})
```

**Queue Strategies**:

1. **FIFO (First In, First Out)**:
   - Process requests in order received
   - Fair, simple

2. **Priority**:
   - Pro users get priority over free
   - Process by plan tier first

3. **Fair Queueing**:
   - Round-robin between users
   - Prevents one user hogging queue

**Tasks**:
- [ ] Implement queue system
- [ ] Add multiple strategies
- [ ] Handle queue overflow
- [ ] Add monitoring
- [ ] Write tests
- [ ] Document patterns

---

### 5.6 Cost Optimization AI

**Problem**: Expensive AI calls waste money

**Solution**: Auto-optimize based on usage patterns

```typescript
limitrate({
  costOptimization: {
    enabled: true,
    strategies: [
      {
        name: 'cache-similar-requests',
        condition: { similarityThreshold: 0.9 },
        action: 'return-cached',
        savingsTarget: 0.3  // Save 30% of costs
      },
      {
        name: 'downgrade-model-for-simple',
        condition: { complexity: 'low' },
        action: { model: 'gpt-3.5-turbo' },  // Use cheaper model
        savingsTarget: 0.5  // Save 50% of costs
      },
      {
        name: 'batch-small-requests',
        condition: { tokenCount: { lt: 100 } },
        action: 'batch',
        maxBatchSize: 10
      }
    ],
    reporting: {
      showSavings: true,
      alertOnTarget: true
    }
  }
})
```

**Tasks**:
- [ ] Implement caching logic
- [ ] Add similarity detection
- [ ] Implement model downgrade
- [ ] Add batching
- [ ] Track savings
- [ ] Write tests
- [ ] Document strategies

---

### Success Criteria (v4.0.0)

- [ ] Multi-tenant limits working
- [ ] Circuit breaker implemented
- [ ] Geographic limits working
- [ ] Adaptive limits functioning
- [ ] Smart queueing operational
- [ ] Cost optimization active
- [ ] All features tested
- [ ] Comprehensive documentation
- [ ] Migration guide from v3.x
- [ ] Launch blog post
- [ ] Conference talk prepared
- [ ] Case studies written

**Deliverable**: LimitRate v4.0 - The most advanced rate limiting library ever built

---

## 📈 Success Metrics

### Downloads
- **Current**: 500/week
- **v3.2.0**: 5,000/week (10x)
- **v3.3.0**: 15,000/week (30x)
- **v3.4.0**: 30,000/week (60x)
- **v4.0.0**: 100,000/week (200x)

### GitHub
- **Current**: 100 stars
- **Target**: 5,000 stars

### Production Deployments
- **Current**: ~10
- **Target**: 1,000+

### Customer Testimonials
- **Current**: 0
- **Target**: 50+

### Market Position
- **Current**: #3 (niche player)
- **Target**: #1 (market leader)

---

## 🚨 Risk Mitigation

### Risk 1: Breaking Changes
**Mitigation**:
- Maintain backward compatibility in v3.x
- Deprecation warnings for old APIs
- Migration scripts provided
- Codemods for automatic updates

### Risk 2: Performance Regression
**Mitigation**:
- Benchmark every release
- Performance tests in CI
- No more than 10% slowdown allowed

### Risk 3: Complexity Creep
**Mitigation**:
- Keep simple use cases simple
- Advanced features opt-in only
- Clear defaults
- Comprehensive examples

### Risk 4: Maintenance Burden
**Mitigation**:
- Automated testing (>90% coverage)
- Clear architecture docs
- Contributor guidelines
- Community support system

---

## 📚 Documentation Plan

### For Each Phase:
- [ ] API reference
- [ ] Migration guide
- [ ] Best practices
- [ ] Common patterns
- [ ] Troubleshooting
- [ ] Performance tuning
- [ ] Security considerations

### Marketing Content:
- [ ] Launch blog post
- [ ] Comparison guides
- [ ] Video tutorials
- [ ] Conference talks
- [ ] Podcast interviews
- [ ] Case studies

---

## 🎉 Launch Strategy

### Phase 1 Launch (v3.2.0)
- Blog: "LimitRate Goes Universal"
- Twitter announcement
- Reddit posts (r/node, r/webdev)
- Show HN

### Phase 2 Launch (v3.3.0)
- Blog: "Choose Your Algorithm"
- Comparison with @upstash
- Technical deep-dive

### Phase 3 Launch (v3.4.0)
- Blog: "Production-Grade Observability"
- Grafana dashboard showcase
- Video demo

### Phase 4 Launch (v3.5.0)
- Blog: "Testing Made Easy"
- Live coding stream
- Testing patterns guide

### Phase 5 Launch (v4.0.0)
- Major release announcement
- Conference talk submissions
- Press release
- Podcast tour
- Case study series

---

## 📝 Notes

**Last Updated**: 2025-01-08
**Status**: Planning Complete
**Next Action**: Begin Phase 1 implementation

**Questions**:
- Which framework should we prioritize first? (Fastify vs Hono)
- Do we need Next.js Pages Router support or just App Router?
- Should smart mode be in v3.3 or v4.0?

**Decisions**:
- Framework order: Express (refactor) → Fastify → Next.js → Hono
- Algorithm order: Sliding window → Token bucket → Leaky bucket
- Metrics priority: Prometheus → OpenTelemetry → DataDog

---

**Ready to execute!** Let's dominate this market. 🚀
