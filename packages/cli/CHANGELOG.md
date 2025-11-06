# @limitrate/cli

## 1.2.2

### Patch Changes

- Updated dependencies [d51e1fc]
  - @limitrate/core@1.3.1

## 1.2.1

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

- Updated dependencies [53074ba]
- Updated dependencies [11adb71]
  - @limitrate/core@1.1.0

## 1.0.1

### Patch Changes

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
