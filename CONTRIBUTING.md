# Contributing to LimitRate

Thank you for your interest in contributing to LimitRate! This document provides guidelines for contributing to the project.

## Code of Conduct

Be respectful, constructive, and professional in all interactions.

## Getting Started

### Prerequisites

- Node.js 18+ and pnpm
- Git
- TypeScript knowledge
- (Optional) Redis for testing

### Setup

```bash
# Clone the repository
git clone https://github.com/limitrate/limitrate.git
cd fairgate

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

## Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

### 2. Make Changes

- Write code following the existing style
- Add tests for new features
- Update documentation as needed
- Keep commits focused and atomic

### 3. Test Your Changes

```bash
# Run all tests
pnpm test

# Run tests for specific package
pnpm --filter @limitrate/core test

# Type check
pnpm typecheck

# Lint
pnpm lint
```

### 4. Submit a Pull Request

- Push your branch to GitHub
- Create a pull request with a clear description
- Link any related issues
- Wait for review

## Project Structure

```
fairgate/
├── packages/
│   ├── core/          # Core policy engine and stores
│   ├── express/       # Express middleware
│   └── cli/           # CLI dashboard
├── apps/
│   └── examples/      # Example applications
│       ├── express-basic/
│       └── express-ai/
├── docs/              # Documentation
└── .github/           # GitHub workflows
```

## Package Development

### @limitrate/core

Core algorithms and storage adapters.

**Key files**:
- `src/engine.ts` — Policy evaluation engine
- `src/stores/` — Storage implementations
- `src/types.ts` — TypeScript definitions

**Testing**:
```bash
cd packages/core
pnpm test
```

### @limitrate/express

Express middleware adapter.

**Key files**:
- `src/index.ts` — Main middleware
- `src/types.ts` — Express-specific types

**Testing**:
```bash
cd packages/express
pnpm test
```

### @limitrate/cli

CLI dashboard and event storage.

**Key files**:
- `src/index.ts` — CLI entry point
- `src/storage.ts` — SQLite event storage
- `src/dashboard.ts` — Dashboard UI

**Testing**:
```bash
cd packages/cli
pnpm test
```

## Coding Standards

### TypeScript

- Use strict mode
- Prefer interfaces over types
- Export types for public APIs
- Use descriptive variable names

### Code Style

```typescript
// Good
async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateCheckResult> {
  // Implementation
}

// Bad
async function check(k: string, l: number, w: number): Promise<any> {
  // Implementation
}
```

### Error Handling

```typescript
// Good
try {
  await store.checkRate(key, limit, windowSeconds);
} catch (error) {
  if (error instanceof RedisConnectionError) {
    // Handle specific error
  }
  throw new LimitRateError('Rate check failed', { cause: error });
}

// Bad
try {
  await store.checkRate(key, limit, windowSeconds);
} catch (e) {
  console.log(e);
}
```

### Testing

- Write unit tests for all new features
- Use descriptive test names
- Test edge cases
- Aim for >80% coverage

```typescript
describe('PolicyEngine', () => {
  it('should block requests when rate limit is exceeded', async () => {
    const store = new MemoryStore();
    const engine = new PolicyEngine(store, policies);

    // Send 10 requests (limit)
    for (let i = 0; i < 10; i++) {
      const result = await engine.check({ user: 'test', plan: 'free', endpoint: 'POST|/api' });
      expect(result.allowed).toBe(true);
    }

    // 11th request should be blocked
    const result = await engine.check({ user: 'test', plan: 'free', endpoint: 'POST|/api' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('rate_limited');
  });
});
```

## Documentation

### Code Comments

```typescript
/**
 * Checks if a request should be allowed based on rate limits and cost caps
 * @param context - Request context (user, plan, endpoint, etc.)
 * @returns Check result with allowed status and details
 */
async check(context: CheckContext): Promise<CheckResult> {
  // Implementation
}
```

### README Updates

- Update package READMEs when adding features
- Include code examples
- Document breaking changes
- Keep API reference up to date

## Commit Messages

Use conventional commit format:

```
feat: add GCRA algorithm for smoother rate limiting
fix: prevent race condition in Redis store
docs: update API reference for cost tracking
test: add integration tests for Express middleware
chore: bump dependencies
```

**Types**:
- `feat` — New feature
- `fix` — Bug fix
- `docs` — Documentation only
- `test` — Tests only
- `refactor` — Code refactoring
- `perf` — Performance improvement
- `chore` — Maintenance tasks

## Pull Request Process

1. **Title**: Use conventional commit format
2. **Description**: Explain what and why
3. **Tests**: Include test results
4. **Documentation**: Update docs if needed
5. **Breaking Changes**: Clearly mark them

Example PR description:

```markdown
## Summary
Adds GCRA algorithm as an alternative to token bucket for smoother rate limiting.

## Changes
- Implement GCRA in `packages/core/src/algorithms/gcra.ts`
- Add `algorithm` option to `RateRule` type
- Update MemoryStore, RedisStore, UpstashStore to support GCRA
- Add tests for GCRA algorithm

## Breaking Changes
None

## Testing
- Unit tests pass: ✅
- Integration tests pass: ✅
- Manual testing with express-basic example: ✅

## Related Issues
Closes #42
```

## Release Process

Releases are handled by maintainers:

1. Version bump with `pnpm changeset`
2. Update CHANGELOG.md
3. Create GitHub release
4. Publish to npm

## Questions?

- Open a GitHub Discussion
- Join Discord: [link]
- Email: hello@limitrate.dev

---

**Thank you for contributing to LimitRate!** 🎉
