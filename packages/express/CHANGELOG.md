# @limitrate/express

## 1.3.0

### Minor Changes

- feat: Add client-side SDK helpers for rate limit status visibility

  New feature: Make frontends rate-limit aware! Show users their quota, remaining requests, and when limits reset - BEFORE they hit the limit.

  **What's new:**

  - `getRateLimitStatus()` - Get user's current rate limit status programmatically
  - `createStatusEndpoint()` - Convenience helper for creating Express status endpoints
  - `RateLimitStatus` type - Status response interface
  - Comprehensive documentation with React, Vue, and Vanilla JS examples

  **Use cases:**

  ```javascript
  // Backend: Create status endpoint
  app.get('/api/rate-limit/status', createStatusEndpoint({
    store,
    identifyUser: (req) => req.user?.id || req.ip,
    identifyPlan: (req) => req.user?.plan || 'free',
    getLimit: (plan) => plan === 'pro' ? 1000 : 100,
    windowSeconds: 60,
  }))

  // Frontend: Fetch and display quota
  const status = await fetch('/api/rate-limit/status').then(r => r.json())
  // { used: 47, limit: 100, remaining: 53, resetIn: 42, plan: 'free', percentage: 47 }

  <button disabled={status.remaining === 0}>
    Generate ({status.remaining}/{status.limit} left)
  </button>
  ```

  **Benefits:**

  - Better UX: Users see limits before hitting them
  - Transparency: Clear quota visibility builds trust
  - Monetization: Smart upgrade prompts at the right moment
  - Professional: Industry standard (Stripe, Vercel, OpenAI do this)
  - Fewer support tickets: No more "Why am I rate limited?" questions

  **Documentation:**

  - Comprehensive guide at `docs/CLIENT-SIDE-SDK.md`
  - Examples for React, Vue, and Vanilla JS
  - Upgrade prompt patterns
  - Response header integration

- feat: Add dry-run mode for safely testing rate limits in production

  New feature: Dry-run mode allows you to test new rate limits without actually blocking users. Perfect for testing stricter limits before deploying them.

  **What's new:**

  - `dryRun: boolean` option - Enable dry-run mode (default: false)
  - `dryRunLogger: (event: DryRunEvent) => void` callback - Custom logger for would-be blocks
  - `DryRunEvent` type - Event data for dry-run logs

  **Use case:**

  ```javascript
  limitrate({
    // ... other config
    dryRun: true,
    dryRunLogger: (event) => {
      console.log(`Would ${event.action} ${event.user} on ${event.endpoint}`);
      // Send to analytics, Slack, etc.
    },
  });
  ```

  When dry-run mode is enabled:

  - All requests succeed (no actual blocking)
  - Would-be blocks are logged to console
  - Custom logger receives event data for analysis
  - Perfect for testing limit changes in production

  **Example scenario:**
  You want to change from 10 req/min to 5 req/min. Enable dry-run mode to see how many users would be affected before actually deploying the change.

- feat: Add per-user custom limits (user overrides)

  New feature: Give specific users custom rate limits regardless of their plan. Perfect for enterprise SLAs, VIP users, internal testing, and API partners.

  **What's new:**

  - `userOverrides` option - Static config-based overrides
  - `getUserOverride(userId, req)` function - Dynamic database-based overrides
  - `UserOverride` type - Override configuration
  - `UserOverridesConfig` type - Map of user IDs to overrides
  - Override precedence over plan limits
  - Endpoint-specific overrides

  **Use cases:**

  ```javascript
  // Static overrides (config)
  limitrate({
    // ... other config
    userOverrides: {
      user_acme_corp: {
        maxPerMinute: 100,
        reason: "Enterprise SLA contract",
      },
      user_vip_founder: {
        maxPerMinute: 500,
        reason: "VIP founder account",
      },
    },
  });

  // Dynamic overrides (database)
  limitrate({
    // ... other config
    getUserOverride: async (userId) => {
      const override = await db.userLimits.findOne({ userId });
      return override ? { maxPerMinute: override.limit } : null;
    },
  });
  ```

  **Problem solved:**

  - Enterprise customer "ACME Corp" needs 100 req/min but is on "Pro" plan (10 req/min)
  - Instead of creating a new "ACMEPro" plan, use user overrides
  - No plan bloat, clean configuration, easy to manage

  **Override precedence:**

  1. User override (if exists)
  2. Plan limit (default)

  This enables enterprise flexibility without creating dozens of custom plans.

### Patch Changes

- Updated dependencies
  - @limitrate/core@1.3.0

## 1.2.0

### Minor Changes

- # v1.2.0 - Major Feature Release

  ## 🚀 New Features

  ### Burst Allowance

  - Added token bucket burst support for handling traffic spikes
  - New `burst` parameter in rate rules allows extra requests beyond regular limit
  - Atomic Lua scripts for distributed burst tracking in Redis/Upstash
  - New `RateLimit-Burst-Remaining` header in responses
  - Example: `maxPerMinute: 60, burst: 10` allows 70 requests total (60 regular + 10 burst)

  ### Extended Time Windows

  - Added `maxPerHour` and `maxPerDay` rate limit options
  - Now supports 4 time windows: second, minute, hour, day
  - Validation ensures only one time window specified per rule
  - Examples:
    - `maxPerHour: 1000` - 1000 requests per hour
    - `maxPerDay: 10000` - 10000 requests per day

  ### CLI Event Inspection

  - Fully functional `limitrate inspect` command
  - SQLite-based event storage with auto-cleanup (48-hour retention)
  - Dashboard displays:
    - Endpoint statistics with hit counts, blocks, and slowdowns
    - Top offenders (users with most blocks in last hour)
    - Recent events with timestamps
  - Beautiful terminal tables with cli-table3
  - Auto-detects when installed and saves events automatically

  ### Per-Route Policy Overrides

  - New `withPolicy()` middleware for route-specific limits
  - Allows overriding global policies on individual routes
  - Usage: `app.get('/route', withPolicy({rate: {...}}), gate, handler)`
  - Important: `withPolicy()` must be applied BEFORE the gate middleware

  ## 🐛 Bug Fixes

  - Fixed policy engine check logic for route overrides
  - Improved validation messages for time window conflicts

  ## 📝 Breaking Changes

  - None - fully backward compatible with v1.1.x

  ## ✅ Testing

  - 32 unit tests passing (100%)
  - 4 comprehensive integration tests passing (100%)
  - Burst allowance: 8/10 allowed (5 regular + 3 burst), 2 blocked ✅
  - Time windows: Hourly, daily, and plan-specific limits ✅
  - CLI inspect: 25 events stored and displayed ✅
  - withPolicy: Route overrides working correctly ✅

### Patch Changes

- Updated dependencies
  - @limitrate/core@1.2.0

## 1.1.1

### Patch Changes

- c8ea5c1: **CRITICAL BUG FIX**: Fix slowdown action not applying delays

  The slowdown action was completely non-functional in v1.1.0. The PolicyEngine's `check()` method was returning early with `action: 'allow'` instead of properly returning the slowdown action result.

  **What was broken:**

  - When rate limit exceeded with `actionOnExceed: 'slowdown'`, the engine would emit events but return `action: 'allow'`
  - Middleware never received the slowdown signal
  - Requests were not delayed as expected

  **What's fixed:**

  - Engine now correctly returns slowdown and allow-and-log actions
  - Changed check logic to return early when `action !== 'allow'`, not just when `allowed === false`
  - Slowdown delays now properly applied to HTTP responses
  - Same fix applied to both rate and cost checks for consistency

  **Test results:**

  - Request 11+ after limit: Now takes ~1000ms (previously ~30ms)
  - All other features continue to work correctly
  - 100% test pass rate achieved

- Updated dependencies [c8ea5c1]
  - @limitrate/core@1.1.1

## 1.1.0

### Minor Changes

- 11adb71: Complete rebrand from FairGate to LimitRate with no backwards compatibility

  BREAKING CHANGES:

  - Removed all `fairgate` exports and type aliases
  - Changed default Redis key prefix from `fairgate:` to `limitrate:`
  - Changed CLI storage path from `.fairgate/` to `.limitrate/`
  - Updated User-Agent header from `FairGate/0.1.0` to `LimitRate/1.0.0`
  - Updated copyright from FairGate Contributors to LimitRate Contributors

  All references to "fairgate" have been completely removed. Users should use "limitrate" everywhere.

### Patch Changes

- 53074ba: Fix endpoint-specific policy matching bug where kebab-case path segments (like "free-strict") were incorrectly treated as dynamic IDs, causing policies to fall back to defaults instead of using endpoint-specific configurations.
- Updated dependencies [53074ba]
- Updated dependencies [11adb71]
  - @limitrate/core@1.1.0

## 1.0.1

### Patch Changes

- 5e1ed92: Fix critical bug where rate limit headers showed 0 and rate limiting was non-functional. The PolicyEngine was discarding rate limit details when requests were allowed, causing all limits to show as 0 and preventing proper enforcement.
- Updated dependencies [5e1ed92]
  - @limitrate/core@1.0.1

## 1.0.0

### Major Changes

- 33514e1: Initial v1.0 release

  Features:

  - Plan-aware rate limiting with free/pro/enterprise tiers
  - AI cost tracking with hourly and daily caps
  - Three storage backends: Memory, Redis, and Upstash
  - Express middleware with beautiful 429 responses
  - CLI dashboard for real-time monitoring
  - IP allowlist/blocklist support
  - Webhook events for observability
  - Multi-model AI cost estimation

### Patch Changes

- Updated dependencies [33514e1]
  - @limitrate/core@1.0.0
