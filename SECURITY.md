# Security Policy

## Supported Versions

We release security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to: **security@limitrate.dev**

### What to Include

When reporting a vulnerability, please include:

1. **Description** — Clear description of the vulnerability
2. **Impact** — What an attacker could achieve
3. **Steps to Reproduce** — Detailed steps to reproduce the issue
4. **Affected Versions** — Which versions are affected
5. **Suggested Fix** — (Optional) How you think it should be fixed

### Example Report

```
Subject: [SECURITY] Potential Redis Injection in Cost Tracking

Description:
The cost tracking feature in @limitrate/core does not properly sanitize
user input before passing it to Redis Lua scripts, potentially allowing
Redis command injection.

Impact:
An attacker could execute arbitrary Redis commands by crafting malicious
cost estimation values, potentially accessing or modifying other keys in
the Redis database.

Steps to Reproduce:
1. Set up LimitRate with RedisStore
2. Configure cost tracking with estimateCost function
3. Send request with crafted payload: {"prompt": "'; FLUSHDB; --"}
4. Observe Redis database is cleared

Affected Versions:
@limitrate/core: 1.0.0 - 1.2.0

Suggested Fix:
Escape user input before passing to Lua scripts, or use parameterized
queries if available.
```

## Response Timeline

- **Initial Response**: Within 48 hours
- **Confirmation**: Within 1 week
- **Fix & Release**: Depends on severity
  - Critical: Within 7 days
  - High: Within 14 days
  - Medium: Within 30 days
  - Low: Next regular release

## Disclosure Policy

- We follow **responsible disclosure**
- We will credit you in the security advisory (unless you prefer to remain anonymous)
- Please give us reasonable time to fix the issue before public disclosure
- We will notify you when the fix is released

## Security Best Practices

When using LimitRate in production:

### 1. Use Secure Stores

```typescript
// Production: Use Redis with authentication
store: {
  type: 'redis',
  url: process.env.REDIS_URL // redis://user:password@host:port
}

// Not recommended for production
store: { type: 'memory' }
```

### 2. Validate User Input

```typescript
// Good: Validate before cost estimation
cost: {
  estimateCost: (context) => {
    if (!context.prompt || typeof context.prompt !== 'string') {
      return 0;
    }
    if (context.prompt.length > 100000) {
      throw new Error('Prompt too large');
    }
    const tokens = Math.ceil(context.prompt.length / 4);
    return tokens * 0.0000015;
  }
}

// Bad: No validation
cost: {
  estimateCost: (context) => {
    return context.prompt.length * 0.0000015;
  }
}
```

### 3. Use IP Allowlisting Carefully

```typescript
// Good: Specific IPs or CIDR ranges
ipAllowlist: ['192.168.1.100', '10.0.0.0/24']

// Bad: Overly broad ranges
ipAllowlist: ['0.0.0.0/0']  // This allows everything!
```

### 4. Protect Redis Connections

```bash
# Use TLS for Redis connections
REDIS_URL=rediss://user:password@host:port

# Use strong passwords
REDIS_PASSWORD=<strong-random-password>

# Restrict Redis access by IP
# Configure Redis to only accept connections from your app servers
```

### 5. Secure Webhook URLs

```typescript
// Good: Use HTTPS and authentication
webhookUrl: 'https://yourapp.com/webhooks/fairgate',
onEvent: async (event) => {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.WEBHOOK_SECRET}`
    },
    body: JSON.stringify(event)
  });
}

// Bad: HTTP without authentication
webhookUrl: 'http://yourapp.com/webhooks/fairgate'
```

### 6. Rate Limit the Rate Limiter

```typescript
// Good: Skip health checks to prevent abuse
skip: (req) => {
  if (req.path === '/health') return true;
  return false;
}
```

### 7. Monitor for Anomalies

```typescript
onEvent: (event) => {
  // Alert on unusual cost patterns
  if (event.type === 'cost_exceeded' && event.value > 100) {
    sendAlert(`Unusually high cost: $${event.value} for user ${event.user}`);
  }

  // Alert on rate limit abuse
  if (event.type === 'rate_exceeded') {
    const count = getRateLimitCount(event.user);
    if (count > 100) {
      sendAlert(`Possible abuse: user ${event.user} hit rate limit ${count} times`);
    }
  }
}
```

## Known Security Considerations

### Redis Lua Scripts

LimitRate uses Lua scripts for atomic operations in Redis. These scripts are carefully designed to prevent injection, but:

- Always use the latest version
- Keep Redis updated
- Use authentication and TLS

### Cost Estimation Functions

The `estimateCost` function runs user-provided code:

- Always validate inputs
- Set reasonable limits
- Don't trust user data
- Handle errors gracefully

### SQLite Database (CLI)

The CLI stores events in SQLite:

- Database is created with restricted permissions (600)
- Events are auto-pruned after 48 hours
- No sensitive data should be stored in events

## Security Audits

We welcome security audits of LimitRate. If you're conducting a security audit:

1. Email security@limitrate.dev to let us know
2. Conduct your audit
3. Report findings via email
4. We'll work with you on fixes and disclosure

## Bug Bounty Program

We currently do not have a formal bug bounty program, but we deeply appreciate security researchers who help keep LimitRate secure.

Depending on the severity and quality of the report, we may offer:

- Public acknowledgment
- Swag/merchandise
- Monetary reward (for critical vulnerabilities)

## Contact

- **Security Email**: security@limitrate.dev
- **General Email**: hello@limitrate.dev
- **GitHub**: [@limitrate](https://github.com/fairgate)

---

**Thank you for helping keep LimitRate and our users safe!**
