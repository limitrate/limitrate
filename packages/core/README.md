# @limitrate/core

Core policy engine and storage adapters for LimitRate rate limiting and cost control.

This package provides the foundational algorithms, stores, and policy engine used by LimitRate framework adapters (Express, Fastify, NestJS, etc.).

## Installation

```bash
pnpm add @limitrate/core
# or
npm install @limitrate/core
```

## What's Inside

### Policy Engine

The heart of LimitRate — evaluates rate limits and cost caps for each request:

```typescript
import { PolicyEngine } from '@limitrate/core';

const engine = new PolicyEngine(store, policies);

const result = await engine.check({
  user: 'user-123',
  plan: 'free',
  endpoint: 'POST|/api/ask',
  ip: '1.2.3.4',
  costContext: { prompt: 'Hello world', model: 'gpt-3.5-turbo' }
});

if (!result.allowed) {
  console.log(`Blocked: ${result.reason}`);
}
```

### Storage Adapters

Three built-in stores for different deployment scenarios:

#### MemoryStore (Development)

```typescript
import { MemoryStore } from '@limitrate/core';

const store = new MemoryStore();
```

**Features**:
- In-memory rate limit and cost tracking
- No external dependencies
- Perfect for local development
- Data lost on restart

#### RedisStore (Production)

```typescript
import { RedisStore } from '@limitrate/core';

const store = new RedisStore({
  url: 'redis://localhost:6379',
  keyPrefix: 'limitrate:'
});
```

**Features**:
- Atomic Lua scripts for rate limiting
- Distributed tracking across servers
- Persistent storage
- Requires Redis 6.0+

#### UpstashStore (Serverless)

```typescript
import { UpstashStore } from '@limitrate/core';

const store = new UpstashStore({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!
});
```

**Features**:
- HTTP-based Redis API (no connection pooling needed)
- Perfect for Vercel, Cloudflare Workers, AWS Lambda
- Global low-latency with edge caching
- Pay-per-request pricing

## Type Definitions

### PolicyConfig

```typescript
interface PolicyConfig {
  [planName: string]: {
    endpoints: {
      [key: string]: EndpointPolicy;
    };
    defaults?: EndpointPolicy;
  };
}
```

### EndpointPolicy

```typescript
interface EndpointPolicy {
  rate?: RateRule;
  cost?: CostRule;
}
```

### RateRule

```typescript
interface RateRule {
  maxPerMinute?: number;
  maxPerHour?: number;
  maxPerDay?: number;
  actionOnExceed: 'block' | 'slowdown' | 'allow-and-log';
  slowdownMs?: number; // Required if actionOnExceed = 'slowdown'
}
```

### CostRule

```typescript
interface CostRule {
  estimateCost: (context: any) => number;
  hourlyCap?: number;
  dailyCap?: number;
  actionOnExceed: 'block' | 'slowdown' | 'allow-and-log';
  slowdownMs?: number;
}
```

## Examples

### Basic Rate Limiting

```typescript
import { PolicyEngine, MemoryStore } from '@limitrate/core';

const store = new MemoryStore();
const policies = {
  free: {
    endpoints: {
      'POST|/api/generate': {
        rate: {
          maxPerMinute: 10,
          actionOnExceed: 'block'
        }
      }
    }
  }
};

const engine = new PolicyEngine(store, policies);

const result = await engine.check({
  user: 'user-123',
  plan: 'free',
  endpoint: 'POST|/api/generate',
  ip: '1.2.3.4'
});
```

### AI Cost Tracking

```typescript
const policies = {
  free: {
    endpoints: {
      'POST|/api/ask': {
        cost: {
          estimateCost: (context) => {
            const tokens = Math.ceil(context.prompt.length / 4);
            return tokens * 0.0000015; // GPT-3.5 pricing
          },
          hourlyCap: 0.10, // $0.10/hour
          actionOnExceed: 'block'
        }
      }
    }
  }
};
```

### Custom Store

Implement your own storage adapter:

```typescript
import { Store, RateCheckResult, CostCheckResult } from '@limitrate/core';

class CustomStore implements Store {
  async checkRate(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<RateCheckResult> {
    // Your implementation
  }

  async incrementCost(
    key: string,
    cost: number,
    windowSeconds: number,
    cap: number
  ): Promise<CostCheckResult> {
    // Your implementation
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    // Cleanup
  }
}
```

## API Reference

### PolicyEngine

#### `constructor(store: Store, policies: PolicyConfig)`

Creates a new policy engine instance.

#### `check(context: CheckContext): Promise<CheckResult>`

Evaluates a request against policies.

**Parameters**:
- `context.user` — User identifier
- `context.plan` — Plan name (free, pro, enterprise, etc.)
- `context.endpoint` — Endpoint key (e.g., `POST|/api/ask`)
- `context.ip` — Client IP address
- `context.costContext?` — Optional context for cost estimation

**Returns**:
```typescript
{
  allowed: boolean;
  action: 'allow' | 'block' | 'slowdown' | 'allow-and-log';
  reason?: 'rate_limited' | 'cost_exceeded' | 'ip_blocked';
  details: {
    // Rate limit info
    rateLimit?: {
      current: number;
      limit: number;
      resetInSeconds: number;
    };
    // Cost info
    cost?: {
      current: number;
      cap: number;
      estimatedCost: number;
    };
  };
  slowdownMs?: number;
}
```

#### `on(event: string, handler: (data: any) => void): void`

Subscribe to events:

```typescript
engine.on('rate_exceeded', (data) => {
  console.log(`User ${data.user} hit rate limit on ${data.endpoint}`);
});

engine.on('cost_exceeded', (data) => {
  console.log(`User ${data.user} exceeded cost cap: $${data.value}`);
});
```

**Events**:
- `allowed` — Request passed all checks
- `rate_exceeded` — Rate limit exceeded
- `cost_exceeded` — Cost cap exceeded
- `ip_blocked` — IP on blocklist

### Store Interface

All stores implement the same interface:

#### `checkRate(key: string, limit: number, windowSeconds: number): Promise<RateCheckResult>`

Checks and increments rate limit counter.

#### `incrementCost(key: string, cost: number, windowSeconds: number, cap: number): Promise<CostCheckResult>`

Checks and increments cost tracker.

#### `ping(): Promise<boolean>`

Health check for the store.

#### `close(): Promise<void>`

Cleanup connections.

## Performance

### MemoryStore
- **Latency**: <1ms
- **Throughput**: 100k+ ops/sec
- **Use case**: Local development, single-server deployments

### RedisStore
- **Latency**: 1-5ms (local), 10-50ms (remote)
- **Throughput**: 10k+ ops/sec
- **Use case**: Multi-server production deployments

### UpstashStore
- **Latency**: 50-200ms (global edge)
- **Throughput**: 1k+ ops/sec per region
- **Use case**: Serverless, edge computing

## License

Apache-2.0
