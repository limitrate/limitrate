# Client-Side SDK (v1.7.0 - B5)

Make your frontend **rate-limit aware**! Show users their quota, remaining requests, and when limits reset.

## Why Use This?

**Without client-side awareness:**
```
User clicks "Generate" 10 times
→ First 5 work fine
→ 6th request: ❌ 429 Rate Limit Exceeded
→ User confused and frustrated
```

**With client-side awareness:**
```jsx
<button disabled={remaining === 0}>
  Generate ({remaining}/{limit} left)
</button>
{remaining === 0 && <p>Resets in {resetIn} seconds</p>}
```

Users see their quota BEFORE hitting the limit. Better UX, fewer support tickets!

## Quick Start

### 1. Add Status Endpoint (Backend)

```typescript
import { createSharedMemoryStore } from '@limitrate/express';
import { createStatusEndpoint } from '@limitrate/express';

const store = createSharedMemoryStore();

// Status endpoint for frontend
app.get('/api/rate-limit/status', createStatusEndpoint({
  store,
  identifyUser: (req) => req.user?.id || req.ip,
  identifyPlan: (req) => req.user?.plan || 'free',
  getLimit: (plan) => plan === 'pro' ? 1000 : 100,
  windowSeconds: 60,
  endpoint: 'POST|/api/chat', // or dynamic
}));
```

### 2. Fetch Status (Frontend)

```javascript
// Vanilla JS/TypeScript
async function getRateLimitStatus() {
  const res = await fetch('/api/rate-limit/status');
  const status = await res.json();

  console.log(status);
  // {
  //   used: 47,
  //   limit: 100,
  //   remaining: 53,
  //   resetIn: 42,
  //   plan: 'free',
  //   percentage: 47
  // }

  return status;
}
```

### 3. Show in UI

```html
<!-- Simple HTML Example -->
<div id="quota-meter">
  <div class="progress-bar" style="width: 0%"></div>
  <p><span id="remaining">100</span>/<span id="limit">100</span> requests left</p>
  <p id="reset-message"></p>
</div>

<button id="generate-btn">Generate</button>

<script>
async function updateQuota() {
  const status = await getRateLimitStatus();

  document.querySelector('.progress-bar').style.width = status.percentage + '%';
  document.getElementById('remaining').textContent = status.remaining;
  document.getElementById('limit').textContent = status.limit;
  document.getElementById('generate-btn').disabled = status.remaining === 0;

  if (status.remaining === 0) {
    document.getElementById('reset-message').textContent =
      `Limit reached. Resets in ${status.resetIn} seconds`;
  }
}

// Update on page load
updateQuota();

// Update after each API call
document.getElementById('generate-btn').addEventListener('click', async () => {
  await fetch('/api/generate', { method: 'POST' });
  await updateQuota(); // Refresh quota
});
</script>
```

## React Example

```jsx
import { useState, useEffect } from 'react';

function useRateLimit() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const res = await fetch('/api/rate-limit/status');
    const data = await res.json();
    setStatus(data);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  return { ...status, refresh, loading };
}

function ImageGenerator() {
  const { remaining, limit, resetIn, percentage, refresh } = useRateLimit();

  const handleGenerate = async () => {
    await fetch('/api/generate', { method: 'POST' });
    await refresh(); // Update quota
  };

  return (
    <div>
      <div className="quota-meter">
        <div className="progress" style={{ width: `${percentage}%` }} />
        <p>{remaining}/{limit} generations left</p>
      </div>

      <button
        disabled={remaining === 0}
        onClick={handleGenerate}
      >
        Generate Image
      </button>

      {remaining === 0 && (
        <p>Limit reached. Resets in {resetIn} seconds.</p>
      )}
    </div>
  );
}
```

## Vue Example

```vue
<template>
  <div>
    <div class="quota-meter">
      <div class="progress" :style="{ width: percentage + '%' }" />
      <p>{{ remaining }}/{{ limit }} requests left</p>
    </div>

    <button
      :disabled="remaining === 0"
      @click="handleRequest"
    >
      Make Request
    </button>

    <p v-if="remaining === 0">
      Limit reached. Resets in {{ resetIn }} seconds.
    </p>
  </div>
</template>

<script>
export default {
  data() {
    return {
      status: null
    };
  },
  computed: {
    remaining() { return this.status?.remaining || 0; },
    limit() { return this.status?.limit || 100; },
    resetIn() { return this.status?.resetIn || 0; },
    percentage() { return this.status?.percentage || 0; }
  },
  mounted() {
    this.fetchStatus();
  },
  methods: {
    async fetchStatus() {
      const res = await fetch('/api/rate-limit/status');
      this.status = await res.json();
    },
    async handleRequest() {
      await fetch('/api/action', { method: 'POST' });
      await this.fetchStatus(); // Refresh
    }
  }
};
</script>
```

## Advanced: Real-Time Updates with Headers

Instead of a separate endpoint, read from response headers:

```javascript
async function makeRequest() {
  const res = await fetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'Hello' })
  });

  // Read rate limit from headers (LimitRate sets these automatically)
  const remaining = parseInt(res.headers.get('RateLimit-Remaining'));
  const limit = parseInt(res.headers.get('RateLimit-Limit'));
  const resetIn = parseInt(res.headers.get('RateLimit-Reset'));

  updateUI({ remaining, limit, resetIn });
}
```

## Upgrade Prompts

Show upgrade prompts at the right moment:

```jsx
function QuotaIndicator() {
  const { remaining, limit, plan } = useRateLimit();

  if (remaining === 0 && plan === 'free') {
    return (
      <div className="upgrade-banner">
        <p>You've used all {limit} free requests this hour!</p>
        <button onClick={() => navigate('/upgrade')}>
          Upgrade to Pro for 1000 requests/hour
        </button>
      </div>
    );
  }

  if (remaining < 10 && plan === 'free') {
    return (
      <div className="warning">
        <p>Only {remaining} requests left. Consider upgrading!</p>
      </div>
    );
  }

  return null;
}
```

## Benefits

✅ **Better UX**: Users see limits before hitting them
✅ **Transparency**: Clear quota visibility builds trust
✅ **Monetization**: Smart upgrade prompts convert better
✅ **Fewer Support Tickets**: No "Why am I rate limited?" questions
✅ **Professional**: Industry standard (Stripe, Vercel, OpenAI do this)

## API Reference

### `createStatusEndpoint(options)`

Creates an Express endpoint handler that returns rate limit status.

**Options:**
- `store`: Store instance (shared with limitrate middleware)
- `identifyUser`: Function to get user ID from request
- `identifyPlan`: Function to get plan name from request
- `getLimit`: Function to get limit based on plan
- `windowSeconds`: Time window in seconds
- `endpoint`: Optional specific endpoint to check

**Returns:** `RateLimitStatus`
```typescript
{
  used: number;        // Current usage
  limit: number;       // Rate limit
  remaining: number;   // Requests left
  resetIn: number;     // Seconds until reset
  plan: string;        // User's plan
  percentage: number;  // Usage percentage (0-100)
}
```

### `getRateLimitStatus(options)`

Lower-level function for custom implementations.

**Options:**
- `user`: User ID
- `plan`: Plan name
- `endpoint`: Endpoint key (e.g., "POST|/api/chat")
- `store`: Store instance
- `limit`: Rate limit number
- `windowSeconds`: Time window in seconds

**Returns:** `Promise<RateLimitStatus>`

## Next Steps

1. Add the status endpoint to your backend
2. Fetch status in your frontend
3. Show quota in your UI
4. Add upgrade prompts when quota is low
5. Profit from better UX and conversions! 💰
