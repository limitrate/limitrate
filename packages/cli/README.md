# @limitrate/cli

CLI dashboard and event storage for LimitRate.

## Installation

The CLI is automatically available when you install any LimitRate package:

```bash
npx limitrate inspect
```

Or install globally:

```bash
pnpm add -g @limitrate/cli
# or
npm install -g @limitrate/cli
```

## Commands

### `npx limitrate inspect`

Launch the interactive dashboard to view real-time statistics:

```bash
npx limitrate inspect
```

**Displays**:
- Total API cost spent (last 48 hours)
- Request count per endpoint
- Top spenders by user
- Cost-exceeded events
- Rate-exceeded events
- Recent blocked requests

**Navigation**:
- `↑/↓` — Scroll through list
- `Tab` — Switch between tabs
- `q` — Quit

### `npx limitrate clear`

Clear all stored events:

```bash
npx limitrate clear
```

This removes the SQLite database at `.limitrate/events.db`.

## Event Storage

### Automatic Storage

When you use `@limitrate/express` with the `onEvent` handler, events are automatically saved to SQLite:

```typescript
import { saveEvent } from '@limitrate/cli';

app.use(limitrate({
  // ... config
  onEvent: (event) => {
    saveEvent(event);  // Store for CLI dashboard

    // Your custom logic
    if (event.type === 'cost_exceeded') {
      console.log('Cost cap exceeded!', event);
    }
  }
}));
```

### Manual Storage

You can also manually save events:

```typescript
import { saveEvent } from '@limitrate/cli';

saveEvent({
  timestamp: Date.now(),
  type: 'rate_exceeded',
  user: 'user-123',
  plan: 'free',
  endpoint: 'POST|/api/ask',
  ip: '1.2.3.4',
  value: 11,
  threshold: 10,
  window: '1m'
});
```

### Storage Location

Events are stored in SQLite at:

```
.limitrate/events.db
```

**Retention**: Events older than 48 hours are automatically pruned.

## Event Types

### `allowed`

Request passed all rate limits and cost caps:

```typescript
{
  timestamp: 1638360000000,
  type: 'allowed',
  user: 'user-123',
  plan: 'free',
  endpoint: 'POST|/api/ask',
  ip: '1.2.3.4'
}
```

### `rate_exceeded`

User hit rate limit:

```typescript
{
  timestamp: 1638360000000,
  type: 'rate_exceeded',
  user: 'user-123',
  plan: 'free',
  endpoint: 'POST|/api/ask',
  ip: '1.2.3.4',
  value: 11,        // Current request count
  threshold: 10,    // Limit
  window: '1m'      // Time window
}
```

### `cost_exceeded`

User hit cost cap:

```typescript
{
  timestamp: 1638360000000,
  type: 'cost_exceeded',
  user: 'user-123',
  plan: 'free',
  endpoint: 'POST|/api/ask',
  ip: '1.2.3.4',
  value: 0.11,      // Current cost ($)
  threshold: 0.10,  // Cap ($)
  window: '1h',     // Time window
  estimatedCost: 0.003  // Cost of this request
}
```

### `ip_blocked`

IP on blocklist:

```typescript
{
  timestamp: 1638360000000,
  type: 'ip_blocked',
  user: 'anonymous',
  plan: 'free',
  endpoint: 'POST|/api/ask',
  ip: '1.2.3.4'
}
```

## Programmatic API

### `saveEvent(event: LimitRateEvent): void`

Save an event to SQLite:

```typescript
import { saveEvent } from '@limitrate/cli';

saveEvent({
  timestamp: Date.now(),
  type: 'rate_exceeded',
  user: 'user-123',
  plan: 'free',
  endpoint: 'POST|/api/ask',
  ip: '1.2.3.4',
  value: 11,
  threshold: 10,
  window: '1m'
});
```

### `getEvents(filter?: EventFilter): LimitRateEvent[]`

Query stored events:

```typescript
import { getEvents } from '@limitrate/cli';

// Get all events from last 24 hours
const events = getEvents({
  since: Date.now() - 24 * 60 * 60 * 1000
});

// Get cost-exceeded events for a specific user
const costEvents = getEvents({
  type: 'cost_exceeded',
  user: 'user-123'
});

// Get events for a specific endpoint
const endpointEvents = getEvents({
  endpoint: 'POST|/api/ask'
});
```

### `clearEvents(): void`

Clear all events:

```typescript
import { clearEvents } from '@limitrate/cli';

clearEvents();
```

### `getStats(): DashboardStats`

Get aggregated statistics:

```typescript
import { getStats } from '@limitrate/cli';

const stats = getStats();

console.log(stats);
// {
//   totalCost: 12.45,
//   totalRequests: 1234,
//   endpointCounts: {
//     'POST|/api/ask': 567,
//     'GET|/api/data': 667
//   },
//   topSpenders: [
//     { user: 'user-123', cost: 5.67, requests: 345 },
//     { user: 'user-456', cost: 3.21, requests: 234 }
//   ],
//   recentBlocked: [
//     { timestamp: 1638360000000, user: 'user-789', reason: 'rate_exceeded' }
//   ]
// }
```

## Example Integration

```typescript
import express from 'express';
import { limitrate } from '@limitrate/express';
import { saveEvent, getStats } from '@limitrate/cli';

const app = express();

app.use(limitrate({
  identifyUser: (req) => req.user?.id || req.ip,
  identifyPlan: (req) => req.user?.plan || 'free',
  store: { type: 'redis', url: process.env.REDIS_URL },

  policies: {
    free: {
      endpoints: {
        'POST|/api/ask': {
          rate: { maxPerMinute: 10, actionOnExceed: 'block' },
          cost: {
            estimateCost: (ctx) => 0.003,
            hourlyCap: 0.10,
            actionOnExceed: 'block'
          }
        }
      }
    }
  },

  onEvent: (event) => {
    // Save to SQLite for CLI dashboard
    saveEvent(event);

    // Send alerts
    if (event.type === 'cost_exceeded') {
      console.log(`🚨 User ${event.user} exceeded cost cap`);
    }
  }
}));

// Admin endpoint to get stats
app.get('/admin/stats', (req, res) => {
  const stats = getStats();
  res.json(stats);
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
  console.log('View dashboard: npx limitrate inspect');
});
```

## Development

### Database Schema

The SQLite database has a single `events` table:

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL,
  user TEXT NOT NULL,
  plan TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  ip TEXT,
  value REAL,
  threshold REAL,
  window TEXT,
  estimated_cost REAL
);

CREATE INDEX idx_timestamp ON events(timestamp);
CREATE INDEX idx_type ON events(type);
CREATE INDEX idx_user ON events(user);
CREATE INDEX idx_endpoint ON events(endpoint);
```

### Auto-Pruning

Events older than 48 hours are automatically deleted on every write to keep the database small.

## License

Apache-2.0
