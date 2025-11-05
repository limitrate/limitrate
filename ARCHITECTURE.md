# LimitRate Architecture

This document provides a technical deep-dive into LimitRate's architecture, design decisions, and implementation details.

## Table of Contents

1. [Overview](#overview)
2. [Core Components](#core-components)
3. [Data Flow](#data-flow)
4. [Storage Layer](#storage-layer)
5. [Algorithms](#algorithms)
6. [Performance](#performance)
7. [Design Decisions](#design-decisions)

---

## Overview

LimitRate is a modular rate limiting and cost control library built on three core principles:

1. **Simplicity** — Drop-in middleware with minimal configuration
2. **Performance** — Sub-millisecond overhead for most operations
3. **Flexibility** — Plan-aware policies, multiple storage backends, custom cost functions

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   Application Layer                       │
│              (Express, Fastify, NestJS, etc.)            │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│                @limitrate/express (or adapter)            │
│  - Extract user, plan, endpoint from request             │
│  - Call PolicyEngine.check()                             │
│  - Enforce action (block, slowdown, allow-and-log)       │
│  - Return 429 or pass to next middleware                 │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│                    @limitrate/core                        │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │          PolicyEngine (engine.ts)                 │  │
│  │  - Check IP allowlist/blocklist                   │  │
│  │  - Evaluate rate rules (checkRate)               │  │
│  │  - Evaluate cost rules (checkCost)               │  │
│  │  - Emit events                                    │  │
│  └────────────┬──────────────────────────┬───────────┘  │
│               │                          │              │
│               ▼                          ▼              │
│     ┌─────────────────┐       ┌─────────────────────┐  │
│     │  Rate Checking  │       │   Cost Checking     │  │
│     │  - Get policy   │       │  - Estimate cost    │  │
│     │  - Call store   │       │  - Call store       │  │
│     └────────┬────────┘       └─────────┬───────────┘  │
│              │                          │              │
│              └──────────┬───────────────┘              │
│                         ▼                              │
│              ┌────────────────────┐                    │
│              │   Store Interface  │                    │
│              │  - checkRate()     │                    │
│              │  - incrementCost() │                    │
│              └──────────┬─────────┘                    │
└─────────────────────────┼──────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ MemoryStore  │  │  RedisStore  │  │ UpstashStore │
│ (in-memory)  │  │ (Redis Lua)  │  │ (HTTP REST)  │
└──────────────┘  └──────────────┘  └──────────────┘
```

---

## Core Components

### 1. PolicyEngine (`packages/core/src/engine.ts`)

The brain of LimitRate. Responsible for:

- Loading and validating policies
- Checking rate limits and cost caps
- Emitting events (allowed, rate_exceeded, cost_exceeded, ip_blocked)
- Coordinating with the storage layer

**Key Methods**:

```typescript
class PolicyEngine extends EventEmitter {
  constructor(store: Store, policies: PolicyConfig);

  // Main entry point
  async check(context: CheckContext): Promise<CheckResult>;

  // Internal methods
  private async checkRate(context, policy): Promise<CheckResult>;
  private async checkCost(context, policy): Promise<CheckResult>;
  private getPolicy(plan, endpoint): EndpointPolicy;
  private async emitEvent(event): Promise<void>;
}
```

**Check Flow**:

```typescript
async check(context) {
  // 1. Get policy for user's plan + endpoint
  const policy = this.getPolicy(context.plan, context.endpoint);

  // 2. Check rate limit (if defined)
  if (policy.rate) {
    const rateResult = await this.checkRate(context, policy);
    if (!rateResult.allowed) return rateResult;
  }

  // 3. Check cost cap (if defined)
  if (policy.cost) {
    const costResult = await this.checkCost(context, policy);
    if (!costResult.allowed) return costResult;
  }

  // 4. All checks passed
  await this.emitEvent({ type: 'allowed', ...context });
  return { allowed: true, action: 'allow' };
}
```

### 2. Store Interface (`packages/core/src/types.ts`)

All storage backends implement this interface:

```typescript
interface Store {
  // Rate limiting: atomic increment + check
  checkRate(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<RateCheckResult>;

  // Cost tracking: atomic increment + check
  incrementCost(
    key: string,
    cost: number,
    windowSeconds: number,
    cap: number
  ): Promise<CostCheckResult>;

  // Health check
  ping(): Promise<boolean>;

  // Cleanup
  close(): Promise<void>;
}
```

### 3. Storage Implementations

#### MemoryStore (`packages/core/src/stores/memory.ts`)

- **Use case**: Development, single-server
- **Data structure**: `Map<string, { count: number, expiresAt: number }>`
- **Algorithm**: Token bucket with timestamp-based expiry
- **Performance**: <1ms, 100k+ ops/sec

**Implementation**:

```typescript
class MemoryStore implements Store {
  private cache = new Map<string, CacheEntry>();

  async checkRate(key, limit, windowSeconds) {
    const now = Date.now();
    const entry = this.cache.get(key);

    // Check if window expired
    if (!entry || entry.expiresAt <= now) {
      const expiresAt = now + windowSeconds * 1000;
      this.cache.set(key, { count: 1, expiresAt });
      return { allowed: true, current: 1, remaining: limit - 1, ... };
    }

    // Increment counter
    entry.count++;

    // Check if limit exceeded
    if (entry.count > limit) {
      return { allowed: false, current: entry.count - 1, remaining: 0, ... };
    }

    return { allowed: true, current: entry.count, remaining: limit - entry.count, ... };
  }
}
```

#### RedisStore (`packages/core/src/stores/redis.ts`)

- **Use case**: Production, multi-server
- **Data structure**: Redis strings with TTL
- **Algorithm**: Lua scripts for atomicity
- **Performance**: 1-5ms (local), 10-50ms (remote)

**Rate Limiting Lua Script**:

```lua
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])

local current = redis.call('GET', key)

if current == false then
  redis.call('SET', key, 1, 'EX', window)
  return {1, 1, limit - 1, window}
end

current = tonumber(current)

if current >= limit then
  local ttl = redis.call('TTL', key)
  return {0, current, 0, ttl}
end

redis.call('INCR', key)
local ttl = redis.call('TTL', key)

return {1, current + 1, limit - current - 1, ttl}
```

**Why Lua?**
- Atomic execution (no race conditions)
- Reduces round trips (1 network call vs 3-4)
- Consistent across Redis cluster nodes

#### UpstashStore (`packages/core/src/stores/upstash.ts`)

- **Use case**: Serverless (Vercel, Cloudflare Workers)
- **Data structure**: Same as Redis, accessed via HTTP REST API
- **Algorithm**: Same Lua scripts, executed via `@upstash/redis`
- **Performance**: 50-200ms (global edge)

**Why HTTP?**
- No connection pooling needed (perfect for serverless)
- Stateless (no hanging connections)
- Global edge caching

---

## Data Flow

### Example: Free User Hits Rate Limit

```
1. Request: POST /api/ask (10th request in 1 minute)

2. Express Middleware:
   - Extract user: "user-123"
   - Extract plan: "free"
   - Extract endpoint: "POST|/api/ask"

3. PolicyEngine.check():
   - Load policy: free.endpoints['POST|/api/ask']
   - Policy: { rate: { maxPerMinute: 10, actionOnExceed: 'block' } }

4. checkRate():
   - Key: "user-123:POST|/api/ask:rate"
   - Limit: 10
   - Window: 60 seconds
   - Call: store.checkRate(key, 10, 60)

5. RedisStore.checkRate():
   - Execute Lua script
   - Current count: 10
   - Result: { allowed: true, current: 10, remaining: 0, resetInSeconds: 45 }

6. PolicyEngine returns: { allowed: true, action: 'allow' }

7. Middleware: next() → Request proceeds

---

8. Request: POST /api/ask (11th request - OVER LIMIT)

9. ... (same as above until step 5) ...

10. RedisStore.checkRate():
    - Current count: 10 (already at limit)
    - Result: { allowed: false, current: 10, remaining: 0, resetInSeconds: 40 }

11. PolicyEngine:
    - Emit event: { type: 'rate_exceeded', user: 'user-123', value: 11, threshold: 10 }
    - Return: { allowed: false, action: 'block', reason: 'rate_limited', retryAfterSeconds: 40 }

12. Middleware:
    - Return 429: {
        ok: false,
        reason: 'rate_limited',
        message: 'Rate limit exceeded. Try again in 40 seconds.',
        retry_after_seconds: 40,
        used: 10,
        allowed: 10
      }
```

---

## Storage Layer

### Key Naming Convention

```
{user}:{endpoint}:rate     # Rate limit counter
{user}:{endpoint}:cost     # Cost tracker
```

**Examples**:
```
user-123:POST|/api/ask:rate
user-456:POST|/api/ask:cost
```

### Time Windows

- **maxPerMinute** → 60 seconds
- **maxPerHour** → 3600 seconds
- **maxPerDay** → 86400 seconds
- **hourlyCap** → 3600 seconds
- **dailyCap** → 86400 seconds

### Race Conditions

**Problem**: What if two requests arrive at the exact same time?

**Solution**: Atomic operations

- **MemoryStore**: Single-threaded JavaScript (no race conditions)
- **RedisStore**: Lua scripts execute atomically
- **UpstashStore**: Same Lua scripts via HTTP API

---

## Algorithms

### Current: Token Bucket

LimitRate v1.0 uses a **sliding window** variant of the token bucket algorithm:

```
Window: 60 seconds
Limit: 10 requests

Time:  0s    15s   30s   45s   60s   75s   90s
Req:   [1]   [2]   [3]   [4]   [5]   [6]   [7]
Count:  1     2     3     4     5     6     7
Allowed: ✓     ✓     ✓     ✓     ✓     ✓     ✓

Time:  95s   100s  105s  110s
Req:   [8]   [9]   [10]  [11]
Count:  8     9     10    10  (window resets at 60s)
Allowed: ✓     ✓     ✓     ✗   (blocked)
```

**Characteristics**:
- Simple to implement
- Low memory usage
- Burst-friendly (all tokens available at window start)
- Hard reset at window boundary

### Future: GCRA (v1.1)

**Generic Cell Rate Algorithm** provides smoother rate limiting:

```
Window: 60 seconds
Limit: 10 requests
Emission interval: 6 seconds

Time:  0s    6s    12s   18s   24s   30s
Req:   [1]   [2]   [3]   [4]   [5]   [6]
TAT:   6s    12s   18s   24s   30s   36s
Allowed: ✓     ✓     ✓     ✓     ✓     ✓

Time:  31s (too soon! must wait 5s)
Req:   [7]
Allowed: ✗   (blocked or delayed)

Time:  36s
Req:   [7]
TAT:   42s
Allowed: ✓
```

**Characteristics**:
- Smoother traffic shaping
- No burst at window start
- More complex to implement
- Slightly higher memory usage (need to store TAT)

---

## Performance

### Benchmarks

**MemoryStore**:
```
checkRate():       <1ms    (100k+ ops/sec)
incrementCost():   <1ms    (100k+ ops/sec)
Memory:            ~100 bytes per key
```

**RedisStore** (local):
```
checkRate():       1-2ms   (10k+ ops/sec)
incrementCost():   1-2ms   (10k+ ops/sec)
Network:           1 round trip (Lua script)
```

**UpstashStore** (global):
```
checkRate():       50-150ms (1k+ ops/sec)
incrementCost():   50-150ms (1k+ ops/sec)
Network:           HTTPS to nearest edge
```

### Bottlenecks

1. **Network latency** (Redis/Upstash) — Mitigate with:
   - Redis: Use local Redis or same-region
   - Upstash: Use edge regions close to users

2. **Policy complexity** — Mitigate with:
   - Cache policy lookups (already done in engine.ts)
   - Use defaults for most endpoints

3. **Cost estimation functions** — Mitigate with:
   - Keep estimateCost() simple (no async, no external calls)
   - Cache expensive calculations

---

## Design Decisions

### 1. Why Lua Scripts in Redis?

**Alternatives considered**:
- Multi-command transactions (MULTI/EXEC)
- Separate GET + SET + EXPIRE commands

**Chosen solution**: Lua scripts

**Reasons**:
- **Atomicity**: No race conditions
- **Performance**: 1 network round trip vs 3-4
- **Simplicity**: All logic in one script
- **Portability**: Works on all Redis versions 2.6+

### 2. Why Three Storage Backends?

**Why not just Redis?**
- Memory: Zero dependencies for dev/testing
- Upstash: Serverless environments can't maintain TCP connections

**Why not pluggable from day 1?**
- YAGNI: Most users need 1-2 backends
- TypeScript interfaces make custom stores easy if needed

### 3. Why Plan-Aware Policies?

**Alternative**: Single global policy with user-level overrides

**Chosen**: Plan-based policies (free, pro, enterprise)

**Reasons**:
- **Common pattern**: Most SaaS apps have tiered plans
- **Simpler config**: Clear separation of plan limits
- **Type safety**: Autocomplete for plan names
- **Upgrade hints**: Easy to show "upgrade to Pro" messages

### 4. Why Cost Tracking in addition to Rate Limiting?

**Problem**: AI API costs don't correlate with request count

Example:
```
Request 1: "Hi" → 2 tokens → $0.000003
Request 2: "Write a 5000-word essay" → 7500 tokens → $0.011
```

Request count limits are unfair: power users get blocked, spammers get through.

**Solution**: Track actual cost

```typescript
cost: {
  estimateCost: (ctx) => ctx.tokens * 0.0000015,
  hourlyCap: 0.10  // $0.10/hour regardless of request count
}
```

### 5. Why EventEmitter for Events?

**Alternatives**:
- Callbacks only
- Webhooks only
- No events

**Chosen**: EventEmitter + optional webhooks

**Reasons**:
- **Flexibility**: Subscribe to specific events only
- **Performance**: Local handlers are fast
- **Webhooks**: Optional, for external systems
- **CLI**: Events stored in SQLite for dashboard

### 6. Why SQLite for CLI Storage?

**Alternatives**:
- JSON file
- CSV
- PostgreSQL/MySQL

**Chosen**: SQLite

**Reasons**:
- **Zero config**: Ships with Node.js via better-sqlite3
- **Fast**: Indexed queries, <1ms reads
- **Portable**: Single file, easy to share/backup
- **Auto-pruning**: Can delete old events with SQL
- **CLI-first**: Perfect for local dashboards

### 7. Why pnpm Workspaces?

**Alternatives**:
- npm workspaces
- Yarn workspaces
- Lerna
- Separate repos

**Chosen**: pnpm workspaces

**Reasons**:
- **Disk efficiency**: Shared node_modules
- **Speed**: Faster than npm/yarn
- **Strictness**: Prevents phantom dependencies
- **Tooling**: Great monorepo support

---

## Future Improvements

### v1.1

- GCRA algorithm
- Fastify adapter
- NestJS adapter
- Prometheus metrics

### v2.0

- SaaS dashboard (live rule changes)
- AI cost predictions
- Multi-region coordination
- Custom storage adapters (DynamoDB, Cassandra, etc.)

### v3.0

- Go/Rust agents for higher performance
- Distributed consensus (etcd, Consul)
- Real-time streaming dashboards
- Enterprise self-hosted version

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## Questions?

Open a GitHub Discussion or email hello@limitrate.dev
