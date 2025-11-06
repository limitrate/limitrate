# LimitRate — Implementation Plan

**Status:** ✅ v1.3.0 Released | 🚧 Phase C Planning
**Started:** 2025-11-04
**Latest Release:** v1.3.0 (Nov 6, 2025) on npm
**Phase B Complete:** All 6 critical features shipped ✅

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

---

## 🤖 AI-Specific Features Roadmap

**Research Date:** 2025-11-06
**Goal:** Become the definitive rate limiting solution for AI applications

### Current AI Strengths (What We Have)

✅ **Cost Tracking** - Track spend per user with `estimateCost()` function
✅ **Hourly/Daily Caps** - `hourlyCap`, `dailyCap` for AI budgets
✅ **Multi-Model Support** - Different limits per AI model (GPT-4 vs GPT-3.5)
✅ **Event Webhooks** - Notifications when cost/rate exceeded
✅ **CLI Dashboard** - View AI spending in real-time

### AI Pain Points Identified (2025 Research)

Based on analysis of 2025 AI API landscape:

1. **Token-Based Limits** - Current rate limiting counts requests, not tokens
   - Problem: 10 requests with 10K tokens each != 10 requests with 100 tokens each
   - Solution: Need token-based rate limiting (maxTokensPerMinute)

2. **Prompt Size Validation** - No pre-flight checks before sending to AI
   - Problem: Large prompts fail at AI provider, but user already charged
   - Solution: Validate prompt size against model limits (8K, 32K, 128K) before sending

3. **Token Counting Accuracy** - Current `estimateCost()` is manual estimation
   - Problem: Inaccurate token counts lead to surprise bills
   - Solution: Integrate official OpenAI/Anthropic tokenizers

4. **Streaming Response Tracking** - No support for streaming AI responses
   - Problem: Can't track tokens in real-time for streaming endpoints
   - Solution: Middleware for tracking streaming token usage

5. **Batch Processing** - No built-in queuing for non-urgent AI requests
   - Problem: Batch API offers 50% discount, but requires manual queuing
   - Solution: Built-in queue system for batch-eligible requests

6. **Prompt Compression** - No optimization to reduce token costs
   - Problem: Developers pay full price for verbose prompts
   - Solution: Built-in prompt compression (20-30% token savings)

7. **Token Usage Analytics** - No detailed token consumption trends
   - Problem: Can't identify which users/endpoints are most expensive
   - Solution: Token-level analytics dashboard

---

## v1.6.0 - AI Power Features (STRATEGIC)

**Goal:** Make LimitRate the #1 choice for AI applications
**Timeline:** 4-6 weeks
**Total Effort:** ~40-50 hours
**Priority:** 🔴 HIGH - Major competitive differentiator

---

### Feature 1: Token-Based Rate Limiting

**Status:** ❌ Not Implemented
**Priority:** 🔴 CRITICAL (AI differentiator)
**Estimated Time:** 8-10 hours

**Why:** Requests don't equal cost - tokens do. A single request can be 1 token or 10,000 tokens.

**Implementation Example:**

```typescript
policies: {
  free: {
    endpoints: {
      'POST|/api/chat': {
        rate: {
          maxPerMinute: 10,           // Still limit requests
          maxTokensPerMinute: 50000,  // NEW: Also limit tokens
          maxTokensPerHour: 500000,   // NEW: Hourly token cap
          maxTokensPerDay: 5000000,   // NEW: Daily token cap
          actionOnExceed: 'block',
        }
      }
    }
  }
}
```

**Token Extraction:**
```typescript
// Automatically extract token usage from:
// 1. Request: req.body.max_tokens
// 2. Response: res.usage.total_tokens (OpenAI format)
// 3. Response: res.usage.input_tokens + output_tokens (Anthropic format)

identifyTokenUsage: (req, res) => {
  // Pre-request: Estimate from prompt
  if (!res) {
    return estimateTokens(req.body.messages);
  }
  // Post-request: Actual usage from response
  return res.usage?.total_tokens || 0;
}
```

**Acceptance Criteria:**
- ✅ Track tokens separately from request counts
- ✅ Support OpenAI response format (`usage.total_tokens`)
- ✅ Support Anthropic response format (`usage.input_tokens + output_tokens`)
- ✅ Pre-flight token estimation before API call
- ✅ Post-request actual token tracking
- ✅ Headers: `X-RateLimit-Tokens-Remaining`, `X-RateLimit-Tokens-Limit`

**Files to Modify:**
- `packages/core/src/types.ts` - Add `maxTokensPerMinute/Hour/Day` to rate config
- `packages/core/src/index.ts` - Token tracking logic in policy engine
- `packages/express/src/middleware.ts` - Extract tokens from req/res
- `apps/examples/express-ai/` - Update example with token limits

---

### Feature 2: Official Tokenizer Integration

**Status:** ❌ Not Implemented
**Priority:** 🟡 HIGH (accuracy improvement)
**Estimated Time:** 6-8 hours

**Why:** Current `estimateCost()` uses `prompt.length / 4` - inaccurate by 20-30%

**Implementation Example:**

```typescript
import { encoding_for_model } from '@dqbd/tiktoken'; // OpenAI
import Anthropic from '@anthropic-ai/sdk'; // Claude

// Built-in tokenizers
const tokenizers = {
  'gpt-3.5-turbo': encoding_for_model('gpt-3.5-turbo'),
  'gpt-4': encoding_for_model('gpt-4'),
  'gpt-4o': encoding_for_model('gpt-4o'),
  'claude-3-opus': Anthropic.countTokens,
  'claude-3-sonnet': Anthropic.countTokens,
};

policies: {
  free: {
    endpoints: {
      'POST|/api/chat': {
        cost: {
          estimateCost: async (req) => {
            const model = req.body.model || 'gpt-3.5-turbo';
            const messages = req.body.messages;

            // Use official tokenizer
            const tokenCount = await tokenizers[model](messages);

            const pricing = {
              'gpt-3.5-turbo': 0.0015 / 1000,
              'gpt-4': 0.03 / 1000,
              'gpt-4o': 0.005 / 1000,
            };

            return tokenCount * pricing[model];
          },
          hourlyCap: 0.10,
          actionOnExceed: 'block',
        }
      }
    }
  }
}
```

**Acceptance Criteria:**
- ✅ Support OpenAI tokenizers (tiktoken)
- ✅ Support Anthropic tokenizers
- ✅ Support custom tokenizers via plugin system
- ✅ Fallback to `length / 4` if tokenizer unavailable
- ✅ Cache tokenizer instances for performance
- ✅ Documentation: How to add custom tokenizers

**Files to Create/Modify:**
- `packages/core/src/tokenizers/` - New directory
- `packages/core/src/tokenizers/openai.ts` - OpenAI integration
- `packages/core/src/tokenizers/anthropic.ts` - Claude integration
- `packages/core/src/tokenizers/index.ts` - Tokenizer factory
- `packages/core/package.json` - Add `@dqbd/tiktoken`, `@anthropic-ai/sdk` as optional peer deps
- `apps/examples/express-ai/` - Example using official tokenizers

---

### Feature 3: Pre-Flight Validation (Model Limits)

**Status:** ❌ Not Implemented
**Priority:** 🟡 HIGH (prevents wasted API calls)
**Estimated Time:** 4-6 hours

**Why:** Sending 50K tokens to GPT-3.5 (4K limit) fails at OpenAI, but user already consumed rate limit slot

**Implementation Example:**

```typescript
policies: {
  free: {
    endpoints: {
      'POST|/api/chat': {
        validation: {
          // NEW: Model limits
          modelLimits: {
            'gpt-3.5-turbo': { maxTokens: 4096, maxOutputTokens: 4096 },
            'gpt-4': { maxTokens: 8192, maxOutputTokens: 8192 },
            'gpt-4-32k': { maxTokens: 32768, maxOutputTokens: 32768 },
            'gpt-4o': { maxTokens: 128000, maxOutputTokens: 16384 },
            'claude-3-opus': { maxTokens: 200000, maxOutputTokens: 4096 },
            'claude-3-sonnet': { maxTokens: 200000, maxOutputTokens: 4096 },
          },
          // Block if exceeds model limits
          actionOnInvalid: 'block', // or 'truncate'
        }
      }
    }
  }
}
```

**Response when blocked:**
```json
{
  "error": "prompt_too_large",
  "message": "Prompt contains 50,000 tokens but gpt-3.5-turbo supports max 4,096 tokens",
  "details": {
    "model": "gpt-3.5-turbo",
    "promptTokens": 50000,
    "maxTokens": 4096,
    "suggestion": "Use gpt-4-32k or claude-3-opus for large prompts"
  }
}
```

**Acceptance Criteria:**
- ✅ Pre-flight validation before consuming rate limit
- ✅ Built-in limits for 15+ popular models
- ✅ Custom limits via config
- ✅ Helpful error messages with model upgrade suggestions
- ✅ Optional truncation mode (truncate prompt to fit within limits)

**Files to Create/Modify:**
- `packages/core/src/validation/` - New directory
- `packages/core/src/validation/model-limits.ts` - Model definitions database
- `packages/core/src/validation/validator.ts` - Validation logic
- `packages/express/src/middleware.ts` - Pre-flight check before rate limit check
- `apps/examples/express-ai/` - Example with validation enabled

---

### Feature 4: Streaming Response Tracking

**Status:** ❌ Not Implemented
**Priority:** 🟡 MEDIUM (modern AI apps use streaming)
**Estimated Time:** 8-10 hours

**Why:** Streaming endpoints (`stream: true`) don't return token usage in single response - need to track chunks

**Implementation Example (Manual):**

```typescript
import { limitrate } from '@limitrate/express';

app.post('/api/chat', limitrate.middleware(), async (req, res) => {
  const stream = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: req.body.messages,
    stream: true,
  });

  let totalTokens = 0;

  for await (const chunk of stream) {
    // Track tokens in real-time
    if (chunk.usage) {
      totalTokens += chunk.usage.total_tokens;

      // Report back to LimitRate
      await limitrate.trackStreamingTokens(req, totalTokens);
    }

    res.write(JSON.stringify(chunk));
  }

  res.end();
});
```

**Implementation Example (Automatic):**
```typescript
app.post('/api/chat',
  limitrate.middleware({ trackStreaming: true }), // NEW
  async (req, res) => {
    // LimitRate automatically intercepts res.write() and tracks tokens
    const stream = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: req.body.messages,
      stream: true,
    });

    for await (const chunk of stream) {
      res.write(JSON.stringify(chunk)); // LimitRate tracks this automatically
    }

    res.end();
  }
);
```

**Acceptance Criteria:**
- ✅ Manual tracking: `limitrate.trackStreamingTokens(req, tokens)`
- ✅ Automatic tracking: Intercept `res.write()` for OpenAI SSE format
- ✅ Support OpenAI streaming format
- ✅ Support Anthropic streaming format
- ✅ Update token limits in real-time during stream
- ✅ Block mid-stream if token limit exceeded (close stream gracefully)

**Files to Create/Modify:**
- `packages/core/src/streaming.ts` - Streaming token tracker
- `packages/express/src/middleware.ts` - Intercept res.write()
- `packages/express/src/streaming.ts` - Streaming response wrapper
- `apps/examples/express-ai/streaming.js` - Streaming example

---

### Feature 5: Built-In Prompt Compression

**Status:** ❌ Not Implemented
**Priority:** 🟢 LOW (nice-to-have optimization)
**Estimated Time:** 6-8 hours

**Why:** Prompt compression can reduce token usage by 20-30% without losing meaning

**Implementation Example:**

```typescript
policies: {
  free: {
    endpoints: {
      'POST|/api/chat': {
        optimization: {
          // NEW: Automatic prompt compression
          compressPrompts: true,
          compressionStrategy: 'llmlingua', // or 'simple' or custom function
          compressionRatio: 0.5, // Target 50% compression
        },
        rate: {
          maxTokensPerMinute: 50000,
        }
      }
    }
  }
}
```

**Compression Techniques:**
1. **LLMLingua** - ML-based prompt compression (research paper implementation)
2. **Simple heuristics** - Remove filler words, redundant spaces, articles
3. **Custom functions** - User-provided compression logic

**Custom Compression Example:**
```typescript
optimization: {
  compressPrompts: async (messages) => {
    // Your custom logic
    return messages.map(m => ({
      ...m,
      content: removeFillerWords(m.content)
    }));
  }
}
```

**Acceptance Criteria:**
- ✅ Optional feature (disabled by default)
- ✅ Built-in compression strategies: 'llmlingua', 'simple'
- ✅ Custom compression functions
- ✅ Metrics: Show token savings in dashboard
- ✅ A/B testing support: Compare compressed vs uncompressed quality

**Files to Create/Modify:**
- `packages/core/src/optimization/` - New directory
- `packages/core/src/optimization/compress.ts` - Compression logic
- `packages/core/src/optimization/strategies/` - Built-in strategies
- `apps/examples/express-ai/compression.js` - Compression example

---

### Feature 6: Batch Queue System

**Status:** ❌ Not Implemented
**Priority:** 🟢 MEDIUM (50% cost savings for async requests)
**Estimated Time:** 10-12 hours

**Why:** OpenAI Batch API offers 50% discount but requires manual queuing

**Implementation Example:**

```typescript
policies: {
  free: {
    endpoints: {
      'POST|/api/summarize': {
        queue: {
          // NEW: Queue non-urgent requests
          enabled: true,
          batchSize: 50,           // Send 50 requests at once
          maxWaitTime: 60000,      // Wait max 60s before sending batch
          provider: 'openai-batch', // Built-in OpenAI Batch API support
        },
        rate: {
          maxPerMinute: 100, // Still enforce user limits
        }
      }
    }
  }
}
```

**User Experience:**
```bash
# Async request (queued)
POST /api/summarize
Response: 202 Accepted
{
  "status": "queued",
  "batchId": "batch_abc123",
  "estimatedTime": "60 seconds",
  "webhookUrl": "https://yourapp.com/webhook/batch-complete"
}

# Check status
GET /api/batch/batch_abc123
Response: 200 OK
{
  "status": "processing", // or "completed", "failed"
  "progress": "40/50 completed"
}
```

**Acceptance Criteria:**
- ✅ Queue system with configurable batch size
- ✅ Built-in OpenAI Batch API integration
- ✅ Webhook notifications when batch completes
- ✅ Status endpoint to check progress
- ✅ Automatic fallback to sync if wait time exceeded
- ✅ Redis-backed queue for multi-instance deployments

**Files to Create/Modify:**
- `packages/core/src/queue/` - New directory
- `packages/core/src/queue/batch.ts` - Batch queue logic
- `packages/core/src/queue/redis-queue.ts` - Redis implementation
- `packages/express/src/webhook.ts` - Batch complete webhook
- `apps/examples/express-ai/batch.js` - Batch example

---

### Feature 7: Token Usage Analytics Dashboard

**Status:** ❌ Not Implemented
**Priority:** 🟢 MEDIUM (visibility for optimization)
**Estimated Time:** 8-10 hours

**Why:** Developers can't see which users/endpoints are most expensive without detailed analytics

**Implementation:**

```bash
npx limitrate inspect tokens

# NEW: Token-focused analytics
┌─────────────────────────────────────────────────────────┐
│ Token Usage Analytics (Last 24 Hours)                  │
├─────────────────────────────────────────────────────────┤
│ Total Tokens Used:        12,450,000                    │
│ Total Cost:               $18.75                        │
│ Average Cost per Request: $0.0015                       │
├─────────────────────────────────────────────────────────┤
│ Top Endpoints by Tokens:                                │
│ 1. POST /api/chat         8,200,000 tokens ($12.30)    │
│ 2. POST /api/summarize    3,100,000 tokens ($4.65)     │
│ 3. POST /api/translate    1,150,000 tokens ($1.73)     │
├─────────────────────────────────────────────────────────┤
│ Top Users by Cost:                                      │
│ 1. user_123               $4.20 (22% of total)         │
│ 2. user_456               $3.80 (20% of total)         │
│ 3. user_789               $2.10 (11% of total)         │
├─────────────────────────────────────────────────────────┤
│ Model Distribution:                                     │
│ • gpt-4:           40% ($7.50) - 2,500,000 tokens      │
│ • gpt-3.5-turbo:   60% ($11.25) - 7,500,000 tokens     │
└─────────────────────────────────────────────────────────┘
```

**Acceptance Criteria:**
- ✅ CLI: `npx limitrate inspect tokens`
- ✅ Show total tokens, cost, average per request
- ✅ Breakdown by endpoint, user, model
- ✅ Time range filters (1h, 24h, 7d, 30d)
- ✅ Export to CSV for external analysis
- ✅ Real-time updates (refresh every 5s)

**Files to Create/Modify:**
- `packages/cli/src/commands/inspect-tokens.ts` - New command
- `packages/cli/src/storage.ts` - Store token events in SQLite
- `packages/core/src/events.ts` - Emit token usage events
- `packages/core/src/types.ts` - Token event types

---

## v1.6.0 Summary

**Total Effort:** ~40-50 hours (5-7 days of focused development)

| Feature | Priority | Time | Impact |
|---------|----------|------|--------|
| Token-based rate limiting | 🔴 CRITICAL | 8-10h | Game changer for AI apps |
| Official tokenizers | 🟡 HIGH | 6-8h | 20-30% accuracy improvement |
| Pre-flight validation | 🟡 HIGH | 4-6h | Prevents wasted API calls |
| Streaming tracking | 🟡 MEDIUM | 8-10h | Modern AI apps use streaming |
| Prompt compression | 🟢 LOW | 6-8h | 20-30% cost savings |
| Batch queue system | 🟢 MEDIUM | 10-12h | 50% cost savings for async |
| Token analytics | 🟢 MEDIUM | 8-10h | Visibility for optimization |

**After v1.6.0, LimitRate will be THE definitive rate limiting solution for AI applications.**

---

## Competitive Positioning After v1.6.0

### Before (Current State)
> "LimitRate supports AI cost tracking with hourly caps"

### After (v1.6.0)
> "LimitRate is the ONLY rate limiting library built specifically for AI applications:
> - ✅ Token-based limits (not just request counts)
> - ✅ Official OpenAI/Claude tokenizers (20-30% more accurate)
> - ✅ Pre-flight validation (prevent wasted API calls)
> - ✅ Streaming support (track tokens in real-time)
> - ✅ Batch queue (50% cost savings with OpenAI Batch API)
> - ✅ Prompt compression (20-30% token savings)
> - ✅ Token analytics (see exactly where your money goes)"

### Target Customers
- AI SaaS companies (ChatGPT clones, AI writing tools, code assistants)
- AI API aggregators (OpenRouter, Portkey, AI gateway services)
- Enterprise AI platforms
- AI research labs and universities
- Developer tool companies (Cursor, Codeium, Continue)
- Content generation platforms

### Competitive Advantage

| Feature | express-rate-limit | rate-limiter-flexible | LimitRate (v1.6.0) |
|---------|-------------------|----------------------|-------------------|
| Token-based limiting | ❌ No | ❌ No | ✅ Yes |
| Official tokenizers | ❌ No | ❌ No | ✅ Yes |
| Pre-flight validation | ❌ No | ❌ No | ✅ Yes |
| Streaming tracking | ❌ No | ❌ No | ✅ Yes |
| Batch queuing | ❌ No | ❌ No | ✅ Yes |
| Prompt compression | ❌ No | ❌ No | ✅ Yes |
| Token analytics | ❌ No | ❌ No | ✅ Yes |

**Marketing Positioning:**
"If you're building with AI APIs, you NEED LimitRate. It's not just rate limiting - it's AI cost control, token management, and budget protection in one library."

---

## v1.7.0 - Production Essentials (CRITICAL)

**Research Date:** 2025-11-06
**Goal:** Address core rate limiting frustrations that users face in production
**Timeline:** 2-3 months
**Total Effort:** ~80-100 hours
**Priority:** 🔴 CRITICAL - These are the most requested features from real users

**Research Sources:**
- express-rate-limit GitHub issues (2024-2025)
- rate-limiter-flexible feature requests
- Distributed systems best practices (2024-2025)
- Production incident reports from rate limiting failures

---

### 🔴 HIGH PRIORITY FEATURES (Must-Have for Production)

---

### Feature 1: Client-Side Rate Limiting SDK

**Status:** ❌ Not Implemented
**Priority:** 🔴 CRITICAL
**Estimated Time:** 8-10 hours

**User Frustration:**
> "My users keep hitting 429 errors and getting frustrated. They have no idea they're about to be rate limited until it's too late. Can we show them a warning BEFORE they hit the limit?" - GitHub Issue

**Why This Matters:**
- **Best Practice 2025:** Rate limiting on BOTH client and server sides maximizes throughput and minimizes latency
- **Better UX:** Users see "3 requests remaining" instead of surprise 429 errors
- **Prevents Wasted Calls:** Check limits before expensive operations (file uploads, AI requests)
- **Competitive Advantage:** NO rate limiting library has official client SDK

**Real-World Problem:**
```
User clicks "Generate" 15 times → All 15 requests sent → Server blocks after 10
Result: User sees 5 errors, confused, frustrated, blames your app
```

**With Client SDK:**
```
User clicks "Generate" 10 times → Client shows "10/10 requests used"
User clicks 11th time → Client shows "Upgrade to Pro for more requests"
Result: User understands limits, no surprise errors
```

**Implementation:**

```typescript
// Install
npm install @limitrate/client

// Client-side (React example)
import { LimitRateClient } from '@limitrate/client';

const limiter = new LimitRateClient({
  apiUrl: 'https://api.yourapp.com',
  userId: currentUser.id,
  plan: currentUser.plan,
});

function ChatComponent() {
  const [limits, setLimits] = useState(null);

  useEffect(() => {
    // Poll for current limits
    limiter.on('limits-updated', (data) => {
      setLimits(data); // { remaining: 7, limit: 10, resetAt: 1699564800 }
    });
  }, []);

  const handleSend = async () => {
    // Check BEFORE sending
    const canProceed = await limiter.checkLimit('POST', '/api/chat');

    if (!canProceed) {
      showUpgradeModal(); // Pre-emptive UX
      return;
    }

    // Proceed with API call
    await fetch('/api/chat', { method: 'POST', body: message });
  };

  return (
    <div>
      <p>Requests: {limits?.remaining}/{limits?.limit}</p>
      <button onClick={handleSend}>Send</button>
    </div>
  );
}
```

**Server-side (Express):**
```typescript
app.use(limitrate({
  // Enable client SDK support
  exposeHeaders: true, // NEW: Send limits in response headers
  cors: true,          // NEW: Enable CORS for client SDK
  policies: {...}
}));

// New endpoint for client polling
app.get('/__limitrate/limits', limitrate.getLimitsHandler()); // NEW
```

**Acceptance Criteria:**
- ✅ JavaScript/TypeScript client SDK package `@limitrate/client`
- ✅ `checkLimit(method, path)` - Check if request would be allowed
- ✅ `getCurrentLimits()` - Get current usage stats
- ✅ Real-time updates via polling (configurable interval)
- ✅ WebSocket support for instant updates (optional)
- ✅ React hooks: `useLimitRate()`, `useRateLimitCheck()`
- ✅ Vue composables support
- ✅ Vanilla JS support (framework-agnostic)
- ✅ Automatic retry-after handling
- ✅ Offline mode (cache last known limits)

**Files to Create:**
- `packages/client/` - New package
- `packages/client/src/index.ts` - Core client logic
- `packages/client/src/react.ts` - React hooks
- `packages/client/src/vue.ts` - Vue composables
- `packages/express/src/client-handler.ts` - Server-side client support
- `apps/examples/react-client/` - React example
- `apps/examples/vue-client/` - Vue example

---

### Feature 2: Shared Store Across Multiple Limiter Instances

**Status:** ❌ Not Implemented
**Priority:** 🔴 CRITICAL (Most requested feature)
**Estimated Time:** 4-6 hours

**User Frustration:**
> "I have 5 different rate limiters on my app (one per endpoint, one global, one for API keys, etc.). Each one creates a NEW Redis connection. I'm hitting Redis connection limits and paying for wasted memory. Why can't they share one store?" - express-rate-limit Discussion #435

**Why This Matters:**
- **#1 Feature Request** in express-rate-limit GitHub discussions
- **Reduces Memory Usage by 80%** when using multiple limiters
- **Reduces Redis Connections** from N limiters → 1 connection
- **Prevents Connection Pool Exhaustion** in production

**Real-World Problem:**
```typescript
// Current: Each limiter creates NEW Redis connection
app.use(limitrate({ store: { type: 'redis', url: REDIS_URL }, policies: {...} })); // Connection 1
app.use('/api', limitrate({ store: { type: 'redis', url: REDIS_URL }, policies: {...} })); // Connection 2
app.use('/admin', limitrate({ store: { type: 'redis', url: REDIS_URL }, policies: {...} })); // Connection 3
app.use('/webhooks', limitrate({ store: { type: 'redis', url: REDIS_URL }, policies: {...} })); // Connection 4

// Result: 4 Redis connections, 4x memory, connection pool exhausted
```

**With Shared Store:**
```typescript
import { createRedisStore } from '@limitrate/core';

// Create ONCE
const sharedStore = createRedisStore({ url: REDIS_URL }); // 1 connection

// Reuse everywhere
app.use(limitrate({ store: sharedStore, policies: { free: {...} } }));
app.use('/api', limitrate({ store: sharedStore, policies: { api: {...} } }));
app.use('/admin', limitrate({ store: sharedStore, policies: { admin: {...} } }));
app.use('/webhooks', limitrate({ store: sharedStore, policies: { webhooks: {...} } }));

// Result: 1 Redis connection, 75% less memory
```

**Implementation:**

```typescript
// packages/core/src/stores/factory.ts
export function createRedisStore(config: RedisStoreConfig): RedisStore {
  const store = new RedisStore(config);
  store.shared = true; // Mark as shareable
  return store;
}

export function createMemoryStore(config?: MemoryStoreConfig): MemoryStore {
  const store = new MemoryStore(config);
  store.shared = true;
  return store;
}

// Usage
import { createRedisStore, limitrate } from '@limitrate/express';

const store = createRedisStore({ url: process.env.REDIS_URL });

app.use(limitrate({ store, policies: {...} })); // Shares connection
app.use('/api', limitrate({ store, policies: {...} })); // Shares connection
```

**Acceptance Criteria:**
- ✅ `createRedisStore()` factory function
- ✅ `createMemoryStore()` factory function
- ✅ `createUpstashStore()` factory function
- ✅ Store reuse detection (warn if duplicate non-shared stores)
- ✅ Connection pooling within shared store
- ✅ Graceful cleanup (only close when last limiter removes)
- ✅ Documentation: Migration guide from current approach
- ✅ Example: Multi-limiter app with shared store

**Files to Modify:**
- `packages/core/src/stores/factory.ts` - New factory functions
- `packages/core/src/stores/base.ts` - Add `shared` flag
- `packages/core/src/stores/redis.ts` - Connection pooling logic
- `packages/express/src/middleware.ts` - Store reuse detection
- `apps/examples/multi-limiter/` - Example with shared store

---

### Feature 3: Dynamic/Adaptive Rate Limiting

**Status:** ❌ Not Implemented
**Priority:** 🔴 CRITICAL (2025 Best Practice)
**Estimated Time:** 10-12 hours

**User Frustration:**
> "During off-peak hours (2am-6am), my API is idle with limits set to 100 req/min. During peak hours (12pm-2pm), my API is overwhelmed with the same 100 req/min limit. Can limits automatically adjust based on server load?" - Production incident report

**Why This Matters:**
- **Can Reduce Server Load by 40%** during peak times (2024 research)
- **Improves User Experience** by allowing more requests during off-peak
- **Prevents Overload** by automatically tightening during high load
- **No Competitor Has This** - major differentiator

**Real-World Problem:**
```
Peak hours (12pm-2pm): 1000 users × 100 req/min = 100,000 req/min → Server crashes
Off-peak (2am-6am): 10 users × 100 req/min = 1,000 req/min → 99% capacity wasted
```

**With Adaptive Limiting:**
```
Peak hours: Automatically reduce to 50 req/min → 50,000 req/min → Server healthy
Off-peak: Automatically increase to 200 req/min → 2,000 req/min → Better UX
```

**Implementation:**

```typescript
policies: {
  free: {
    endpoints: {
      'POST|/api/chat': {
        rate: {
          adaptive: true, // NEW
          basePerMinute: 100, // Target under normal load
          minPerMinute: 20,   // Floor (never go below)
          maxPerMinute: 300,  // Ceiling (never go above)

          // Adjustment strategies
          adjustBasedOn: 'server-load', // or 'time-of-day' or 'user-history' or 'custom'

          // Server load thresholds
          serverLoad: {
            metric: 'cpu', // or 'memory' or 'response-time' or 'error-rate'
            low: 30,    // < 30% CPU → increase limits to maxPerMinute
            normal: 70, // 30-70% CPU → use basePerMinute
            high: 90,   // > 70% CPU → decrease to minPerMinute
          },

          // Time-based (optional)
          timeWindows: {
            'peak': { hours: [12, 13, 14], multiplier: 0.5 },    // 12pm-2pm: 50% of base
            'off-peak': { hours: [2, 3, 4, 5], multiplier: 2.0 }, // 2am-5am: 200% of base
          },

          // User history (optional)
          userHistory: {
            goodBehavior: { multiplier: 1.5, threshold: 0.8 }, // 80%+ success rate → +50%
            badBehavior: { multiplier: 0.5, threshold: 0.5 },  // <50% success rate → -50%
          }
        }
      }
    }
  }
}
```

**Custom Strategy:**
```typescript
rate: {
  adaptive: true,
  customStrategy: async (context) => {
    const { serverLoad, timeOfDay, userHistory, baseLimit } = context;

    // Your custom logic
    if (serverLoad.cpu > 80) return baseLimit * 0.3; // 30% during overload
    if (timeOfDay.hour >= 2 && timeOfDay.hour <= 6) return baseLimit * 2; // 2x at night
    if (userHistory.successRate > 0.9) return baseLimit * 1.5; // Reward good users

    return baseLimit;
  }
}
```

**Acceptance Criteria:**
- ✅ Server load monitoring (CPU, memory, response time, error rate)
- ✅ Time-based adjustments (hourly, daily patterns)
- ✅ User history tracking (success rate, abuse patterns)
- ✅ Custom strategy functions
- ✅ Gradual adjustments (smooth transitions, not sudden jumps)
- ✅ Metrics: Show current adjusted limits in dashboard
- ✅ Events: `adaptive_limit_increased`, `adaptive_limit_decreased`
- ✅ Safety bounds (min/max enforcement)

**Files to Create/Modify:**
- `packages/core/src/adaptive/` - New directory
- `packages/core/src/adaptive/strategies.ts` - Built-in strategies
- `packages/core/src/adaptive/monitor.ts` - Server monitoring
- `packages/core/src/adaptive/history.ts` - User history tracking
- `packages/core/src/types.ts` - Add adaptive config types
- `packages/express/src/middleware.ts` - Apply adaptive limits
- `apps/examples/express-adaptive/` - Adaptive example

---

### Feature 4: Geo-Aware/Regional Rate Limiting

**Status:** ❌ Not Implemented
**Priority:** 🔴 HIGH (Enterprise Requirement)
**Estimated Time:** 6-8 hours

**User Frustration:**
> "We're a global SaaS. EU users have stricter limits due to GDPR/DPA concerns. US users have higher limits. Asia has medium. Right now, we have ONE global limit and it's not working for anyone." - Enterprise customer

**Why This Matters:**
- **Enterprise Requirement:** Different regions have different data processing laws
- **Compliance:** GDPR, DPA, CCPA require regional restrictions
- **Performance:** Route users to nearest region with appropriate limits
- **Competitor Has This:** rlimit.com offers global rate limiting (we should too)

**Real-World Problem:**
```
Global limit: 100 req/min

EU user (strict GDPR): Needs 30 req/min max
US user (lenient): Could handle 200 req/min
APAC user: Needs 50 req/min

Current: Everyone gets 100 → EU non-compliant, US underutilized
```

**With Geo-Aware Limiting:**
```
EU: 30 req/min ✅ GDPR compliant
US: 200 req/min ✅ Maximizes capacity
APAC: 50 req/min ✅ Balanced
```

**Implementation:**

```typescript
policies: {
  free: {
    endpoints: {
      'POST|/api/chat': {
        rate: {
          maxPerMinute: 100, // Default fallback

          // NEW: Regional overrides
          regional: {
            'eu-central-1': { maxPerMinute: 30 },  // GDPR-cautious
            'eu-west-1': { maxPerMinute: 30 },
            'us-east-1': { maxPerMinute: 200 },   // High capacity
            'us-west-2': { maxPerMinute: 200 },
            'ap-southeast-1': { maxPerMinute: 50 }, // Medium
            'ap-northeast-1': { maxPerMinute: 50 },
          },

          // Optional: Detect region
          detectRegionFrom: 'cloudflare-header', // or 'aws-header' or 'geoip' or 'custom'
        }
      }
    }
  }
},

// Custom region detection
identifyRegion: (req) => {
  // Cloudflare sets this header
  const cfRegion = req.headers['cf-ipcountry'];
  if (cfRegion) return `cloudflare-${cfRegion.toLowerCase()}`;

  // AWS ALB sets this
  const awsRegion = req.headers['x-amzn-region'];
  if (awsRegion) return awsRegion;

  // Fallback to GeoIP lookup
  return geoip.lookup(req.ip)?.region || 'default';
}
```

**Multi-Region Sync (Advanced):**
```typescript
store: {
  type: 'redis',
  url: process.env.REDIS_URL,

  // NEW: Multi-region mode
  multiRegion: {
    enabled: true,
    regions: ['us-east-1', 'eu-central-1', 'ap-southeast-1'],
    syncMode: 'eventual', // or 'strong' (slower but accurate)
    syncInterval: 1000, // Sync every 1s
  }
}
```

**Acceptance Criteria:**
- ✅ Regional rate limit overrides per endpoint
- ✅ Built-in region detection (Cloudflare, AWS, GeoIP)
- ✅ Custom region identification functions
- ✅ Multi-region Redis sync (eventual consistency)
- ✅ Fallback to default if region unknown
- ✅ Headers: `X-RateLimit-Region: eu-central-1`
- ✅ Metrics: Per-region usage stats
- ✅ Documentation: GDPR compliance guide

**Files to Create/Modify:**
- `packages/core/src/regional/` - New directory
- `packages/core/src/regional/detector.ts` - Region detection
- `packages/core/src/regional/sync.ts` - Multi-region sync
- `packages/core/src/stores/redis.ts` - Multi-region support
- `packages/core/src/types.ts` - Add regional config types
- `packages/express/src/middleware.ts` - Region detection
- `apps/examples/multi-region/` - Multi-region example
- `docs/GDPR_COMPLIANCE.md` - Compliance guide

---

### Feature 5: Circuit Breaker Integration

**Status:** ❌ Not Implemented
**Priority:** 🔴 HIGH (DDoS Protection)
**Estimated Time:** 6-8 hours

**User Frustration:**
> "We have users who hit rate limits, then IMMEDIATELY retry 100 times in a loop. This creates a denial-of-service for our API. Can you automatically block users who spam after hitting 429?" - Production incident

**Why This Matters:**
- **Prevents API Hammering:** Stop users who retry after 429
- **Reduces Server Load:** Block abusive patterns before they reach app
- **Industry Standard:** Resilience4j (10.4k stars) has this built-in
- **DDoS Protection:** Automatic temporary bans for bad actors

**Real-World Problem:**
```
User hits rate limit (10/10 requests used)
User's app has aggressive retry logic:
  - Retry #1: 429
  - Retry #2: 429
  - Retry #3: 429
  ... (100 more retries in 10 seconds)

Result: Server wastes CPU checking same user 100 times, legitimate users suffer
```

**With Circuit Breaker:**
```
User hits rate limit (10/10 requests used)
User retries:
  - Retry #1: 429
  - Retry #2: 429
  - Retry #3: 429
  - Retry #4: 429
  - Retry #5: 429 (circuit opens!)

Circuit breaker: Block user for 5 minutes
All subsequent requests: 503 Service Unavailable (no rate limit check needed)

After 5 minutes: Allow 1 test request (half-open state)
  - If success → circuit closes, normal operation
  - If 429 again → block for another 5 minutes
```

**Implementation:**

```typescript
policies: {
  free: {
    endpoints: {
      'POST|/api/chat': {
        rate: {
          maxPerMinute: 10,
          actionOnExceed: 'block',
        },

        // NEW: Circuit breaker
        circuitBreaker: {
          enabled: true,

          // Open circuit after N consecutive 429s
          failureThreshold: 5, // 5 consecutive 429s
          failureWindow: 60,   // Within 60 seconds

          // Block duration
          blockDuration: 300, // Block for 5 minutes (300 seconds)

          // Half-open state
          halfOpenRequests: 1, // Allow 1 test request after cooldown

          // Response when circuit is open
          response: {
            statusCode: 503,
            message: 'Service temporarily unavailable due to excessive requests. Try again in 5 minutes.',
            retryAfter: 300,
          },

          // Events
          onCircuitOpen: async (event) => {
            await sendAlert(`User ${event.userId} circuit opened (spam detected)`);
          },
          onCircuitClose: async (event) => {
            await sendAlert(`User ${event.userId} circuit closed (behavior improved)`);
          }
        }
      }
    }
  }
}
```

**States:**
```
CLOSED (normal operation)
  ↓ (5 consecutive 429s)
OPEN (block all requests)
  ↓ (wait 5 minutes)
HALF-OPEN (allow 1 test request)
  ↓ success → CLOSED
  ↓ failure → OPEN (reset 5 min timer)
```

**Acceptance Criteria:**
- ✅ Three states: CLOSED, OPEN, HALF-OPEN
- ✅ Configurable failure threshold (N consecutive 429s)
- ✅ Configurable failure window (within X seconds)
- ✅ Configurable block duration
- ✅ Half-open state with test requests
- ✅ Custom responses when circuit is open (503 vs 429)
- ✅ Events: `circuit_opened`, `circuit_closed`, `circuit_half_open`
- ✅ Metrics: Circuit state per user, per endpoint
- ✅ Storage: Track circuit state in Redis (distributed support)
- ✅ Manual override: Admin can force close circuit

**Files to Create/Modify:**
- `packages/core/src/circuit-breaker/` - New directory
- `packages/core/src/circuit-breaker/state-machine.ts` - Circuit logic
- `packages/core/src/circuit-breaker/tracker.ts` - Failure tracking
- `packages/core/src/stores/redis.ts` - Store circuit state
- `packages/core/src/types.ts` - Add circuit breaker config
- `packages/express/src/middleware.ts` - Circuit check before rate limit
- `apps/examples/circuit-breaker/` - Circuit breaker example

---

### 🟡 MEDIUM PRIORITY FEATURES (Important for Production)

---

### Feature 6: Endpoint Auto-Discovery (CLI)

**Status:** ✅ COMPLETE
**Priority:** 🟡 MEDIUM (Developer Experience)
**Estimated Time:** 3-4 hours

**User Frustration:**
> "I added a new endpoint `/api/export` last week. It's been getting hammered by bots because I forgot to add rate limits. Can the CLI warn me about unprotected endpoints?" - Developer

**Why This Matters:**
- **Catch Forgotten Endpoints:** New endpoints often lack rate limits
- **Security:** Identify attack surface
- **Better DX:** See all endpoints at a glance

**Real-World Problem:**
```
Developer adds: app.post('/api/export', ...)
Developer forgets to add rate limit config
Endpoint goes live unprotected
Bots discover endpoint, hammer it → server crash
```

**With Auto-Discovery:**
```bash
npx limitrate inspect

Discovered Endpoints (Last 24h):
✓ POST /api/chat          10/10 req/min (rate limited)
✓ GET /api/users/:id      50/100 req/min (rate limited)
⚠ POST /api/export        NO LIMITS - UNPROTECTED!
⚠ DELETE /api/admin       NO LIMITS - UNPROTECTED!

Suggestion: Add rate limits to 2 unprotected endpoints
```

**Implementation:**

```typescript
// CLI discovers endpoints from:
// 1. Runtime tracking (req/res events)
// 2. Static analysis (optional: scan code)

// Runtime tracking (automatic):
app.use(limitrate({
  trackEndpoints: true, // NEW: Track all endpoints that receive requests
  policies: {...}
}));

// CLI command:
npx limitrate inspect endpoints

// Output:
┌─────────────────────────────────────────────────────────┐
│ Endpoint Discovery (Last 24 Hours)                     │
├─────────────────────────────────────────────────────────┤
│ Status   Method  Path                Requests  Limited │
├─────────────────────────────────────────────────────────┤
│ ✓ OK     POST    /api/chat           1,234     Yes     │
│ ✓ OK     GET     /api/users/:id      5,678     Yes     │
│ ⚠ WARN   POST    /api/export         45        NO      │
│ ⚠ WARN   DELETE  /api/admin/users    2         NO      │
│ ⚠ WARN   POST    /webhooks/stripe    890       NO      │
└─────────────────────────────────────────────────────────┘

⚠ WARNING: 3 endpoints are NOT rate limited!

Suggestions:
  - Add rate limits to /api/export (high traffic: 45 requests)
  - Add rate limits to /webhooks/stripe (very high traffic: 890 requests)
  - Add rate limits to /api/admin/users (admin endpoint, should be protected)
```

**Acceptance Criteria:**
- ✅ Runtime endpoint tracking (no code scan needed)
- ✅ CLI command: `npx limitrate inspect endpoints`
- ✅ Show: Status (protected/unprotected), method, path, request count
- ✅ Warnings for unprotected endpoints
- ✅ Suggestions based on traffic patterns
- ✅ Export to JSON for CI/CD checks
- ✅ Exit code 1 if unprotected endpoints found (CI/CD fail)

**Files to Modify:**
- `packages/core/src/tracking/endpoints.ts` - Runtime tracking
- `packages/cli/src/commands/inspect-endpoints.ts` - New command
- `packages/cli/src/storage.ts` - Store endpoint stats
- `packages/express/src/middleware.ts` - Track all requests

---

### Feature 7: Graphical Config Builder (Offline Tool)

**Status:** ❌ Not Implemented
**Priority:** 🟡 MEDIUM (Onboarding Experience)
**Estimated Time:** 15-20 hours

**User Frustration:**
> "I don't understand the nested JSON config format. I've spent 2 hours debugging syntax errors. Is there a visual way to build this?" - New user onboarding feedback

**Why This Matters:**
- **Lowers Barrier to Entry:** Non-experts can configure visually
- **Reduces Errors:** No more JSON syntax mistakes
- **Faster Onboarding:** 5 minutes instead of 2 hours
- **Better DX:** Live preview, validation, suggestions

**What It Is:**
Local web UI to BUILD the initial config file (runs at `localhost:3000` during development)

**What It's NOT:**
- Not the v2.0 SaaS Dashboard (that's for live changes in production)
- Not auto-scanning codebase (that's Feature #8)
- Not cloud-hosted (runs locally)

**User Flow:**

```bash
# 1. Developer runs locally
cd my-app
npx limitrate config-builder

# 2. Opens browser at http://localhost:3000
# 3. Visual interface appears:

┌────────────────────────────────────────────────────────┐
│ LimitRate Config Builder                               │
├────────────────────────────────────────────────────────┤
│                                                         │
│  Plans:  [Add Plan ▼]                                 │
│  ┌──────────────────────────────────────┐            │
│  │ 📦 Free Plan                          │            │
│  │   Endpoints:                          │            │
│  │   • POST /api/chat                    │            │
│  │     Rate: 10 req/min [Edit]           │            │
│  │   • GET /api/users/:id                │            │
│  │     Rate: 100 req/min [Edit]          │            │
│  │   [+ Add Endpoint]                    │            │
│  └──────────────────────────────────────┘            │
│                                                         │
│  ┌──────────────────────────────────────┐            │
│  │ 💎 Pro Plan                           │            │
│  │   Endpoints:                          │            │
│  │   • POST /api/chat                    │            │
│  │     Rate: 100 req/min [Edit]          │            │
│  │   [+ Add Endpoint]                    │            │
│  └──────────────────────────────────────┘            │
│                                                         │
│  [+ Add Plan]                                          │
│                                                         │
├────────────────────────────────────────────────────────┤
│  Generated Config (Live Preview):                      │
│  ┌──────────────────────────────────────┐            │
│  │ export default {                      │            │
│  │   policies: {                         │            │
│  │     free: {                            │            │
│  │       endpoints: {                     │            │
│  │         'POST|/api/chat': {           │            │
│  │           rate: { maxPerMinute: 10 }  │            │
│  │         }                              │            │
│  │       }                                │            │
│  │     }                                  │            │
│  │   }                                    │            │
│  │ }                                      │            │
│  └──────────────────────────────────────┘            │
│                                                         │
│  [Copy to Clipboard] [Save to File] [Test Config]    │
└────────────────────────────────────────────────────────┘

# 4. Developer clicks "Save to File"
# 5. Saves as limitrate.config.ts
# 6. Developer imports in code:

import config from './limitrate.config';
app.use(limitrate(config));
```

**Features:**
- Drag-and-drop interface for plans and endpoints
- Live JSON preview (right side)
- Validation errors highlighted in red
- Autocomplete for common patterns (burst, cost caps, etc.)
- Example templates ("API service", "AI app", "SaaS platform")
- Test mode (dry-run simulation)
- Export to TypeScript or JSON

**Implementation:**

```bash
# Tech stack
- React frontend (or Svelte for smaller bundle)
- Express backend (serves UI, saves config)
- Monaco Editor for JSON preview
- Zod for validation

# Files structure
packages/config-builder/
├── src/
│   ├── frontend/ (React UI)
│   ├── backend/ (Express server)
│   ├── templates/ (Starter configs)
│   └── validator/ (Zod schemas)
```

**Acceptance Criteria:**
- ✅ Web UI at `localhost:3000`
- ✅ Add/remove/edit plans visually
- ✅ Add/remove/edit endpoints per plan
- ✅ Configure rate limits (maxPerMinute, burst, etc.)
- ✅ Configure cost limits (AI apps)
- ✅ Live JSON preview with syntax highlighting
- ✅ Validation errors with helpful messages
- ✅ Example templates (5+ common use cases)
- ✅ Test mode (simulate requests)
- ✅ Export to TypeScript (.ts) or JSON (.json)
- ✅ Save to file automatically

**Files to Create:**
- `packages/config-builder/` - New package
- `packages/config-builder/src/frontend/` - React UI
- `packages/config-builder/src/backend/` - Express server
- `packages/config-builder/templates/` - Starter configs
- `apps/examples/config-builder-demo/` - Demo video/GIF

---

### Feature 8: Auto-Scan + Generate Config

**Status:** ❌ Not Implemented
**Priority:** 🟡 MEDIUM (Zero-Config Onboarding)
**Estimated Time:** 10-12 hours

**User Frustration:**
> "I have 50 API endpoints. Do I really need to manually type all 50 into the config? Can you just scan my code and generate it for me?" - Enterprise customer

**Why This Matters:**
- **Zero-Config Onboarding:** New users get started in seconds
- **Reduces Manual Work:** No typing 50+ endpoints
- **Smart Suggestions:** AI-powered limit recommendations
- **Keeps Config In Sync:** Re-scan after adding new endpoints

**What It Is:**
CLI tool that scans your Express app and generates initial config

**User Flow:**

```bash
# 1. Run scanner
cd my-app
npx limitrate scan

Scanning Express app...
Found 12 endpoints:
  ✓ POST /api/chat
  ✓ GET /api/users/:id
  ✓ POST /api/summarize
  ✓ DELETE /api/admin/users
  ... (8 more)

Analyzing patterns...
  • 3 AI endpoints detected (high cost)
  • 2 admin endpoints detected (sensitive)
  • 7 public endpoints detected

Generating config...

# 2. Shows suggested config:
┌────────────────────────────────────────────────────────┐
│ Generated Configuration                                 │
├────────────────────────────────────────────────────────┤
│                                                         │
│ export default {                                        │
│   policies: {                                           │
│     default: {                                          │
│       endpoints: {                                      │
│         // AI endpoints (cost-sensitive)               │
│         'POST|/api/chat': {                            │
│           rate: { maxPerMinute: 10 },                  │
│           cost: { hourlyCap: 0.10 }  // Suggested     │
│         },                                              │
│         'POST|/api/summarize': {                       │
│           rate: { maxPerMinute: 5 },                   │
│           cost: { hourlyCap: 0.05 }                    │
│         },                                              │
│                                                         │
│         // Admin endpoints (sensitive)                 │
│         'DELETE|/api/admin/users': {                   │
│           rate: { maxPerMinute: 10 }  // Conservative  │
│         },                                              │
│                                                         │
│         // Public endpoints                            │
│         'GET|/api/users/:id': {                        │
│           rate: { maxPerMinute: 100 }                  │
│         },                                              │
│       }                                                 │
│     }                                                   │
│   }                                                     │
│ }                                                       │
│                                                         │
└────────────────────────────────────────────────────────┘

Save to limitrate.config.ts? (Y/n): Y

✅ Config saved to limitrate.config.ts
✅ Import in your app: import config from './limitrate.config'
✅ Next: Adjust limits based on your needs
```

**How It Works:**

```typescript
// Scans for:
// 1. Express route definitions
app.get('/api/users/:id', ...)
app.post('/api/chat', ...)
router.delete('/admin/users', ...)

// 2. Detects patterns
// - Keywords: 'ai', 'openai', 'gpt', 'claude' → AI endpoint
// - Keywords: 'admin', 'delete', 'destroy' → Sensitive endpoint
// - Keywords: 'public', 'health', 'status' → High-traffic endpoint

// 3. Suggests limits based on patterns
// - AI endpoints: Low limits (10/min), add cost caps
// - Admin endpoints: Conservative limits (10/min)
// - Public endpoints: Higher limits (100/min)
// - Sensitive operations (DELETE): Very low limits (5/min)
```

**Advanced: AST Parsing**
```typescript
// Uses AST (Abstract Syntax Tree) to find routes:
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

const ast = parse(code, { sourceType: 'module' });
traverse(ast, {
  CallExpression(path) {
    if (path.node.callee.object?.name === 'app') {
      const method = path.node.callee.property.name; // 'get', 'post', etc.
      const route = path.node.arguments[0].value; // '/api/users/:id'
      endpoints.push({ method, route });
    }
  }
});
```

**Acceptance Criteria:**
- ✅ CLI command: `npx limitrate scan`
- ✅ Detect Express routes via AST parsing
- ✅ Support: Express, Router, app.route()
- ✅ Pattern detection (AI, admin, public, sensitive)
- ✅ Smart limit suggestions based on patterns
- ✅ Generate valid TypeScript config
- ✅ Save to file with user confirmation
- ✅ Re-scan support (update existing config)
- ✅ Dry-run mode (show without saving)

**Files to Create:**
- `packages/cli/src/commands/scan.ts` - Scanner command
- `packages/cli/src/scanner/ast-parser.ts` - AST parsing
- `packages/cli/src/scanner/pattern-detector.ts` - Pattern matching
- `packages/cli/src/scanner/limit-suggester.ts` - Limit recommendations
- `packages/cli/src/scanner/config-generator.ts` - Generate TypeScript

---

### Feature 9: Rate Limit Simulator/Dry-Run Mode

**Status:** ✅ COMPLETE
**Priority:** 🟡 MEDIUM (Testing & Safety)
**Estimated Time:** 3-4 hours

**User Frustration:**
> "I want to change rate limits from 10/min to 5/min, but I'm scared it will break production. Can I test it first without actually blocking users?" - Operations team

**Why This Matters:**
- **Reduces Production Incidents:** Test before deploy
- **Confidence:** See impact before committing
- **Debugging:** Understand why users are getting blocked

**What It Is:**
Dry-run mode that LOGS 429s but doesn't actually block requests

**Implementation:**

```typescript
app.use(limitrate({
  dryRun: true, // NEW: Don't block, just log

  dryRunLogger: (event) => {
    if (event.action === 'block') {
      console.log('⚠️ DRY-RUN: Would have blocked:', {
        userId: event.userId,
        endpoint: event.endpoint,
        reason: event.reason,
        limit: event.limit,
        current: event.current,
      });
    }
  },

  policies: {
    free: {
      endpoints: {
        'POST|/api/chat': {
          rate: { maxPerMinute: 5 } // Testing new limit
        }
      }
    }
  }
}));

// Logs:
// ⚠️ DRY-RUN: Would have blocked: { userId: 'user_123', endpoint: 'POST /api/chat', reason: 'rate_exceeded', limit: 5, current: 6 }
// ⚠️ DRY-RUN: Would have blocked: { userId: 'user_456', endpoint: 'POST /api/chat', reason: 'rate_exceeded', limit: 5, current: 7 }
// ... (10 more in 1 minute)

// Analysis:
// ✅ New limit (5/min) would block 12 users
// ✅ Safe to deploy? Review logs first
```

**Acceptance Criteria:**
- ✅ `dryRun: true` config option
- ✅ Logs would-be 429s without blocking
- ✅ Custom logger function
- ✅ Export logs to file/database for analysis
- ✅ CLI: `npx limitrate dry-run analyze` (summary)
- ✅ Works with all enforcement modes (block, slowdown, etc.)

**Files to Modify:**
- `packages/core/src/index.ts` - Add dry-run logic
- `packages/express/src/middleware.ts` - Skip enforcement if dry-run
- `packages/cli/src/commands/dry-run-analyze.ts` - Analysis tool

---

### Feature 10: Per-User Custom Limits (Overrides)

**Status:** ✅ COMPLETE
**Priority:** 🟡 MEDIUM (Enterprise Customization)
**Estimated Time:** 5-6 hours

**User Frustration:**
> "We have an enterprise customer who needs 10,000 req/min, but they're on the 'Pro' plan which only allows 100 req/min. Do I need to create a whole new plan just for one customer?" - Sales team

**Why This Matters:**
- **Enterprise Flexibility:** Custom SLAs without new plans
- **VIP Treatment:** Give specific users higher limits
- **Testing:** Give internal users unlimited access
- **Partnerships:** Special limits for API partners

**Real-World Problem:**
```
Customer "ACME Corp" signs contract: 10,000 req/min custom SLA
They're on "Pro" plan: 100 req/min
Options:
  1. Create new plan "ACMEPro" → Config bloat, hard to maintain
  2. Hard-code userId in middleware → Unmaintainable
  3. Per-user overrides → Clean solution ✅
```

**Implementation:**

```typescript
policies: {
  free: {
    defaults: { rate: { maxPerMinute: 10 } }
  },
  pro: {
    defaults: { rate: { maxPerMinute: 100 } }
  },

  // NEW: Per-user overrides (take precedence over plan limits)
  userOverrides: {
    'user_acme_corp': {
      maxPerMinute: 10000,
      reason: 'Enterprise SLA contract',
    },
    'user_vip_founder': {
      maxPerMinute: 500,
      reason: 'VIP user - no limits',
    },
    'user_internal_testing': {
      maxPerMinute: Infinity, // Unlimited
      reason: 'Internal testing account',
    },
  }
}
```

**Dynamic Overrides (Database):**
```typescript
// Load from database
app.use(limitrate({
  getUserOverride: async (userId) => {
    const override = await db.userLimits.findOne({ userId });
    return override ? { maxPerMinute: override.limit } : null;
  },
  policies: {...}
}));
```

**CLI Management:**
```bash
# Add override
npx limitrate override add user_123 --limit 500 --reason "VIP customer"

# List overrides
npx limitrate override list
user_acme_corp: 10,000 req/min (Enterprise SLA contract)
user_vip_founder: 500 req/min (VIP user)
user_internal_testing: Unlimited (Internal testing)

# Remove override
npx limitrate override remove user_123
```

**Acceptance Criteria:**
- ✅ `userOverrides` config section
- ✅ Dynamic overrides via `getUserOverride()` function
- ✅ Overrides take precedence over plan limits
- ✅ Reason field for audit trail
- ✅ CLI: `npx limitrate override add/list/remove`
- ✅ Dashboard: Show users with overrides
- ✅ Events: `user_override_applied`

**Files to Create/Modify:**
- `packages/core/src/overrides/` - New directory
- `packages/core/src/overrides/manager.ts` - Override logic
- `packages/core/src/types.ts` - Add override types
- `packages/express/src/middleware.ts` - Check overrides first
- `packages/cli/src/commands/override.ts` - CLI management
- `packages/cli/src/storage.ts` - Store overrides in SQLite

---

### Feature 11: Rate Limit Metrics Export (Prometheus/OpenTelemetry)

**Status:** ❌ Not Implemented
**Priority:** 🟡 MEDIUM (Enterprise Observability)
**Estimated Time:** 8-10 hours

**User Frustration:**
> "We use Grafana for all our metrics. Can LimitRate export to Prometheus format so we can see rate limits in our existing dashboards?" - DevOps team

**Why This Matters:**
- **Enterprise Requirement:** Standard observability tools
- **Existing Workflows:** Integrate with Grafana, Datadog, New Relic
- **Alerting:** Set up PagerDuty alerts on rate limit spikes
- **Compliance:** Auditors want metrics retention

**What It Is:**
Export rate limiting metrics in Prometheus/OpenTelemetry format

**Implementation:**

```typescript
import { limitrate } from '@limitrate/express';
import { PrometheusExporter } from '@limitrate/exporters';

app.use(limitrate({
  exporters: [
    new PrometheusExporter({
      endpoint: '/metrics', // Prometheus scrapes this
      labels: ['endpoint', 'plan', 'user'], // Dimensions
    })
  ],
  policies: {...}
}));

// GET /metrics
// Exposes:
// limitrate_requests_total{endpoint="/api/chat",plan="free"} 1234
// limitrate_requests_blocked{endpoint="/api/chat",plan="free"} 45
// limitrate_requests_allowed{endpoint="/api/chat",plan="free"} 1189
// limitrate_cost_total{endpoint="/api/chat",plan="free"} 18.75
// limitrate_latency_seconds{endpoint="/api/chat",quantile="0.5"} 0.00047
```

**Grafana Dashboard:**
```
┌─────────────────────────────────────────────────────────┐
│ LimitRate Metrics                                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Requests/sec (last 5min):  4,579 req/s                │
│  ███████████████████░░░░░░                             │
│                                                         │
│  Blocked Requests:  45 (0.98%)                          │
│  ██░░░░░░░░░░░░░░░░░░░░░░░                             │
│                                                         │
│  Top Endpoints by Cost:                                 │
│  1. POST /api/chat      $12.30                          │
│  2. POST /api/summarize $4.65                           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**OpenTelemetry Support:**
```typescript
import { OpenTelemetryExporter } from '@limitrate/exporters';

app.use(limitrate({
  exporters: [
    new OpenTelemetryExporter({
      serviceName: 'my-api',
      endpoint: 'https://otel-collector:4318',
    })
  ],
  policies: {...}
}));
```

**Acceptance Criteria:**
- ✅ Prometheus exporter (`/metrics` endpoint)
- ✅ OpenTelemetry exporter (traces, metrics, logs)
- ✅ Metrics: requests_total, requests_blocked, requests_allowed, cost_total, latency
- ✅ Labels: endpoint, plan, user, action
- ✅ Histograms for latency (p50, p95, p99)
- ✅ Grafana dashboard template (JSON)
- ✅ Documentation: Setup guide for Grafana/Datadog

**Files to Create:**
- `packages/exporters/` - New package
- `packages/exporters/src/prometheus.ts` - Prometheus exporter
- `packages/exporters/src/opentelemetry.ts` - OTEL exporter
- `packages/exporters/dashboards/grafana.json` - Grafana template
- `docs/OBSERVABILITY.md` - Setup guide

---

### Feature 12: Quota Carryover / Rollover

**Status:** ❌ Not Implemented
**Priority:** 🟡 LOW (UX Improvement)
**Estimated Time:** 6-8 hours

**User Frustration:**
> "I only used 40 out of 100 requests this hour. Can the unused 60 roll over to next hour? It feels wasteful to lose them." - Free tier user feedback

**Why This Matters:**
- **Fairer UX:** Bursty usage patterns feel less restrictive
- **Competitive Advantage:** Unique feature (no competitor has this)
- **User Satisfaction:** "Use it or lose it" feels punishing

**How It Works:**
```
Hour 1: User makes 40 requests (60 unused)
Hour 2: User gets 100 + min(60, carryoverMax) = 150 total
Hour 3: User makes 120 requests (30 unused)
Hour 4: User gets 100 + min(30, carryoverMax) = 130 total
```

**Implementation:**

```typescript
rate: {
  maxPerHour: 100,
  carryover: true, // NEW
  carryoverMax: 50, // Max 50 can rollover
}

// Hour 1: 40/100 used → 60 unused
// Hour 2: 100 base + min(60, 50) carryover = 150 total
```

**Acceptance Criteria:**
- ✅ `carryover: true` config option
- ✅ `carryoverMax` to cap rollover amount
- ✅ Works with hourly/daily windows
- ✅ Headers show carryover: `X-RateLimit-Carryover: 50`
- ✅ Metrics: Track carryover usage
- ✅ Documentation: Explain carryover math

**Files to Modify:**
- `packages/core/src/index.ts` - Carryover logic
- `packages/core/src/stores/base.ts` - Track unused quota
- `packages/core/src/types.ts` - Add carryover config

---

## v1.7.0 Summary

**Total Effort:** ~80-100 hours (10-13 days of focused development)

### Priority Breakdown

| Priority | Features | Effort |
|----------|----------|--------|
| 🔴 HIGH | 5 features | 34-44h |
| 🟡 MEDIUM | 7 features | 46-56h |

### Features by Category

| Category | Features | Count |
|----------|----------|-------|
| **Core Rate Limiting** | Client SDK, Shared Store, Adaptive, Geo-Aware, Circuit Breaker | 5 |
| **Developer Experience** | Endpoint Discovery, Config Builder, Auto-Scan, Dry-Run | 4 |
| **Enterprise** | Per-User Overrides, Metrics Export, Carryover | 3 |

### User Impact

| Feature | Users Who Requested This |
|---------|-------------------------|
| Shared Store | #1 request (express-rate-limit Discussion #435) |
| Client SDK | "Show limits before 429" (multiple requests) |
| Adaptive Limits | 2025 best practice (40% load reduction) |
| Geo-Aware | Enterprise GDPR compliance requirement |
| Circuit Breaker | DDoS protection (production incidents) |
| Config Builder | Onboarding friction ("2 hours debugging JSON") |
| Auto-Scan | Enterprise ("50 endpoints to type manually?") |

---

## Updated Full Roadmap

| Version | Focus | Timeline | Effort | Status |
|---------|-------|----------|--------|--------|
| **v1.0** | Core foundation | ✅ COMPLETED | 20-25h | Done |
| **v1.2** | Burst + time windows | ✅ COMPLETED | 15-20h | Done |
| **v1.3** | Phase B: Critical features | ✅ COMPLETED | ~12h | Done (Nov 6, 2025) |
| **v1.4** | Competitive parity | Next 2 weeks | 25-30h | Planned |
| **v1.5** | Polish & growth | 1 month | 30-40h | Planned |
| **v1.6** | AI power features | 1-2 months | 40-50h | Planned |
| **v1.7** | Production essentials | 2-3 months | 80-100h | Planned |
| **v2.0** | Next generation | 3 months | 50-60h | Future |

**Total Outstanding Work:** ~225-280 hours (28-35 days of focused development)

---

## 🧪 Living Test Harness (Established Nov 6, 2025)

**Location:** `/Users/apple/limitrate-npm-test-suite/`

**Purpose:** Integration test suite that installs LimitRate from REAL npm packages (not local workspace) to verify all features work as end users would experience them.

**Workflow Rule:**
⚠️ **MANDATORY**: Every new feature MUST have a passing integration test in this suite before proceeding to the next feature. See `CLAUDE.md` for detailed workflow.

**Coverage (v1.3.0):**
- ✅ v1.0-v1.2 Features: Burst, time windows, withPolicy(), multi-plan
- ✅ v1.3 Features: Shared store (B1), endpoint discovery (B2), dry-run (B3), user overrides (B4), client SDK (B5)
- 📊 9 comprehensive test files covering all features
- ✅ All tests passing

**Why This Matters:**
- Tests install `@limitrate/express` from npm (not local files)
- Catches issues that only appear in published packages
- Acts as living documentation of feature usage
- Ensures backward compatibility with every release
- Prevents regressions from sneaking into production

**Test Files:**
1. `test-comprehensive-v1-2-0.js` - All v1.0-v1.2 features
2. `test-burst.js` - Burst allowance
3. `test-time-windows.js` - Hour/day windows
4. `test-with-policy-fixed.js` - Route overrides
5. `test-b1-shared-store.js` - Shared store pattern
6. `test-b2-auto-discovery.js` - Endpoint tracking
7. `test-b3-dry-run.js` - Dry-run mode
8. `test-b4-user-overrides.js` - User overrides
9. `test-b5-client-sdk.js` - Status endpoints

**Run Tests:**
```bash
cd /Users/apple/limitrate-npm-test-suite
npm test
```

---

## v1.3.0 Release Summary (Nov 6, 2025)

**Phase B: Critical User Requests - COMPLETED**

All 6 features implemented, tested, and published to npm:

1. **B1: Shared Store Instances** ✅
   - `createSharedMemoryStore()` helper
   - 75% memory reduction with multiple limiters

2. **B2: Endpoint Auto-Discovery** ✅
   - `GET /limitrate/endpoints` auto-generated
   - Real-time endpoint tracking

3. **B3: Dry-Run Mode** ✅
   - `dryRun: boolean` option
   - `dryRunLogger` callback
   - Test limits without blocking production traffic

4. **B4: User Overrides** ✅
   - `userOverrides` static config
   - `getUserOverride()` dynamic lookups
   - Enterprise SLAs without custom plans

5. **B5: Client-Side SDK** ✅ (Game changer!)
   - `getRateLimitStatus()` programmatic API
   - `createStatusEndpoint()` Express helper
   - Frontend rate-limit awareness
   - React/Vue/JS examples in docs

6. **B6: Performance Benchmarks** ✅
   - 3.5x faster than express-rate-limit (Memory Store)
   - Competitive Redis performance
   - Published benchmark results

**Published Packages:**
- `@limitrate/core@1.3.0`
- `@limitrate/express@1.3.0`
- `@limitrate/cli@1.2.1`

**Documentation:**
- `docs/CLIENT-SIDE-SDK.md` - Comprehensive guide
- `docs/SHARED-STORE.md` - Memory efficiency patterns
- `docs/USER-OVERRIDES.md` - Enterprise customization
- `CLAUDE.md` - Development workflow
- `IMPLEMENTATION.md` - Phase tracking

**Next Phase:** C - AI Differentiation (token-based limits, streaming, etc.)
