/**
 * Inspect command - show LimitRate dashboard
 */

import Table from 'cli-table3';
import { getStorage } from '../storage';

export function inspect(): void {
  const storage = getStorage();

  console.log('\n📊 LimitRate Dashboard (last 48 hours)\n');
  console.log('=' + '='.repeat(60));
  console.log('');

  // Event count
  const eventCount = storage.getEventCount();
  console.log(`Total events tracked: ${eventCount.toLocaleString()}\n`);

  // Endpoint stats table
  const endpointStats = storage.getEndpointStats();

  if (endpointStats.length > 0) {
    const endpointTable = new Table({
      head: ['Endpoint', 'Total Hits', 'Blocked', 'Slowdowns'],
      colWidths: [35, 15, 12, 12],
    });

    for (const stat of endpointStats) {
      endpointTable.push([
        stat.endpoint,
        stat.totalHits.toLocaleString(),
        stat.blocked.toLocaleString(),
        stat.slowdowns.toLocaleString(),
      ]);
    }

    console.log('📈 Endpoint Statistics:\n');
    console.log(endpointTable.toString());
    console.log('');
  } else {
    console.log('📈 No endpoint data yet. Start making requests!\n');
  }

  // Top offenders table
  const topOffenders = storage.getTopOffenders(10);

  if (topOffenders.length > 0) {
    const offenderTable = new Table({
      head: ['User', 'Plan', 'Blocks (last hour)'],
      colWidths: [30, 12, 20],
    });

    for (const offender of topOffenders) {
      offenderTable.push([
        offender.user.length > 28 ? offender.user.substring(0, 25) + '...' : offender.user,
        offender.plan,
        offender.blocks.toLocaleString(),
      ]);
    }

    console.log('🚨 Top Offenders (last hour):\n');
    console.log(offenderTable.toString());
    console.log('');
  }

  // Recent events
  const recentEvents = storage.getRecentEvents(10);

  if (recentEvents.length > 0) {
    console.log('📋 Recent Events:\n');

    for (const event of recentEvents) {
      const timestamp = new Date(event.timestamp).toLocaleTimeString();
      const emoji = getEventEmoji(event.type);
      const userDisplay = event.user.length > 20 ? event.user.substring(0, 17) + '...' : event.user;

      console.log(`  ${emoji} [${timestamp}] ${userDisplay} (${event.plan}) ${event.type} on ${event.endpoint}`);
    }

    console.log('');
  }

  console.log('=' + '='.repeat(60));
  console.log('');
  console.log('💡 Tip: Run this command again to see updated stats');
  console.log('📖 Docs: https://github.com/limitrate/limitrate\n');

  storage.close();
}

function getEventEmoji(type: string): string {
  switch (type) {
    case 'rate_exceeded':
    case 'cost_exceeded':
    case 'blocked':
      return '🚫';
    case 'slowdown_applied':
      return '🐌';
    case 'allowed':
      return '✅';
    default:
      return '📌';
  }
}
