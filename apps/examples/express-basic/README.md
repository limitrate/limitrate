# LimitRate Basic Express Example

This example demonstrates how to use LimitRate with Express to implement **plan-based rate limiting** for a REST API.

## Features

- ✅ **Three-Tier Rate Limiting**: Free, Pro, and Enterprise plans
- ✅ **Endpoint-Specific Limits**: Different limits for different routes
- ✅ **Multiple Enforcement Actions**: Block, slowdown, or allow-and-log
- ✅ **CLI Dashboard**: Real-time monitoring with `npx limitrate inspect`
- ✅ **In-Memory Storage**: Perfect for development and single-server deployments
- ✅ **Standard Headers**: Automatic `RateLimit-*` headers on all responses

## Quick Start

```bash
# Install dependencies
pnpm install

# Run the server
pnpm dev
```

Server runs on http://localhost:3001

## API Endpoints

### `GET /`
Shows API information and available endpoints.

```bash
curl http://localhost:3001/
```

### `GET /api/data`
Strictly rate-limited endpoint (10 req/min for free users).

**Test as free user:**
```bash
curl http://localhost:3001/api/data
```

**Test as pro user:**
```bash
curl -H "x-user-plan: pro" http://localhost:3001/api/data
```

### `GET /api/hello`
Less strict endpoint (60 req/min for free users).

```bash
curl http://localhost:3001/api/hello
```

## Testing Rate Limits

### Test Free Plan (10 requests/minute on /api/data)

```bash
# Make 15 requests rapidly - last 5 should be blocked
for i in {1..15}; do
  echo "Request $i:"
  curl http://localhost:3001/api/data
  echo ""
done
```

**Expected:** First 10 succeed, last 5 return 429 status.

### Test Pro Plan (100 requests/minute with slowdown)

```bash
# Pro users get slowdown instead of hard blocks
for i in {1..110}; do
  curl -H "x-user-plan: pro" http://localhost:3001/api/data > /dev/null 2>&1
done
```

**Expected:** All requests succeed, but requests 101-110 have 500ms delay.

### Test Enterprise Plan (allow-and-log)

```bash
# Enterprise users are never blocked
for i in {1..1500}; do
  curl -H "x-user-plan: enterprise" http://localhost:3001/api/data > /dev/null 2>&1
done
```

**Expected:** All requests succeed, events logged for monitoring.

## Plan Comparison

| Plan | `/api/data` Limit | Other Endpoints | Action on Exceed |
|------|-------------------|-----------------|------------------|
| **Free** | 10 req/min | 60 req/min | **Block** (429) |
| **Pro** | 100 req/min | 300 req/min | **Slowdown** (500ms) |
| **Enterprise** | 1000 req/min | 1000 req/min | **Allow & Log** |

## Rate Limit Headers

Every response includes standard rate limit headers:

```http
RateLimit-Limit: 10
RateLimit-Remaining: 7
RateLimit-Reset: 1730920800
```

**After hitting limit:**
```http
HTTP/1.1 429 Too Many Requests
RateLimit-Limit: 10
RateLimit-Remaining: 0
RateLimit-Reset: 1730920860
Retry-After: 60

{
  "ok": false,
  "error": "rate_limited",
  "message": "Rate limit exceeded for free plan on GET|/api/data. You've used 10 requests (limit: 10/minute). Try again in 60 seconds.",
  "details": {
    "reason": "rate_limited",
    "plan": "free",
    "endpoint": "GET|/api/data",
    "used": 10,
    "allowed": 10,
    "retryAfterSeconds": 60
  },
  "upgradeHint": "Upgrade to Pro for 10x higher limits: https://yourapp.com/pricing"
}
```

## View Dashboard

Monitor usage in real-time:

```bash
npx limitrate inspect
```

**Shows:**
- Total events tracked (last 48 hours)
- Endpoint statistics (hits, blocks, slowdowns)
- Top offenders (users hitting limits)
- Recent events with timestamps

**Example output:**
```
📊 LimitRate Dashboard (last 48 hours)
=============================================================

Total events tracked: 35

📈 Endpoint Statistics:

┌─────────────────────┬────────────┬──────────┬──────────┐
│ Endpoint            │ Total Hits │ Blocked  │ Slowdowns│
├─────────────────────┼────────────┼──────────┼──────────┤
│ GET|/api/data       │ 35         │ 5        │ 0        │
└─────────────────────┴────────────┴──────────┴──────────┘

🚨 Top Offenders (last hour):

┌──────────────┬──────┬────────────────────┐
│ User         │ Plan │ Blocks (last hour) │
├──────────────┼──────┼────────────────────┤
│ ::1          │ free │ 5                  │
└──────────────┴──────┴────────────────────┘
```

## Configuration

### User Identification

This example uses headers for simplicity. In production, use your auth system:

```typescript
identifyUser: (req) => {
  // Development: Header-based
  return req.get('x-user-id') || req.ip || 'anonymous';

  // Production: From JWT/session
  return req.user?.id || req.ip;
}
```

### Plan Identification

```typescript
identifyPlan: (req) => {
  // Development: Header-based
  const plan = req.get('x-user-plan');
  return plan === 'pro' || plan === 'enterprise' ? plan : 'free';

  // Production: From database
  return req.user?.plan || 'free';
}
```

### Storage

**Development (current):**
```typescript
store: { type: 'memory' }
```

**Production (recommended):**
```typescript
store: {
  type: 'redis',
  url: process.env.REDIS_URL
}
```

**Serverless:**
```typescript
store: {
  type: 'upstash',
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
}
```

## How It Works

```typescript
limitrate({
  // Identify user (from headers/JWT/session)
  identifyUser: (req) => req.get('x-user-id') || req.ip,

  // Identify plan (from headers/database)
  identifyPlan: (req) => req.get('x-user-plan') || 'free',

  // Define rate limits per plan
  policies: {
    free: {
      endpoints: {
        'GET|/api/data': {
          rate: {
            maxPerMinute: 10,
            actionOnExceed: 'block'  // Hard block
          }
        }
      },
      defaults: {
        rate: {
          maxPerMinute: 60,
          actionOnExceed: 'block'
        }
      }
    },
    pro: {
      endpoints: {
        'GET|/api/data': {
          rate: {
            maxPerMinute: 100,
            actionOnExceed: 'slowdown',  // Gentle slowdown
            slowdownMs: 500
          }
        }
      }
    }
  },

  // Custom upgrade message
  upgradeHint: (plan) => {
    if (plan === 'free') {
      return 'Upgrade to Pro for 10x higher limits: https://yourapp.com/pricing';
    }
  }
})
```

## Production Deployment

### 1. Use Redis

```bash
# Add Redis dependency
pnpm add redis

# Set environment variable
export REDIS_URL=redis://localhost:6379
```

```typescript
store: {
  type: 'redis',
  url: process.env.REDIS_URL,
  keyPrefix: 'limitrate:'
}
```

### 2. Add Proper Authentication

```typescript
// Example with Express session
identifyUser: (req) => {
  if (req.session?.userId) {
    return req.session.userId;
  }
  return req.ip;  // Fallback to IP
}

// Example with JWT
identifyUser: (req) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.userId;
  }
  return req.ip;
}
```

### 3. Add Webhook Monitoring

```typescript
webhookUrl: 'https://your-app.com/webhooks/limitrate',
onEvent: (event) => {
  if (event.type === 'rate_exceeded') {
    // Send alert to Slack, email, etc.
    console.warn('Rate limit exceeded:', event);
  }
}
```

### 4. Trust Proxy Headers

If behind nginx, Cloudflare, or a load balancer:

```typescript
trustProxy: true  // or ['127.0.0.1', '::1']
```

## Troubleshooting

### Rate limiting not working?

1. **Check user identification**: Make sure `identifyUser()` returns consistent values
2. **Check plan matching**: Verify `identifyPlan()` returns 'free', 'pro', or 'enterprise'
3. **Check endpoint format**: Must be `METHOD|/path` (e.g., `GET|/api/data`)

### Getting 429 but limits seem correct?

1. **Check the time window**: Limits reset after 1 minute
2. **Check for burst traffic**: Multiple fast requests count immediately
3. **Use CLI dashboard**: Run `npx limitrate inspect` to see actual usage

### CLI dashboard showing no events?

1. **Make sure you're making requests** to trigger events
2. **Check .limitrate/history.db exists** in your project root
3. **Verify @limitrate/cli is installed** in your project

## Learn More

- [LimitRate Documentation](https://github.com/limitrate/limitrate)
- [express-ai example](../express-ai) - AI cost tracking with OpenAI
- [vercel-upstash example](../vercel-upstash) - Serverless deployment

## License

Apache-2.0
