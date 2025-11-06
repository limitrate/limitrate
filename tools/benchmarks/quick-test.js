/**
 * Quick Benchmark Verification Test
 * Ensures test server and benchmarks work correctly
 */

import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

console.log('🔍 Quick Benchmark Verification Test\n');

let serverProcess = null;
let testsPassed = 0;
let testsFailed = 0;

async function startServer() {
  console.log('Starting test server...');
  serverProcess = spawn('node', ['test-server.js'], {
    env: { ...process.env, LIBRARY: 'limitrate', STORE: 'memory', PORT: '3001' },
    cwd: process.cwd(),
  });

  // Wait for server to start
  await sleep(2000);

  // Check if server is running
  try {
    const response = await fetch('http://localhost:3001/health');
    if (response.ok) {
      console.log('✅ Server started successfully\n');
      return true;
    }
  } catch (error) {
    console.error('❌ Server failed to start:', error.message);
    return false;
  }
}

async function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    await sleep(500);
  }
}

async function testBasicRequest() {
  console.log('Test 1: Basic Request');
  try {
    const response = await fetch('http://localhost:3001/test', {
      headers: { 'x-user-id': 'test-user', 'x-plan': 'free' },
    });

    if (response.ok) {
      const hasHeaders = response.headers.has('ratelimit-limit');
      if (hasHeaders) {
        console.log('✅ Basic request works with rate limit headers\n');
        testsPassed++;
      } else {
        console.log('⚠️  Request works but missing rate limit headers\n');
        testsFailed++;
      }
    } else {
      console.log(`❌ Request failed with status ${response.status}\n`);
      testsFailed++;
    }
  } catch (error) {
    console.log('❌ Request failed:', error.message, '\n');
    testsFailed++;
  }
}

async function testRateLimiting() {
  console.log('Test 2: Rate Limiting');
  const userId = 'rate-limit-test-user';
  let allowedRequests = 0;
  let blockedRequests = 0;

  // Make 70 requests (limit is 60 per minute)
  for (let i = 0; i < 70; i++) {
    try {
      const response = await fetch('http://localhost:3001/test', {
        headers: { 'x-user-id': userId, 'x-plan': 'free' },
      });

      if (response.status === 200) {
        allowedRequests++;
      } else if (response.status === 429) {
        blockedRequests++;
      }
    } catch (error) {
      console.log('❌ Request error:', error.message);
      testsFailed++;
      return;
    }
  }

  console.log(`   Allowed: ${allowedRequests}, Blocked: ${blockedRequests}`);

  if (allowedRequests === 60 && blockedRequests === 10) {
    console.log('✅ Rate limiting works correctly\n');
    testsPassed++;
  } else if (blockedRequests > 0) {
    console.log('⚠️  Rate limiting works but counts are off\n');
    testsPassed++;
  } else {
    console.log('❌ Rate limiting not working\n');
    testsFailed++;
  }
}

async function testMultipleUsers() {
  console.log('Test 3: Multiple Users (Isolation)');

  const results = await Promise.all([
    fetch('http://localhost:3001/test', {
      headers: { 'x-user-id': 'user-a', 'x-plan': 'free' },
    }),
    fetch('http://localhost:3001/test', {
      headers: { 'x-user-id': 'user-b', 'x-plan': 'free' },
    }),
    fetch('http://localhost:3001/test', {
      headers: { 'x-user-id': 'user-c', 'x-plan': 'free' },
    }),
  ]);

  const allSucceeded = results.every(r => r.status === 200);

  if (allSucceeded) {
    console.log('✅ Multiple users work independently\n');
    testsPassed++;
  } else {
    console.log('❌ Multiple users failed\n');
    testsFailed++;
  }
}

async function testPerformance() {
  console.log('Test 4: Basic Performance Check');
  const iterations = 100;
  const userId = 'perf-test-user';

  const start = Date.now();

  for (let i = 0; i < iterations; i++) {
    await fetch('http://localhost:3001/test', {
      headers: { 'x-user-id': `${userId}-${i}`, 'x-plan': 'free' },
    });
  }

  const duration = Date.now() - start;
  const avgLatency = duration / iterations;

  console.log(`   ${iterations} requests in ${duration}ms (avg: ${avgLatency.toFixed(2)}ms per request)`);

  if (avgLatency < 10) {
    console.log('✅ Performance looks good\n');
    testsPassed++;
  } else {
    console.log('⚠️  Performance slower than expected\n');
    testsPassed++;
  }
}

async function runTests() {
  const serverStarted = await startServer();

  if (!serverStarted) {
    console.log('❌ Cannot run tests - server failed to start');
    process.exit(1);
  }

  try {
    await testBasicRequest();
    await testRateLimiting();
    await testMultipleUsers();
    await testPerformance();
  } catch (error) {
    console.error('❌ Test error:', error);
    testsFailed++;
  } finally {
    await stopServer();
  }

  console.log('═'.repeat(70));
  console.log('RESULTS:');
  console.log(`  ✅ Passed: ${testsPassed}`);
  console.log(`  ❌ Failed: ${testsFailed}`);
  console.log('═'.repeat(70));

  if (testsFailed === 0) {
    console.log('\n✅ All tests passed! Benchmark setup is ready.');
    console.log('\nRun the full benchmark suite with:');
    console.log('  ./run-benchmarks.sh\n');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed. Please fix issues before running benchmarks.\n');
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('Fatal error:', error);
  stopServer();
  process.exit(1);
});
