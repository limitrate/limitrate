---
'@limitrate/core': patch
'@limitrate/express': patch
---

## v3.0.4

### Fixed
- Race condition in concurrent cost tracking (added atomicity documentation)
- Memory leak from event listeners (added cleanup in engine.close())
- Memory exhaustion in concurrency queue (added maxQueueSize: 1000 default)
- SSRF via webhook URLs (startup validation blocks private IPs)
- Production detection bypass (multi-platform checks: Railway, Vercel, Fly, Render)
- Cascade failures in fail-closed mode (circuit breaker with 5-failure threshold, 30s timeout)

### Added
- PolicyEngine.close() - cleanup method that removes event listeners and closes store
- PolicyEngine.removeAllListeners() - explicit event listener cleanup
- ConcurrencyConfig.maxQueueSize - backpressure limit (default: 1000 requests)
- validateWebhookUrl() - startup validation for webhook URLs
- CircuitBreaker - prevents cascade failures in Redis/Upstash fail-closed mode

### Changed
- MemoryStore production check now detects Railway, Vercel, Fly, Render environments
- Burst tokens behavior documented (fixed window model, not token bucket with refill)
- Cost tracking atomicity clarified in code comments

### Breaking Changes
- None (all new options have safe defaults)
