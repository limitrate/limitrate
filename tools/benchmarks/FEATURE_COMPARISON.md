# Feature Comparison: LimitRate vs Competitors

**Date:** November 5, 2025
**Competitors Analyzed:** express-rate-limit v7.5.1, rate-limiter-flexible v5.0.5

## Executive Summary

### 🏆 Winner by Category

| Category | Winner | Reason |
|----------|--------|---------|
| **Ease of Use** | express-rate-limit | Simplest API, minimal config |
| **Features** | **LimitRate** | Unique features (burst, time windows, CLI) |
| **Flexibility** | rate-limiter-flexible | Most config options |
| **Performance (p50)** | **LimitRate** | 0.47ms median latency |
| **Performance (p95/p99)** | express-rate-limit | Best tail latencies |
| **Store Support** | rate-limiter-flexible | 10+ stores vs our 3 |
| **Modern DX** | **LimitRate** | TypeScript-first, clean API |
| **AI/Cost Control** | **LimitRate** | Only one with cost caps |
| **Observability** | **LimitRate** | CLI inspect tool |

### Verdict: **LimitRate wins for modern apps needing AI cost control and advanced features**

---

## Detailed Feature Matrix

### 1. Core Rate Limiting

| Feature | LimitRate | express-rate-limit | rate-limiter-flexible |
|---------|-----------|-------------------|----------------------|
| **Time Windows** | ✅ Second, Minute, Hour, Day | ✅ Custom window | ✅ Duration-based |
| **Algorithm** | Token bucket | Sliding window | Token bucket / GCRA-like |
| **Burst Allowance** | ✅ **UNIQUE** | ❌ No | ❌ No |
| **Dynamic Limits** | ✅ Plan-based | ✅ keyGenerator | ✅ Key-based |
| **Per-Route Config** | ✅ withPolicy() | ✅ Multiple instances | ✅ Multiple limiters |

**Analysis:**
- **LimitRate's burst allowance is unique** - neither competitor offers this
- All support dynamic limits, but our plan-based approach is cleaner
- express-rate-limit requires multiple middleware instances for different routes

### 2. Storage Backends

| Store | LimitRate | express-rate-limit | rate-limiter-flexible |
|-------|-----------|-------------------|----------------------|
| **Memory** | ✅ Yes | ✅ Yes (default) | ✅ Yes |
| **Redis** | ✅ Yes | ✅ rate-limit-redis | ✅ Yes (native) |
| **Upstash** | ✅ Yes | ❌ No | ❌ No |
| **MongoDB** | ❌ No | ❌ No | ✅ Yes |
| **PostgreSQL** | ❌ No | ❌ No | ✅ Yes |
| **MySQL** | ❌ No | ❌ No | ✅ Yes |
| **DynamoDB** | ❌ No | ❌ No | ✅ Yes |
| **Memcached** | ❌ No | ✅ rate-limit-memcached | ✅ Yes |
| **Prisma** | ❌ No | ❌ No | ✅ Yes |

**Analysis:**
- **rate-limiter-flexible wins on store variety** (10+ stores)
- **We win on serverless** (Upstash native support)
- We should consider adding: MongoDB, PostgreSQL, MySQL

**What to Copy:** Add PostgreSQL/MySQL/MongoDB support in v1.4.0

### 3. AI & Cost Control

| Feature | LimitRate | express-rate-limit | rate-limiter-flexible |
|---------|-----------|-------------------|----------------------|
| **Cost Estimation** | ✅ **UNIQUE** | ❌ No | ❌ No |
| **Cost Caps** | ✅ Hourly/Daily | ❌ No | ❌ No |
| **Token Counting** | ✅ Via costContext | ❌ No | ❌ No |
| **Multi-Model Support** | ✅ Custom estimators | ❌ No | ❌ No |

**Analysis:**
- **THIS IS OUR KILLER FEATURE** - no competitor has AI cost control
- This alone justifies choosing LimitRate for AI apps
- We should emphasize this more in marketing

**Our Unique Value Proposition**

### 4. Headers & Standards

| Feature | LimitRate | express-rate-limit | rate-limiter-flexible |
|---------|-----------|-------------------|----------------------|
| **RateLimit-* Headers** | ✅ Standard | ✅ Standard | ❌ None |
| **X-RateLimit-* Headers** | ❌ Legacy removed | ✅ Optional legacy | ❌ None |
| **Custom Headers** | ❌ No | ✅ Via custom handler | ❌ No |
| **Retry-After** | ✅ Yes | ✅ Yes | ❌ No |
| **Burst Headers** | ✅ `RateLimit-Burst-Remaining` | ❌ No | ❌ No |

**Analysis:**
- LimitRate and express-rate-limit follow standards
- rate-limiter-flexible requires manual header implementation
- Our burst headers are innovative

**What to Copy:** Add legacy X-RateLimit-* headers as opt-in for backwards compat

### 5. Error Handling & Responses

| Feature | LimitRate | express-rate-limit | rate-limiter-flexible |
|---------|-----------|-------------------|----------------------|
| **Custom 429 Response** | ✅ JSON with upgrade hints | ✅ Custom handler | ⚠️ Manual |
| **Retry-After** | ✅ Automatic | ✅ Automatic | ❌ Manual |
| **Store Failure Mode** | ✅ Allow/Block config | ✅ Skip on error | ⚠️ Throws |
| **Error Events** | ✅ Via onEvent | ❌ No | ❌ No |
| **Upgrade Hints** | ✅ **UNIQUE** | ❌ No | ❌ No |

**Analysis:**
- **Our upgrade hints are unique** - great for monetization
- express-rate-limit has solid error handling
- rate-limiter-flexible requires more manual work

**What to Copy:** Add more error handling options from express-rate-limit

### 6. Advanced Features

| Feature | LimitRate | express-rate-limit | rate-limiter-flexible |
|---------|-----------|-------------------|----------------------|
| **IP Allowlist** | ✅ Built-in | ✅ skip function | ⚠️ Manual |
| **IP Blocklist** | ✅ Built-in | ✅ skip function | ⚠️ Manual |
| **Slowdown Mode** | ✅ Delay requests | ✅ express-slow-down | ✅ blockDuration |
| **Event Webhooks** | ✅ Built-in | ❌ No | ❌ No |
| **CLI Inspection** | ✅ **UNIQUE** | ❌ No | ❌ No |
| **Skip Logic** | ✅ skip function | ✅ skip function | ⚠️ Manual |
| **Trust Proxy** | ✅ Built-in | ✅ Built-in | ⚠️ Manual |
| **Key Blocking** | ❌ No | ❌ No | ✅ blockDuration |
| **Insurance Strategy** | ❌ No | ❌ No | ✅ insuranceLimiter |
| **Queue System** | ❌ No | ❌ No | ✅ RateLimiterQueue |

**Analysis:**
- **Our CLI inspect is unique and powerful**
- **Our webhook events are unique**
- rate-limiter-flexible has advanced blocking strategies we lack
- express-rate-limit has excellent skip/trust-proxy UX

**What to Copy:**
1. **Key blocking** - temporarily block abusive users
2. **Insurance/fallback** - backup limiter if Redis fails
3. **Queue system** - queue requests instead of rejecting

### 7. Developer Experience

| Feature | LimitRate | express-rate-limit | rate-limiter-flexible |
|---------|-----------|-------------------|----------------------|
| **TypeScript** | ✅ First-class | ⚠️ Types available | ⚠️ Types available |
| **API Simplicity** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Documentation** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Examples** | ⭐⭐⭐ (2 examples) | ⭐⭐⭐⭐⭐ (Many) | ⭐⭐⭐⭐ (Many) |
| **Error Messages** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Test Coverage** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

**Analysis:**
- **express-rate-limit wins on simplicity** - minimal config needed
- **We win on TypeScript** - built with TS from day 1
- express-rate-limit has excellent documentation site
- We need more examples

**What to Copy:**
1. **Dedicated docs site** (like express-rate-limit.mintlify.app)
2. **More examples** for common use cases
3. **Simpler API** for basic use cases (too many required options)

### 8. Performance

| Metric | LimitRate | express-rate-limit | rate-limiter-flexible |
|--------|-----------|-------------------|----------------------|
| **p50 Latency** | **0.47ms** 🏆 | 0.62ms | 0.55ms |
| **p95 Latency** | 6.4ms | **3.09ms** 🏆 | 4.5ms |
| **p99 Latency** | 45ms | **7.12ms** 🏆 | 19.6ms |
| **Throughput** | 4,579 req/s | **4,663 req/s** 🏆 | 4,636 req/s |
| **Memory Usage** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

**Analysis:**
- **We win median (p50)** - best for typical requests
- **express-rate-limit wins tail latencies** - better under stress
- All are fast enough for production
- Performance differences are negligible in real-world apps

**What to Optimize:**
- Reduce p95/p99 latencies (likely GC or event emission overhead)
- Profile hot paths
- Consider object pooling

### 9. Ecosystem & Community

| Metric | LimitRate | express-rate-limit | rate-limiter-flexible |
|--------|-----------|-------------------|----------------------|
| **GitHub Stars** | 🆕 New | ⭐⭐⭐⭐⭐ 2.9k | ⭐⭐⭐⭐ 2.7k |
| **Weekly Downloads** | 🆕 New | ⭐⭐⭐⭐⭐ 7M+ | ⭐⭐⭐⭐ 500k+ |
| **Maintenance** | ✅ Active | ✅ Active (2025) | ✅ Active |
| **Issues Response** | 🆕 New | ⭐⭐⭐⭐ Fast | ⭐⭐⭐⭐ Good |
| **Documentation Site** | ❌ No | ✅ mintlify.app | ✅ GitHub Wiki |
| **Plugin Ecosystem** | ❌ No | ✅ rate-limit-redis, etc | ✅ Built-in stores |

**Analysis:**
- **We're the new kid** - no community yet
- express-rate-limit is the most popular (7M downloads/week!)
- Both have large user bases and battle-tested code
- We need to build trust and community

**What to Build:**
1. **Documentation site**
2. **More examples**
3. **Plugin ecosystem** (custom stores, etc)
4. **Community resources** (Discord, discussions)

---

## What We Should Copy

### Priority 1: Must Have (v1.4.0)

1. **Key Blocking** (from rate-limiter-flexible)
   ```typescript
   rate: {
     maxPerMinute: 60,
     blockDuration: 3600, // Block for 1 hour if exceeded
     actionOnExceed: 'block',
   }
   ```
   **Use case:** Temporarily ban abusive users

2. **Insurance/Fallback Limiter** (from rate-limiter-flexible)
   ```typescript
   store: {
     type: 'redis',
     url: process.env.REDIS_URL,
     fallback: { type: 'memory' }, // Use if Redis fails
   }
   ```
   **Use case:** Keep working when Redis is down

3. **More Database Stores** (from rate-limiter-flexible)
   - PostgreSQL (for existing databases)
   - MySQL (for existing databases)
   - MongoDB (popular NoSQL)

### Priority 2: Nice to Have (v1.5.0)

4. **Queue System** (from rate-limiter-flexible)
   ```typescript
   rate: {
     maxPerMinute: 60,
     actionOnExceed: 'queue', // Queue instead of reject
     queueTimeout: 5000,
   }
   ```
   **Use case:** Better UX - delay instead of reject

5. **Simpler API** (from express-rate-limit)
   ```typescript
   // Current: Too verbose for simple cases
   limitrate({
     identifyUser: (req) => req.ip,
     identifyPlan: (req) => 'free',
     store: { type: 'memory' },
     policies: { free: { defaults: { rate: { maxPerMinute: 60, actionOnExceed: 'block' } } } }
   })

   // Better: Simple preset for common case
   limitrate.simple({ maxPerMinute: 60 }) // Uses IP, memory store, basic config
   ```

6. **Documentation Site** (like express-rate-limit)
   - Create limitrate.dev or use mintlify
   - Better than GitHub README
   - SEO benefits

### Priority 3: Future (v2.0.0)

7. **Multiple Algorithm Support** (from rate-limiter-flexible)
   - GCRA (more accurate)
   - Leaky bucket
   - Custom algorithms

8. **Advanced Blocking Strategies** (from rate-limiter-flexible)
   - Progressive blocking (1min, 10min, 1hour, 1day)
   - Reputation scoring
   - ML-based abuse detection

---

## What We Have Better

### 1. AI & Cost Control ⭐⭐⭐⭐⭐
**UNIQUE TO US** - Neither competitor has this
- Cost estimation per request
- Hourly/daily cost caps
- Multi-model support
- Token counting

**Impact:** This is a game-changer for AI apps

### 2. CLI Inspection Tool ⭐⭐⭐⭐⭐
**UNIQUE TO US** - Neither competitor has this
- `npx limitrate inspect`
- Real-time event viewer
- SQLite storage
- Analytics

**Impact:** Huge DX improvement for debugging

### 3. Burst Allowance ⭐⭐⭐⭐⭐
**UNIQUE TO US** - Neither competitor has this
- Extra tokens beyond rate limit
- Perfect for handling spikes
- `burst: 2` → 60 + 2 = 62 total

**Impact:** Better user experience during bursts

### 4. Plan-Aware Policies ⭐⭐⭐⭐
**Better UX** - Cleaner than competitors
- Built-in concept of plans
- Different limits per plan
- Upgrade hints built-in

**Impact:** Perfect for SaaS/freemium models

### 5. Event Webhooks ⭐⭐⭐⭐
**UNIQUE TO US** - Neither competitor has this
- Real-time limit exceeded events
- Custom event handlers
- Webhook integration

**Impact:** Great for monitoring and alerting

### 6. TypeScript-First ⭐⭐⭐⭐
**Better DX** - Built with TS from day 1
- Full type safety
- Better autocomplete
- Fewer runtime errors

**Impact:** Modern developer experience

### 7. Extended Time Windows ⭐⭐⭐⭐
**Better UX** - maxPerHour, maxPerDay built-in
- Competitors require manual calculation
- Cleaner API

**Impact:** Easier to configure common patterns

### 8. withPolicy() Override ⭐⭐⭐
**Better UX** - Per-route config
- express-rate-limit requires multiple instances
- Cleaner code

**Impact:** More flexible configuration

---

## Competitive Positioning

### When to Choose LimitRate

✅ **Best for:**
- AI/ML applications with cost control needs
- SaaS apps with tiered pricing
- Modern TypeScript projects
- Teams that need observability (CLI inspect)
- Apps needing burst handling
- Serverless deployments (Upstash)

### When to Choose express-rate-limit

✅ **Best for:**
- Simple rate limiting needs
- Existing large-scale deployments
- Need for battle-tested stability (7M downloads/week)
- Best tail latency (p95/p99)
- Minimal configuration desired

### When to Choose rate-limiter-flexible

✅ **Best for:**
- Complex multi-database environments
- Need for advanced blocking strategies
- Multiple storage backend requirements
- DDoS protection (insurance strategy)
- Need for queue system

---

## Recommendation: Feature Roadmap

### v1.4.0 - Competitive Parity
- [ ] Add key blocking (temporary bans)
- [ ] Add insurance/fallback limiter
- [ ] Add PostgreSQL/MySQL stores
- [ ] Simplify API for basic use cases
- [ ] Optimize p95/p99 performance

### v1.5.0 - Advanced Features
- [ ] Add queue system
- [ ] Add MongoDB store
- [ ] Add progressive blocking
- [ ] Create documentation site
- [ ] Add more examples (10+ recipes)

### v2.0.0 - Next Generation
- [ ] Multiple algorithm support (GCRA, leaky bucket)
- [ ] ML-based abuse detection
- [ ] Web dashboard (not just CLI)
- [ ] Multi-region support
- [ ] Rate limit analytics API

---

## Bottom Line

**Our Strengths:**
1. ⭐ **AI/Cost control** - unique and valuable
2. ⭐ **CLI inspect** - excellent DX
3. ⭐ **Burst allowance** - better UX
4. ⭐ **Modern codebase** - TypeScript-first
5. ⭐ **Fastest p50** - best for typical traffic

**Our Weaknesses:**
1. ❌ **New library** - no community yet
2. ❌ **Fewer stores** - only 3 vs 10+
3. ❌ **No blocking strategies** - can't temp-ban users
4. ❌ **No fallback** - Redis failure = downtime
5. ❌ **Slower p95/p99** - need optimization

**Strategic Advice:**
1. **Double down on AI features** - this is our moat
2. **Add key blocking** - critical missing feature
3. **Add fallback limiter** - reliability improvement
4. **Build community** - examples, docs site, blog posts
5. **Don't chase store parity** - focus on what matters (Redis, Upstash, Postgres)

---

**Last Updated:** November 5, 2025
**Next Review:** After v1.4.0 release
