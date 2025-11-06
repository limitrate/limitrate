/**
 * k6 Throughput Test for LimitRate
 *
 * Measures maximum requests/second under sustained load
 */

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const requests = new Counter('requests');

export const options = {
  duration: '60s',
  vus: 1000,
  thresholds: {
    http_req_duration: ['p(50)<5', 'p(95)<20'], // p50 < 5ms, p95 < 20ms
  },
};

export default function () {
  const userId = `user_${__VU}`;

  const res = http.get('http://localhost:3000/test', {
    headers: {
      'x-user-id': userId,
      'x-plan': 'free',
    },
  });

  requests.add(1);

  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
  });
}
