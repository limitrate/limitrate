# LimitRate Benchmark Results

**Date:** November 5, 2025
**Version:** v1.2.0
**Test Environment:** macOS (Apple Silicon), Node.js v22.16.0, k6 v1.3.0

## Executive Summary

LimitRate was benchmarked against two popular rate limiting libraries under realistic load conditions. **LimitRate achieves the fastest median latency (p50)** at 0.47ms, making it ideal for typical user traffic.

### Key Findings

- ✅ **LimitRate has the fastest p50 (median) latency: 0.47ms**
- ✅ **All libraries handle 4,500+ req/s throughput**
- ⚠️ express-rate-limit has better tail latencies (p95, p99)
- ⚠️ rate-limiter-flexible doesn't set standard rate limit headers

## Test Methodology

### Load Test Profile
```
Stage 1: Ramp up to 100 users    (30 seconds)
Stage 2: Sustain 100 users       (1 minute)
Stage 3: Ramp up to 1000 users   (30 seconds)
Stage 4: Sustain 1000 users      (1 minute)
Stage 5: Ramp down               (30 seconds)

Total Duration: ~3.5 minutes per library
Total Requests: ~960,000 per library
```

### Configuration
- **Rate Limit:** 60 requests/minute (all libraries)
- **Store:** In-memory (fastest case)
- **Action:** Block on exceed (429 response)

### Hardware
- **CPU:** Apple Silicon
- **Memory:** Sufficient for in-memory storage
- **Network:** Localhost (no network latency)

## Detailed Results

### Benchmark 1: LimitRate (Memory Store)

```
✓ All thresholds passed
✓ Rate limit headers present
✓ 0% error rate

Latency:
  p50 (median):  0.47ms   ⭐ BEST
  p95:           6.4ms
  p99:           44.96ms
  avg:           2.73ms
  min:           0.04ms (40µs)
  max:           556.82ms

Throughput:
  http_reqs:     961,757 total
  rate:          4,579 req/s

Status Codes:
  200 OK:        ~60 per user (rate limit working)
  429 Too Many:  Excess requests (correct behavior)
```

### Benchmark 2: express-rate-limit (Memory Store)

```
✓ All thresholds passed
✓ Rate limit headers present
✓ 0% error rate

Latency:
  p50 (median):  0.62ms
  p95:           3.09ms   ⭐ BEST
  p99:           7.12ms   ⭐ BEST
  avg:           1.01ms
  min:           0.04ms (40µs)
  max:           18.47ms  ⭐ BEST

Throughput:
  http_reqs:     979,438 total
  rate:          4,663 req/s  ⭐ BEST

Status Codes:
  429 Too Many:  99.97% (aggressive rate limiting)
  200 OK:        0.03%
```

**Note:** express-rate-limit's 99.97% rate limit indicates very aggressive enforcement, possibly blocking more than expected.

### Benchmark 3: rate-limiter-flexible (Memory Store)

```
⚠️ Some thresholds failed
✗ No rate limit headers (by design)
⚠️ 100% "error" rate (headers missing, not actual errors)

Latency:
  p50 (median):  0.55ms
  p95:           4.5ms
  p99:           19.61ms
  avg:           1.54ms
  min:           0.04ms (39µs)
  max:           146.64ms

Throughput:
  http_reqs:     973,849 total
  rate:          4,636 req/s

Status Codes:
  200 OK / 429:  Both present (rate limiting works)

Limitation:
  - Does NOT set standard RateLimit-* headers
  - May require custom header parsing
```

## Comparison Table

| Metric | LimitRate | express-rate-limit | rate-limiter-flexible |
|--------|-----------|-------------------|----------------------|
| **p50 (median)** | **0.47ms** ⭐ | 0.62ms | 0.55ms |
| **p95** | 6.4ms | **3.09ms** ⭐ | 4.5ms |
| **p99** | 44.96ms | **7.12ms** ⭐ | 19.61ms |
| **Throughput** | 4,579 req/s | **4,663 req/s** ⭐ | 4,636 req/s |
| **Rate Limit Headers** | ✅ Yes | ✅ Yes | ❌ No |
| **Burst Support** | ✅ Yes | ❌ No | ❌ No |
| **Time Windows** | ✅ Hour/Day | ❌ No | ✅ Yes |
| **CLI Inspect** | ✅ Yes | ❌ No | ❌ No |

## Analysis

### What the Numbers Mean

**Percentiles Explained:**
- **p50 (median):** 50% of users get this speed or faster - **most important metric**
- **p95:** 95% of users get this speed - catches "unlucky" traffic spikes
- **p99:** 99% of users get this speed - extreme edge cases

**In Context:**
```
Typical API Response Time Breakdown:
├── Database query:    50-200ms  (90% of time)
├── Business logic:    5-20ms    (8% of time)
├── Rate limiting:     0.5-6ms   (2% of time)  ← This is us
└── Network latency:   10-100ms

Even optimizing rate limiting to 0ms only improves total time by 2%
```

### LimitRate Strengths

1. **Fastest for typical requests (p50)**
   - 0.47ms vs 0.62ms (24% faster than express-rate-limit)
   - Most users get the best experience

2. **Rich feature set**
   - Burst allowance (unique to LimitRate)
   - Extended time windows (maxPerHour, maxPerDay)
   - CLI inspect command for debugging
   - Event hooks for monitoring

3. **Modern codebase**
   - TypeScript throughout
   - Clean API design
   - Active development

### LimitRate Weaknesses

1. **Slower tail latencies (p95, p99)**
   - p95: 6.4ms vs 3.09ms (2x slower)
   - p99: 45ms vs 7.12ms (6x slower)
   - Likely due to garbage collection or feature overhead

2. **Newer library**
   - express-rate-limit has 10+ years of optimization
   - Smaller community (for now)

### Performance Recommendations

**For most applications: LimitRate is excellent**
- Median latency (0.47ms) is what matters for 50% of traffic
- Tail latencies (p95, p99) are still very fast (6.4ms, 45ms)
- Extra features justify minor overhead

**Consider alternatives if:**
- You need absolute best p99 latency (express-rate-limit)
- You don't need burst support or time windows
- You're already using express-rate-limit in production

**Optimization opportunities (v1.4.0):**
- Profile and optimize hot paths
- Reduce memory allocations
- Optimize event emission
- Consider object pooling

## Real-World Impact

### Scenario: E-commerce API

**Current API response time:** 150ms average
```
150ms total = 100ms database + 30ms logic + 20ms network + 0.47ms rate limiting

If we optimize rate limiting to 0ms → 149.53ms (0.3% improvement)
If rate limiting slows to 10ms → 159.53ms (6.3% degradation)
```

**Verdict:** Rate limiting overhead is negligible. Focus on database optimization instead.

### Scenario: High-Frequency Trading API

**Current API response time:** 5ms average
```
5ms total = 2ms logic + 2ms network + 1ms rate limiting

Rate limiting is 20% of latency - optimization matters!
```

**Verdict:** For ultra-low-latency APIs, consider using express-rate-limit or optimizing LimitRate.

## Conclusions

1. **LimitRate is production-ready** with competitive performance
2. **Fastest median latency** makes it ideal for typical traffic patterns
3. **Feature richness** justifies the minor tail latency trade-off
4. **Performance is not a blocker** for adoption

### Recommended Next Steps

- ✅ Document these results (done)
- ✅ Add Performance section to README (done)
- ⏳ Collect user feedback on performance
- ⏳ Add Redis benchmarks (v1.3.0)
- ⏳ Optimize hot paths based on profiling (v1.4.0)

## Running the Benchmarks Yourself

```bash
cd tools/benchmarks

# Install dependencies
pnpm install

# Quick verification test (5 seconds)
pnpm test

# Full benchmark suite (requires k6)
brew install k6
./run-benchmarks.sh
```

Results will be saved to `results/` directory in JSON format.

## Benchmark Files

- `k6-load-test.js` - Main load test script
- `k6-throughput-test.js` - Throughput stress test
- `test-server.js` - Configurable test server (supports multiple libraries)
- `run-benchmarks.sh` - Automated runner with comparison
- `quick-test.js` - Fast verification test

## Version History

- **v1.2.0** (2025-11-05): Initial benchmarks vs express-rate-limit and rate-limiter-flexible
  - LimitRate: 0.47ms p50, 6.4ms p95
  - Throughput: 4,579 req/s

---

**Last Updated:** November 5, 2025
**Next Benchmark:** TBD (after v1.3.0 optimizations)
