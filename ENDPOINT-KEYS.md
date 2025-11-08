# Endpoint Keys - Complete Guide

## What Are Endpoint Keys?

Endpoint keys uniquely identify routes in your API for rate limiting. They follow the format:

```
METHOD|/path/to/endpoint
```

**Examples:**
- `POST|/api/users` - Create user endpoint
- `GET|/api/users/:id` - Get specific user
- `DELETE|/api/posts/:id` - Delete specific post

## How Endpoint Keys Are Generated

LimitRate automatically creates endpoint keys using:

```typescript
createEndpointKey(req.method, req.path, req.route?.path)
```

### Method Normalization

**The HTTP method is automatically uppercased:**

```typescript
// ✅ These policy keys all work:
'POST|/api/users'   // Recommended
'post|/api/users'   // Also works
'Post|/api/users'   // Also works

// The method is always normalized to uppercase internally
```

**You can use any case in your policy**, but we recommend **uppercase for consistency**.

###  Route Parameters

Express provides `req.route.path` which includes parameter placeholders:

```typescript
// Express route definition:
app.post('/api/users/:id/posts/:postId', ...)

// LimitRate sees:
req.path = '/api/users/123/posts/456'           // Actual request
req.route.path = '/api/users/:id/posts/:postId'  // Route template

// Endpoint key = 'POST|/api/users/:id/posts/:postId'
```

**This means ALL requests to `/api/users/*/posts/*` share the same rate limit!**

```typescript
// These all count toward the same limit:
POST /api/users/1/posts/1
POST /api/users/1/posts/2
POST /api/users/2/posts/1
```

### Policy Configuration

```typescript
policies: {
  free: {
    endpoints: {
      // ✅ Correct: Use the route template
      'POST|/api/users/:id/posts/:postId': {
        rate: { maxPerMinute: 10, actionOnExceed: 'block' }
      }
    }
  }
}
```

## Without Route Templates (Non-Express Frameworks)

If `req.route.path` is not available, LimitRate uses heuristics to normalize paths:

```typescript
// Request: /api/users/123
// LimitRate detects "123" looks like an ID
// Endpoint key = 'GET|/api/users/:id'

// Request: /api/users/550e8400-e29b-41d4-a716-446655440000
// LimitRate detects UUID
// Endpoint key = 'GET|/api/users/:id'

// Request: /api/products/laptop-stand
// LimitRate detects kebab-case word (not an ID)
// Endpoint key = 'GET|/api/products/laptop-stand'
```

**ID Detection Rules:**
- Numeric IDs: `123`, `456789`
- UUIDs: `550e8400-e29b-41d4-a716-446655440000`
- MongoDB ObjectIds: `507f1f77bcf86cd799439011`
- Short IDs (16+ chars): `xg7Kp9mN2qL8wR5t`
- **NOT kebab-case words**: `free-strict`, `rate-limit`

## Common Mistakes

### ❌ Mistake 1: Using Actual IDs in Policy Keys

```typescript
policies: {
  free: {
    endpoints: {
      // ❌ WRONG: This only matches user 123
      'GET|/api/users/123': {
        rate: { maxPerMinute: 100 }
      }
    }
  }
}
```

**Fix:** Use the route template with `:id`:

```typescript
'GET|/api/users/:id': {
  rate: { maxPerMinute: 100 }
}
```

### ❌ Mistake 2: Forgetting Method Prefix

```typescript
policies: {
  free: {
    endpoints: {
      // ❌ WRONG: Missing method
      '/api/users': {
        rate: { maxPerMinute: 100 }
      }
    }
  }
}
```

**Fix:** Always include the method:

```typescript
'POST|/api/users': {
  rate: { maxPerMinute: 100 }
}
```

### ❌ Mistake 3: Query Parameters in Endpoint Key

```typescript
// ❌ WRONG: Query params are NOT part of the endpoint key
'GET|/api/search?q=test': { ... }
```

**Endpoint keys use only the path, not query strings:**

```typescript
// ✅ Correct:
'GET|/api/search': {
  rate: { maxPerMinute: 50 }
}

// This limits ALL searches:
// /api/search?q=test
// /api/search?q=hello
// /api/search?q=world&page=2
```

## Debugging Endpoint Keys

### See What Keys Are Being Generated

Add logging to see endpoint keys in action:

```typescript
app.use((req, res, next) => {
  const endpoint = `${req.method}|${req.route?.path || req.path}`;
  console.log('Endpoint key:', endpoint);
  next();
});
```

### Enable Endpoint Tracking

LimitRate can auto-discover endpoints:

```typescript
limitrate({
  trackEndpoints: true,  // Opt-in: track which endpoints are hit
  // ...
})
```

Then use the CLI to see all discovered endpoints:

```bash
npx limitrate inspect
```

### Use Dry Run Mode

Test your rate limits without blocking users:

```typescript
limitrate({
  dryRun: true,  // Log rate limit violations but don't enforce
  dryRunLogger: (event) => {
    console.log('Would limit:', event.endpoint, event.user);
  },
  // ...
})
```

## Advanced: Custom Endpoint Keys

If you need custom endpoint key logic, you can use per-route policies:

```typescript
import { withPolicy } from '@limitrate/express';

// Override for specific route
app.post('/api/special',
  withPolicy({
    rate: { maxPerMinute: 5, actionOnExceed: 'block' }
  }),
  handler
);
```

## Best Practices

1. **Always use uppercase methods** (for consistency)
   ```typescript
   'POST|/api/users'  // ✅ Good
   'post|/api/users'  // ⚠️  Works but inconsistent
   ```

2. **Use route templates, not actual values**
   ```typescript
   'GET|/api/users/:id'  // ✅ Good
   'GET|/api/users/123'  // ❌ Bad
   ```

3. **Document your endpoint keys**
   ```typescript
   endpoints: {
     // User creation endpoint - 10 req/min to prevent spam
     'POST|/api/users': {
       rate: { maxPerMinute: 10, actionOnExceed: 'block' }
     },

     // User profile fetch - 100 req/min for good UX
     'GET|/api/users/:id': {
       rate: { maxPerMinute: 100, actionOnExceed: 'slowdown', slowdownMs: 200 }
     }
   }
   ```

4. **Use defaults for most endpoints**
   ```typescript
   policies: {
     free: {
       // Specific limits for critical endpoints
       endpoints: {
         'POST|/api/ai/generate': {
           rate: { maxPerMinute: 5, actionOnExceed: 'block' }
         }
       },
       // Fallback for everything else
       defaults: {
         rate: { maxPerMinute: 60, actionOnExceed: 'block' }
       }
     }
   }
   ```

## Troubleshooting

**Problem:** "My rate limit isn't working!"

**Checklist:**
1. Is the method in uppercase? → Use uppercase `POST` not `post`
2. Are you using `:id` for parameters? → Use `'GET|/api/users/:id'` not `'GET|/api/users/123'`
3. Did you add the `|` separator? → Use `'POST|/api/users'` not `'POST/api/users'`
4. Is the path correct? → Check with `console.log(req.route?.path)`

**Problem:** "Different users share rate limits!"

This is expected! Endpoint keys identify **which endpoint**, not which user.

Rate limits are per-user per-endpoint:
- User A → `POST|/api/generate` → 5 req/min
- User B → `POST|/api/generate` → 5 req/min (separate counter)

**Problem:** "Route parameters cause cache pollution!"

If you have thousands of unique parameter values, consider:
1. Use `maxKeysPerUser: 100` to limit per-user cache growth
2. Use Redis/Upstash store (handles large key counts better)
3. Consider if you need per-endpoint limits (maybe a global user limit is enough)

## Further Reading

- [Configuration Guide](./packages/express/README.md)
- [Policy Engine Docs](./packages/core/README.md)
- [Examples](./apps/examples/)
