---
"@limitrate/core": patch
"@limitrate/express": patch
---

fix: IP allowlist now works with IPv4-mapped IPv6 addresses

Fixed critical bug where IP allowlist feature was completely broken due to Node.js/Express returning localhost connections as `::ffff:127.0.0.1` (IPv4-mapped IPv6 format), but the package only accepted plain IPv4 addresses like `127.0.0.1`.

**Changes:**
- Added IPv4-mapped IPv6 validation support in `validateIPAddress()`
- Added `normalizeIP()` function to convert `::ffff:x.x.x.x` to `x.x.x.x`
- Updated `isIPInList()` to normalize both incoming IPs and allowlist entries before comparison

**Impact:** IP allowlist now works correctly for localhost and other IPv4-mapped addresses.
