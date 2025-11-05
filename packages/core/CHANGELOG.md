# @limitrate/core

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
