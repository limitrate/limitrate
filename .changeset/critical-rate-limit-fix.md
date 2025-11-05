---
"@limitrate/core": patch
"@limitrate/express": patch
---

Fix critical bug where rate limit headers showed 0 and rate limiting was non-functional. The PolicyEngine was discarding rate limit details when requests were allowed, causing all limits to show as 0 and preventing proper enforcement.
