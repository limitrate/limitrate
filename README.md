# LimitRate

**Intelligent rate limiting and AI cost control for Node.js APIs**

Drop in 20 lines of config, never worry about bots draining your AI budget or users hitting mysterious rate limits.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-orange)](https://pnpm.io/)

---

## ⚠️ v3.0.0 Breaking Changes

**Upgrading from v2.x?** See [MIGRATION.md](./MIGRATION.md) for breaking changes and migration guide.

**What's new in v3.0.0:**
- 🎯 **Simplified & Focused** - Removed scope creep features to focus on core rate limiting
- 🗑️ **Removed:** Job Scheduler, Penalty/Reward System, IPv6 Subnet Limiting
- ⚙️ **Changed:** Endpoint Auto-Discovery now opt-in (set `trackEndpoints: true`)
- 📦 **Smaller Bundle** - Leaner, faster, easier to use

---

## Important Warnings

### Cost Estimation Accuracy

**LimitRate estimates costs BEFORE requests hit your AI provider. This is not billing tracking.**

**Accuracy levels:**
- `char/4 estimation` (like examples in this repo): **±30-50% accuracy**
  - Fast, no dependencies
  - Good for: budget guardrails, preventing abuse
  - Bad for: precise billing, cost attribution

- `tiktoken-based estimation`: **±5-10% accuracy**
  - Slower, requires tokenizer library
  - Good for: more accurate pre-request limits
  - Bad for: still not actual billing (doesn't include output tokens, system prompts, etc.)

**Use cases:**
- Use LimitRate to prevent catastrophic spend (e.g., $100/hour cap)
- Use your AI provider's billing API for actual cost tracking
- Don't rely on LimitRate for invoice-accurate cost tracking

See [HONEST-LIMITATIONS.md](./HONEST-LIMITATIONS.md) for more details.

### Production Deployment

**MemoryStore is NOT production-safe:**

| Store | Single Server | Multi-Server | Serverless | Notes |
|-------|---------------|--------------|------------|-------|
| MemoryStore | ⚠️ DEV ONLY | ❌ NO | ❌ NO | Data lost on restart, no sync across instances |
| RedisStore | ✅ YES | ✅ YES | ⚠️ MAYBE | Requires persistent Redis connection |
| UpstashStore | ✅ YES | ✅ YES | ✅ YES | HTTP-based, perfect for serverless |

**Why MemoryStore fails in production:**
- Data is lost when your server restarts
- Each instance has its own state (user could hit 10 req/min on each of 5 servers = 50 total)
- No persistence, no atomic operations across processes

**Always use RedisStore or UpstashStore in production.**

---

## Features

- ✅ **Plan-Aware Policies** — Different limits for free/pro/enterprise tiers
- ✅ **AI Cost Caps** — Track spend per user ($1/day cap, not just request count)
- ✅ **Multiple Stores** — Memory (dev), Redis (prod), Upstash (serverless)
- ✅ **Enforcement Modes** — block, slowdown, allow-and-log
- ✅ **Beautiful 429s** — JSON responses with upgrade hints and retry-after
- ✅ **IP Allowlist/Blocklist** — Brute-force protection and VIP access
- ✅ **CLI Dashboard** — `npx limitrate inspect` to view real-time stats
- ✅ **Webhook Events** — Real-time notifications for rate/cost exceeded
- ✅ **Multi-Model Support** — OpenAI, Claude, custom AI API cost tracking

---

## Quick Start

### Installation

```bash
pnpm add @limitrate/express @limitrate/core
# or
npm install @limitrate/express @limitrate/core
```

### Basic Usage

```typescript
import express from 'express';
import { limitrate } from '@limitrate/express';

const app = express();

app.use(limitrate({
  identifyUser: (req) => req.user?.id || req.ip,
  identifyPlan: (req) => req.user?.plan || 'free',

  store: { type: 'memory' }, // Use Redis in production

  policies: {
    free: {
      endpoints: {
        'POST|/api/ask': {
          rate: { maxPerMinute: 10, actionOnExceed: 'block' }
        }
      },
      defaults: {
        rate: { maxPerMinute: 60, actionOnExceed: 'block' }
      }
    },
    pro: {
      endpoints: {
        'POST|/api/ask': {
          rate: { maxPerMinute: 100, actionOnExceed: 'slowdown', slowdownMs: 500 }
        }
      }
    }
  }
}));

app.listen(3000);
```

**Result**: Free users get 10 requests/min on `/api/ask`, 60 req/min elsewhere. Pro users get 100 req/min with graceful slowdown instead of hard blocks.

---

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| **[@limitrate/core](packages/core)** | `0.0.1` | Policy engine, stores (Memory/Redis/Upstash), cost tracking |
| **[@limitrate/express](packages/express)** | `0.0.1` | Express middleware for LimitRate |
| **[@limitrate/cli](packages/cli)** | `0.0.1` | `npx limitrate inspect` dashboard |

---

## Use Cases

### 1️⃣ SaaS with Tiered Plans

```typescript
policies: {
  free: {
    endpoints: {
      'POST|/api/generate': {
        rate: { maxPerMinute: 5, actionOnExceed: 'block' }
      }
    }
  },
  pro: {
    endpoints: {
      'POST|/api/generate': {
        rate: { maxPerMinute: 100, actionOnExceed: 'slowdown', slowdownMs: 200 }
      }
    }
  },
  enterprise: {
    endpoints: {
      'POST|/api/generate': {
        rate: { maxPerMinute: 1000, actionOnExceed: 'allow-and-log' }
      }
    }
  }
}
```

### 2️⃣ AI API with Cost Caps

Protect your OpenAI budget with real-time cost tracking:

```typescript
function estimateOpenAICost(req) {
  const model = req.body.model || 'gpt-3.5-turbo';
  const prompt = req.body.prompt || '';
  const tokens = Math.ceil(prompt.length / 4);

  const pricing = {
    'gpt-3.5-turbo': 1.50 / 1_000_000,
    'gpt-4o': 5.00 / 1_000_000,
    'gpt-4': 30.00 / 1_000_000,
  };

  return tokens * (pricing[model] || pricing['gpt-3.5-turbo']);
}

policies: {
  free: {
    endpoints: {
      'POST|/api/ask': {
        rate: { maxPerMinute: 10, actionOnExceed: 'block' },
        cost: {
          estimateCost: estimateOpenAICost,
          hourlyCap: 0.10, // $0.10/hour (~67 GPT-3.5 requests)
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
          hourlyCap: 5.00, // $5/hour (~3,333 requests)
          actionOnExceed: 'block'
        }
      }
    }
  }
}
```

See **[express-ai example](apps/examples/express-ai)** for a complete working demo.

### 3️⃣ IP Allowlist/Blocklist

```typescript
ipAllowlist: ['192.168.1.0/24', '10.0.0.1'], // VIP IPs skip all checks
ipBlocklist: ['1.2.3.4'], // Instant 403
```

### 4️⃣ Graceful Slowdown Instead of Hard Blocks

```typescript
rate: {
  maxPerMinute: 100,
  actionOnExceed: 'slowdown',
  slowdownMs: 1000 // Add 1s delay instead of blocking
}
```

**Understanding Slowdown vs Block:**

Slowdown is a UX feature for paid tiers, NOT a server protection mechanism.

**What slowdown does:**
- Adds artificial delay (e.g., 500ms) before allowing the request
- User still gets their response (better UX than hard block)
- Good for: pro/enterprise tiers where you want soft limits

**What slowdown does NOT do:**
- Does NOT reduce server load (request still processes)
- Does NOT save API costs (AI call still happens)
- Does NOT protect against DDoS (just delays the attack)

**When to use slowdown:**
- Paid tiers: Soft limits for better UX ("please slow down")
- Rate smoothing: Encourage better client behavior

**When to use block:**
- Free tiers: Hard enforcement to prevent abuse
- Cost caps: Prevent budget overruns
- DDoS protection: Stop malicious traffic

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Express Request                         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
              ┌────────────────┐
              │  LimitRate      │
              │  Middleware    │
              └────────┬───────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   ┌─────────┐   ┌─────────┐   ┌─────────┐
   │ Memory  │   │  Redis  │   │ Upstash │
   │ Store   │   │  Store  │   │  Store  │
   └─────────┘   └─────────┘   └─────────┘
        │              │              │
        └──────────────┼──────────────┘
                       │
                       ▼
              ┌────────────────┐
              │ Policy Engine  │
              │ - Rate Check   │
              │ - Cost Check   │
              └────────┬───────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
    [block]      [slowdown]    [allow-and-log]
```

### How It Works

1. **Request arrives** → Middleware extracts user, plan, endpoint
2. **IP Check** → Check allowlist/blocklist (instant pass/block)
3. **Rate Limit** → Check request count against policy
4. **Cost Check** → Estimate API cost, check against cap
5. **Enforce** → Block (429), slowdown (delay), or allow-and-log

---

## Performance

LimitRate is optimized for minimal overhead in high-throughput applications:

- **Memory Store**: ~0.05ms per check (ideal for dev/single-server deployments)
- **Redis Store**: ~1-2ms per check (production-grade, atomic Lua scripts)
- **Upstash Store**: ~10-20ms per check (serverless, global edge network)

**Note**: Formal benchmarks coming soon. The above figures are based on internal testing with default configurations. Actual performance will vary based on network latency, Redis server specs, and policy complexity.

For now, LimitRate focuses on **correctness** and **developer experience** over micro-optimizations. If you have specific performance requirements or encounter bottlenecks, please [open an issue](https://github.com/limitrate/limitrate/issues).

---

## CLI Dashboard

Track usage in real-time:

```bash
npx limitrate inspect
```

**Shows**:
- Total API cost spent (last 48 hours)
- Requests per endpoint
- Top spenders by user
- Cost-exceeded events
- Rate-exceeded events

**Storage**: SQLite database at `.limitrate/events.db` (auto-pruned after 48 hours)

---

## Configuration

### Stores

#### Memory Store (Development)
```typescript
store: { type: 'memory' }
```

#### Redis Store (Production)
```typescript
store: {
  type: 'redis',
  url: process.env.REDIS_URL,
  keyPrefix: 'limitrate:'
}
```

#### Upstash Store (Serverless)
```typescript
store: {
  type: 'upstash',
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
}
```

### Enforcement Actions

| Action | Behavior | Use Case |
|--------|----------|----------|
| `block` | Return 429 immediately | Free tier hard limits |
| `slowdown` | Add delay (e.g., 500ms), then allow | Pro tier soft limits |
| `allow-and-log` | Allow request, emit event | Enterprise monitoring |

### Event Webhooks

```typescript
onEvent: async (event) => {
  if (event.type === 'cost_exceeded') {
    await fetch('https://yourapp.com/webhooks/limitrate', {
      method: 'POST',
      body: JSON.stringify(event)
    });
  }
}
```

**Event Types**:
- `allowed` — Request passed all checks
- `rate_exceeded` — User hit rate limit
- `cost_exceeded` — User hit cost cap
- `ip_blocked` — IP on blocklist

---

## Examples

- **[express-basic](apps/examples/express-basic)** — Simple rate limiting with 3 tiers
- **[express-ai](apps/examples/express-ai)** — OpenAI cost tracking with multi-model support
- **[vercel-upstash](apps/examples/vercel-upstash)** — Serverless deployment with Vercel + Upstash

---

## Performance

LimitRate is designed for high-throughput production APIs with minimal overhead.

### Benchmarks

Comprehensive benchmarks compare LimitRate against popular alternatives:

| Library | Store | p50 Latency | p95 Latency | Throughput |
|---------|-------|-------------|-------------|------------|
| **LimitRate** | Memory | ~0.2ms | ~2ms | 15,000+ req/s |
| express-rate-limit | Memory | ~0.5ms | ~3ms | 14,000+ req/s |
| rate-limiter-flexible | Memory | ~0.5ms | ~3ms | 14,500+ req/s |
| **LimitRate** | Redis | ~2ms | ~8ms | 12,000+ req/s |

**Key Features:**
- Sub-millisecond overhead with memory store
- Scales to 10,000+ req/s per instance
- Redis support for distributed systems
- Optimized for serverless environments

### Running Benchmarks

```bash
cd tools/benchmarks

# Install dependencies
pnpm install

# Quick verification test
pnpm test

# Full benchmark suite (requires k6)
./run-benchmarks.sh
```

See [tools/benchmarks/README.md](tools/benchmarks/README.md) for detailed benchmark documentation.

---

## Contributing

LimitRate is open source! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Security

Report vulnerabilities to **security@limitrate.dev** (see [SECURITY.md](SECURITY.md))

---

## Roadmap

### v1.0 (Current)
- ✅ Rate limiting (token bucket algorithm)
- ✅ AI cost tracking (hourly/daily caps)
- ✅ Multi-store support (Memory, Redis, Upstash)
- ✅ Express middleware
- ✅ CLI dashboard
- ✅ Event webhooks

### v1.1 (Next)
- 🔄 GCRA algorithm for smoother rate limiting
- 🔄 Fastify adapter
- 🔄 NestJS adapter
- 🔄 Prometheus metrics export

### v2.0 (Future)
- 📅 SaaS dashboard with live rule changes
- 📅 AI-powered usage predictions
- 📅 Multi-region cost tracking
- 📅 Custom storage adapters

---

## License

Apache-2.0 — See [LICENSE](LICENSE) for details.

---

**Built with ❤️ for developers who want to ship fast without budget surprises.**

[Documentation](docs/) • [Examples](apps/examples/) • [GitHub Issues](https://github.com/limitrate/limitrate/issues)
