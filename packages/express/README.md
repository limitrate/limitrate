# @limitrate/express

Express middleware for LimitRate rate limiting and AI cost control.

## Installation

```bash
pnpm add @limitrate/express @limitrate/core
# or
npm install @limitrate/express @limitrate/core
```

## Quick Start

```typescript
import express from 'express';
import { limitrate } from '@limitrate/express';

const app = express();

app.use(limitrate({
  identifyUser: (req) => req.user?.id || req.ip,
  identifyPlan: (req) => req.user?.plan || 'free',

  store: { type: 'memory' },

  policies: {
    free: {
      endpoints: {
        'POST|/api/generate': {
          rate: { maxPerMinute: 10, actionOnExceed: 'block' }
        }
      },
      defaults: {
        rate: { maxPerMinute: 60, actionOnExceed: 'block' }
      }
    },
    pro: {
      endpoints: {
        'POST|/api/generate': {
          rate: { maxPerMinute: 100, actionOnExceed: 'slowdown', slowdownMs: 500 }
        }
      }
    }
  }
}));

app.listen(3000);
```

## Configuration Options

### `identifyUser` (required)

Function to extract user identifier from request:

```typescript
identifyUser: (req) => {
  // From authenticated user
  if (req.user?.id) return req.user.id;

  // From API key
  if (req.headers['x-api-key']) return req.headers['x-api-key'];

  // Fallback to IP
  return req.ip || 'anonymous';
}
```

### `identifyPlan` (required)

Function to determine user's plan:

```typescript
identifyPlan: (req) => {
  // From authenticated user
  if (req.user?.plan) return req.user.plan;

  // From custom header
  const plan = req.get('x-user-plan');
  if (plan === 'pro' || plan === 'enterprise') return plan;

  return 'free';
}
```

### `store` (required)

Storage backend configuration:

```typescript
// Memory (development)
store: { type: 'memory' }

// Redis (production)
store: {
  type: 'redis',
  url: process.env.REDIS_URL,
  keyPrefix: 'fairgate:'
}

// Upstash (serverless)
store: {
  type: 'upstash',
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
}
```

### `policies` (required)

Plan-based rate limits and cost caps:

```typescript
policies: {
  [planName: string]: {
    endpoints: {
      [key: string]: {
        rate?: RateRule;
        cost?: CostRule;
      }
    };
    defaults?: {
      rate?: RateRule;
      cost?: CostRule;
    }
  }
}
```

**Endpoint key format**: `METHOD|/path` (e.g., `POST|/api/ask`, `GET|/api/data`)

### `trustProxy` (optional)

Trust proxy headers for IP extraction:

```typescript
trustProxy: true  // If behind nginx, Cloudflare, etc.
```

### `ipAllowlist` (optional)

IPs that always pass (skip all checks):

```typescript
ipAllowlist: ['192.168.1.0/24', '10.0.0.1']
```

### `ipBlocklist` (optional)

IPs that are always blocked (instant 403):

```typescript
ipBlocklist: ['1.2.3.4', '5.6.7.8']
```

### `webhookUrl` (optional)

Send events to a webhook:

```typescript
webhookUrl: 'https://yourapp.com/webhooks/fairgate'
```

### `onEvent` (optional)

Custom event handler:

```typescript
onEvent: async (event) => {
  if (event.type === 'cost_exceeded') {
    await sendAlert(`User ${event.user} exceeded cost cap`);
  }
}
```

**Event types**:
- `allowed` — Request passed all checks
- `rate_exceeded` — User hit rate limit
- `cost_exceeded` — User hit cost cap
- `ip_blocked` — IP on blocklist

### `onRedisError` (optional)

Behavior when Redis fails:

```typescript
onRedisError: 'allow'  // Default: allow requests through
// or
onRedisError: 'block'  // Block all requests on Redis failure
```

### `upgradeHint` (optional)

Custom message for 429 responses:

```typescript
upgradeHint: (plan) => {
  if (plan === 'free') {
    return 'Upgrade to Pro for 10x higher limits: https://yourapp.com/pricing';
  }
  return undefined;
}
```

### `skip` (optional)

Skip rate limiting for certain paths:

```typescript
skip: (req) => {
  // Skip health checks
  if (req.path === '/health') return true;

  // Skip internal IPs
  if (req.ip?.startsWith('192.168.')) return true;

  return false;
}
```

## 429 Response Format

When a request is blocked, LimitRate returns:

```json
{
  "ok": false,
  "reason": "rate_limited",
  "message": "Rate limit exceeded. Try again in 45 seconds.",
  "retry_after_seconds": 45,
  "used": 10,
  "allowed": 10,
  "plan": "free",
  "endpoint": "POST|/api/ask",
  "upgrade_hint": "Upgrade to Pro for 10x higher limits: https://yourapp.com/pricing"
}
```

**Headers**:
- `Retry-After: 45` — Seconds until limit resets
- `X-RateLimit-Limit: 10` — Max requests allowed
- `X-RateLimit-Remaining: 0` — Requests remaining
- `X-RateLimit-Reset: 1638360000` — Unix timestamp of reset

## Examples

### Basic Rate Limiting

```typescript
import express from 'express';
import { limitrate } from '@limitrate/express';

const app = express();

app.use(limitrate({
  identifyUser: (req) => req.ip,
  identifyPlan: () => 'free',
  store: { type: 'memory' },

  policies: {
    free: {
      defaults: {
        rate: { maxPerMinute: 60, actionOnExceed: 'block' }
      }
    }
  }
}));
```

### AI Cost Tracking

```typescript
import { limitrate } from '@limitrate/express';

function estimateOpenAICost(req) {
  const model = req.body.model || 'gpt-3.5-turbo';
  const prompt = req.body.prompt || '';
  const tokens = Math.ceil(prompt.length / 4);

  const pricing = {
    'gpt-3.5-turbo': 1.50 / 1_000_000,
    'gpt-4o': 5.00 / 1_000_000,
  };

  return tokens * (pricing[model] || pricing['gpt-3.5-turbo']);
}

app.use(limitrate({
  identifyUser: (req) => req.user?.id || req.ip,
  identifyPlan: (req) => req.user?.plan || 'free',
  store: { type: 'redis', url: process.env.REDIS_URL },

  policies: {
    free: {
      endpoints: {
        'POST|/api/ask': {
          rate: { maxPerMinute: 10, actionOnExceed: 'block' },
          cost: {
            estimateCost: estimateOpenAICost,
            hourlyCap: 0.10, // $0.10/hour
            actionOnExceed: 'block'
          }
        }
      }
    },
    pro: {
      endpoints: {
        'POST|/api/ask': {
          cost: {
            estimateCost: estimateOpenAICost,
            hourlyCap: 5.00, // $5/hour
            actionOnExceed: 'block'
          }
        }
      }
    }
  }
}));
```

See **[express-ai example](../../apps/examples/express-ai)** for a complete working demo.

### Multi-Tier SaaS

```typescript
app.use(limitrate({
  identifyUser: (req) => req.user?.id || req.ip,
  identifyPlan: (req) => req.user?.plan || 'free',
  store: { type: 'redis', url: process.env.REDIS_URL },

  policies: {
    free: {
      endpoints: {
        'POST|/api/generate': {
          rate: { maxPerMinute: 5, actionOnExceed: 'block' }
        }
      },
      defaults: {
        rate: { maxPerMinute: 60, actionOnExceed: 'block' }
      }
    },
    pro: {
      endpoints: {
        'POST|/api/generate': {
          rate: { maxPerMinute: 100, actionOnExceed: 'slowdown', slowdownMs: 200 }
        }
      },
      defaults: {
        rate: { maxPerMinute: 300, actionOnExceed: 'allow-and-log' }
      }
    },
    enterprise: {
      endpoints: {
        'POST|/api/generate': {
          rate: { maxPerMinute: 1000, actionOnExceed: 'allow-and-log' }
        }
      },
      defaults: {
        rate: { maxPerMinute: 5000, actionOnExceed: 'allow-and-log' }
      }
    }
  },

  upgradeHint: (plan) => {
    if (plan === 'free') {
      return 'Upgrade to Pro: https://yourapp.com/pricing';
    }
    if (plan === 'pro') {
      return 'Upgrade to Enterprise: https://yourapp.com/enterprise';
    }
  }
}));
```

### IP Allowlist/Blocklist

```typescript
app.use(limitrate({
  identifyUser: (req) => req.user?.id || req.ip,
  identifyPlan: (req) => req.user?.plan || 'free',
  store: { type: 'memory' },

  // VIP IPs skip all checks
  ipAllowlist: ['192.168.1.0/24', '10.0.0.1'],

  // Blocked IPs get instant 403
  ipBlocklist: ['1.2.3.4'],

  policies: {
    free: {
      defaults: {
        rate: { maxPerMinute: 60, actionOnExceed: 'block' }
      }
    }
  }
}));
```

### Graceful Slowdown

```typescript
app.use(limitrate({
  identifyUser: (req) => req.user?.id || req.ip,
  identifyPlan: (req) => req.user?.plan || 'free',
  store: { type: 'memory' },

  policies: {
    free: {
      endpoints: {
        'POST|/api/generate': {
          rate: {
            maxPerMinute: 10,
            actionOnExceed: 'slowdown',
            slowdownMs: 1000  // Add 1s delay instead of blocking
          }
        }
      }
    }
  }
}));
```

## TypeScript Support

Full TypeScript support with exported types:

```typescript
import {
  fairgate,
  type LimitRateOptions,
  type BlockedResponse,
  type PolicyConfig,
  type EndpointPolicy,
  type RateRule,
  type CostRule
} from '@limitrate/express';
```

## Integration with Auth Middleware

```typescript
import express from 'express';
import { authenticateUser } from './auth';
import { limitrate } from '@limitrate/express';

const app = express();

// 1. Auth middleware (adds req.user)
app.use(authenticateUser);

// 2. LimitRate middleware (uses req.user)
app.use(limitrate({
  identifyUser: (req) => req.user?.id || req.ip,
  identifyPlan: (req) => req.user?.subscription || 'free',
  store: { type: 'redis', url: process.env.REDIS_URL },
  policies: {
    // ...
  }
}));

// 3. Your routes
app.post('/api/generate', async (req, res) => {
  // If we get here, rate limits passed
  // ...
});
```

## Performance

- **MemoryStore**: <1ms latency, 100k+ ops/sec
- **RedisStore**: 1-5ms latency (local), 10k+ ops/sec
- **UpstashStore**: 50-200ms latency (global edge), 1k+ ops/sec

## License

Apache-2.0
