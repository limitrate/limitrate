# Troubleshooting Guide

Common issues and solutions when using LimitRate.

---

## Table of Contents

1. [Rate Limiting Not Working](#rate-limiting-not-working)
2. [429 Responses Not Being Sent](#429-responses-not-being-sent)
3. [Redis Connection Issues](#redis-connection-issues)
4. [Memory Store in Production](#memory-store-in-production)
5. [IP Allowlist/Blocklist Not Working](#ip-allowlistblocklist-not-working)
6. [Cost Tracking Issues](#cost-tracking-issues)
7. [CLI Dashboard Not Working](#cli-dashboard-not-working)
8. [TypeScript Errors](#typescript-errors)
9. [Performance Issues](#performance-issues)
10. [Webhook Not Firing](#webhook-not-firing)

---

## Rate Limiting Not Working

### Symptom
Requests are not being blocked even after exceeding the limit.

### Common Causes

**1. Using Memory Store with Multiple Instances**

```typescript
// ❌ Problem: Each instance has its own memory
app.use(limitrate({
  store: { type: 'memory' },
  // ...
}));
```

**Solution:** Use Redis for distributed rate limiting:

```typescript
// ✅ Solution: Shared Redis across all instances
app.use(limitrate({
  store: {
    type: 'redis',
    url: process.env.REDIS_URL
  },
  // ...
}));
```

**2. Middleware Order**

```typescript
// ❌ Problem: LimitRate after route handlers
app.get('/api/data', (req, res) => res.json({ data: [] }));
app.use(limitrate(options));
```

**Solution:** Place LimitRate middleware BEFORE route handlers:

```typescript
// ✅ Solution: LimitRate before routes
app.use(limitrate(options));
app.get('/api/data', (req, res) => res.json({ data: [] }));
```

**3. Missing User Identification**

```typescript
// ❌ Problem: All users treated as same identity
identifyUser: (req) => 'anonymous'
```

**Solution:** Extract actual user ID:

```typescript
// ✅ Solution: Unique user identification
identifyUser: (req) => req.user?.id || req.headers['x-api-key'] || req.ip
```

**4. Wrong Endpoint Matching**

```typescript
// Policy defined for specific endpoint
policies: {
  free: {
    endpoints: {
      'POST|/api/ask': { /* limits */ }
    }
  }
}

// But requests are going to /api/ask/123
// These won't match unless route normalization works
```

**Solution:** Use Express route patterns:

```typescript
// Define route first
app.post('/api/ask/:id', handler);

// LimitRate will normalize /api/ask/123 → /api/ask/:id
```

Or use defaults:

```typescript
policies: {
  free: {
    endpoints: {
      'POST|/api/ask': { /* specific limits */ }
    },
    defaults: {
      rate: { maxPerMinute: 60, actionOnExceed: 'block' }
    }
  }
}
```

---

## 429 Responses Not Being Sent

### Symptom
Rate limits are exceeded but 429 responses not returned.

### Common Causes

**1. `actionOnExceed` Set to Allow**

```typescript
// ❌ Problem: Configured to allow and log only
rate: {
  maxPerMinute: 60,
  actionOnExceed: 'allow-and-log'
}
```

**Solution:** Use 'block' action:

```typescript
// ✅ Solution: Block when exceeded
rate: {
  maxPerMinute: 60,
  actionOnExceed: 'block'
}
```

**2. Error in Middleware**

```typescript
// ❌ Problem: identifyUser throws, falls back to IP
identifyUser: (req) => {
  throw new Error('Auth service down');
}
```

Check console logs for warnings:
```
[LimitRate] identifyUser/identifyPlan failed, using IP: Error: Auth service down
```

**Solution:** Fix the identity function or handle errors:

```typescript
// ✅ Solution: Graceful error handling
identifyUser: (req) => {
  try {
    return req.user?.id || req.ip;
  } catch (error) {
    return req.ip;
  }
}
```

---

## Redis Connection Issues

### Symptom
```
[LimitRate] Store error: Redis connection failed
```

### Common Causes

**1. Wrong Redis URL**

```typescript
// ❌ Problem: Invalid URL format
store: {
  type: 'redis',
  url: 'localhost:6379'
}
```

**Solution:** Use proper URL format:

```typescript
// ✅ Solution: Proper Redis URL
store: {
  type: 'redis',
  url: 'redis://localhost:6379'
}

// With authentication
store: {
  type: 'redis',
  url: 'redis://:password@localhost:6379'
}

// With TLS
store: {
  type: 'redis',
  url: 'rediss://username:password@host:6380'
}
```

**2. Redis Not Running**

Check if Redis is running:

```bash
redis-cli ping
# Should return: PONG
```

Start Redis:

```bash
# macOS
brew services start redis

# Linux
sudo systemctl start redis

# Docker
docker run -p 6379:6379 redis:7
```

**3. Firewall Blocking Connection**

Check if you can connect:

```bash
telnet your-redis-host 6379
```

**Solution:** Configure firewall rules or use correct network.

**4. Redis Error Handling**

By default, LimitRate fails open (allows requests) when Redis is down:

```typescript
// Default behavior: allow on error
store: { type: 'redis', url: process.env.REDIS_URL }
```

To fail closed (block on error):

```typescript
store: { type: 'redis', url: process.env.REDIS_URL },
onRedisError: 'block'  // Block all requests if Redis is down
```

---

## Memory Store in Production

### Symptom
```
⚠️ [LimitRate] Memory store in production detected.
Limits won't be shared across instances.
```

### Problem
Memory store doesn't work with load balancers or multiple instances.

### Solution
Use Redis or Upstash:

```typescript
// ✅ Production: Use Redis
store: {
  type: 'redis',
  url: process.env.REDIS_URL
}

// ✅ Serverless: Use Upstash
store: {
  type: 'upstash',
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
}
```

---

## IP Allowlist/Blocklist Not Working

### Symptom
IPs in allowlist are still being rate limited, or blocklist IPs getting through.

### Common Causes

**1. Proxy Configuration**

```typescript
// ❌ Problem: Not trusting proxy headers
app.use(limitrate({
  ipAllowlist: ['203.0.113.0/24'],
  trustProxy: false  // Express doesn't trust X-Forwarded-For
}));
```

**Solution:** Configure both Express and LimitRate:

```typescript
// ✅ Solution: Trust proxy headers
app.set('trust proxy', true);

app.use(limitrate({
  ipAllowlist: ['203.0.113.0/24'],
  trustProxy: true
}));
```

**2. Wrong IP Format**

```typescript
// ❌ Problem: IPv6 loopback not supported by validator
ipAllowlist: ['::1']
```

**Solution:** Use IPv4 or CIDR notation:

```typescript
// ✅ Solution: Use IPv4
ipAllowlist: ['127.0.0.1', '203.0.113.0/24']
```

**3. Load Balancer IP Instead of Client IP**

Behind AWS ELB, Cloudflare, etc., you might see load balancer IPs.

**Solution:** Use the rightmost IP in `X-Forwarded-For`:

```typescript
// ✅ Solution: Trust proxy chain
app.set('trust proxy', true);
trustProxy: true
```

---

## Cost Tracking Issues

### Symptom
Cost tracking not blocking even when cap is exceeded.

### Common Causes

**1. estimateCost Returns Wrong Value**

```typescript
// ❌ Problem: Returning string instead of number
cost: {
  estimateCost: (ctx) => ctx.prompt?.length || '0',  // Returns string!
  hourlyCap: 0.10
}
```

**Solution:** Always return a number:

```typescript
// ✅ Solution: Return number
cost: {
  estimateCost: (ctx) => {
    const tokens = Math.ceil((ctx.prompt?.length || 0) / 4);
    return tokens * 0.0000015;  // Returns number
  },
  hourlyCap: 0.10
}
```

**2. Cost Context Not Passed**

```typescript
// ❌ Problem: No costContext passed to middleware
const result = await engine.check({
  user: 'user-123',
  plan: 'free',
  endpoint: 'POST|/api/ask'
  // Missing: costContext
});
```

**Solution:** Pass request as costContext:

```typescript
// ✅ Solution: Middleware automatically passes req as costContext
// In Express middleware, this is done automatically:
const result = await engine.check({
  user,
  plan,
  endpoint,
  costContext: req  // Express middleware passes entire request
});
```

**3. Wrong Cap Value**

```typescript
// ❌ Problem: Cap too low (user exceeds immediately)
cost: {
  estimateCost: (ctx) => 0.05,  // $0.05 per request
  hourlyCap: 0.01  // Only $0.01/hour - blocks after 1st request!
}
```

**Solution:** Set realistic caps:

```typescript
// ✅ Solution: Reasonable cap
cost: {
  estimateCost: (ctx) => 0.05,
  hourlyCap: 1.00  // $1/hour - allows 20 requests
}
```

---

## CLI Dashboard Not Working

### Symptom
```bash
npx limitrate inspect
# Shows: No events found
```

### Common Causes

**1. CLI Not Installed**

```bash
# Install CLI package
pnpm add -D @limitrate/cli
# or
npm install --save-dev @limitrate/cli
```

**2. Events Not Being Saved**

The Express middleware auto-detects the CLI package:

```typescript
// Middleware automatically saves events if @limitrate/cli is installed
// Check console for:
// [LimitRate] CLI detected - events will be saved to SQLite
```

If you don't see this message, CLI package is not installed or not detected.

**3. Wrong Directory**

```bash
# CLI looks for .fairgate/history.db in current directory
cd /path/to/your/project
npx limitrate inspect
```

**4. No Events Generated**

Generate some events by hitting your API:

```bash
# Hit your API to generate events
for i in {1..20}; do curl http://localhost:3000/api/ask; done
```

**5. Events Expired**

Events are auto-deleted after 48 hours. Check timestamp:

```bash
# Check SQLite database directly
sqlite3 .fairgate/history.db "SELECT COUNT(*) FROM events;"
```

---

## TypeScript Errors

### Symptom
```
Type 'X' is not assignable to type 'Y'
```

### Common Causes

**1. Missing Type Imports**

```typescript
// ❌ Problem: Using any
const options: any = { /* ... */ };
```

**Solution:** Import proper types:

```typescript
// ✅ Solution: Import types
import { limitrate } from '@limitrate/express';
import type { LimitRateOptions, PolicyConfig } from '@limitrate/express';

const options: LimitRateOptions = { /* ... */ };
```

**2. Wrong Plan Names**

```typescript
// ❌ Problem: Typo in plan name
identifyPlan: (req) => req.user.tier  // Returns 'basic', but policy uses 'free'
```

**Solution:** Use consistent plan names:

```typescript
// ✅ Solution: Match policy keys
policies: {
  basic: { /* ... */ }  // Must match what identifyPlan returns
}

identifyPlan: (req) => req.user.tier  // Returns 'basic'
```

---

## Performance Issues

### Symptom
High latency, slow response times.

### Common Causes

**1. Slow estimateCost Function**

```typescript
// ❌ Problem: Async operation in estimateCost
cost: {
  estimateCost: async (ctx) => {
    const result = await fetch('https://api.example.com/estimate');
    return result.cost;
  }
}
```

**Solution:** Keep estimateCost synchronous and fast:

```typescript
// ✅ Solution: Fast synchronous calculation
cost: {
  estimateCost: (ctx) => {
    const tokens = Math.ceil((ctx.prompt?.length || 0) / 4);
    return tokens * 0.0000015;
  }
}
```

**2. Redis Network Latency**

Use Redis in the same region as your app servers:

```bash
# Check Redis latency
redis-cli --latency -h your-redis-host -p 6379
```

**3. Too Many Policies**

```typescript
// ❌ Problem: 100+ endpoint-specific policies
endpoints: {
  'GET|/api/users': { /* ... */ },
  'GET|/api/posts': { /* ... */ },
  // ... 98 more
}
```

**Solution:** Use defaults for most endpoints:

```typescript
// ✅ Solution: Defaults + specific overrides
endpoints: {
  'POST|/api/expensive': {
    rate: { maxPerMinute: 5, actionOnExceed: 'block' }
  }
},
defaults: {
  rate: { maxPerMinute: 60, actionOnExceed: 'block' }
}
```

---

## Webhook Not Firing

### Symptom
Webhook URL not receiving events.

### Common Causes

**1. Wrong URL**

```typescript
// ❌ Problem: HTTP instead of HTTPS, or wrong path
webhookUrl: 'http://example.com/webhook'
```

**Solution:** Use HTTPS and verify URL:

```typescript
// ✅ Solution: Correct HTTPS URL
webhookUrl: 'https://your-app.com/api/fairgate-webhook'
```

Test webhook endpoint:

```bash
curl -X POST https://your-app.com/api/fairgate-webhook \
  -H "Content-Type: application/json" \
  -d '{"type":"rate_exceeded","user":"test"}'
```

**2. Webhook Endpoint Errors**

Check your webhook handler logs:

```typescript
// Webhook handler should return 2xx status
app.post('/api/fairgate-webhook', (req, res) => {
  console.log('Received event:', req.body);
  res.status(200).send('OK');  // Important!
});
```

**3. Network/Firewall Issues**

LimitRate retries 3 times (1s, 4s, 16s intervals) but logs failures:

```
[LimitRate] Webhook error: Error: connect ETIMEDOUT
```

**Solution:** Check firewall rules, network connectivity.

---

## Common Configuration Mistakes

### 1. Forgetting to Export Config Types

```typescript
// ❌ Problem: Plain object without type safety
const policies = {
  free: { endpoints: {} }
};
```

```typescript
// ✅ Solution: Use types
import type { PolicyConfig } from '@limitrate/express';

const policies: PolicyConfig = {
  free: { endpoints: {}, defaults: {} }
};
```

### 2. Not Validating at Startup

LimitRate validates config at startup. If you see errors, fix them before deploying:

```
ValidationError: [LimitRate] Invalid configuration: maxPerMinute must be > 0
```

### 3. Using Wrong Store for Environment

- **Development:** `memory` ✅
- **Single server:** `redis` ✅
- **Multi-server:** `redis` ✅
- **Serverless:** `upstash` ✅

---

## Getting Help

1. **Check logs:** LimitRate logs warnings and errors to console
2. **Enable debug mode:** Set `DEBUG=fairgate:*` environment variable
3. **GitHub Issues:** https://github.com/limitrate/limitrate/issues
4. **Discord:** [Join our community]
5. **Stack Overflow:** Tag with `fairgate`

---

## Debugging Tips

### 1. Test Rate Limits Manually

```bash
#!/bin/bash
# Test rate limiting
for i in {1..70}; do
  echo "Request $i:"
  curl -X POST http://localhost:3000/api/ask \
    -H "x-user-id: test-user" \
    -H "x-plan: free" \
    -w "\nStatus: %{http_code}\n\n"
done
```

### 2. Inspect Redis Keys

```bash
# See all LimitRate keys
redis-cli KEYS "user:*"

# Check specific rate limit
redis-cli GET "user-123:POST|/api/ask:rate"

# Check TTL
redis-cli TTL "user-123:POST|/api/ask:rate"
```

### 3. Monitor Events

```typescript
// Add event logger
app.use(limitrate({
  // ... config
  onEvent: (event) => {
    console.log('[LimitRate Event]', JSON.stringify(event, null, 2));
  }
}));
```

### 4. Test with curl

```bash
# Test with specific headers
curl -X POST http://localhost:3000/api/ask \
  -H "x-user-id: user-123" \
  -H "x-plan: free" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"test"}' \
  -v

# Look for rate limit headers in response:
# < RateLimit-Limit: 60
# < RateLimit-Remaining: 45
# < RateLimit-Reset: 1730720018
```

---

## Still Having Issues?

Open a GitHub issue with:

1. LimitRate version: `npm list @limitrate/express`
2. Node.js version: `node --version`
3. Configuration (sanitized)
4. Error messages/logs
5. Steps to reproduce

We typically respond within 24 hours!
