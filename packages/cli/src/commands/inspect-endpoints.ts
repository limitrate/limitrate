/**
 * Inspect endpoints command - show endpoint auto-discovery (v1.4.0 - B2)
 */

import Table from 'cli-table3';
import { getGlobalEndpointTracker } from '@limitrate/core';

export function inspectEndpoints(options: { json?: boolean; failOnUnprotected?: boolean } = {}): void {
  const tracker = getGlobalEndpointTracker();
  const endpoints = tracker.getEndpoints();
  const stats = tracker.getStats();

  // JSON output for CI/CD
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          summary: stats,
          endpoints: endpoints.map((e) => ({
            method: e.method,
            path: e.path,
            hasRateLimit: e.hasRateLimit,
            requestCount: e.requestCount,
            rateLimitedCount: e.rateLimitedCount,
            policy: e.policy,
            limit: e.limit,
            firstSeen: e.firstSeen,
            lastSeen: e.lastSeen,
          })),
        },
        null,
        2
      )
    );

    // Exit code 1 if unprotected endpoints found (for CI/CD)
    if (options.failOnUnprotected && stats.unprotectedEndpoints > 0) {
      process.exit(1);
    }

    return;
  }

  // Human-readable output
  console.log('\n🔍 Endpoint Auto-Discovery (Last 24 Hours)\n');
  console.log('=' + '='.repeat(80));
  console.log('');

  // Summary stats
  console.log(`📊 Summary:`);
  console.log(`   Total Endpoints:      ${stats.totalEndpoints}`);
  console.log(`   Protected:            ${stats.protectedEndpoints} ✅`);
  console.log(`   Unprotected:          ${stats.unprotectedEndpoints} ${stats.unprotectedEndpoints > 0 ? '⚠️' : '✅'}`);
  console.log(`   Total Requests:       ${stats.totalRequests.toLocaleString()}`);
  console.log(`   Rate Limited:         ${stats.totalRateLimited.toLocaleString()}`);
  console.log('');

  if (endpoints.length === 0) {
    console.log('📭 No endpoints discovered yet. Start making requests!\n');
    console.log('=' + '='.repeat(80));
    console.log('');
    return;
  }

  // Protected endpoints table
  const protectedEndpoints = endpoints.filter((e) => e.hasRateLimit);
  if (protectedEndpoints.length > 0) {
    console.log('✅ Protected Endpoints:\n');

    const protectedTable = new Table({
      head: ['Status', 'Method', 'Path', 'Requests', 'Limited', 'Policy', 'Limit'],
      colWidths: [8, 8, 30, 12, 10, 12, 10],
    });

    for (const endpoint of protectedEndpoints) {
      protectedTable.push([
        '✓',
        endpoint.method,
        endpoint.path.length > 28 ? endpoint.path.substring(0, 25) + '...' : endpoint.path,
        endpoint.requestCount.toLocaleString(),
        endpoint.rateLimitedCount.toLocaleString(),
        endpoint.policy || '-',
        endpoint.limit ? `${endpoint.limit}/min` : '-',
      ]);
    }

    console.log(protectedTable.toString());
    console.log('');
  }

  // Unprotected endpoints table (WARNING)
  const unprotectedEndpoints = endpoints.filter((e) => !e.hasRateLimit);
  if (unprotectedEndpoints.length > 0) {
    console.log('⚠️  UNPROTECTED Endpoints (NO RATE LIMITS):\n');

    const unprotectedTable = new Table({
      head: ['Status', 'Method', 'Path', 'Requests', 'Severity'],
      colWidths: [8, 8, 30, 12, 20],
      style: { head: ['yellow'] },
    });

    for (const endpoint of unprotectedEndpoints) {
      const severity = getSeverity(endpoint.requestCount);
      unprotectedTable.push([
        '⚠',
        endpoint.method,
        endpoint.path.length > 28 ? endpoint.path.substring(0, 25) + '...' : endpoint.path,
        endpoint.requestCount.toLocaleString(),
        severity,
      ]);
    }

    console.log(unprotectedTable.toString());
    console.log('');

    console.log('🚨 WARNING: These endpoints have NO rate limiting!\n');
    console.log('Suggestions:');
    console.log('  - Add limitrate middleware before these routes');
    console.log('  - Or add them to your policy configuration');
    console.log('  - Or use skip() to intentionally bypass rate limiting');
    console.log('');

    // List specific high-traffic unprotected endpoints
    const highTraffic = unprotectedEndpoints.filter((e) => e.requestCount >= 50);
    if (highTraffic.length > 0) {
      console.log('🔥 High Priority (high traffic, no protection):');
      for (const endpoint of highTraffic) {
        console.log(`   ${endpoint.method} ${endpoint.path} - ${endpoint.requestCount} requests`);
      }
      console.log('');
    }
  }

  console.log('=' + '='.repeat(80));
  console.log('');

  if (stats.unprotectedEndpoints > 0) {
    console.log('💡 Tip: Add rate limits to unprotected endpoints to prevent abuse');
    console.log('📖 Docs: https://github.com/limitrate/limitrate\n');

    // Exit code 1 if failOnUnprotected flag is set (for CI/CD)
    if (options.failOnUnprotected) {
      console.log('❌ CI/CD Check FAILED: Unprotected endpoints detected\n');
      process.exit(1);
    }
  } else {
    console.log('✅ All discovered endpoints are protected by rate limiting!');
    console.log('📖 Docs: https://github.com/limitrate/limitrate\n');
  }
}

/**
 * Determine severity based on request count
 */
function getSeverity(requestCount: number): string {
  if (requestCount >= 500) return '🔴 CRITICAL';
  if (requestCount >= 100) return '🟠 HIGH';
  if (requestCount >= 50) return '🟡 MEDIUM';
  return '🟢 LOW';
}
