# LimitRate Project Instructions for Claude

## Project Overview
LimitRate is an open-source rate limiting and cost control library for Express.js APIs, with a focus on AI/LLM cost management.

**Current Status**: v1.3.0 published to npm
**Latest Release**: 2025-11-06

## Development Workflow

### 1. Feature Development Process

When implementing new features, follow this **MANDATORY** workflow:

1. **Plan** - Review PLAN.md for the feature specification
2. **Implement** - Write the feature code in core/express packages
3. **Unit Test** - Add tests to `packages/*/src/__tests__/`
4. **Build** - Run `pnpm build` to compile TypeScript
5. **Integration Test** - Add test to `/Users/apple/limitrate-npm-test-suite/`
6. **Verify from npm** - Test must install from real npm and pass
7. **Document** - Update CHANGELOG and docs
8. **Publish** - Only after ALL tests pass from npm

**❌ NEVER skip the npm test suite verification**
**❌ NEVER proceed to next feature if current tests fail**
**❌ NEVER publish without testing from real npm package**

### 2. Living Test Harness

**Location**: `/Users/apple/limitrate-npm-test-suite/`

This directory is the **single source of truth** for verifying all features work from published npm packages.

**Structure**:
```
limitrate-npm-test-suite/
├── package.json              # Installs @limitrate/express from npm
├── run-all-tests.js          # Master test runner
├── test-comprehensive-v1-2-0.js  # v1.0-v1.2 features
├── test-burst.js             # Burst allowance
├── test-time-windows.js      # Hour/day windows
├── test-with-policy-fixed.js # Route overrides
├── test-b1-shared-store.js   # Shared store pattern
├── test-b2-auto-discovery.js # Endpoint tracking
├── test-b3-dry-run.js        # Dry-run mode
├── test-b4-user-overrides.js # User-specific limits
├── test-b5-client-sdk.js     # Status endpoints
└── README.md                 # Documentation
```

**When adding a new feature**:
1. Implement the feature
2. Add unit tests in `packages/*/src/__tests__/`
3. Build and publish to npm
4. Create `test-[feature-name].js` in npm-test-suite
5. Run `npm test` to verify ALL tests pass
6. Only proceed to next feature if tests pass

### 3. Testing Philosophy

**Three Levels of Testing**:

1. **Unit Tests** (`packages/*/src/__tests__/`)
   - Fast, isolated tests
   - Test internal logic
   - Run with `pnpm test`

2. **Integration Tests** (`limitrate-npm-test-suite/`)
   - Install from **real npm registry**
   - Test as a regular user would
   - Verify published package works
   - Run with `cd limitrate-npm-test-suite && npm test`

3. **Example Apps** (`apps/examples/`)
   - Real-world usage demonstrations
   - Manual verification

**Golden Rule**: Integration tests MUST pass before moving to next feature.

### 4. Version Management

**Release Process**:
```bash
# 1. Ensure all tests pass
cd /Users/apple/limitrate
pnpm test  # Unit tests

# 2. Build packages
pnpm build

# 3. Version bump
pnpm changeset version

# 4. Commit changes
git add .
git commit -m "chore: version packages to vX.X.X"

# 5. Publish to npm
pnpm build  # Fresh build
pnpm changeset publish
git push
git push --tags

# 6. VERIFY from real npm
cd /Users/apple/limitrate-npm-test-suite
npm install @limitrate/express@X.X.X  # Update to new version
npm test  # MUST pass before proceeding
```

### 5. Current Feature Status

**Implemented & Tested (v1.3.0)**:
- ✅ v1.0: Basic rate limiting, cost tracking, Redis/Upstash stores
- ✅ v1.1: Rebranding to LimitRate
- ✅ v1.2: Burst allowance, hour/day windows, route overrides, CLI inspect
- ✅ v1.3 (B1): Shared store instances
- ✅ v1.3 (B2): Endpoint auto-discovery
- ✅ v1.3 (B3): Dry-run mode
- ✅ v1.3 (B4): User overrides
- ✅ v1.3 (B5): Client-side SDK

**All features have integration tests in npm-test-suite** ✅

### 6. Key Files

**Planning**:
- `PLAN.md` - Feature roadmap and specifications
- `IMPLEMENTATION.md` - Implementation details
- `PRD-IMPLEMENTATION-AUDIT.md` - Audit of completed features

**Code**:
- `packages/core/` - Core algorithms and stores
- `packages/express/` - Express middleware
- `packages/cli/` - CLI tools

**Testing**:
- `packages/*/src/__tests__/` - Unit tests (use workspace)
- `/Users/apple/limitrate-npm-test-suite/` - Integration tests (use real npm)

**Documentation**:
- `docs/` - Feature documentation
- `packages/*/README.md` - Package-specific docs
- `CHANGELOG.md` - Version history

### 7. npm Package Details

**Published Packages**:
- `@limitrate/core` - Core functionality
- `@limitrate/express` - Express middleware
- `@limitrate/cli` - CLI tools

**Current Version**: v1.3.0
**Registry**: https://www.npmjs.com/package/@limitrate/express

### 8. Important Conventions

**Coding Standards**:
- TypeScript for all packages
- ESM and CJS dual exports
- Comprehensive JSDoc comments
- Error handling with descriptive messages

**Git Workflow**:
- Commit after each feature is complete and tested
- Descriptive commit messages
- Tag releases: `@limitrate/express@X.X.X`

**Breaking Changes**:
- We are in v1.x, so breaking changes require major version bump
- Document breaking changes in CHANGELOG

### 9. Common Tasks

**Add a new feature**:
```bash
# 1. Implement in packages/
# 2. Add unit tests
pnpm test

# 3. Build
pnpm build

# 4. Create changeset
pnpm changeset

# 5. Version & publish
pnpm changeset version
pnpm build
pnpm changeset publish

# 6. Add integration test
cd /Users/apple/limitrate-npm-test-suite
# Create test-new-feature.js
npm test  # Verify it works
```

**Fix a bug**:
```bash
# 1. Write failing test first
# 2. Fix the bug
# 3. Verify test passes
# 4. Follow publish workflow above
```

**Update documentation**:
```bash
# Update relevant files:
# - README.md (user-facing)
# - PLAN.md (feature planning)
# - docs/*.md (detailed guides)
# - CHANGELOG.md (version history)
```

### 10. Troubleshooting

**Tests failing locally**:
- Run `pnpm build` first
- Check you're using the right Node version (>= 18)
- Clear node_modules and reinstall

**npm test suite failing**:
- Ensure package is published to npm first
- Check npm registry has latest version
- Wait a few minutes for npm to propagate
- Clear npm cache: `npm cache clean --force`

**Can't publish**:
- Check you're logged in: `npm whoami`
- Verify 2FA if enabled
- Ensure version is incremented

### 11. Emergency Procedures

**If published broken version**:
```bash
# Option 1: Deprecate
npm deprecate @limitrate/express@X.X.X "Broken version, use X.X.X+1"

# Option 2: Unpublish (only within 72 hours)
npm unpublish @limitrate/express@X.X.X

# Then publish fixed version
pnpm changeset version  # Bump version
pnpm build
pnpm changeset publish
```

## Summary

The most important rule: **Every feature MUST have a passing integration test in limitrate-npm-test-suite before moving to the next feature.**

This ensures:
- Published packages actually work
- No regressions
- Real-world usage is tested
- Users get reliable software

When in doubt, test from npm. Always test from npm.
