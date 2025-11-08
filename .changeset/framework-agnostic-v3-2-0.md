---
"@limitrate/core": minor
"@limitrate/express": minor
---

# Framework Agnostic Architecture (v3.2.0)

## Major Changes

### New Framework-Agnostic Core

LimitRate now has a framework-agnostic architecture that enables support for any web framework! This is the foundation for supporting Fastify, Hono, Next.js, and any future frameworks.

**New exports from `@limitrate/core`:**

```typescript
import {
  RateLimiter,           // Framework-agnostic rate limiter
  FrameworkAdapter,      // Interface for framework adapters
  AdapterOptions,        // Configuration for adapters
  RateLimitRequest,      // Universal request format
  RateLimitResult,       // Universal response format
  RateLimiterConfig,     // Configuration for RateLimiter
} from '@limitrate/core';
```

**Architecture:**

```
Framework (Express/Fastify/Hono)
    ↓
FrameworkAdapter (converts to universal format)
    ↓
RateLimiter (framework-agnostic logic)
    ↓
PolicyEngine (existing rate limiting logic)
```

### New Express Middleware (v2)

A new simplified Express middleware using the framework-agnostic architecture:

```typescript
import { limitrateV2 } from '@limitrate/express';

app.use(limitrateV2({
  store: { type: 'memory' },
  policies: {
    free: { rate: { maxPerMinute: 10 } }
  },
  identifyUser: (req) => req.user?.id || req.ip,
  identifyPlan: (req) => req.user?.plan || 'free'
}));
```

**New exports from `@limitrate/express`:**

```typescript
import {
  limitrateV2,      // New framework-agnostic middleware
  ExpressAdapter,   // Express adapter implementation
} from '@limitrate/express';
```

### Backward Compatibility

✅ **100% backward compatible** - The existing `limitrate()` middleware continues to work exactly as before. The new `limitrateV2()` is opt-in.

All existing features remain:
- IP allowlist/blocklist
- Dry-run mode
- User overrides
- Policy overrides
- Webhooks
- CLI integration
- Concurrency limiting

### What This Enables

This architecture change enables:

1. **Multi-framework support** - Easily add Fastify, Hono, Next.js adapters
2. **Cleaner code** - Separation of concerns between core logic and framework integration
3. **Better testing** - Test core logic independently of frameworks
4. **Future extensibility** - Easy to add new algorithms, features

### Next Steps

According to our [roadmap](ROADMAP.md), the next phases are:

- **Phase 2 (v3.3.0)**: Multiple rate limiting algorithms (sliding window, token bucket, leaky bucket)
- **Phase 3 (v3.4.0)**: Production observability (Prometheus, OpenTelemetry, DataDog)
- **Phase 4 (v3.5.0)**: Testing framework
- **Phase 5 (v4.0.0)**: Game-changing features (multi-tenant, circuit breaker, adaptive limits)

### Migration Guide

**No migration required** - existing code continues to work!

If you want to try the new architecture:

```typescript
// Before (still works)
import { limitrate } from '@limitrate/express';

// After (opt-in)
import { limitrateV2 } from '@limitrate/express';
```

The API is identical, but `limitrateV2` uses the new framework-agnostic architecture under the hood.

### Files Created

- `packages/core/src/limiter.ts` - Framework-agnostic RateLimiter class (414 lines)
- `packages/core/src/adapter.ts` - FrameworkAdapter interface (160 lines)
- `packages/express/src/adapters/express.ts` - ExpressAdapter implementation (123 lines)
- `packages/express/src/middleware-v2.ts` - New middleware using RateLimiter (206 lines)

### Test Coverage

- ✅ All 69 core tests passing
- ✅ All 69 Express tests passing
- ✅ 100% backward compatibility verified
