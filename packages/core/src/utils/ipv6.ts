/**
 * IPv6 Subnet Utilities (v2.1.0 - D5)
 * Normalize IPv6 addresses to subnet prefixes for rate limiting
 */

/**
 * Supported IPv6 subnet prefix lengths
 */
export type IPv6SubnetPrefix = '/48' | '/56' | '/64' | '/80' | '/96' | '/112';

/**
 * Convert prefix string to bit count
 */
function prefixToBits(prefix: IPv6SubnetPrefix): number {
  return parseInt(prefix.substring(1), 10);
}

/**
 * Check if an IP address is IPv6
 */
export function isIPv6(ip: string): boolean {
  return ip.includes(':');
}

/**
 * Normalize an IPv6 address to its expanded form
 * Example: 2001:db8::1 → 2001:0db8:0000:0000:0000:0000:0000:0001
 */
export function expandIPv6(ip: string): string {
  // Remove zone identifier if present (e.g., fe80::1%eth0)
  const cleanIp = ip.split('%')[0];

  // Handle IPv4-mapped IPv6 addresses (::ffff:192.0.2.1)
  if (cleanIp.includes('.')) {
    const parts = cleanIp.split(':');
    const ipv4 = parts[parts.length - 1];
    const ipv4Parts = ipv4.split('.');
    if (ipv4Parts.length === 4) {
      // Convert IPv4 to hex
      const hex1 = (parseInt(ipv4Parts[0]) * 256 + parseInt(ipv4Parts[1])).toString(16).padStart(4, '0');
      const hex2 = (parseInt(ipv4Parts[2]) * 256 + parseInt(ipv4Parts[3])).toString(16).padStart(4, '0');
      parts[parts.length - 1] = hex1;
      parts.push(hex2);
      return expandIPv6(parts.join(':'));
    }
  }

  // Split by '::'
  const parts = cleanIp.split('::');

  if (parts.length === 1) {
    // No :: compression, just expand each segment
    return cleanIp.split(':').map(seg => seg.padStart(4, '0')).join(':');
  }

  if (parts.length > 2) {
    throw new Error(`Invalid IPv6 address: ${ip}`);
  }

  // Expand both sides of ::
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts[1] ? parts[1].split(':') : [];

  // Calculate missing segments
  const missingCount = 8 - left.length - right.length;
  const middle = Array(missingCount).fill('0000');

  // Combine and expand
  const allParts = [...left, ...middle, ...right];
  return allParts.map(seg => seg.padStart(4, '0')).join(':');
}

/**
 * Extract subnet prefix from an IPv6 address
 * Example:
 *   - getIPv6Subnet('2001:db8::1', '/64') → '2001:0db8:0000:0000'
 *   - getIPv6Subnet('2001:db8::1', '/48') → '2001:0db8:0000'
 */
export function getIPv6Subnet(ip: string, prefix: IPv6SubnetPrefix): string {
  const expanded = expandIPv6(ip);
  const bits = prefixToBits(prefix);

  // Each segment is 16 bits
  const segmentsNeeded = Math.ceil(bits / 16);
  const segments = expanded.split(':').slice(0, segmentsNeeded);

  // If the last segment is partial, mask it
  if (bits % 16 !== 0) {
    const lastSegmentBits = bits % 16;
    const lastSegment = segments[segments.length - 1];
    const mask = (0xFFFF << (16 - lastSegmentBits)) & 0xFFFF;
    const masked = (parseInt(lastSegment, 16) & mask).toString(16).padStart(4, '0');
    segments[segments.length - 1] = masked;
  }

  return segments.join(':');
}

/**
 * Normalize an IP address for rate limiting
 * - IPv6: Returns subnet prefix if specified
 * - IPv4: Returns the full IP (no change)
 */
export function normalizeIP(ip: string, ipv6Subnet?: IPv6SubnetPrefix): string {
  if (isIPv6(ip) && ipv6Subnet) {
    return getIPv6Subnet(ip, ipv6Subnet);
  }
  return ip; // IPv4 or no subnet grouping
}
