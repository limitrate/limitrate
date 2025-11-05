# LimitRate — Implementation Plan

**Status:** 🟡 Planning → Implementation
**Started:** 2025-11-04
**Target v1.0:** TBD

---

## Vision

**One-liner:**
LimitRate is a protective layer for API/AI backends—install one wrapper, enforce per-plan rate limits + AI cost caps, stop abusive traffic, get beautiful client responses.

**Core value:**
Drop in 20 lines of config, never worry about bots draining your AI budget or users hitting mysterious rate limits.

---

## Product Positioning

### Open-Source (v1)
- Full-featured rate limiting + cost caps
- Works 100% locally
- Bring your own Redis (or use in-memory)
- Local CLI dashboard
- Webhook events for DIY alerts
- Apache-2.0 license

### Paid Cloud (v2+)
- **SaaS Dashboard** (dashboard.limitrate.cloud)
- **Cloud Connector** (opt-in, streams events to cloud)
- Live rule changes (no redeploy)
- Managed alerts (Slack/email/PagerDuty)
- AI anomaly detection & suggestions
- Team/RBAC, audit logs
- Longer retention (7d free → 90d paid)
- Multi-environment (dev/staging/prod)

### Enterprise Self-Hosted (v3+)
- Self-hosted dashboard (runs in customer infrastructure)
- All data stays on-premises
- Air-gapped deployments
- Custom retention policies
- SSO/SAML integration

---

## Architecture Overview

### Packages
```
limitrate/
├── packages/
│   ├── core/           # @limitrate/core (algorithms, stores, policies)
│   ├── express/        # @limitrate/express (Express middleware)
│   ├── cli/            # @limitrate/cli (npx limitrate inspect)
│   └── cloud-connector/ # @limitrate/cloud (v2: streams to SaaS dashboard)
├── apps/
│   └── examples/
│       ├── express-basic/
│       ├── express-ai/
│       └── vercel-upstash/
├── tools/
│   └── k6/             # Load test scripts
└── docs/
    ├── README.md
    ├── ARCHITECTURE.md
    ├── TROUBLESHOOTING.md
    └── CLOUD.md        # Cloud connector setup (v2)
```

### Core Concepts

**Identity:** Who is making the request?
→ `userId` | `apiKey` | `ip`

**Plan:** What tier are they on?
→ `free` | `pro` | `enterprise`

**Endpoint:** What route + method?
→ Normalized to `POST|/ask-ai` (handles `/ask-ai/:id` → `/ask-ai/:id`)

**Rate Rule:** Requests per time window
→ 60/min for free, 300/min for pro

**Cost Rule:** Dollar spend per time window
→ Max $1/day on AI endpoint for free

**Enforcement Action:** What to do when exceeded?
→ `allow` | `block` | `slowdown` | `allow-and-log`

---

## Technical Design

### 1. Core (`@limitrate/core`)

**Responsibilities:**
- Rate limiting algorithms (token bucket, GCRA)
- Storage backends (memory, Redis, Upstash)
- Policy evaluation engine
- Event emission
- Route normalization

**No framework dependencies** (works with any Node.js framework).

#### Algorithms

**Token Bucket:**
```typescript
interface TokenBucket {
  capacity: number;      // max tokens (burst)
  refillRate: number;    // tokens/second
  tokens: number;        // current tokens
  lastRefill: number;    // timestamp
}
```

**GCRA (Generic Cell Rate Algorithm):**
```typescript
interface GCRAState {
  tat: number;           // theoretical arrival time
  period: number;        // time between requests
  burst: number;         // max burst allowance
}
```

Choose **GCRA** for production (smoother, sub-second precision).

#### Stores

**Interface:**
```typescript
interface Store {
  // Check rate limit, return remaining/reset
  checkRate(key: string, limit: number, windowSec: number): Promise<RateResult>;

  // Increment cost, return used/cap
  incrementCost(key: string, cost: number, windowSec: number): Promise<CostResult>;

  // Health check
  ping(): Promise<boolean>;
}
```

**Implementations:**

1. **MemoryStore** (`memory.ts`)
   - LRU cache (max 10k keys)
   - Auto-expire old entries
   - Single instance only

2. **RedisStore** (`redis.ts`)
   - Uses `ioredis`
   - Atomic Lua scripts
   - Connection pool
   - Works with any Redis

3. **UpstashStore** (`upstash.ts`)
   - Uses `@upstash/redis` (HTTP API)
   - Serverless-friendly (no persistent connection)
   - Atomic operations via REST

**Redis Lua Script (atomic rate check):**
```lua
-- KEYS[1] = rate key (e.g., "rate:user_123:POST|/ask-ai")
-- ARGV[1] = limit
-- ARGV[2] = window (seconds)
-- ARGV[3] = current timestamp

local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local current = redis.call('GET', key)
if not current then
  redis.call('SETEX', key, window, 1)
  return {1, limit - 1, window}
end

current = tonumber(current)
if current >= limit then
  local ttl = redis.call('TTL', key)
  return {current, 0, ttl}
end

redis.call('INCR', key)
return {current + 1, limit - current - 1, redis.call('TTL', key)}
```

#### Policy Model

```typescript
type EnforcementAction = 'allow' | 'block' | 'slowdown' | 'allow-and-log';

interface RateRule {
  maxPerMinute?: number;
  maxPerSecond?: number;
  burst?: number;
  actionOnExceed: EnforcementAction;
  slowdownMs?: number;
}

interface CostRule {
  estimateCost: (req: Request) => number;
  hourlyCap?: number;
  dailyCap?: number;
  actionOnExceed: EnforcementAction;
}

interface EndpointPolicy {
  rate?: RateRule;
  cost?: CostRule;
}

type PlanName = 'free' | 'pro' | 'enterprise';

type PolicyConfig = Record<
  PlanName,
  {
    endpoints: Record<string, EndpointPolicy>;
    defaults?: EndpointPolicy;
  }
>;
```

#### Route Normalization

```typescript
// Express: req.route?.path || req.path
// /ask-ai/123 → /ask-ai/:id
// /users/foo/posts/bar → /users/:id/posts/:id

function normalizeRoute(method: string, path: string, routePath?: string): string {
  const template = routePath || path.replace(/\/[^\/]+/g, (match) => {
    return /^\d+$/.test(match.slice(1)) ? '/:id' : match;
  });
  return `${method}|${template}`;
}
```

#### Event System

```typescript
interface LimitRateEvent {
  timestamp: number;
  user: string;
  plan: PlanName;
  endpoint: string;
  type: 'rate_exceeded' | 'cost_exceeded' | 'slowdown_applied' | 'allowed';
  window?: string;
  value?: number;
  threshold?: number;
}

// EventEmitter pattern
emitter.on('limit_exceeded', (event) => { ... });
```

---

### 2. Express Adapter (`@limitrate/express`)

**Responsibilities:**
- Express middleware wrapper
- Extract identity/plan from request
- Call core policy engine
- Set headers, send 429 responses
- Handle slowdown delays

**API:**
```typescript
import { limitrate, withPolicy } from '@limitrate/express';

interface LimitRateOptions {
  identifyUser: (req: Request) => string;
  identifyPlan: (req: Request) => PlanName;
  store: StoreConfig;
  trustProxy?: boolean;
  policies: PolicyConfig;
  ipAllowlist?: string[];        // v1: IPs that always pass
  ipBlocklist?: string[];        // v1: IPs that always block
  webhookUrl?: string;
  onEvent?: (event: LimitRateEvent) => void;
  onRedisError?: 'allow' | 'block'; // default: 'allow'
}

function limitrate(options: LimitRateOptions): RequestHandler;
function withPolicy(policy: EndpointPolicy): RequestHandler;
```

**Middleware Flow:**
1. Extract IP (respect `trustProxy` config)
2. Check IP allowlist → if match, skip all checks, allow
3. Check IP blocklist → if match, block immediately (403)
4. Extract `userId` via `identifyUser(req)`
5. Extract `plan` via `identifyPlan(req)`
6. Normalize endpoint: `POST|/ask-ai`
7. Resolve policy (endpoint-specific or plan default)
8. Check rate rule (if defined)
9. Check cost rule (if defined)
10. Determine action: allow / block / slowdown
11. Set headers (`Retry-After`, `RateLimit-*`)
12. If block: send 429 JSON
13. If slowdown: `await delay(ms)` then continue
14. Emit event
15. Call `next()`

**Response Format (429):**
```json
{
  "ok": false,
  "reason": "rate_limited",
  "message": "Free plan allows 60 req/min on POST /ask-ai. You sent 73.",
  "retry_after_seconds": 18,
  "used": 73,
  "allowed": 60,
  "plan": "free",
  "endpoint": "POST|/ask-ai",
  "upgrade_hint": "Upgrade to Pro for 300 req/min"
}
```

**Headers:**
```
HTTP/1.1 429 Too Many Requests
Retry-After: 18
RateLimit-Limit: 60
RateLimit-Remaining: 0
RateLimit-Reset: 1730720018
Content-Type: application/json
```

---

### 3. CLI (`@limitrate/cli`)

**Command:** `npx limitrate inspect`

**Responsibilities:**
- Read local event history (SQLite or JSON)
- Display:
  - Discovered endpoints
  - Request rate per endpoint
  - Recent enforcements (last 100)
  - Top offending users/IPs
- Output: terminal table or web UI (http://localhost:7777)

**Storage:**
- SQLite file: `.limitrate/history.db` (auto-created)
- Schema:
  ```sql
  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    timestamp INTEGER,
    user TEXT,
    plan TEXT,
    endpoint TEXT,
    type TEXT,
    value REAL,
    threshold REAL
  );
  CREATE INDEX idx_timestamp ON events(timestamp);
  CREATE INDEX idx_endpoint ON events(endpoint);
  ```

**Retention:** 48 hours (auto-delete old rows).

---

## Implementation Roadmap

### Phase 1: Core Foundation ✅ COMPLETED
- [x] Scaffold monorepo (pnpm workspaces)
- [x] `packages/core` setup (TypeScript, tsup build)
- [x] Config validation (fail-fast at startup)
- [x] MemoryStore implementation (`stores/memory.ts`)
- [x] RedisStore implementation with atomic Lua scripts (`stores/redis.ts`)
- [x] UpstashStore implementation (`stores/upstash.ts`)
- [x] Policy engine (`engine.ts`)
- [x] Route normalization (`utils/routes.ts`)
- [x] Event emitter (`utils/events.ts`)
- [x] Store factory (`stores/index.ts`)
- [x] Main exports (`index.ts`)
- [x] Build tested and working
- [ ] Unit tests (deferred to testing phase)

### Phase 2: Express Adapter ✅ COMPLETED
- [x] `packages/express` setup (TypeScript + tsup)
- [x] IP extraction (trustProxy logic)
- [x] IP allowlist/blocklist implementation
- [x] Middleware implementation
- [x] Identity/plan adapters (error handling with fallback)
- [x] 429 response builder (human-readable messages)
- [x] Header setting logic (RateLimit-*, Retry-After)
- [x] Slowdown implementation (async delay)
- [x] Webhook integration (3x retry: 1s, 4s, 16s)
- [x] Per-route override (`withPolicy`)
- [x] Example app (`apps/examples/express-basic`)
- [x] End-to-end testing (verified with test script)
- [ ] Integration tests (deferred to Phase 5)

### Phase 3: CLI (Minimal for v1)
- [ ] `packages/cli` setup (separate optional package)
- [ ] SQLite event storage (better-sqlite3)
- [ ] Storage interface (save/query events)
- [ ] `inspect` command (terminal table output)
- [ ] Auto-cleanup old events (48h retention)
- [ ] Auto-detection in Express middleware (optional dependency)
- [ ] Test with example app
- [ ] Web UI (deferred to v1.1)
- [ ] Advanced queries (deferred to v1.1)

### Phase 4: Examples
- [ ] `apps/examples/express-basic` (simple rate limit)
- [ ] `apps/examples/express-ai` (rate + cost caps)
- [ ] `apps/examples/vercel-upstash` (serverless)
- [ ] Each example has README + run instructions

### Phase 5: Testing & Benchmarking
- [ ] Property tests (fast-check: burst scenarios)
- [ ] Concurrency tests (100 parallel requests)
- [ ] Distributed tests (3 processes + shared Redis)
- [ ] k6 load tests (10k req/s for 60s)
- [ ] Benchmark overhead (p50/p95/p99)
- [ ] Publish results in README

### Phase 6: Documentation
- [ ] README.md (quickstart, badges, benchmarks)
- [ ] ARCHITECTURE.md (deep dive)
- [ ] TROUBLESHOOTING.md (common issues)
- [ ] API reference (TypeDoc)
- [ ] Migration guide (from express-rate-limit)

### Phase 7: Release
- [ ] CI/CD (GitHub Actions: lint, test, build)
- [ ] Changesets setup (versioning)
- [ ] npm publish `@limitrate/core@0.1.0`
- [ ] npm publish `@limitrate/express@0.1.0`
- [ ] npm publish `@limitrate/cli@0.1.0`
- [ ] GitHub release + changelog
- [ ] Tweet/post announcement

---

## Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Middleware overhead (memory) | p50 < 0.5ms | k6 benchmark |
| Middleware overhead (Redis) | p50 < 2ms | k6 benchmark |
| Redis roundtrips per check | 1 | Code review |
| Memory leak | 0 | 1M requests, monitor heap |
| Throughput (single instance) | 10k req/s | k6 load test |
| Correctness (distributed) | 100% | 3 instances, shared Redis, verify counts |

---

## Success Metrics (v1 OSS)

| Metric | Target | Timeline |
|--------|--------|----------|
| GitHub stars | 500 | 60 days |
| npm downloads/week | 1,000 | 8 weeks |
| Public projects using it | 5 | 90 days |
| Issues (bugs vs features) | < 20% bugs | Ongoing |
| P50 latency (published) | < 0.5ms | Launch |

---

## Cloud Dashboard Architecture (v2)

### SaaS Model

**Free Tier:**
- 100k tracked requests/month
- 7 days retention
- 1 project
- Basic analytics
- Email alerts

**Pro Tier ($29/mo):**
- 1M requests/month
- 90 days retention
- 5 projects
- Advanced analytics
- Slack/email alerts
- Live rule changes

**Enterprise Tier ($299/mo):**
- Unlimited requests
- 1 year retention
- Unlimited projects
- Team/RBAC
- AI anomaly detection
- Phone support
- SLA

### Cloud Connector

**Installation (v2):**
```typescript
import { limitrate } from '@limitrate/express';
import { connectCloud } from '@limitrate/cloud';

const gate = limitrate({
  // ... existing config
  cloud: connectCloud({
    apiKey: process.env.LIMITRATE_API_KEY,
    projectId: 'proj_123',
    sampling: {
      allowed: 0.1,        // Sample 10% of "allowed" events
      blocked: 1.0,        // Track 100% of blocks
      cost_exceeded: 1.0,  // Track 100% of cost caps
      slowdown: 1.0        // Track 100% of slowdowns
    }
  })
});
```

**Privacy:**
- Opt-in only (OSS works fully without it)
- No request/response bodies sent
- Only metadata: userId, plan, endpoint, timestamp, action
- User can self-host in v3

### Self-Hosted Dashboard (v3)

**For enterprises requiring on-premises:**
- Docker image: `limitrate/dashboard:latest`
- Runs in customer infrastructure
- All data stays on-premises
- SSO/SAML integration
- Custom retention policies
- Air-gapped deployments

---

## Configuration & Error Handling

### Validation Strategy

**Fail-fast at startup:**
```typescript
// Invalid config → app won't start
limitrate({
  policies: {
    free: {
      endpoints: {
        'POST|/api': {
          rate: { maxPerMinute: -50 }  // ❌ Error: maxPerMinute must be > 0
        }
      }
    }
  }
})
```

**Validation rules:**
- `maxPerMinute` / `maxPerSecond` / `burst` > 0
- `hourlyCap` / `dailyCap` > 0
- `slowdownMs` > 0 and < 60000 (max 60s)
- `estimateCost` is a function
- `identifyUser` / `identifyPlan` are functions
- IP allowlist/blocklist are valid IP/CIDR formats

### Error Handling

**`identifyUser()` / `identifyPlan()` throws:**
```typescript
// If adapter throws, log warning and use fallback
try {
  userId = identifyUser(req);
} catch (err) {
  logger.warn('identifyUser failed', err);
  userId = req.ip; // fallback to IP
}
```

**Redis connection fails:**
```typescript
limitrate({
  onRedisError: 'allow', // default: fail-open (allow requests)
  // or: 'block' (fail-closed, block all requests)
})
```

**Webhook fails:**
- Retry 3x with exponential backoff (1s, 4s, 16s)
- Log error after final failure
- Never block request due to webhook failure

---

## Version & Breaking Change Policy

### SemVer Commitment

**v1.x (stable):**
- No breaking changes
- Deprecation warnings added (6 months before removal)
- Security patches backported
- LTS support: 1 year from v2.0 release

**v2.0 (breaking changes):**
- Announced 6 months in advance
- Migration guide published
- v1.x continues receiving security patches for 1 year
- Deprecated features removed

**Example timeline:**
- **2025-03:** v1.0 ships
- **2025-09:** v1.5 ships, deprecates `maxPerMinute` (adds `requestsPerMinute`)
- **2026-03:** v2.0 ships, removes `maxPerMinute`, v1.x enters LTS
- **2027-03:** v1.x EOL (end of life)

### Deprecation Process

1. **Add warning:**
   ```typescript
   console.warn('[LimitRate] maxPerMinute is deprecated, use requestsPerMinute. Will be removed in v2.0');
   ```

2. **Update docs:**
   - Mark old API as deprecated
   - Provide migration examples

3. **6-month wait period**

4. **Remove in next major version**

---

## Open Questions → Decisions

- [x] **Cost estimation:** Start with user-provided `estimateCost` function, add helpers in v1.1
- [x] **Fail-open vs fail-closed:** Default `allow` (fail-open), configurable via `onRedisError`
- [x] **CLI web UI:** Terminal table in v1, web UI in v1.1
- [x] **IP handling:** Use rightmost IP when `trustProxy: true`, document proxy setup
- [x] **IP allowlist/blocklist:** Add to v1
- [x] **Config validation:** Fail-fast at startup
- [x] **Webhook retry:** 3x exponential backoff (1s, 4s, 16s)
- [x] **Breaking changes:** SemVer + 1yr LTS + 6mo deprecation
- [x] **Dashboard pricing:** Free 100k/mo, Pro $29/mo, Enterprise $299/mo
- [x] **Event sampling:** 10% allowed, 100% blocked/cost/slowdown

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Redis atomic ops are complex | High | Use battle-tested Lua scripts from `rate-limiter-flexible`, add extensive tests |
| Performance regression unnoticed | High | Benchmark in CI, fail if p50 > 1ms |
| Users misconfigure policies | Medium | Provide warnings for common mistakes (memory store in prod, no rate limits, etc.) |
| Serverless cold starts | Medium | Document Upstash as recommended, provide example |
| Breaking changes in deps | Low | Pin ioredis/@upstash versions, test in CI |

---

## Non-Goals (v1)

- ❌ No paid cloud yet (reserve interface hooks)
- ❌ No multi-language agents (Python/Go later)
- ❌ No deep payload validation/schema enforcement
- ❌ No auto-enforcement by AI suggestions
- ❌ No customer quota sync (Stripe/Chargebee hooks in v2)

---

## Adoption Enablers

### Trust & Onboarding

**Try without installing:**
- CodeSandbox live demo in README
- StackBlitz instant playground
- "Run this code" → see 429 response in 30 seconds

**Visual proof:**
- Animated GIF: "Hit endpoint 61 times → beautiful 429 with upgrade hint"
- Screenshot: CLI dashboard showing blocked requests
- Video: 2-minute walkthrough

**Comparison to DIY:**
```typescript
// Manual approach (40+ lines, prone to race conditions)
const rateLimits = new Map();
app.use((req, res, next) => {
  const key = `${req.user.id}:${req.path}`;
  const count = rateLimits.get(key) || 0;
  if (count >= 60) return res.status(429).json({error: 'Rate limited'});
  rateLimits.set(key, count + 1);
  setTimeout(() => rateLimits.delete(key), 60000);
  next();
});

// LimitRate (5 lines, production-ready)
app.use(limitrate({
  identifyUser: req => req.user.id,
  identifyPlan: req => req.user.plan,
  store: { type: 'redis', url: process.env.REDIS_URL },
  policies: { free: { defaults: { rate: { maxPerMinute: 60, actionOnExceed: 'block' }}}}
}));
```

**Mistake prevention:**
```typescript
// Warn if risky config detected
if (store.type === 'memory' && process.env.NODE_ENV === 'production') {
  console.warn(`
    ⚠️  [LimitRate] Memory store in production detected.
    Limits won't be shared across instances.
    Use Redis for distributed rate limiting:

    store: { type: 'redis', url: process.env.REDIS_URL }
  `);
}
```

### Community & Growth

**Launch strategy:**
1. **Week 1:** Publish to npm, post on Reddit r/node, HN, Twitter
2. **Week 2:** Blog post: "Why we built LimitRate" (with benchmarks)
3. **Week 4:** Integration guides (Next.js, tRPC, Remix, NestJS)
4. **Month 2:** Case study with early adopter
5. **Month 3:** "Who uses LimitRate" page (logos, testimonials)

**Contributing:**
- `CONTRIBUTING.md`: How to add a new store backend
- Good first issues labeled on GitHub
- Fast PR review (< 48h)

**Support:**
- Discord server (launch day)
- GitHub Discussions (Q&A, feature requests)
- Monthly office hours (Zoom call with maintainers)

**Integrations:**
- Next.js API routes guide
- tRPC middleware adapter
- Remix loader/action examples
- NestJS guard implementation

---

## 3-Year Roadmap

### v1.0–v1.5 (2025): Foundation
- ✅ Express adapter
- ✅ Memory/Redis/Upstash stores
- ✅ Rate + cost caps
- ✅ IP allowlist/blocklist
- ✅ Local CLI dashboard
- ✅ Fastify adapter (v1.1)
- ✅ NestJS adapter (v1.2)
- ✅ Cost helpers for OpenAI/Anthropic (v1.3)
- ✅ CLI web UI (v1.4)
- ✅ Python agent (v1.5)

### v2.0 (2026): SaaS Dashboard
- ✅ Cloud connector (opt-in)
- ✅ Hosted dashboard (dashboard.limitrate.cloud)
- ✅ Live rule changes (no redeploy)
- ✅ Managed Slack/email alerts
- ✅ Multi-environment (dev/staging/prod)
- ✅ AI anomaly detection ("Your /login is getting hammered")
- ✅ Team/RBAC
- ✅ Stripe/Chargebee quota sync
- ✅ Customer-facing quota widgets

### v3.0 (2027): Enterprise & Scale
- ✅ Self-hosted dashboard (Docker image)
- ✅ SSO/SAML integration
- ✅ Air-gapped deployments
- ✅ Multi-region distributed rate limiting (geo-aware)
- ✅ GraphQL support
- ✅ gRPC support
- ✅ Go agent
- ✅ Rust agent
- ✅ Advanced AI suggestions ("Detected credential stuffing on /login")

---

## Competitive Analysis

| Feature | LimitRate | express-rate-limit | rate-limiter-flexible | bottleneck |
|---------|----------|-------------------|----------------------|------------|
| Plan-aware limits | ✅ | ❌ | ❌ | ❌ |
| AI cost caps | ✅ | ❌ | ❌ | ❌ |
| Human-readable 429s | ✅ | ⚠️ | ❌ | ❌ |
| Local dashboard | ✅ | ❌ | ❌ | ❌ |
| Enforcement modes | ✅ (4 modes) | ⚠️ (2) | ⚠️ (2) | ⚠️ (2) |
| IP allowlist/blocklist | ✅ | ❌ | ❌ | ❌ |
| Upstash helper | ✅ | ❌ | ❌ | ❌ |
| Auto route discovery | ✅ | ❌ | ❌ | ❌ |
| TypeScript-first | ✅ | ⚠️ | ⚠️ | ⚠️ |
| Config validation | ✅ | ❌ | ❌ | ❌ |

---

## License & Ethics

- **License:** Apache-2.0 (OSS agent)
- **Telemetry:** None unless cloud connector enabled
- **Code of Conduct:** Contributor Covenant
- **Security:** Responsible disclosure policy in SECURITY.md
- **Philosophy:** Don't over-block; help users upgrade gracefully

---

## Progress Tracking

### Current Phase: Phase 3 (CLI Dashboard)

**Completed:**
- [x] Phase 1: Core Foundation (all stores, policy engine, validation)
- [x] Phase 2: Express Adapter (middleware, 429 responses, webhooks, example app)
- [x] @limitrate/core package built and working
- [x] @limitrate/express package built and working
- [x] End-to-end testing verified (rate limits work correctly)

**In Progress:**
- [ ] Phase 3: CLI (`npx limitrate inspect`)

**Blocked:**
- [ ] None

---

## Security & Trust

### Pre-Launch
- [ ] Security audit (basic: input validation, Redis injection, XSS)
- [ ] Responsible disclosure policy (SECURITY.md)
- [ ] Dependency pinning + Dependabot
- [ ] npm 2FA for publishing

### Post-Launch
- [ ] Bug bounty program (HackerOne, starting $100/bug)
- [ ] SOC2 compliance (for Enterprise dashboard, v3)
- [ ] Penetration testing (annual)
- [ ] Public incident log

### Best Practices
- No eval/Function() in codebase
- Sanitize all user inputs (IP, userId, endpoint)
- Rate limit the rate limiter (prevent internal DoS)
- Document security assumptions (trust Redis, trust headers, etc.)

---

## Notes & Decisions

**2025-11-04:**
- Created comprehensive PLAN.md
- Finalized all open questions (validation, webhooks, breaking changes, dashboard pricing)
- Decided on 3-store strategy (memory/redis/upstash)
- Express-first, modular core for future framework adapters
- GCRA algorithm for production smoothness (implementation deferred to optimization phase)
- IP allowlist/blocklist in v1
- SaaS dashboard v2, self-hosted v3
- 3-year roadmap: Foundation (2025) → SaaS (2026) → Enterprise (2027)
- Adoption enablers: CodeSandbox demo, visual proof, mistake prevention
- Community: Discord, contributing guide, integration guides
- Security: Audit, responsible disclosure, bug bounty

**Phase 1 Completed (2025-11-04):**
- ✅ Monorepo scaffolded with pnpm workspaces
- ✅ @limitrate/core package created and built successfully
- ✅ Three stores implemented: MemoryStore, RedisStore (atomic Lua), UpstashStore
- ✅ Policy engine with rate + cost checking
- ✅ Config validation (fail-fast)
- ✅ Event emitter for observability
- ✅ Route normalization utilities
- ✅ Full TypeScript support with proper exports

**Phase 2 Completed (2025-11-04):**
- ✅ @limitrate/express package created and built
- ✅ Express middleware with full policy evaluation
- ✅ Beautiful 429 responses with upgrade hints
- ✅ Standard rate limit headers (RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After)
- ✅ IP allowlist/blocklist with validation
- ✅ Webhook integration with 3x exponential backoff retry
- ✅ Slowdown enforcement (async delay before next())
- ✅ Error handling with fallback (identifyUser/Plan failures)
- ✅ Production warnings (memory store in prod)
- ✅ Working example app (`apps/examples/express-basic`)
- ✅ Test script proving rate limits work correctly
- ✅ Event logging to console (rate_exceeded events visible)

**Phase 3 Decision (2025-11-04):**
- ✅ Decided to build minimal CLI for v1.0
- Strategy: Separate optional package `@limitrate/cli`
- Auto-detection in middleware (graceful fallback if not installed)
- Simple `npx limitrate inspect` command with terminal table
- 48h event retention with auto-cleanup
- Web UI deferred to v1.1
