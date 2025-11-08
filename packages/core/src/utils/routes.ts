/**
 * Route normalization utilities
 * Converts dynamic routes to templates (e.g., /users/123 → /users/:id)
 */

/**
 * Normalize a route path by replacing dynamic segments with :id
 * @param path - The request path
 * @param routePath - The route template (if available from framework)
 * @returns Normalized path (e.g., "/users/:id")
 */
export function normalizeRoutePath(path: string, routePath?: string): string {
  // If we have the route template from the framework, use it
  if (routePath) {
    return routePath;
  }

  // Otherwise, heuristically replace numeric/UUID segments with :id
  return path.replace(/\/[^\/]+/g, (segment) => {
    const value = segment.slice(1); // Remove leading /

    // Check if segment looks like an ID
    if (isLikelyId(value)) {
      return '/:id';
    }

    return segment;
  });
}

/**
 * Create endpoint key from method and path
 * @param method - HTTP method
 * @param path - Route path
 * @param routePath - Route template (if available)
 * @returns Endpoint key (e.g., "POST|/api/users/:id")
 */
export function createEndpointKey(method: string, path: string, routePath?: string): string {
  const normalizedPath = normalizeRoutePath(path, routePath);
  return `${method.toUpperCase()}|${normalizedPath}`;
}

/**
 * Check if value is a kebab-case word (e.g., "free-strict", "rate-limit")
 * Non-backtracking implementation to prevent ReDoS (V6 fix)
 */
function isKebabCaseWord(value: string): boolean {
  // Must contain at least one hyphen
  if (!value.includes('-')) {
    return false;
  }

  // Split by hyphen and check each part is lowercase letters only
  const parts = value.split('-');
  if (parts.length < 2) {
    return false;
  }

  // Each part must be lowercase letters only (no numbers, no mixed case)
  return parts.every((part) => part.length > 0 && /^[a-z]+$/.test(part));
}

/**
 * Check if a string looks like an ID (numeric, UUID, ObjectId, etc.)
 */
function isLikelyId(value: string): boolean {
  // Numeric ID
  if (/^\d+$/.test(value)) {
    return true;
  }

  // UUID (8-4-4-4-12 format)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return true;
  }

  // MongoDB ObjectId (24 hex chars)
  if (/^[0-9a-f]{24}$/i.test(value)) {
    return true;
  }

  // Short ID / nanoid (common patterns)
  // Only treat as ID if it looks random (not kebab-case words)
  // Kebab-case words like "free-strict" should NOT be treated as IDs
  // Fixed ReDoS vulnerability (V6): replaced backtracking regex with simple check
  if (value.length >= 16 && /^[A-Za-z0-9_-]+$/.test(value) && !isKebabCaseWord(value)) {
    return true;
  }

  return false;
}

/**
 * Extract IP address from request, respecting proxy headers
 *
 * ⚠️  SECURITY WARNING:
 * - Only set trustProxy=true if your app is behind a trusted reverse proxy
 * - When enabled, uses the LEFTMOST IP from X-Forwarded-For (the original client)
 * - The leftmost IP can still be spoofed if your proxy doesn't sanitize headers
 * - Your reverse proxy MUST strip/sanitize X-Forwarded-For headers from clients
 * - Recommended proxies: nginx (with proper config), CloudFlare, AWS ALB
 *
 * Safe proxy configuration example (nginx):
 * ```
 * proxy_set_header X-Forwarded-For $remote_addr;
 * ```
 *
 * X-Forwarded-For format: "client_ip, proxy1_ip, proxy2_ip"
 * - client_ip (leftmost): Original client - use this for rate limiting
 * - proxy_ip (rightmost): Your proxy's IP - NOT useful for rate limiting
 *
 * V4 Security Fix: Added trustedProxyCount parameter to skip N rightmost IPs
 * - This prevents IP spoofing by skipping your known proxy IPs
 * - Example: "attacker_ip, real_client, your_proxy" with trustedProxyCount=1 returns "real_client"
 *
 * @param ip - Direct IP from socket connection
 * @param forwardedFor - Value of X-Forwarded-For header
 * @param trustProxy - Whether to trust X-Forwarded-For header (default: false)
 * @param trustedProxyCount - Number of rightmost IPs to skip (your proxies)
 * @returns Client IP address
 */
export function extractIP(
  ip: string,
  forwardedFor?: string,
  trustProxy: boolean = false,
  trustedProxyCount?: number
): string {
  if (!trustProxy || !forwardedFor) {
    return ip;
  }

  // X-Forwarded-For format: "client, proxy1, proxy2"
  const ips = forwardedFor.split(',').map(s => s.trim()).filter(s => s.length > 0);

  if (ips.length === 0) {
    return ip;
  }

  // V4: If trustedProxyCount is specified, skip N rightmost IPs (your proxies)
  // Example: ["attacker_ip", "real_client", "your_proxy"] with trustedProxyCount=1
  // Removes "your_proxy", leaving ["attacker_ip", "real_client"]
  // Returns rightmost of remaining: "real_client"
  if (trustedProxyCount !== undefined && trustedProxyCount > 0) {
    const remainingIps = ips.slice(0, ips.length - trustedProxyCount);

    if (remainingIps.length === 0) {
      // All IPs were proxies, fall back to socket IP
      return ip;
    }

    // Return rightmost of remaining IPs (closest to our proxies = most trustworthy)
    return remainingIps[remainingIps.length - 1];
  }

  // Default behavior: Return first (leftmost) IP - the original client
  return ips[0];
}

/**
 * Normalize IPv4-mapped IPv6 addresses to plain IPv4
 * @param ip - IP address
 * @returns Normalized IP address
 */
function normalizeIP(ip: string): string {
  // Convert ::ffff:127.0.0.1 to 127.0.0.1
  if (ip.toLowerCase().startsWith('::ffff:')) {
    return ip.substring(7);
  }
  return ip;
}

/**
 * Convert IPv4 address to 32-bit integer
 * Uses unsigned right shift to prevent overflow for IPs >= 128.0.0.0
 */
function ipToNumber(ip: string): number {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return 0; // Invalid IPv4
  }

  // Validate each octet is 0-255
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) {
      return 0; // Invalid octet
    }
  }

  // Build 32-bit number with unsigned right shift to prevent overflow
  return parts.reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

/**
 * Check if IP matches CIDR range
 */
function isIPInCIDR(ip: string, cidr: string): boolean {
  const [network, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);

  // Validate CIDR notation
  if (!bitsStr || isNaN(bits) || bits < 0 || bits > 32) {
    return false;
  }

  // Create subnet mask
  const mask = bits === 0 ? 0 : ~(0xffffffff >>> bits);

  const ipNum = ipToNumber(ip);
  const networkNum = ipToNumber(network);

  // Check if IP is in the subnet
  return (ipNum & mask) === (networkNum & mask);
}

/**
 * Check if IP is in allowlist/blocklist
 * @param ip - IP to check
 * @param list - List of IPs (supports CIDR notation)
 * @returns Whether IP matches
 */
export function isIPInList(ip: string, list: string[]): boolean {
  // Normalize both the IP being checked and the list entries
  const normalizedIP = normalizeIP(ip);

  for (const entry of list) {
    const normalizedEntry = normalizeIP(entry);

    // Exact match
    if (normalizedEntry === normalizedIP) {
      return true;
    }

    // CIDR match with proper bitwise subnet calculation
    if (normalizedEntry.includes('/')) {
      if (isIPInCIDR(normalizedIP, normalizedEntry)) {
        return true;
      }
    }
  }

  return false;
}
