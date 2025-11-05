# Pre-Publish Checklist for LimitRate v1.0

## ✅ Automated Checks (Run These Commands)

### 1. Clean Build
```bash
pnpm clean && pnpm install && pnpm build
```
**Expected**: All packages build without errors

### 2. Run Tests
```bash
pnpm test
```
**Expected**:
- Core: 20 tests pass (1 skipped - known slowdown bug)
- Express: 12 tests pass (1 skipped - known IPv6 issue)
- CLI: Skipped (no tests yet)

### 3. TypeScript Check
```bash
pnpm typecheck
```
**Expected**: No TypeScript errors

### 4. Check Package Contents
```bash
# Core package
cd packages/core && pnpm pack --dry-run
# Express package
cd ../express && pnpm pack --dry-run
# CLI package
cd ../cli && pnpm pack --dry-run
cd ../..
```
**Expected**: All dist files included, no extra files

## ✅ Manual Checks

### 5. Verify Package.json Files

#### Core (`packages/core/package.json`)
- [x] name: `@limitrate/core`
- [x] version: `0.1.0`
- [x] main/module/types exports correct
- [x] dependencies correct (ioredis, @upstash/redis)
- [x] license: Apache-2.0
- [x] repository URL correct

#### Express (`packages/express/package.json`)
- [x] name: `@limitrate/express`
- [x] version: `0.1.0`
- [x] depends on `@limitrate/core`
- [x] peerDependencies: express
- [x] license: Apache-2.0

#### CLI (`packages/cli/package.json`)
- [x] name: `@limitrate/cli`
- [x] version: `0.1.0`
- [x] bin points to correct file
- [x] depends on `@limitrate/core`
- [x] license: Apache-2.0

### 6. Test Examples Locally

```bash
# Test express-basic example
cd apps/examples/express-basic
pnpm install
pnpm dev &
sleep 3

# Make test requests
curl http://localhost:3000/health
# Should return 200

# Test rate limiting (make 11 requests, last one should 429)
for i in {1..11}; do
  curl -X POST http://localhost:3000/api/ask \\
    -H "Content-Type: application/json" \\
    -H "x-user-id: test" \\
    -H "x-plan: free" \\
    -d '{"question":"test"}'
  echo ""
done

# Kill server
pkill -f "node.*express-basic"
cd ../../..
```

**Expected**: First 10 succeed, 11th returns 429

### 7. Test CLI Command

```bash
cd apps/examples/express-basic
pnpm dev &
sleep 3

# Make some requests to generate events
curl -X POST http://localhost:3000/api/ask \\
  -H "Content-Type: application/json" \\
  -H "x-user-id: test" \\
  -H "x-plan: free" \\
  -d '{"question":"test"}'

# Check CLI dashboard
npx limitrate inspect

pkill -f "node.*express-basic"
cd ../../..
```

**Expected**: CLI shows events table

### 8. Documentation Review

- [x] README.md is comprehensive
- [x] All examples have READMEs
- [x] TROUBLESHOOTING.md exists
- [x] CONTRIBUTING.md exists (if not, should create)
- [x] LICENSE file exists
- [x] SECURITY.md exists (if not, should create)

### 9. Package Metadata

Check these are correct in all `package.json`:
- [x] keywords (rate-limiting, api, middleware, etc.)
- [x] author
- [x] repository URL
- [x] bugs URL
- [x] homepage URL

### 10. Security Checks

```bash
# Check for known vulnerabilities
pnpm audit

# Check for outdated dependencies
pnpm outdated
```

**Expected**: No high/critical vulnerabilities

## ✅ Pre-Publish Test (Dry Run)

### 11. Test Package Installation

```bash
# Create temp directory
mkdir -p /tmp/limitrate-test
cd /tmp/limitrate-test

# Initialize test project
npm init -y
npm install express

# Install from local tarballs
npm install /Users/apple/limitrate/packages/core/limitrate-core-0.1.0.tgz
npm install /Users/apple/limitrate/packages/express/limitrate-express-0.1.0.tgz
npm install /Users/apple/limitrate/packages/cli/limitrate-cli-0.1.0.tgz

# Create test file
cat > test.js << 'EOF'
const express = require('express');
const { limitrate } = require('@limitrate/express');

const app = express();
app.use(limitrate({
  identifyUser: () => 'test',
  identifyPlan: () => 'free',
  store: { type: 'memory' },
  policies: {
    free: {
      defaults: {
        rate: { maxPerMinute: 60, actionOnExceed: 'block' }
      }
    }
  }
}));

app.get('/test', (req, res) => res.json({ ok: true }));
app.listen(3000, () => console.log('Test server running'));
EOF

# Run test
node test.js &
sleep 2
curl http://localhost:3000/test
pkill -f "node test.js"

# Cleanup
cd ~
rm -rf /tmp/limitrate-test
```

**Expected**: Server starts, request succeeds

## ✅ Final Checks Before Publishing

### 12. Git Status
```bash
git status
```
**Expected**: All changes committed (or changesets ready)

### 13. Check npm Registry
```bash
npm view @limitrate/core 2>/dev/null || echo "Package not yet published - OK"
npm view @limitrate/express 2>/dev/null || echo "Package not yet published - OK"
npm view @limitrate/cli 2>/dev/null || echo "Package not yet published - OK"
```
**Expected**: Packages don't exist yet (first publish)

### 14. Verify npm Credentials
```bash
npm whoami
```
**Expected**: Shows your npm username

### 15. Check npm Org/Scope Access
Make sure you have publish rights to `@limitrate` scope on npm.

---

## 🚀 If All Checks Pass

You're ready to create a changeset and publish!

### Option A: Create Changeset (Recommended)
```bash
pnpm changeset
# Select: @limitrate/core, @limitrate/express, @limitrate/cli
# Version: major (0.1.0 → 1.0.0)
# Summary: "Initial v1.0 release with rate limiting and AI cost tracking"

git add .
git commit -m "chore: add changeset for v1.0"
git push

# GitHub Actions will create a "Version Packages" PR
# Review and merge that PR to publish
```

### Option B: Manual Publish (Not Recommended)
```bash
# Version packages
pnpm changeset version

# Build
pnpm build

# Publish
pnpm release
```

---

## 🎯 Post-Publish Verification

After publishing, verify:

1. Packages appear on npmjs.com:
   - https://www.npmjs.com/package/@limitrate/core
   - https://www.npmjs.com/package/@limitrate/express
   - https://www.npmjs.com/package/@limitrate/cli

2. Test installation from npm:
```bash
mkdir -p /tmp/limitrate-npm-test
cd /tmp/limitrate-npm-test
npm init -y
npm install @limitrate/express
node -e "console.log(require('@limitrate/express'))"
cd ~ && rm -rf /tmp/limitrate-npm-test
```

3. Check package READMEs render correctly on npm

4. Verify badges in README work

5. Create GitHub release with changelog

---

## ❌ If Something Goes Wrong

### Unpublish (within 72 hours only)
```bash
npm unpublish @limitrate/core@1.0.0
npm unpublish @limitrate/express@1.0.0
npm unpublish @limitrate/cli@1.0.0
```

**Note**: npm has strict unpublish policies. It's better to publish a patch version with fixes.

### Publish Patch Fix
```bash
# Fix the issue
# Then:
pnpm changeset
# Select packages, choose "patch", describe fix
pnpm changeset version
pnpm build
pnpm release
```
