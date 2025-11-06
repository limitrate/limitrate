# LimitRate Performance Benchmarks

Comprehensive performance benchmarks comparing LimitRate against popular rate limiting libraries.

## Quick Start

### Prerequisites

1. **Install k6** (load testing tool)
   ```bash
   # macOS
   brew install k6

   # Linux
   snap install k6

   # Windows
   choco install k6
   ```

2. **Install jq** (JSON processor)
   ```bash
   # macOS
   brew install jq

   # Linux
   apt-get install jq

   # Windows
   choco install jq
   ```

3. **Optional: Install Redis** (for Redis benchmarks)
   ```bash
   # macOS
   brew install redis
   brew services start redis

   # Linux
   apt-get install redis-server
   systemctl start redis

   # Docker
   docker run -d -p 6379:6379 redis:alpine
   ```

### Running Benchmarks

```bash
cd tools/benchmarks

# Install dependencies
pnpm install

# Run all benchmarks
./run-benchmarks.sh
```

## Benchmark Suite

### 1. Load Test (k6-load-test.js)
- **Purpose**: Measure latency under various load conditions
- **Load Profile**:
  - Ramp up to 100 users (30s)
  - Sustain 100 users (1m)
  - Ramp up to 1000 users (30s)
  - Sustain 1000 users (1m)
  - Ramp down (30s)
- **Metrics**: p50, p95, p99 latency, requests/second
- **Thresholds**: p95 < 50ms, p99 < 100ms, error rate < 1%

### 2. Throughput Test (k6-throughput-test.js)
- **Purpose**: Measure maximum requests/second
- **Load Profile**: 1000 concurrent users for 60 seconds
- **Metrics**: Total requests/second, p50 and p95 latency

### 3. Library Comparison
Compares LimitRate against:
- **express-rate-limit**: Popular Express middleware
- **rate-limiter-flexible**: Feature-rich rate limiter

### 4. Store Comparison
Tests performance with different storage backends:
- **Memory**: In-process storage (fast, single-instance)
- **Redis**: Distributed storage (slower, multi-instance)

## Test Configuration

All tests use the same rate limit configuration:
```javascript
{
  maxPerMinute: 60,  // 60 requests per minute
  actionOnExceed: 'block'
}
```

## Understanding Results

### Latency Metrics
- **p50 (median)**: 50% of requests complete within this time
- **p95**: 95% of requests complete within this time
- **p99**: 99% of requests complete within this time

### Target Performance
- **Memory Store**: p50 < 0.5ms, p95 < 5ms
- **Redis Store**: p50 < 2ms, p95 < 10ms
- **Throughput**: > 10,000 req/s (single instance)

### What Good Results Look Like

```
Library                           p50 (ms)   p95 (ms)   p99 (ms)     req/s
───────────────────────────────────────────────────────────────────────────
LimitRate (Memory)                   0.45       2.30       4.50    15000
express-rate-limit (Memory)          0.52       3.10       6.20    14000
rate-limiter-flexible (Memory)       0.48       2.80       5.80    14500
LimitRate (Redis)                    1.85       8.50      15.00    12000
```

## Running Individual Tests

### Start Test Server
```bash
# LimitRate with memory store
LIBRARY=limitrate STORE=memory PORT=3000 node test-server.js

# express-rate-limit with memory store
LIBRARY=express-rate-limit STORE=memory PORT=3000 node test-server.js

# LimitRate with Redis
LIBRARY=limitrate STORE=redis REDIS_URL=redis://localhost:6379 PORT=3000 node test-server.js
```

### Run Specific k6 Test
```bash
# Load test
k6 run k6-load-test.js

# Throughput test
k6 run k6-throughput-test.js

# With JSON output
k6 run --out json=results.json k6-load-test.js
```

## Analyzing Results

Results are saved as JSON files in the `results/` directory:
- `limitrate-memory.json`
- `express-rate-limit-memory.json`
- `rate-limiter-flexible-memory.json`
- `limitrate-redis.json`
- `limitrate-throughput.json`

### Extract Metrics with jq
```bash
# Get p50, p95, p99
cat results/limitrate-memory.json | jq '.metrics.http_req_duration.values | {p50, p95, p99}'

# Get requests/second
cat results/limitrate-memory.json | jq '.metrics.http_reqs.values.rate'

# Get error rate
cat results/limitrate-memory.json | jq '.metrics.errors.values.rate'
```

## CI Integration

Add to GitHub Actions workflow:

```yaml
- name: Run Performance Benchmarks
  run: |
    cd tools/benchmarks
    pnpm install
    ./run-benchmarks.sh

    # Fail if performance degrades
    # TODO: Add performance regression checks
```

## Troubleshooting

### Server Won't Start
```bash
# Check if port is in use
lsof -i :3000

# Kill process using port
kill -9 $(lsof -t -i:3000)
```

### k6 Errors
```bash
# Test connectivity
curl http://localhost:3000/health

# Check k6 version
k6 version
```

### Redis Connection Issues
```bash
# Test Redis connection
redis-cli ping

# Check Redis is running
redis-cli info server
```

## Contributing

To add a new benchmark:

1. Create k6 test file (e.g., `k6-new-test.js`)
2. Update `run-benchmarks.sh` to include new test
3. Document test purpose and metrics in this README
4. Add acceptance criteria to PLAN.md

## Performance Goals

From PLAN.md acceptance criteria:
- [x] k6 load test measures p50/p95/p99 latency
- [x] Benchmarks compare memory vs Redis overhead
- [x] Benchmarks compare against popular libraries
- [ ] Results published in main README
- [ ] Target: p50 < 0.5ms (memory), p50 < 2ms (Redis)
- [ ] Throughput: > 10k req/s (single instance)

## License

Apache-2.0
