---
'@limitrate/core': patch
'@limitrate/express': patch
---

## Performance Optimizations v3.1.2

### PERFORMANCE FIX #1: Dynamic Crypto Import on Hot Path

**Severity**: High (Performance Degradation)
**Location**: `packages/express/src/middleware.ts`

**Problem**: Every invalid user ID triggered `await import('crypto')` on the hot path, causing unnecessary async module resolution overhead on every request with non-standard user IDs (emails, UUIDs with dots, etc.).

**Fix**: Moved `createHash` from `crypto` to top-level import, eliminating dynamic import overhead.

**Code Changes**:
```typescript
// Added to top-level imports:
import { createHash } from 'crypto';

// Changed from:
const crypto = await import('crypto');
const hash = crypto.createHash('sha256').update(user).digest('hex');

// To:
const hash = createHash('sha256').update(user).digest('hex');
```

---

### PERFORMANCE FIX #2: MemoryStore User Key Count Optimization

**Severity**: High (Performance Improvement)
**Location**: `packages/core/src/stores/memory.ts`

**Problem**: `countUserKeys()` method scanned all cache entries on every insert to enforce per-user key limits. With 10,000 cached keys, checking if a user exceeded their 100-key limit required scanning all 10,000 entries.

**What Was Fixed**:
- ✅ User key count lookups: O(n) → O(1)
- ❌ LRU eviction scans: Still O(n) (only on cache insertion, not on every request)

**Fix**: Maintain `userKeyCounts: Map<user, number>` for O(1) per-user key count lookups.

**Code Changes**:
```typescript
// Added field to MemoryStore class:
private userKeyCounts: Map<string, number>;

// Added O(1) helper methods:
private getUserKeyCount(user: string): number {
  return this.userKeyCounts.get(user) ?? 0;
}

private incrementUserKeyCount(user: string): void {
  const current = this.userKeyCounts.get(user) ?? 0;
  this.userKeyCounts.set(user, current + 1);
}

private decrementUserKeyCount(user: string): void {
  const current = this.userKeyCounts.get(user) ?? 0;
  if (current <= 1) {
    this.userKeyCounts.delete(user);
  } else {
    this.userKeyCounts.set(user, current - 1);
  }
}

// Updated evictIfNeeded() to use O(1) lookup:
const userKeyCount = this.getUserKeyCount(user); // Was: this.countUserKeys(user)

// Updated all cache.set() calls to maintain counts
// Updated cleanup() to decrement counts when removing expired entries
// Updated close() to clear userKeyCounts map
```

**Performance Impact**:
- **User key count check**: O(n) → O(1) (10,000x faster for full cache)
- **LRU eviction**: Still O(n), but only triggered on new cache insertions (not every request)

**Note**: True O(1) LRU eviction would require a doubly-linked list structure. Current implementation is acceptable since eviction only happens when inserting new keys, not on every cache read/increment.

---

### IMPROVEMENT #3: Pluggable Logger Interface

**Severity**: Medium (Developer Experience)
**Location**: `packages/core/src/logger.ts`

**Problem**: LimitRate used `console.log/warn/error` throughout the codebase (141 occurrences), with no way for users to:
- Integrate with existing logging infrastructure (Winston, Pino, etc.)
- Disable logs in production
- Filter/route logs to different outputs

**Fix**: Added pluggable logger interface allowing users to provide custom logger implementations.

**Code Changes**:
```typescript
// New logger interface
export interface Logger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

// Set custom logger
import { setLogger, createSilentLogger } from '@limitrate/core';
setLogger(createSilentLogger()); // Disable all logs

// Or integrate with Winston/Pino
setLogger({
  debug: winston.debug,
  info: winston.info,
  warn: winston.warn,
  error: winston.error,
});
```

**Usage**:
```typescript
import { setLogger, createSilentLogger, createConsoleLogger } from '@limitrate/core';

// Disable all logging
setLogger(createSilentLogger());

// Use default console logger (default)
setLogger(createConsoleLogger());

// Integrate with Winston
import winston from 'winston';
setLogger({
  debug: (msg, ...args) => winston.debug(msg, ...args),
  info: (msg, ...args) => winston.info(msg, ...args),
  warn: (msg, ...args) => winston.warn(msg, ...args),
  error: (msg, ...args) => winston.error(msg, ...args),
});
```

---

## Production Impact

**Before this release**:
- ❌ Dynamic crypto import on hot path
- ❌ O(n) per-user key count scans
- ❌ No way to customize logging

**After this release**:
- ✅ Top-level crypto import (zero overhead)
- ✅ O(1) per-user key count tracking (10,000x faster)
- ✅ Pluggable logger interface for logging integration
- ⚠️  LRU eviction still O(n), but only on cache insertion (not every request)

---

## Upgrade Path

No code changes required. Simply upgrade:

```bash
npm install @limitrate/core@latest @limitrate/express@latest
```

All fixes are automatic. No configuration changes needed.

---

## Files Changed

1. `packages/express/src/middleware.ts` - Crypto import optimization, replaced console.* with logger
2. `packages/express/src/webhook.ts` - Replaced console.* with logger
3. `packages/express/src/status.ts` - Replaced console.* with logger
4. `packages/core/src/stores/memory.ts` - O(1) user key count tracking
5. `packages/core/src/stores/redis.ts` - Replaced console.* with logger
6. `packages/core/src/stores/upstash.ts` - Replaced console.* with logger
7. `packages/core/src/engine.ts` - Replaced console.* with logger
8. `packages/core/src/tokenizers/*.ts` - Replaced console.* with logger
9. `packages/core/src/utils/events.ts` - Replaced console.* with logger
10. `packages/core/src/logger.ts` - NEW: Pluggable logger interface
11. `packages/core/src/index.ts` - Export logger interface and utilities
