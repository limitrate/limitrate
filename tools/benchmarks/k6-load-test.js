/**
 * k6 Load Test for LimitRate Performance Benchmarking
 *
 * Tests latency under various load conditions:
 * - Ramp up to 100 users (30s)
 * - Sustain 100 users (1m)
 * - Ramp up to 1000 users (30s)
 * - Sustain 1000 users (1m)
 * - Ramp down (30s)
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '30s', target: 100 },   // Ramp up to 100 users
    { duration: '1m', target: 100 },    // Stay at 100 users
    { duration: '30s', target: 1000 },  // Ramp up to 1000 users
    { duration: '1m', target: 1000 },   // Stay at 1000 users
    { duration: '30s', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<50', 'p(99)<100'], // 95% < 50ms, 99% < 100ms
    errors: ['rate<0.01'],                         // Error rate < 1%
  },
};

export default function () {
  const userId = `user_${__VU}_${__ITER}`;

  const res = http.get('http://localhost:3000/test', {
    headers: {
      'x-user-id': userId,
      'x-plan': 'free',
    },
  });

  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    'has rate limit headers': (r) => r.headers['Ratelimit-Limit'] !== undefined,
  }) || errorRate.add(1);

  sleep(0.1);
}
