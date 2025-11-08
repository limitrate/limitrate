---
'@limitrate/core': minor
'@limitrate/express': minor
'@limitrate/cli': minor
---

## Usability Improvements v3.2.0

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

###  Documentation: Error Handling

**Added examples** of error handling to README:

```typescript
// Redis connection failures
limitrate({
  store: {
    type: 'redis',
    url: process.env.REDIS_URL
  },
  onRedisError: 'allow', // Don't block users if Redis is down
  // ...
})
```

###  Documentation: Shared Store Pattern

**Added warning** about creating multiple store instances:

```typescript
// ❌ BAD: Creates 2 Redis connections!
app.use('/api', limitrate({ store: { type: 'redis', url: '...' } }));
app.use('/admin', limitrate({ store: { type: 'redis', url: '...' } }));

// ✅ GOOD: Share one store across middleware
import { createSharedRedisStore } from '@limitrate/express';
const store = createSharedRedisStore({ url: process.env.REDIS_URL });
app.use('/api', limitrate({ store }));
app.use('/admin', limitrate({ store }));
```

###  Documentation: identifyUser Fallback

**Clarified** that throwing from `identifyUser` falls back to IP:

```typescript
identifyUser: (req) => {
  // If you throw, LimitRate falls back to req.ip
  if (!req.headers['x-api-key']) {
    throw new Error('No API key');  // Falls back to IP
  }
  return req.headers['x-api-key'];
}
```

###  Documentation: Cost Estimation Accuracy

**Added warnings** to cost estimation examples:

```typescript
// ⚠️  Very rough estimate (±30-50% accuracy)
// Use tiktoken for better accuracy (~±5-10%)
const tokens = Math.ceil(prompt.length / 4);
```

###  Documentation: 429 Response Format

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

###  Documentation: TypeScript Examples

**Added TypeScript section** to README showing:
- Import types from `@limitrate/express`
- Typed middleware configuration
- Type-safe policy definitions

###  Documentation: Concurrency Limits

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

###  Improvement: Better Error Messages

**Enhanced** rate limit error messages:

Before:
```
Rate limit exceeded
```

After:
```
Rate limit exceeded: 11/10 requests used. Resets in 42 seconds.
```

###  Feature: Debug Mode (Opt-in)

**Added optional debug logging**:

```typescript
limitrate({
  debug: true,  // Log every rate limit check (verbose!)
  // ...
})
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
