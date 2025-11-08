---
'@limitrate/express': patch
'@limitrate/core': patch
---

Security audit improvements and webhook enhancements

## Fixed Issues

**Webhook Retry Logic (M4)**:
- Added URL validation before sending webhook requests
- Now distinguishes between 4xx (client errors - don't retry) and 5xx (server errors - retry)
- Replaced `AbortSignal.timeout()` with `AbortController` for Node.js 14+ compatibility
- Progressive timeout increases on retries (5s, 10s, 15s)
- Updated User-Agent to reflect current version (3.0.2)

## Verified Already Fixed

Through comprehensive code review, confirmed the following issues from audit were false positives (already properly implemented):
- **C1**: Timeout cleanup in concurrency limiter - Already properly stored and cleared
- **C2**: Event handler error handling - Already uses `Promise.allSettled()` to handle rejections
- **M8**: Cost validation - Already validates for NaN/Infinity/negative values
- **M10**: getUserOverride timeout - Already uses 1-second timeout with `withTimeout()`

## Test Results

All 68 tests passing:
- Core package: 20 tests passed (1 skipped)
- Express package: 48 tests passed (3 skipped)

## Notes

The comprehensive audit revealed that many reported issues were actually already fixed in previous releases. The code quality is solid with proper error handling, input validation, and timeout management already in place.
