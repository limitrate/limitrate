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
  if (value.length >= 16 && /^[A-Za-z0-9_-]+$/.test(value) && !/^[a-z]+(-[a-z]+)+$/.test(value)) {
    return true;
  }

  return false;
}

/**
 * Extract IP address from request, respecting proxy headers
 * @param ip - Direct IP from socket
 * @param forwardedFor - X-Forwarded-For header value
 * @param trustProxy - Whether to trust proxy headers
 * @returns Client IP address
 */
export function extractIP(ip: string, forwardedFor?: string, trustProxy: boolean = false): string {
  if (!trustProxy || !forwardedFor) {
    return ip;
  }

  // X-Forwarded-For can be: "client, proxy1, proxy2"
  // We want the rightmost IP (closest to us)
  const ips = forwardedFor.split(',').map(s => s.trim());
  return ips[ips.length - 1] || ip;
}

/**
 * Check if IP is in allowlist/blocklist
 * @param ip - IP to check
 * @param list - List of IPs (supports CIDR notation)
 * @returns Whether IP matches
 */
export function isIPInList(ip: string, list: string[]): boolean {
  for (const entry of list) {
    // Exact match
    if (entry === ip) {
      return true;
    }

    // CIDR match (simplified - exact match for now, can enhance later)
    if (entry.includes('/')) {
      const [network] = entry.split('/');
      if (ip.startsWith(network)) {
        return true;
      }
    }
  }

  return false;
}
