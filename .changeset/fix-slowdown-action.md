---
'@limitrate/core': patch
'@limitrate/express': patch
---

**CRITICAL BUG FIX**: Fix slowdown action not applying delays

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
