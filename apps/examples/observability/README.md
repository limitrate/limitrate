# Observability Examples

This directory contains examples of integrating LimitRate with popular observability platforms.

## Available Examples

### 1. Prometheus (`prometheus.ts`)

**Best for:** Self-hosted metrics, Kubernetes environments, Grafana dashboards

**What it includes:**
- Request counters (allowed/blocked)
- Cost gauges (current consumption)
- Duration histograms (p50, p95, p99 latency)
- Blocked request tracking by reason

**Setup:**
```bash
npm install prom-client
```

**Grafana Dashboard Queries:**
```promql
# Rate limit block rate by plan
rate(limitrate_blocked_requests_total{plan="free"}[5m])

# P95 latency of rate limit checks
histogram_quantile(0.95, rate(limitrate_request_duration_seconds_bucket[5m]))

# Current cost by user
topk(10, limitrate_cost_current)
```

### 2. Datadog (`datadog.ts`)

**Best for:** Managed monitoring, enterprise environments, comprehensive APM

**What it includes:**
- Custom metrics (counters, gauges, histograms)
- Events for critical actions (cost exceeded, enterprise user limits)
- Tags for filtering (user, plan, endpoint)
- Automatic alerting integration

**Setup:**
```bash
npm install hot-shots
```

**Monitor Examples:**
```
1. Alert on high blocked rate:
   avg(last_5m):sum:limitrate.requests.blocked{plan:free}.as_rate() > 10

2. Alert on cost cap exceeded:
   sum(last_15m):limitrate.cost.exceeded{plan:pro} > 5

3. Alert on enterprise users hitting limits:
   sum(last_1h):limitrate.rate.exceeded{plan:enterprise} > 0
```

### 3. OpenTelemetry (`opentelemetry.ts`)

**Best for:** Vendor-agnostic observability, distributed tracing, cloud-native apps

**What it includes:**
- Distributed traces across rate limit checks
- Metrics (counters, gauges, histograms)
- Context propagation across services
- Flexible export to any backend (Jaeger, Prometheus, Grafana, etc.)

**Setup:**
```bash
npm install @opentelemetry/api @opentelemetry/sdk-metrics \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/resources @opentelemetry/semantic-conventions
```

**Benefits:**
- Trace rate limit decisions across microservices
- Correlate slow requests with rate limit checks
- Export to multiple backends simultaneously
- Future-proof (vendor-agnostic)

## Event Hook Reference

All examples use the `onEvent` hook provided by LimitRate:

```typescript
onEvent: async (event) => {
  // event.type: 'allowed' | 'rate_exceeded' | 'cost_exceeded' | 'ip_blocked'
  // event.user: string
  // event.plan: string
  // event.endpoint: string
  // event.allowed: boolean
  // event.action: 'block' | 'slowdown' | 'allow-and-log'
  // event.value: number (cost or count)
  // event.limit: number
}
```

## Choosing the Right Solution

| Feature | Prometheus | Datadog | OpenTelemetry |
|---------|-----------|---------|---------------|
| Cost | Free (self-hosted) | Paid | Free (self-hosted) |
| Setup Complexity | Medium | Low | High |
| Distributed Tracing | No | Yes | Yes |
| Metrics | Yes | Yes | Yes |
| Events/Alerts | Via Alertmanager | Built-in | Via backend |
| Vendor Lock-in | None | High | None |
| Kubernetes Native | Yes | Yes | Yes |
| Best For | Self-hosted, K8s | Managed, enterprise | Vendor-agnostic, future-proof |

## Common Metrics to Track

### Request Metrics
- `requests.total` - Total requests processed
- `requests.allowed` - Requests that passed rate limits
- `requests.blocked` - Requests blocked by rate limits
- `requests.blocked.{reason}` - Blocked by specific reason (rate/cost/ip)

### Cost Metrics
- `cost.current` - Current cost consumption per user
- `cost.exceeded` - Number of times cost cap exceeded
- `cost.remaining` - Remaining budget

### Performance Metrics
- `check.duration` - Time spent checking rate limits
- `slowdown.duration` - Time added by slowdown actions
- `redis.latency` - Redis operation latency (if exposed)

### Business Metrics
- `plan.distribution` - Users per plan
- `endpoint.popularity` - Most-used endpoints
- `user.activity` - Active users per time window

## Alert Examples

### Critical Alerts

```yaml
# High block rate on free tier (possible attack)
- alert: HighBlockRateFree
  expr: rate(limitrate_blocked_requests_total{plan="free"}[5m]) > 100
  severity: critical

# Enterprise user hitting limits (bad UX)
- alert: EnterpriseUserLimited
  expr: sum(last_1h):limitrate.rate.exceeded{plan="enterprise"} > 0
  severity: high

# Redis connection failures
- alert: RedisDown
  expr: limitrate_redis_errors_total > 10
  severity: critical
```

### Warning Alerts

```yaml
# High cost consumption (approaching caps)
- alert: HighCostConsumption
  expr: limitrate_cost_current / limitrate_cost_cap > 0.8
  severity: warning

# Slowdown actions increasing (users pushing limits)
- alert: HighSlowdownRate
  expr: rate(limitrate_slowdown_applied[5m]) > 50
  severity: warning
```

## Running the Examples

```bash
# Prometheus
npx tsx prometheus.ts
# Visit http://localhost:3000/metrics

# Datadog (requires DD agent running)
export DD_AGENT_HOST=localhost
npx tsx datadog.ts

# OpenTelemetry (requires OTLP collector)
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
npx tsx opentelemetry.ts
```

## Integration Tips

1. **Start Simple**: Begin with basic counters, add histograms/gauges later
2. **Use Tags**: Tag metrics with user, plan, endpoint for granular filtering
3. **Set Alerts Early**: Alert on critical metrics (enterprise limits, high costs)
4. **Monitor Redis**: Track Redis latency and errors separately
5. **Dashboard First**: Build dashboards before complex alerts
6. **Test Events**: Send test events to verify integration before production

## Resources

- [Prometheus Best Practices](https://prometheus.io/docs/practices/naming/)
- [Datadog APM](https://docs.datadoghq.com/tracing/)
- [OpenTelemetry Docs](https://opentelemetry.io/docs/)
- [LimitRate Event API](../../packages/core/README.md#events)
