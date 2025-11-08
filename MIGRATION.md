# Migration Guide: v2.x → v3.0.0

**Published:** November 8, 2025
**Impact:** Breaking changes - major version bump required

---

## Overview

LimitRate v3.0.0 is a **simplification release** that removes scope creep features to refocus on the core mission: **rate limiting and cost control for API/AI backends**.

This release removes three features that were outside the core scope and makes one feature opt-in instead of default-on.

---

## Breaking Changes Summary

| Feature | Status | Migration Path |
|---------|--------|----------------|
| **Job Scheduler** (D6) | ❌ Removed | Use Bull/BullMQ instead |
| **Penalty/Reward System** (D4) | ❌ Removed | Implement via `getUserOverride()` |
| **IPv6 Subnet Limiting** (D5) | ❌ Removed | Handle at CDN/proxy layer |
| **Endpoint Auto-Discovery** (B2) | ⚠️ Now opt-in | Set `trackEndpoints: true` |
| **Pre-Flight Validation** (C3) | ✅ Still available | Now utilities-only (no change needed) |
| **Streaming Tracking** (C4) | ✅ Still available | Now utilities-only (no change needed) |

---

## 1. Job Scheduler Removal

### What Changed
The built-in job scheduler has been removed. This feature was outside the scope of rate limiting and better handled by dedicated job queue systems.

### Migration Path

**Before (v2.x):**
```typescript
import { JobScheduler } from '@limitrate/core';

const scheduler = new JobScheduler();
scheduler.schedule('cleanup-old-data', '0 0 * * *', async () => {
  // Cleanup logic
});
```

**After (v3.0.0):**
Use a dedicated job queue library like **Bull** or **BullMQ**:

```typescript
import Queue from 'bull';

const cleanupQueue = new Queue('cleanup', process.env.REDIS_URL);

// Schedule job with cron
cleanupQueue.add('cleanup-old-data', {}, {
  repeat: { cron: '0 0 * * *' }
});

// Process job
cleanupQueue.process('cleanup-old-data', async (job) => {
  // Cleanup logic
});
```

**Recommended Libraries:**
- [Bull](https://github.com/OptimalBits/bull) - Redis-based queue
- [BullMQ](https://github.com/taskforcesh/bullmq) - Modern Bull alternative
- [Agenda](https://github.com/agenda/agenda) - MongoDB-based scheduler

---

## 2. Penalty/Reward System Removal

### What Changed
The automatic penalty/reward system (for detecting abuse patterns) has been removed. This was too opinionated and complex for a rate limiting library.

### Migration Path

**Before (v2.x):**
```typescript
import { limitrate } from '@limitrate/express';

app.use(limitrate({
  // ... other config
  policies: {
    free: {
      endpoints: {
        'POST|/api/chat': {
          rate: { maxPerMinute: 10, actionOnExceed: 'block' },
          penalty: {
            enabled: true,
            onViolation: { multiplyLimit: 0.5, duration: 3600 },
            rewards: { threshold: 0.8, multiplyLimit: 1.2 }
          }
        }
      }
    }
  }
}));
```

**After (v3.0.0):**
Implement custom logic using `getUserOverride()`:

```typescript
import { limitrate } from '@limitrate/express';

// Track violations in your database
async function getUserOverride(userId) {
  const violations = await db.violations.count({ userId, timestamp: { $gte: Date.now() - 3600000 } });

  // Apply penalty for repeat offenders
  if (violations >= 3) {
    return {
      maxPerMinute: 5, // Reduce from 10 to 5
      reason: 'Repeat violator penalty'
    };
  }

  return null; // No override
}

app.use(limitrate({
  // ... other config
  getUserOverride,
  policies: {
    free: {
      endpoints: {
        'POST|/api/chat': {
          rate: { maxPerMinute: 10, actionOnExceed: 'block' }
        }
      }
    }
  }
}));
```

**Benefits of Manual Implementation:**
- Full control over penalty logic
- Integrate with your existing abuse detection system
- Customize based on your specific needs
- No opinionated behavior forced on you

---

## 3. IPv6 Subnet Limiting Removal

### What Changed
The automatic IPv6 subnet grouping feature has been removed. This is better handled at the CDN/proxy layer.

### Migration Path

**Before (v2.x):**
```typescript
import { limitrate } from '@limitrate/express';

app.use(limitrate({
  // ... other config
  policies: {
    free: {
      endpoints: {
        'POST|/api/chat': {
          rate: { maxPerMinute: 10, actionOnExceed: 'block' },
          ipv6Subnet: '/64' // Group by /64 subnet
        }
      }
    }
  }
}));
```

**After (v3.0.0):**
Handle IP normalization at the CDN/proxy layer or in `identifyUser()`:

**Option 1: CDN/Proxy Layer (Recommended)**
Configure your CDN (Cloudflare, Fastly, etc.) to rate limit by IPv6 subnet.

**Option 2: Custom `identifyUser()` Logic**
```typescript
import { limitrate } from '@limitrate/express';

function normalizeIPv6ToSubnet(ip, prefix = 64) {
  // Implement your own IPv6 subnet normalization
  // Or use a library like 'ipaddr.js'
  const ipaddr = require('ipaddr.js');
  const addr = ipaddr.parse(ip);
  if (addr.kind() === 'ipv6') {
    return addr.toNormalizedString().split(':').slice(0, prefix / 16).join(':');
  }
  return ip;
}

app.use(limitrate({
  identifyUser: (req) => {
    const ip = req.ip || req.connection.remoteAddress;
    return normalizeIPv6ToSubnet(ip, 64);
  },
  // ... other config
}));
```

**Recommended Approach:**
Handle this at the CDN/proxy layer (Cloudflare, AWS WAF, etc.) where it's more efficient and effective.

---

## 4. Endpoint Auto-Discovery Now Opt-In

### What Changed
Endpoint auto-discovery is **no longer enabled by default**. You must explicitly enable it with `trackEndpoints: true`.

### Impact
If you were relying on automatic endpoint tracking, your tracking will stop working unless you opt-in.

### Migration Path

**Before (v2.x):**
```typescript
import { limitrate } from '@limitrate/express';

// Tracking was automatic
app.use(limitrate({
  // ... config
}));
```

**After (v3.0.0):**
```typescript
import { limitrate } from '@limitrate/express';

// Must explicitly enable tracking
app.use(limitrate({
  // ... config
  trackEndpoints: true  // ✅ Add this line
}));
```

**Check if you need tracking:**
- If you use `npx limitrate inspect-endpoints` → Enable it
- If you rely on endpoint stats → Enable it
- If you don't use tracking features → Leave it disabled (better performance)

---

## 5. Pre-Flight Validation (No Changes Required)

### What Changed
Pre-flight validation utilities are **still available** but now clearly documented as utilities only (no auto-enforcement was ever implemented).

### No Migration Needed
If you're using validation utilities, they work exactly the same:

```typescript
import { validatePrompt } from '@limitrate/core';

// Still works in v3.0.0
const result = validatePrompt({
  prompt: userInput,
  model: 'gpt-4',
  maxTokens: 4000
});

if (!result.valid) {
  return res.status(400).json({ error: result.error });
}
```

---

## 6. Streaming Response Tracking (No Changes Required)

### What Changed
Streaming utilities are **still available** but now clearly documented as utilities only (no auto-interception was ever implemented).

### No Migration Needed
If you're using streaming utilities, they work exactly the same:

```typescript
import { StreamingTracker } from '@limitrate/core';

// Still works in v3.0.0
const tracker = new StreamingTracker();
res.on('data', (chunk) => tracker.processChunk(chunk));
res.on('end', () => {
  const tokens = tracker.getTotalTokens();
  // Log or track tokens
});
```

---

## Migration Checklist

Use this checklist to ensure a smooth migration:

### Step 1: Check for Removed Features
- [ ] Search codebase for `JobScheduler` imports
- [ ] Search codebase for `PenaltyManager` imports
- [ ] Search codebase for `penalty` in policy configs
- [ ] Search codebase for `ipv6Subnet` in policy configs
- [ ] Search codebase for IPv6 utility imports (`normalizeIP`, `getIPv6Subnet`)

### Step 2: Update Dependencies
```bash
# Update to v3.0.0
npm install @limitrate/core@^3.0.0 @limitrate/express@^3.0.0
# or
pnpm add @limitrate/core@^3.0.0 @limitrate/express@^3.0.0
```

### Step 3: Remove Removed Features
- [ ] Remove job scheduler code (migrate to Bull/BullMQ)
- [ ] Remove penalty/reward configs (implement with `getUserOverride()`)
- [ ] Remove IPv6 subnet configs (handle at CDN or in `identifyUser()`)

### Step 4: Enable Endpoint Tracking (if needed)
- [ ] Add `trackEndpoints: true` if you use `npx limitrate inspect-endpoints`
- [ ] Test endpoint tracking still works

### Step 5: Test Thoroughly
- [ ] Run tests
- [ ] Verify rate limiting still works
- [ ] Check that custom overrides work
- [ ] Verify no TypeScript errors

### Step 6: Deploy
- [ ] Deploy to staging
- [ ] Monitor for issues
- [ ] Deploy to production

---

## TypeScript Migration

### Removed Types
The following types have been removed:

```typescript
// ❌ No longer available in v3.0.0
import {
  PenaltyConfig,
  PenaltyState,
  IPv6SubnetPrefix,
  ScheduledJob,
  JobProcessor,
  SchedulerOptions
} from '@limitrate/core';
```

### Updated Types

**EndpointPolicy Interface:**
```typescript
// v2.x
interface EndpointPolicy {
  rate?: RateRule;
  cost?: CostRule;
  concurrency?: ConcurrencyConfig;
  penalty?: PenaltyConfig;      // ❌ Removed
  ipv6Subnet?: IPv6SubnetPrefix; // ❌ Removed
}

// v3.0.0
interface EndpointPolicy {
  rate?: RateRule;
  cost?: CostRule;
  concurrency?: ConcurrencyConfig;
}
```

---

## Support & Questions

- **GitHub Issues:** https://github.com/yourusername/limitrate/issues
- **Documentation:** See updated READMEs in each package
- **Discord:** [Your Discord Link]

---

## Why These Changes?

These features were removed to:

1. **Refocus on core mission** - Rate limiting and cost control for APIs/AI backends
2. **Reduce complexity** - Simpler codebase, easier to maintain and use
3. **Better separation of concerns** - Job scheduling and abuse detection belong in dedicated tools
4. **Improve performance** - Less overhead, smaller bundle size
5. **Clearer API surface** - Fewer options = easier to understand and use correctly

The result is a **leaner, faster, and more focused** rate limiting library.
