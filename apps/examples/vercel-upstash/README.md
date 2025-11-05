# LimitRate + Vercel + Upstash Example

This example demonstrates how to deploy LimitRate rate limiting to **Vercel serverless functions** with **Upstash Redis** for distributed state management.

## Features

- Serverless API route with rate limiting
- Upstash Redis for distributed rate limiting across serverless functions
- Cost tracking for AI API endpoints
- Plan-based limits (free vs pro)
- Zero-config deployment to Vercel

## Prerequisites

1. [Vercel account](https://vercel.com/signup)
2. [Upstash account](https://console.upstash.com/)

## Setup

### 1. Create Upstash Redis Database

1. Go to [Upstash Console](https://console.upstash.com/)
2. Create a new Redis database (Global or Regional)
3. Copy your `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`

### 2. Configure Environment Variables

```bash
cp .env.example .env.local
```

Edit `.env.local` and add your Upstash credentials:

```bash
UPSTASH_REDIS_REST_URL=https://your-redis-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token-here
```

### 3. Install Dependencies

```bash
pnpm install
```

### 4. Run Locally

```bash
pnpm dev
```

The API will be available at `http://localhost:3000/api/ask`

### 5. Test the API

**Free plan user (10 requests/minute):**

```bash
curl -X POST http://localhost:3000/api/ask \
  -H "Content-Type: application/json" \
  -H "x-user-id: user-123" \
  -H "x-plan: free" \
  -d '{"question": "What is rate limiting?"}'
```

**Pro plan user (100 requests/minute):**

```bash
curl -X POST http://localhost:3000/api/ask \
  -H "Content-Type: application/json" \
  -H "x-user-id: user-456" \
  -H "x-plan: pro" \
  -d '{"question": "What is rate limiting?"}'
```

**Test rate limiting:**

```bash
# Make 11 requests rapidly (free plan allows 10/minute)
for i in {1..11}; do
  curl -X POST http://localhost:3000/api/ask \
    -H "Content-Type: application/json" \
    -H "x-user-id: user-123" \
    -H "x-plan: free" \
    -d '{"question": "What is rate limiting?"}'
  echo ""
done
```

The 11th request should return a 429 error.

## Deploy to Vercel

### Option 1: Deploy via Vercel CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables
vercel env add UPSTASH_REDIS_REST_URL
vercel env add UPSTASH_REDIS_REST_TOKEN

# Deploy to production
vercel --prod
```

### Option 2: Deploy via GitHub

1. Push to GitHub
2. Import project to Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

## Configuration

### Rate Limits

Edit `api/ask.ts` to customize rate limits:

```typescript
policies: {
  free: {
    endpoints: {
      'POST|/api/ask': {
        rate: {
          maxPerMinute: 10,   // 10 requests/minute
          maxPerHour: 100,    // 100 requests/hour
          actionOnExceed: 'block',
        },
      },
    },
  },
  pro: {
    endpoints: {
      'POST|/api/ask': {
        rate: {
          maxPerMinute: 100,  // 100 requests/minute
          maxPerHour: 10000,  // 10k requests/hour
          actionOnExceed: 'slowdown',
        },
      },
    },
  },
}
```

### Cost Tracking

Add cost tracking for AI API calls:

```typescript
cost: {
  perRequest: 0.002,    // $0.002 per request
  maxPerHour: 0.20,     // $0.20/hour
  maxPerDay: 2.00,      // $2.00/day
  actionOnExceed: 'block',
}
```

### User Identification

In production, replace header-based identification with JWT or session:

```typescript
identifyUser: (req) => {
  // Extract from JWT
  const token = req.headers.authorization?.replace('Bearer ', '');
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  return decoded.userId;
},

identifyPlan: async (req) => {
  // Fetch from database
  const user = await db.users.findOne({ id: req.user.id });
  return user.plan;
}
```

## Architecture

```
┌─────────────┐
│   Vercel    │
│  Serverless │
│  Functions  │
└──────┬──────┘
       │
       │ Rate Limit Check
       │
       ▼
┌─────────────┐
│   Upstash   │
│    Redis    │
│   (Global)  │
└─────────────┘
```

**Benefits:**
- **Serverless**: No server management, auto-scaling
- **Global**: Upstash provides low-latency Redis globally
- **Stateless**: Each function invocation is independent
- **Cost-effective**: Pay only for what you use

## Rate Limit Headers

LimitRate automatically adds rate limit headers to responses:

```
RateLimit-Limit: 10
RateLimit-Remaining: 7
RateLimit-Reset: 1704067200
```

## Troubleshooting

### Connection Issues

If you see Redis connection errors:

1. Verify your `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
2. Make sure you're using the REST API credentials (not Redis protocol)
3. Check Upstash dashboard for database status

### Rate Limiting Not Working

1. Make sure environment variables are set in Vercel dashboard
2. Verify user identification returns consistent values
3. Check Redis data in Upstash console

### Cold Starts

Vercel functions may have cold starts. LimitRate is optimized for serverless:
- Minimal dependencies
- Fast initialization
- Connection pooling with Upstash

## Learn More

- [LimitRate Documentation](https://github.com/limitrate/limitrate)
- [Upstash Documentation](https://docs.upstash.com/)
- [Vercel Documentation](https://vercel.com/docs)

## License

Apache-2.0
