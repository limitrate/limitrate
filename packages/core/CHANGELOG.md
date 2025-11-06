# @limitrate/core

## 1.3.0

### Minor Changes

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

## 1.0.1

### Patch Changes

- 5e1ed92: Fix critical bug where rate limit headers showed 0 and rate limiting was non-functional. The PolicyEngine was discarding rate limit details when requests were allowed, causing all limits to show as 0 and preventing proper enforcement.

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
