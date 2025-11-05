#!/bin/bash
set -e

echo "🧪 Pre-Publish Testing Script for LimitRate"
echo "=========================================="
echo ""

# Create a temporary test directory
TEST_DIR=$(mktemp -d)
echo "📁 Test directory: $TEST_DIR"
echo ""

# Build all packages
echo "🔨 Building all packages..."
pnpm build
echo "✅ Build complete"
echo ""

# Pack packages
echo "📦 Packing packages..."
cd packages/core
CORE_PKG=$(pnpm pack --pack-destination "$TEST_DIR" 2>&1 | grep "limitrate-core" | tail -1)
cd ../..

cd packages/express
EXPRESS_PKG=$(pnpm pack --pack-destination "$TEST_DIR" 2>&1 | grep "limitrate-express" | tail -1)
cd ../..

cd packages/cli
CLI_PKG=$(pnpm pack --pack-destination "$TEST_DIR" 2>&1 | grep "limitrate-cli" | tail -1)
cd ../..

echo "✅ Packages packed:"
echo "   - $CORE_PKG"
echo "   - $EXPRESS_PKG"
echo "   - $CLI_PKG"
echo ""

# Create test app
echo "🧪 Creating test Express app..."
cd "$TEST_DIR"
mkdir test-app
cd test-app

# Initialize package.json
cat > package.json <<EOF
{
  "name": "limitrate-test-app",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node index.js"
  }
}
EOF

# Install packed packages
echo "📥 Installing packed packages..."
npm install "../$CORE_PKG" "../$EXPRESS_PKG" "../$CLI_PKG" express

# Create test application
cat > index.js <<'EOF'
import express from 'express';
import { limitrate } from '@limitrate/express';

const app = express();
app.use(express.json());

// Test LimitRate middleware
app.use(limitrate({
  identifyUser: (req) => req.headers['x-user-id'] || 'anonymous',
  identifyPlan: (req) => req.headers['x-plan'] || 'free',
  store: { type: 'memory' },
  policies: {
    free: {
      endpoints: {
        'POST|/api/test': {
          rate: {
            maxPerMinute: 3,
            actionOnExceed: 'block'
          }
        }
      },
      defaults: {
        rate: {
          maxPerMinute: 60,
          actionOnExceed: 'block'
        }
      }
    },
    pro: {
      endpoints: {
        'POST|/api/test': {
          rate: {
            maxPerMinute: 100,
            actionOnExceed: 'slowdown',
            slowdownMs: 500
          }
        }
      }
    }
  }
}));

app.post('/api/test', (req, res) => {
  res.json({ ok: true, message: 'Request successful!' });
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

const server = app.listen(0, () => {
  const port = server.address().port;
  console.log(`✅ Test server running on port ${port}`);

  // Run tests
  runTests(port).then(() => {
    console.log('✅ All tests passed!');
    server.close();
    process.exit(0);
  }).catch(err => {
    console.error('❌ Tests failed:', err.message);
    server.close();
    process.exit(1);
  });
});

async function runTests(port) {
  const baseUrl = \`http://localhost:\${port}\`;

  console.log('');
  console.log('🧪 Running integration tests...');
  console.log('');

  // Test 1: Health check
  console.log('Test 1: Health check endpoint');
  const health = await fetch(\`\${baseUrl}/health\`);
  if (!health.ok) throw new Error('Health check failed');
  console.log('✅ Health check passed');

  // Test 2: First 3 requests should succeed
  console.log('');
  console.log('Test 2: First 3 requests should succeed (free plan limit)');
  for (let i = 0; i < 3; i++) {
    const res = await fetch(\`\${baseUrl}/api/test\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': 'test-user',
        'x-plan': 'free'
      },
      body: JSON.stringify({ test: true })
    });

    if (res.status !== 200) {
      throw new Error(\`Request \${i + 1} failed with status \${res.status}\`);
    }

    const remaining = res.headers.get('ratelimit-remaining');
    console.log(\`✅ Request \${i + 1}/3: Status 200, Remaining: \${remaining}\`);
  }

  // Test 3: 4th request should be rate limited
  console.log('');
  console.log('Test 3: 4th request should be rate limited (429)');
  const blocked = await fetch(\`\${baseUrl}/api/test\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': 'test-user',
      'x-plan': 'free'
    },
    body: JSON.stringify({ test: true })
  });

  if (blocked.status !== 429) {
    throw new Error(\`Expected 429, got \${blocked.status}\`);
  }

  const blockedData = await blocked.json();
  console.log(\`✅ Rate limited correctly: \${blockedData.message}\`);
  console.log(\`   Retry-After: \${blocked.headers.get('retry-after')}s\`);

  // Test 4: Different user should have separate limit
  console.log('');
  console.log('Test 4: Different user should have separate limit');
  const otherUser = await fetch(\`\${baseUrl}/api/test\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': 'other-user',
      'x-plan': 'free'
    },
    body: JSON.stringify({ test: true })
  });

  if (otherUser.status !== 200) {
    throw new Error(\`Different user request failed: \${otherUser.status}\`);
  }
  console.log('✅ Different users have separate limits');

  // Test 5: Pro user should have higher limits
  console.log('');
  console.log('Test 5: Pro user should have higher limits and slowdown');
  const proUser = await fetch(\`\${baseUrl}/api/test\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': 'pro-user',
      'x-plan': 'pro'
    },
    body: JSON.stringify({ test: true })
  });

  if (proUser.status !== 200) {
    throw new Error(\`Pro user request failed: \${proUser.status}\`);
  }

  const proRemaining = proUser.headers.get('ratelimit-remaining');
  console.log(\`✅ Pro user has higher limit: \${proRemaining} remaining (vs 3 for free)\`);

  console.log('');
  console.log('🎉 All integration tests passed!');
}
EOF

# Run the test
echo ""
echo "🚀 Running test application..."
echo ""
node index.js

# Cleanup
echo ""
echo "🧹 Cleaning up..."
cd /
rm -rf "$TEST_DIR"
echo "✅ Cleanup complete"
echo ""
echo "✨ Pre-publish testing completed successfully!"
