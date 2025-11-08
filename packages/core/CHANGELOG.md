# @limitrate/core

## 3.0.1

### Patch Changes

- **v3.0.1 - Code Cleanup & Bug Fixes**

  **Security Fix:**

  - Fixed critical CIDR IP matching bug in `isIPInList()` - now uses proper bitwise subnet calculation instead of string prefix matching

  **Code Quality Improvements:**

  - Extracted magic numbers to named constants in MemoryStore (DEFAULT_MAX_KEYS, DEFAULT_CLEANUP_INTERVAL_MS)
  - Removed duplicate `sleep()` functions - consolidated into shared `packages/express/src/utils/sleep.ts`
  - Cleaned up old feature reference comments from v3.0.0 migration

  **Internal:**

  - Deferred Lua script extraction due to complexity (Redis/Upstash have different parameter orders)

## 3.0.0

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

## 2.2.0

### Minor Changes

- D2: Priority Queues - Higher-priority requests go first in concurrency queue

  This feature allows you to define custom request priorities based on user plan, request attributes, or any custom logic. Lower priority numbers execute first (1 = highest priority, 5 = default).

  Features:

  - Enterprise users can jump ahead of queued free users
  - Critical operations get priority processing
  - VIP users get faster response times
  - Paid plans process before free plans
  - Maintains FIFO ordering within same priority level

  API:

  ```typescript
  limitrate({
    policies,
    priority: (req) => {
      // Lower number = higher priority
      if (req.user?.plan === "enterprise") return 1;
      if (req.user?.plan === "pro") return 3;
      return 5; // free
    },
  });
  ```

## 2.1.0

### Minor Changes

- feat(D5): Add IPv6 subnet limiting to prevent IP rotation bypass

  **IPv6 Subnet Limiting (v2.1.0)**

  Group IPv6 addresses by subnet prefix to prevent users from bypassing rate limits via IP rotation. This is especially useful for preventing distributed attacks from the same network.

  **Features:**

  - Configurable subnet prefixes: `/48`, `/56`, `/64`, `/80`, `/96`, `/112`
  - IPv4 addresses pass through unchanged
  - Works across rate limiting, cost limiting, and token limiting
  - Per-endpoint configuration

  **Usage:**

  ```typescript
  limitrate({
    policies: {
      free: {
        endpoints: {
          "GET|/api/endpoint": {
            rate: { maxPerMinute: 10 },
            ipv6Subnet: "/64", // Group by /64 subnet
          },
        },
      },
    },
  });
  ```

  **Example:**

  - Without `ipv6Subnet`: `2001:db8::1` and `2001:db8::2` have separate limits
  - With `ipv6Subnet: '/64'`: Both normalize to `2001:0db8:0000:0000` and share the same limit

  **Implementation:**

  - New utilities: `isIPv6()`, `expandIPv6()`, `getIPv6Subnet()`, `normalizeIP()`
  - Integrated into PolicyEngine for all limit types
  - Comprehensive test suite with 5 tests (all passing)

  **Use Cases:**

  - Prevent distributed attacks from same network
  - Corporate networks behind same subnet
  - ISP-level rate limiting

- e471d9b: feat: Complete rebrand from FairGate to LimitRate with D5 and D6 features

  This release completes the rebrand from FairGate to LimitRate and adds two new features from Phase D.

  **BREAKING CHANGE:** Complete rebrand from `@fairgate/*` to `@limitrate/*`

  All package names, imports, and documentation have been updated:

  - `@fairgate/core` → `@limitrate/core`
  - `@fairgate/express` → `@limitrate/express`
  - `@fairgate/cli` → `@limitrate/cli`

  **Migration Guide:**

  ```bash
  # Uninstall old packages
  npm uninstall @fairgate/core @fairgate/express @fairgate/cli

  # Install new packages
  npm install @limitrate/core @limitrate/express @limitrate/cli
  ```

  Update imports:

  ```typescript
  // Before
  import { limitrate } from "@fairgate/express";

  // After
  import { limitrate } from "@limitrate/express";
  ```

  **New Features:**

  **D5: IPv6 Subnet Limiting (v2.1.0)**

  Group IPv6 addresses by subnet prefix to prevent users from bypassing rate limits via IP rotation.

  Features:

  - Configurable subnet prefixes: `/48`, `/56`, `/64`, `/80`, `/96`, `/112`
  - IPv4 addresses pass through unchanged
  - Works across rate limiting, cost limiting, and token limiting
  - Per-endpoint configuration

  Usage:

  ```typescript
  limitrate({
    policies: {
      free: {
        endpoints: {
          "GET|/api/endpoint": {
            rate: { maxPerMinute: 10 },
            ipv6Subnet: "/64", // Group by /64 subnet
          },
        },
      },
    },
  });
  ```

  Example:

  - Without `ipv6Subnet`: `2001:db8::1` and `2001:db8::2` have separate limits
  - With `ipv6Subnet: '/64'`: Both normalize to `2001:0db8:0000:0000` and share the same limit

  Implementation:

  - New utilities: `isIPv6()`, `expandIPv6()`, `getIPv6Subnet()`, `normalizeIP()`
  - Integrated into PolicyEngine for all limit types
  - Comprehensive test suite with 5 tests (all passing)

  Use Cases:

  - Prevent distributed attacks from same network
  - Corporate networks behind same subnet
  - ISP-level rate limiting

  **D6: Job Scheduling (v2.1.0)**

  Schedule rate-limited jobs for future execution with automatic retry logic and concurrency control.

  Features:

  - Polling-based job execution with configurable interval
  - Concurrency limiting (max simultaneous jobs)
  - Automatic retry with exponential backoff
  - Job lifecycle management (pending → running → completed/failed)
  - Job cancellation support
  - Store-agnostic (works with any Store implementation)

  Usage:

  ```typescript
  import { JobScheduler, MemoryStore } from "@limitrate/core";

  const store = new MemoryStore();
  const scheduler = new JobScheduler(store, {
    pollInterval: 1000, // Check for jobs every 1s
    maxConcurrency: 10, // Max 10 concurrent jobs
    completedJobTTL: 86400, // Keep completed jobs 24h
  });

  // Register processor
  scheduler.process(async (job) => {
    console.log("Processing job:", job.id, job.data);
    // Your job logic here
  });

  // Schedule a job
  await scheduler.schedule({
    id: "job-123",
    executeAt: Date.now() + 3600000, // Execute in 1 hour
    endpoint: "POST|/send-email",
    user: "user_123",
    plan: "free",
    data: { to: "user@example.com", subject: "Hello" },
    maxRetries: 3, // Retry up to 3 times on failure
  });

  // Cancel a job
  await scheduler.cancel("job-123");

  // Get job status
  const job = await scheduler.getJob("job-123");
  console.log(job.status); // 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  ```

  Implementation:

  - Created `JobScheduler` class with polling mechanism
  - Type-safe job definitions with TypeScript generics
  - Exponential backoff retry strategy (2^retry \* 1000ms)
  - FIFO job execution ordered by `executeAt` timestamp
  - Comprehensive test suite with 5 tests (all passing)

  Use Cases:

  - Schedule API calls for later execution
  - Retry failed operations automatically
  - Implement delayed job processing
  - Defer expensive operations to off-peak hours

## 2.0.0

### Major Changes

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

## 1.7.0

### Minor Changes

- # Phase C4: Streaming Response Tracking (v1.7.0)

  Add streaming token tracking for real-time monitoring of AI responses.

  ## New Features

  ### StreamingTracker API

  - `StreamingTracker` class - Simple accumulator for manual token tracking
  - `trackChunk(tokens)` - Track tokens from each streaming chunk
  - `getTotalTokens()` - Get accumulated token count
  - `reset()` - Reset the counter

  ### Streaming Format Parsers

  - `parseOpenAIChunk(chunk)` - Parse OpenAI SSE format
    - Extracts usage from final chunk
    - Estimates tokens from delta content
    - Handles [DONE] marker
  - `parseAnthropicChunk(chunk)` - Parse Anthropic SSE format
    - Extracts input_tokens from message_start
    - Extracts output_tokens from message_delta
    - Estimates tokens from content_block_delta
  - `estimateTokens(text)` - Fallback token estimation (length/4)

  ## Example Usage

  ```typescript
  import { StreamingTracker, parseOpenAIChunk } from "@limitrate/core";

  const tracker = new StreamingTracker();

  for await (const chunk of stream) {
    const tokens = parseOpenAIChunk(chunk);
    if (tokens !== null) {
      tracker.trackChunk(tokens);
    }
  }

  const total = tracker.getTotalTokens();
  console.log(`Used ${total} tokens`);
  ```

  ## Benefits

  - Track tokens in real-time during streaming
  - Enforce limits during streaming (prevent overages)
  - Accurate cost tracking for streaming endpoints
  - Support for OpenAI and Anthropic formats

## 1.6.0

### Minor Changes

- # Pre-Flight Validation (v1.6.0 - Phase C3)

  Validate AI prompts BEFORE consuming rate limits to prevent wasted API calls and costs.

  ## Features

  ### Model Limits Database

  - Built-in database of 23+ popular AI models
  - Includes OpenAI (GPT-3.5, GPT-4, GPT-4o)
  - Includes Anthropic (Claude 3, Claude 3.5)
  - Includes Google (Gemini Pro, Gemini 1.5)
  - Includes Mistral (Small, Medium, Large)

  ### Validation API

  ```typescript
  import {
    validatePrompt,
    createTokenizer,
    formatValidationError,
  } from "@limitrate/core";

  // Create tokenizer
  const tokenizer = await createTokenizer("gpt-4");

  // Validate prompt
  const result = await validatePrompt({
    model: "gpt-4",
    tokenizer,
    prompt: "Your prompt text here",
    maxOutputTokens: 1000,
  });

  if (!result.valid) {
    console.error(formatValidationError(result));
    // Try suggested alternative model
    console.log("Suggested:", result.suggestedModels);
  }
  ```

  ### Custom Model Limits

  ```typescript
  const result = await validatePrompt({
    model: "my-custom-model",
    tokenizer,
    prompt: "Your prompt",
    customLimits: {
      maxInputTokens: 50000,
      maxOutputTokens: 8192,
      provider: "other",
      displayName: "My Custom Model",
    },
  });
  ```

  ### Model Limits Helpers

  ```typescript
  import {
    getModelLimits,
    getSuggestedAlternatives,
    MODEL_LIMITS,
  } from "@limitrate/core";

  // Get limits for a specific model
  const limits = getModelLimits("gpt-4");
  console.log(limits?.maxInputTokens); // 8192

  // Get alternative models with larger context windows
  const alternatives = getSuggestedAlternatives("gpt-4", 50000);
  console.log(alternatives); // ['gpt-4-turbo', 'gpt-4o', 'claude-3-opus']

  // Access full database
  console.log(Object.keys(MODEL_LIMITS)); // All supported models
  ```

  ## Benefits

  - **Prevent Wasted API Calls**: Catch oversized prompts before consuming rate limits
  - **Cost Savings**: Avoid failed API calls that still count against quotas
  - **Better UX**: Instant validation feedback without waiting for API errors
  - **Smart Suggestions**: Automatically suggest models with sufficient context windows
  - **Custom Models**: Support for fine-tuned and custom models

  ## Validation Checks

  1. **Input Token Limit**: Validates prompt doesn't exceed model's max input tokens
  2. **Output Token Limit**: Validates requested output doesn't exceed model's max output tokens
  3. **Context Window**: Validates total tokens (input + output) fit within context window
  4. **Suggested Alternatives**: Automatically suggests models from same provider with larger limits

  ## TypeScript Support

  Full type safety with detailed interfaces:

  ```typescript
  interface ValidationResult {
    valid: boolean;
    reason?: string;
    inputTokens: number;
    maxInputTokens?: number;
    outputTokens?: number;
    maxOutputTokens?: number;
    totalTokens: number;
    suggestedModels?: string[];
    modelDisplayName?: string;
  }

  interface ModelLimits {
    maxInputTokens: number;
    maxOutputTokens: number;
    provider: "openai" | "anthropic" | "google" | "mistral" | "other";
    displayName: string;
  }
  ```

  ## Migration Guide

  No breaking changes. This feature is purely additive. Simply import and use the new validation functions as needed.

## 1.5.0

### Minor Changes

- # Official Tokenizer Integration (v1.5.0 - Phase C2)

  Add support for official tokenizers from OpenAI (tiktoken) and Anthropic for accurate token counting.

  ## Features

  - **OpenAI Tokenizer Integration**: Support for GPT models using tiktoken
  - **Anthropic Tokenizer Integration**: Support for Claude models using @anthropic-ai/sdk
  - **Custom Tokenizers**: Users can provide their own tokenizer functions
  - **Fallback Tokenizer**: Automatic fallback to length/4 approximation if tokenizers not installed
  - **Tokenizer Caching**: Tokenizer instances are cached for better performance
  - **Zero Breaking Changes**: All tokenizers are optional peer dependencies

  ## Usage

  ### Basic Usage (Fallback Tokenizer)

  Works out of the box without any additional dependencies:

  ```typescript
  import { createTokenizer } from "@limitrate/core";

  const tokenizer = await createTokenizer("gpt-4");
  const count = await tokenizer.count("Hello world");
  // Uses fallback: length/4 approximation
  ```

  ### With OpenAI Tokenizer (tiktoken)

  For accurate OpenAI token counts:

  ```bash
  npm install tiktoken
  ```

  ```typescript
  import { createTokenizer } from "@limitrate/core";

  const tokenizer = await createTokenizer("gpt-4");
  const count = await tokenizer.count("Hello world");
  // Uses tiktoken for precise counting
  ```

  ### With Anthropic Tokenizer

  For accurate Claude token counts:

  ```bash
  npm install @anthropic-ai/sdk
  ```

  ```typescript
  import { createTokenizer } from "@limitrate/core";

  const tokenizer = await createTokenizer("claude-3-opus");
  const count = await tokenizer.count("Hello world");
  // Uses Anthropic SDK for precise counting
  ```

  ### Custom Tokenizer Function

  ```typescript
  import { createTokenizer } from "@limitrate/core";

  // Word-based tokenizer
  const tokenizer = await createTokenizer((text) => {
    return text.split(/\s+/).length;
  });

  const count = await tokenizer.count("Hello world");
  // Returns: 2 (word count)
  ```

  ### Integration with Cost Estimation

  ```typescript
  import { limitrate, createTokenizer } from "@limitrate/express";

  // Create tokenizers once (cached)
  const gpt4Tokenizer = await createTokenizer("gpt-4");
  const claudeTokenizer = await createTokenizer("claude-3-opus");

  app.use(
    limitrate({
      store,
      identifyUser: (req) => req.headers["x-user-id"],
      identifyPlan: (req) => req.headers["x-user-plan"] || "free",
      policies: {
        free: {
          endpoints: {
            "POST|/api/chat": {
              cost: {
                estimateCost: async (req) => {
                  const model = req.body.model || "gpt-4";
                  const messages = req.body.messages;

                  // Extract text from messages
                  const text = messages.map((m) => m.content).join("\n");

                  // Count tokens accurately
                  const tokenizer = model.startsWith("claude")
                    ? claudeTokenizer
                    : gpt4Tokenizer;

                  const tokens = await tokenizer.count(text);

                  // Calculate cost
                  const pricing = {
                    "gpt-4": 0.03 / 1000,
                    "claude-3-opus": 0.015 / 1000,
                  };

                  return tokens * (pricing[model] || 0.001);
                },
                hourlyCap: 1.0,
                actionOnExceed: "block",
              },
            },
          },
        },
      },
    })
  );
  ```

  ## API

  ### `createTokenizer(modelOrFunction, options?)`

  Creates a tokenizer for the specified model or using a custom function.

  **Parameters:**

  - `modelOrFunction`: Model name (string) or custom tokenizer function
  - `options.warnOnFallback`: Whether to warn when using fallback (default: true)

  **Returns:** `Promise<Tokenizer>`

  **Supported Models:**

  - OpenAI: `gpt-3.5-turbo`, `gpt-4`, `gpt-4-turbo`, `gpt-4o`, `gpt-4o-mini`
  - Anthropic: `claude-3-opus`, `claude-3-sonnet`, `claude-3-haiku`, `claude-3-5-sonnet`

  ### `Tokenizer` Interface

  ```typescript
  interface Tokenizer {
    count(text: string | string[]): Promise<number>;
    model: string;
    isFallback: boolean;
  }
  ```

  ### `clearTokenizerCache()`

  Clears the tokenizer cache (useful for testing or reinitializing tokenizers).

  ## Migration Guide

  ### No Changes Required

  All tokenizers are optional. Existing code continues to work without any modifications.

  ### To Enable Accurate Token Counting

  1. **For OpenAI models:**

     ```bash
     npm install tiktoken
     ```

  2. **For Anthropic models:**

     ```bash
     npm install @anthropic-ai/sdk
     ```

  3. **Use in your code:**

     ```typescript
     import { createTokenizer } from "@limitrate/core";

     const tokenizer = await createTokenizer("gpt-4");
     const tokens = await tokenizer.count(text);
     ```

  ## Notes

  - **Performance**: Tokenizers are cached automatically for better performance
  - **Bundle Size**: No impact on bundle size if tokenizers are not installed
  - **Graceful Degradation**: Automatically falls back to length/4 if tokenizers unavailable
  - **Type Safety**: Full TypeScript support with type definitions

  ## Why This Matters

  **Before:** Token estimation using `text.length / 4` was inaccurate by 20-30%

  **After:** Precise token counting using official tokenizers, ensuring:

  - Accurate cost estimation
  - Better rate limiting for AI applications
  - Fewer surprises in API billing
  - Prevention of wasted API calls due to bad estimates

  ***

  **Tested with:**

  - ✅ Fallback tokenizer (no dependencies)
  - ✅ OpenAI tokenizer (tiktoken)
  - ✅ Anthropic tokenizer (@anthropic-ai/sdk)
  - ✅ Custom tokenizer functions
  - ✅ Array input support
  - ✅ Tokenizer caching
  - ✅ Multiple model support
  - ✅ Large text handling

  **Phase C2 Complete!** 🎉

## 1.4.0

### Minor Changes

- # Token-Based Rate Limiting for AI Applications (v1.4.0 - Phase C1)

  Add token-based rate limiting to enable precise control over AI API usage. Instead of limiting only request counts, you can now limit by token consumption - critical for cost control in AI applications.

  ## New Features

  ### Core (`@limitrate/core`)

  - **Token Limit Configuration**: Add `maxTokensPerMinute`, `maxTokensPerHour`, `maxTokensPerDay` to rate rules
  - **Token Tracking**: New `incrementTokens()` method in all stores (Memory, Redis, Upstash)
  - **Atomic Operations**: Lua scripts for Redis/Upstash ensure atomic token tracking
  - **Token Events**: Emit `token_limit_exceeded` and `token_usage_tracked` events

  ### Express (`@limitrate/express`)

  - **Token Extraction**: New `identifyTokenUsage` callback to extract token counts from requests
  - **Token-Aware Middleware**: Automatically tracks and enforces token limits
  - **Enhanced 429 Responses**: Token-specific error messages with clear limit information
  - **Type Safety**: Full TypeScript support for token-based rate limiting

  ## Example Usage

  ```typescript
  import { limitrate, createSharedMemoryStore } from "@limitrate/express";

  app.use(
    limitrate({
      store: createSharedMemoryStore(),
      identifyUser: (req) => req.headers["x-user-id"],
      identifyPlan: (req) => req.user?.plan || "free",
      identifyTokenUsage: (req) => {
        // Extract token count from request
        return req.body.tokens || 0;
      },
      policies: {
        free: {
          endpoints: {
            "POST|/api/chat": {
              rate: {
                maxPerMinute: 10, // Request limit
                maxTokensPerMinute: 50000, // Token limit per minute
                maxTokensPerHour: 500000, // Token limit per hour
                maxTokensPerDay: 5000000, // Token limit per day
                actionOnExceed: "block",
              },
            },
          },
        },
      },
    })
  );
  ```

  ## Breaking Changes

  None - this is a purely additive feature.

  ## Migration Guide

  No migration needed. Existing rate limiting configurations continue to work unchanged. Token limits are opt-in via the `identifyTokenUsage` callback and `maxTokens*` configuration.

  ##Performance

  - Minimal overhead: Token tracking uses the same atomic operations as existing rate limiting
  - Redis/Upstash: Single Lua script execution per request
  - Memory store: O(1) lookups and updates

  ## Testing

  Comprehensive test suite added in `test-token-based-limits.js`:

  - ✅ Token limit per minute enforcement
  - ✅ Multiple time windows (minute, hour, day)
  - ✅ Combined request + token limits
  - ✅ Token-specific 429 responses
  - ✅ All scenarios passing

## 1.3.1

### Patch Changes

- d51e1fc: fix: IP allowlist now works with IPv4-mapped IPv6 addresses

  Fixed critical bug where IP allowlist feature was completely broken due to Node.js/Express returning localhost connections as `::ffff:127.0.0.1` (IPv4-mapped IPv6 format), but the package only accepted plain IPv4 addresses like `127.0.0.1`.

  **Changes:**

  - Added IPv4-mapped IPv6 validation support in `validateIPAddress()`
  - Added `normalizeIP()` function to convert `::ffff:x.x.x.x` to `x.x.x.x`
  - Updated `isIPInList()` to normalize both incoming IPs and allowlist entries before comparison

  **Impact:** IP allowlist now works correctly for localhost and other IPv4-mapped addresses.

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
