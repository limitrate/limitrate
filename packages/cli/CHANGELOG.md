# @limitrate/cli

## 2.1.1

### Patch Changes

- Updated dependencies [b17faee]
  - @limitrate/core@3.2.0

## 2.1.0

### Minor Changes

- 7e66a8d: ## Usability Improvements v3.2.0

  Based on fresh user feedback, this release addresses documentation gaps, adds helpful guides, and improves the developer experience.

  ### NEW: Endpoint Keys Documentation

  **Problem**: Users were confused about endpoint key format (`POST|/api/users/:id`)

  - "Do I use uppercase or lowercase methods?"
  - "What about route parameters?"
  - "Why isn't my rate limit working?"

  **Fix**: Added comprehensive [ENDPOINT-KEYS.md](./ENDPOINT-KEYS.md) guide covering:

  - How endpoint keys are generated
  - Method normalization (case-insensitive)
  - Route parameter handling
  - Common mistakes and debugging
  - Best practices

  ### Documentation: Error Handling

  **Added examples** of error handling to README:

  ```typescript
  // Redis connection failures
  limitrate({
    store: {
      type: "redis",
      url: process.env.REDIS_URL,
    },
    onRedisError: "allow", // Don't block users if Redis is down
    // ...
  });
  ```

  ### Documentation: Shared Store Pattern

  **Added warning** about creating multiple store instances:

  ```typescript
  // ❌ BAD: Creates 2 Redis connections!
  app.use("/api", limitrate({ store: { type: "redis", url: "..." } }));
  app.use("/admin", limitrate({ store: { type: "redis", url: "..." } }));

  // ✅ GOOD: Share one store across middleware
  import { createSharedRedisStore } from "@limitrate/express";
  const store = createSharedRedisStore({ url: process.env.REDIS_URL });
  app.use("/api", limitrate({ store }));
  app.use("/admin", limitrate({ store }));
  ```

  ### Documentation: identifyUser Fallback

  **Clarified** that throwing from `identifyUser` falls back to IP:

  ```typescript
  identifyUser: (req) => {
    // If you throw, LimitRate falls back to req.ip
    if (!req.headers["x-api-key"]) {
      throw new Error("No API key"); // Falls back to IP
    }
    return req.headers["x-api-key"];
  };
  ```

  ### Documentation: Cost Estimation Accuracy

  **Added warnings** to cost estimation examples:

  ```typescript
  // ⚠️  Very rough estimate (±30-50% accuracy)
  // Use tiktoken for better accuracy (~±5-10%)
  const tokens = Math.ceil(prompt.length / 4);
  ```

  ### Documentation: 429 Response Format

  **Documented** the 429 response body format:

  ```json
  {
    "ok": false,
    "error": "Rate limit exceeded",
    "retryAfter": 42,
    "current": 11,
    "allowed": 10,
    "resetIn": 42,
    "upgradeHint": "Upgrade to Pro for higher limits"
  }
  ```

  ### Documentation: TypeScript Examples

  **Added TypeScript section** to README showing:

  - Import types from `@limitrate/express`
  - Typed middleware configuration
  - Type-safe policy definitions

  ### Documentation: Concurrency Limits

  **Added section** documenting concurrency limits (previously undocumented):

  ```typescript
  policies: {
    pro: {
      endpoints: {
        'POST|/api/heavy-task': {
          concurrency: {
            max: 5,        // Only 5 requests at once
            mode: 'block'  // Block if all slots are busy
          }
        }
      }
    }
  }
  ```

  ### Documentation: CLI Dashboard

  **Added details** about CLI dashboard:

  - Reads from `.limitrate/events.db` (SQLite)
  - Only works when `@limitrate/cli` is installed
  - Auto-prunes events after 48 hours
  - Shows real-time cost and rate limit stats

  ### Documentation: Version Numbers

  **Fixed** version number mismatch in README table (was showing v0.0.1, should match package.json)

  ### Improvement: Better Error Messages

  **Enhanced** rate limit error messages:

  Before:

  ```
  Rate limit exceeded
  ```

  After:

  ```
  Rate limit exceeded: 11/10 requests used. Resets in 42 seconds.
  ```

  ### Feature: Debug Mode (Opt-in)

  **Added optional debug logging**:

  ```typescript
  limitrate({
    debug: true, // Log every rate limit check (verbose!)
    // ...
  });
  ```

  Logs include:

  - User ID
  - Endpoint key
  - Current usage vs limit
  - Policy matched
  - Action taken (allow/block/slowdown)

  ## Migration Guide

  No breaking changes. All improvements are:

  - Documentation additions
  - Optional features (debug mode)
  - Enhanced error messages (backward compatible)

  Simply upgrade:

  ```bash
  npm install @limitrate/core@latest @limitrate/express@latest
  ```

  ## Files Added

  1. `ENDPOINT-KEYS.md` - Comprehensive endpoint key guide
  2. `TYPESCRIPT.md` - TypeScript usage examples
  3. `ERROR-HANDLING.md` - Error handling patterns

  ## Files Changed

  1. `README.md` - Added sections for:

     - Shared store pattern
     - Error handling
     - TypeScript usage
     - Concurrency limits
     - CLI dashboard details
     - 429 response format

  2. `packages/express/README.md` - Enhanced with:

     - identifyUser fallback behavior
     - Cost estimation accuracy warnings
     - Debug mode documentation

  3. `packages/express/src/response.ts` - Better error messages
  4. `packages/express/src/middleware.ts` - Optional debug logging

  ## User Feedback Addressed

  ✅ Endpoint key format confusion
  ✅ Version number mismatch
  ✅ Missing error handling examples
  ✅ identifyUser fallback undocumented
  ✅ Cost estimation misleading
  ✅ CLI dashboard unclear
  ✅ Shared store pattern buried
  ✅ Concurrency limits undocumented
  ✅ 429 response format undocumented
  ✅ No TypeScript examples

  ## Remaining Improvements (Future Releases)

  - Config validation helper (`validateConfig()`)
  - Type-safe policy builder
  - Status endpoint helper (`getRateLimitStatus()`)
  - Warning system for unused policy keys

### Patch Changes

- Updated dependencies [7e66a8d]
- Updated dependencies [7e66a8d]
- Updated dependencies [7e66a8d]
- Updated dependencies [7e66a8d]
- Updated dependencies [7e66a8d]
- Updated dependencies [7e66a8d]
- Updated dependencies [7e66a8d]
  - @limitrate/core@3.1.0

## 2.0.1

### Patch Changes

- Updated dependencies
  - @limitrate/core@3.0.1

## 2.0.0

### Major Changes

- # v3.0.0 - Simplification & Focus Release

  **Major breaking changes - see [MIGRATION.md](../../MIGRATION.md) for upgrade guide**

  ## Breaking Changes

  ### Removed Features

  1. **Job Scheduler (D6)** - Removed built-in job scheduler

     - **Reason:** Outside scope of rate limiting, better handled by dedicated job queue systems
     - **Migration:** Use Bull, BullMQ, or Agenda for job scheduling
     - **Files removed:** `packages/core/src/scheduler/`

  2. **Penalty/Reward System (D4)** - Removed automatic penalty/reward system

     - **Reason:** Too opinionated for a rate limiting library, abuse detection is separate concern
     - **Migration:** Implement custom logic using `getUserOverride()` callback
     - **Files removed:** `packages/core/src/penalty/`

  3. **IPv6 Subnet Limiting (D5)** - Removed automatic IPv6 subnet grouping
     - **Reason:** Better handled at CDN/proxy layer
     - **Migration:** Handle IP normalization at CDN or in `identifyUser()` callback
     - **Files removed:** `packages/core/src/utils/ipv6.ts`

  ### Changed Defaults

  4. **Endpoint Auto-Discovery (B2)** - Now opt-in instead of default-on
     - **Breaking:** `trackEndpoints` now defaults to `false` (was `true`)
     - **Migration:** Explicitly set `trackEndpoints: true` to re-enable
     - **Reason:** Reduces overhead for users who don't need endpoint tracking

  ## Non-Breaking Changes

  - **Pre-Flight Validation (C3)** - Already utilities-only, no changes needed
  - **Streaming Tracking (C4)** - Already utilities-only, no changes needed

  ## Benefits

  - **Smaller Bundle:** Removed ~8 files and unused code
  - **Clearer API:** Fewer options = easier to understand and use correctly
  - **Better Separation:** Job scheduling and abuse detection belong in dedicated tools
  - **Improved Performance:** Less overhead, simpler execution paths

  ## Migration Checklist

  See [MIGRATION.md](../../MIGRATION.md) for detailed migration steps including:

  - [ ] Remove Job Scheduler usage
  - [ ] Remove Penalty/Reward configs
  - [ ] Remove IPv6 Subnet configs
  - [ ] Add `trackEndpoints: true` if using endpoint tracking
  - [ ] Update tests
  - [ ] Deploy and monitor

  ## TypeScript Changes

  ### Removed Types

  - `PenaltyConfig`
  - `PenaltyState`
  - `IPv6SubnetPrefix`
  - `ScheduledJob`
  - `JobProcessor`
  - `SchedulerOptions`

  ### Updated Types

  ```typescript
  // v2.x
  interface EndpointPolicy {
    rate?: RateRule;
    cost?: CostRule;
    concurrency?: ConcurrencyConfig;
    penalty?: PenaltyConfig; // ❌ Removed
    ipv6Subnet?: IPv6SubnetPrefix; // ❌ Removed
  }

  // v3.0.0
  interface EndpointPolicy {
    rate?: RateRule;
    cost?: CostRule;
    concurrency?: ConcurrencyConfig;
  }
  ```

  ## Metrics

  - **Files removed:** 8 files total (4 test files, 2 feature directories, 1 utility, 1 integration)
  - **Bundle size:** @limitrate/core: 73 KB, @limitrate/express: 17 KB
  - **Tests:** 16/17 passing (1 Redis connectivity failure unrelated to changes)

  ## Support

  - **Migration Guide:** [MIGRATION.md](../../MIGRATION.md)
  - **GitHub Issues:** https://github.com/yourusername/limitrate/issues
  - **Simplification Progress:** [SIMPLIFICATION-PROGRESS.md](../../SIMPLIFICATION-PROGRESS.md)

### Patch Changes

- Updated dependencies
  - @limitrate/core@3.0.0

## 1.3.2

### Patch Changes

- Updated dependencies
  - @limitrate/core@2.2.0

## 1.3.1

### Patch Changes

- Updated dependencies
- Updated dependencies [e471d9b]
  - @limitrate/core@2.1.0

## 1.3.0

### Minor Changes

- # v2.0.0: Phase D - General-Purpose Enhancement

  This major release transforms LimitRate into a comprehensive rate limiting solution with enterprise-grade features.

  ## 🚀 New Features

  ### D1: Concurrency Limits

  Control how many requests can run simultaneously per user/endpoint.

  ```typescript
  endpoints: {
    'POST|/api/heavy': {
      concurrency: {
        max: 5,                    // Max 5 concurrent requests
        queueTimeout: 30000,       // 30 second queue timeout
        actionOnExceed: 'queue'    // Queue or block
      }
    }
  }
  ```

  **Key capabilities:**

  - Semaphore-style concurrency control
  - Queue mode: Wait for slot to become available
  - Block mode: Reject immediately when limit reached
  - Per-user AND per-endpoint limiting
  - Configurable queue timeouts

  ### D2: Priority Queues

  Process high-priority requests first when using concurrency queues.

  ```typescript
  app.use(
    limitrate({
      // ...config
      priority: (req) => {
        // Lower number = higher priority
        if (req.headers["x-plan"] === "enterprise") return 1;
        if (req.headers["x-plan"] === "pro") return 3;
        return 5; // free tier
      },
    })
  );
  ```

  **Key capabilities:**

  - Priority-based request ordering
  - FIFO within same priority level
  - Integrates with concurrency limiting
  - Plan-based or custom priority functions

  ### D3: Clustering Support

  Share rate limits across multiple Node.js processes/servers.

  ```typescript
  import { createSharedMemoryStore } from '@limitrate/express';

  // Create ONE shared store instance
  const sharedStore = createSharedMemoryStore();

  // Use same instance across all servers
  app1.use(limitrate({ store: sharedStore, ... }));
  app2.use(limitrate({ store: sharedStore, ... }));
  app3.use(limitrate({ store: sharedStore, ... }));
  ```

  **Production clustering:**

  ```typescript
  // Use Redis for true multi-process clustering
  import { createSharedRedisStore } from "@limitrate/express";

  const store = createSharedRedisStore({
    url: process.env.REDIS_URL,
  });
  ```

  ### D4: Penalty/Reward System

  Dynamically adjust rate limits based on user behavior.

  ```typescript
  endpoints: {
    'GET|/api/data': {
      rate: {
        maxPerMinute: 100,
        actionOnExceed: 'block',
      },
      penalty: {
        enabled: true,
        onViolation: {
          duration: 300,       // 5 minute penalty
          multiplier: 0.5      // Reduce to 50% (50 req/min)
        },
        rewards: {
          duration: 300,
          multiplier: 1.5,     // Increase to 150% (150 req/min)
          trigger: 'below_25_percent'  // Reward light usage
        }
      }
    }
  }
  ```

  **Key capabilities:**

  - Automatic penalty on violations (reduces limits)
  - Automatic rewards for low usage (increases limits)
  - Configurable duration (TTL)
  - Configurable multipliers
  - Trigger thresholds for rewards (10%, 25%, 50%)

  ## 🔧 Breaking Changes

  ### Store Interface Extension

  All custom store implementations must now implement three additional methods:

  ```typescript
  interface Store {
    // ... existing methods ...

    // NEW: Generic data storage (v2.0.0)
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttl?: number): Promise<void>;
    delete(key: string): Promise<void>;
  }
  ```

  **Migration for custom stores:**
  If you have a custom store implementation, add these methods:

  ```typescript
  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    return value ? JSON.parse(value) : null;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    await this.client.setex(key, ttl || 86400, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }
  ```

  Built-in stores (MemoryStore, RedisStore, UpstashStore) have been updated automatically.

  ## 📊 Test Coverage

  - **D1 Concurrency:** 10 comprehensive tests
  - **D2 Priority:** 5 comprehensive tests
  - **D3 Clustering:** 1 integration test
  - **D4 Penalty/Reward:** 5 comprehensive tests
  - **Total:** 21 new tests

  ## 🎯 Use Cases Unlocked

  1. **API Gateways:** Concurrency limits prevent resource exhaustion
  2. **AI/LLM APIs:** Priority queues + penalties for fair usage
  3. **Multi-tenant SaaS:** Plan-based priority + clustering
  4. **Microservices:** Shared limits across distributed services
  5. **High-traffic APIs:** Reward good behavior, penalize abuse

  ## 📈 Performance

  All features are designed for production use with minimal overhead:

  - Concurrency: O(1) semaphore operations
  - Priority: O(log n) heap insertion
  - Clustering: Shared memory (same process) or Redis (multi-process)
  - Penalty/Reward: O(1) multiplier lookups with TTL

  ## 🔮 Future (v2.1.0+)

  The following features are planned for future releases:

  - **D5:** IPv6 Subnet Limiting
  - **D6:** Job Scheduling

  ## 📚 Documentation

  Full documentation and examples available at:

  - [Concurrency Limits](../packages/core/README.md#concurrency-limits)
  - [Priority Queues](../packages/core/README.md#priority-queues)
  - [Clustering](../packages/core/README.md#clustering)
  - [Penalty/Reward](../packages/core/README.md#penalty-reward)

### Patch Changes

- Updated dependencies
  - @limitrate/core@2.0.0

## 1.2.6

### Patch Changes

- Updated dependencies
  - @limitrate/core@1.7.0

## 1.2.5

### Patch Changes

- Updated dependencies
  - @limitrate/core@1.6.0

## 1.2.4

### Patch Changes

- Updated dependencies
  - @limitrate/core@1.5.0

## 1.2.3

### Patch Changes

- Updated dependencies
  - @limitrate/core@1.4.0

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
