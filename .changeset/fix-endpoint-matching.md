---
"@limitrate/core": patch
"@limitrate/express": patch
---

Fix endpoint-specific policy matching bug where kebab-case path segments (like "free-strict") were incorrectly treated as dynamic IDs, causing policies to fall back to defaults instead of using endpoint-specific configurations.
