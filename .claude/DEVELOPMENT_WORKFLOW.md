# LimitRate Development Workflow

**IMPORTANT: Follow this workflow for every feature implementation**

## Step-by-Step Process

### 1. Update Progress Files FIRST ⚠️
Before writing any code:
- [ ] Update `PLAN.md` - Mark feature as "IN PROGRESS"
- [ ] Update `IMPLEMENTATION.md` - Add to current phase tracking
- [ ] Use TodoWrite tool to track sub-tasks

### 2. Implement Feature
- [ ] Write the code in packages/
- [ ] Run `pnpm build` - verify it compiles
- [ ] Run `pnpm test` - ensure existing tests pass
- [ ] Add any new unit tests if needed

### 3. Test in Integration App (`/Users/apple/limitratetestfolder`)
- [ ] Add new feature to the test app
- [ ] Test that it works correctly
- [ ] Test edge cases and error scenarios
- [ ] **The test app ACCUMULATES features** - don't remove old tests!
- [ ] Document the test in the test app's README or comments

### 4. Verify Nothing Broke
- [ ] Re-run ALL tests in the test app
- [ ] Ensure all previous features still work
- [ ] Check for regressions

### 5. Update Progress Files AGAIN
- [ ] Mark feature as COMPLETE in `IMPLEMENTATION.md`
- [ ] Update overall progress percentage
- [ ] Mark TodoWrite item as completed

### 6. Only Then Move to Next Feature
- Do NOT start next feature until current one is fully tested

---

## Why This Matters

### The Test Folder is Special
`/Users/apple/limitratetestfolder` is a **cumulative integration test suite**:
- Each feature adds new test scenarios
- Old tests remain (builds up over time)
- Can always re-run everything to catch regressions
- Real-world usage patterns, not just unit tests

### Benefits
✅ Catch breaking changes immediately
✅ Ensure features work together
✅ Real integration testing, not just mocks
✅ Confidence before release

---

## Example Workflow

### Feature: B1 - Shared Store Instances

1. ✅ **Update Progress**
   - Updated IMPLEMENTATION.md: B1 in progress
   - Created TodoWrite tasks

2. ✅ **Implement**
   - Created factory functions in `packages/core/src/stores/index.ts`
   - Modified middleware in `packages/express/src/middleware.ts`
   - Built successfully, tests pass

3. ✅ **Test Integration**
   - Created example in `apps/examples/express-shared-store/`
   - Tested with curl - works!
   - Tested multiple limiters sharing one store - works!

4. ✅ **Verify**
   - Re-ran all 32 tests - pass
   - Checked existing examples - still work

5. ✅ **Complete**
   - Updated IMPLEMENTATION.md: B1 complete (2/6)
   - Updated progress: 38.1% overall

6. ✅ **Move to Next**
   - Now ready for B2: Endpoint Auto-Discovery

---

## Test App Structure

The test app should grow like this:

```
/Users/apple/limitratetestfolder/
├── index.js              # Main Express app with ALL features
├── test-b1-shared-store.js     # B1 test scenarios
├── test-b2-auto-discovery.js   # B2 test scenarios (NEXT)
├── test-b3-dry-run.js          # B3 test scenarios (FUTURE)
├── test-all.sh           # Script to run ALL tests
└── README.md             # Document what each test does
```

Each new feature gets its own test file, but they all use the same Express app.

---

## Checklist Template

Copy this for each feature:

```markdown
## Feature: [NAME]

### Pre-Implementation
- [ ] Updated PLAN.md (feature IN PROGRESS)
- [ ] Updated IMPLEMENTATION.md (tracking)
- [ ] Created TodoWrite tasks

### Implementation
- [ ] Code written
- [ ] pnpm build passes
- [ ] pnpm test passes (32+ tests)
- [ ] Unit tests added (if needed)

### Integration Testing
- [ ] Added to test app (/Users/apple/limitratetestfolder)
- [ ] Feature works correctly
- [ ] Edge cases tested
- [ ] Test documented

### Verification
- [ ] Re-ran ALL test app scenarios
- [ ] No regressions
- [ ] All previous features still work

### Completion
- [ ] Updated IMPLEMENTATION.md (COMPLETE)
- [ ] Updated progress percentage
- [ ] TodoWrite marked complete
```

---

**Last Updated:** 2025-11-06
**Current Feature:** B1 (Shared Store Instances) - COMPLETE
**Next Feature:** B2 (Endpoint Auto-Discovery)
