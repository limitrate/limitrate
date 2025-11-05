---
"@limitrate/core": minor
"@limitrate/express": minor
"@limitrate/cli": minor
---

Complete rebrand from FairGate to LimitRate with no backwards compatibility

BREAKING CHANGES:
- Removed all `fairgate` exports and type aliases
- Changed default Redis key prefix from `fairgate:` to `limitrate:`
- Changed CLI storage path from `.fairgate/` to `.limitrate/`
- Updated User-Agent header from `FairGate/0.1.0` to `LimitRate/1.0.0`
- Updated copyright from FairGate Contributors to LimitRate Contributors

All references to "fairgate" have been completely removed. Users should use "limitrate" everywhere.
