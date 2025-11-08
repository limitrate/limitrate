# Honest Limitations

This document radically honestly describes what LimitRate IS and IS NOT. If you're evaluating LimitRate, read this first.

## What LimitRate IS

**LimitRate is a pre-request rate limiting and cost estimation library for Node.js APIs.**

Good for:
- Preventing catastrophic AI spend ($1000/hour mistakes)
- Basic request-per-minute rate limiting
- Plan-based access control (free/pro/enterprise tiers)
- Budget guardrails (not billing tracking)
- Simple cost caps before requests hit your AI provider

## What LimitRate IS NOT

### 1. NOT Accurate Billing Tracking

**Cost estimation accuracy: ±30-50% with char/4, ±5-10% with tiktoken**

Why it's inaccurate:
- Only estimates INPUT tokens (doesn't know output length before request)
- Doesn't account for system prompts, function calls, or tool usage
- Model pricing changes, special pricing (volume discounts, etc.)
- Estimation happens BEFORE the request (can't know actual tokens used)

**What to use instead:**
- OpenAI's billing API for actual costs
- Your AI provider's usage dashboard for invoice-accurate tracking
- Stripe/payment processor webhooks for real billing
- LimitRate + actual billing = complete picture

**Good use case:** "Block users from spending $100/hour accidentally"
**Bad use case:** "Bill customers based on LimitRate's estimates"

### 2. NOT a DDoS Protection Tool

**Slowdown mode does NOT reduce server load.**

What happens with slowdown:
- Request still processes (costs you money)
- Just adds artificial delay before responding
- Server still does all the work (AI call, DB queries, etc.)

**What slowdown IS good for:**
- Better UX for paid tiers ("please slow down" vs hard block)
- Encouraging better client behavior
- Smoothing burst traffic from legitimate users

**What slowdown is BAD for:**
- DDoS protection (attacker doesn't care about delays)
- Reducing server costs (you still process every request)
- Protecting infrastructure (load is the same)

**Use this instead:**
- Cloudflare for DDoS protection
- AWS Shield, Fastly, or similar CDN
- Infrastructure-level rate limiting (nginx, Kong, etc.)

### 3. NOT Production-Safe with MemoryStore

**MemoryStore is for development only. Period.**

Why it fails in production:
- Data lost on server restart (all rate limits reset)
- Each instance has its own state (5 servers = 5x the limit)
- No atomic operations across processes
- Race conditions under load
- No persistence

**What happens:**
```
User hits server 1: 10/10 requests used
User hits server 2: 0/10 requests used (different memory)
Result: User got 20 requests instead of 10
```

**Always use in production:**
- RedisStore (traditional deployments)
- UpstashStore (serverless/edge)

### 4. NOT a Replacement for Kong/AWS API Gateway

**LimitRate is application-level, not infrastructure-level.**

What LimitRate can't do:
- Protect multiple services (each needs its own middleware)
- Rate limit before your app code runs (you're already using CPU)
- Distribute limits across different apps/languages
- Provide zero-downtime config updates
- Enterprise features (OAuth, JWT validation, etc.)

**When to use Kong/AWS API Gateway instead:**
- Multi-service architecture (microservices)
- Need rate limiting BEFORE app code runs
- Using multiple languages (Go, Python, Java)
- Enterprise API management needs
- Need centralized config management

**When LimitRate is better:**
- Single Node.js app
- Need plan-aware limits (free/pro/enterprise)
- AI cost tracking (not just request counts)
- Want simple library (not infrastructure change)

### 5. NOT SOC2/ISO27001/PCI Certified

**We're a library, not a service.**

What this means:
- We don't have compliance certifications
- Security depends on YOUR deployment
- No SLA, no guaranteed uptime
- No 24/7 support, no incident response team
- Open source = you're responsible for security

**Our security grade: A- (library-level)**
- Good: Secure defaults, no known critical vulnerabilities
- Not good: Not audited by third-party, not certified

**Use with caution if you need:**
- SOC2 compliance
- PCI DSS compliance
- HIPAA compliance
- Enterprise SLAs

### 6. NOT Token-Accurate (Even with Tiktoken)

**Tiktoken gives ±5-10% accuracy, not 100%.**

Why it's still not perfect:
- You don't know output tokens before the request
- Model behavior changes (same prompt ≠ same tokens over time)
- Special tokens (BOS, EOS, etc.) handled differently
- System prompts add hidden tokens
- Function calling adds unpredictable tokens

**Example:**
```
Prompt: "Write a story"
Tiktoken estimate: 100 tokens input
Actual usage: 100 input + 500 output = 600 total
LimitRate saw: 100 tokens
Invoice shows: 600 tokens
```

**Tiktoken is good for:** More accurate pre-request limits
**Tiktoken is bad for:** Actual billing, cost attribution

### 7. NOT Real-Time (There's Latency)

**Every rate limit check hits Redis/Upstash (network latency).**

Typical latencies:
- MemoryStore: <1ms (in-process)
- RedisStore: 1-5ms (local), 10-50ms (cloud)
- UpstashStore: 50-200ms (global edge)

**What this means:**
- Your API gets 1-200ms slower per request
- Not suitable for ultra-low-latency APIs (<10ms SLA)
- Network issues = rate limiting fails (unless fail-open)

**Mitigation:**
- Use fail-open mode (allow requests if Redis is down)
- Cache results for very short periods (risky, can exceed limits)
- Skip rate limiting for health checks (`skip: (req) => req.path === '/health'`)

### 8. NOT Multi-Tenant (Out of the Box)

**LimitRate tracks per-user, not per-organization.**

What you need to build yourself:
- Organization-level limits (all users in company share limit)
- Hierarchical limits (team limit + user limit)
- Cross-service limits (limit across multiple APIs)
- Limit delegation (admin assigns limits to users)

**Workaround:**
```typescript
identifyUser: (req) => {
  // Use org ID instead of user ID for org-wide limits
  return req.user?.orgId || req.user?.id || req.ip;
}
```

But this loses per-user granularity.

## When NOT to Use LimitRate

### Use a different tool if you need:

1. **Infrastructure-level rate limiting** → Use Kong, nginx, AWS API Gateway
2. **Multi-language support** → Use Kong, Envoy, or API gateway
3. **DDoS protection** → Use Cloudflare, AWS Shield, Fastly
4. **Actual billing** → Use your AI provider's API + Stripe webhooks
5. **SOC2/ISO27001 compliance** → Use enterprise API gateway
6. **Ultra-low latency (<10ms)** → Skip rate limiting or use in-memory only
7. **Multi-tenant SaaS limits** → Build custom solution or use Stripe Billing

## When TO Use LimitRate

### LimitRate is great for:

1. **Preventing budget disasters**
   - "Don't let users spend $1000/hour on GPT-4"
   - Budget guardrails, not precise billing

2. **Simple plan-based limits**
   - Free tier: 10 req/min
   - Pro tier: 100 req/min with slowdown
   - Enterprise: soft limits with logging

3. **Single Node.js app**
   - Express, Fastify, Next.js API routes
   - Not microservices (use Kong for that)

4. **Rapid prototyping**
   - 20 lines of config, works immediately
   - Great for MVP, proof of concept
   - Easy to replace later if you outgrow it

5. **AI cost awareness**
   - Show users their estimated spend
   - Prevent accidental overuse
   - Complement (don't replace) actual billing

## The Honest Pitch

**LimitRate is a simple, honest tool for Node.js APIs.**

✅ Good at: Basic rate limiting, AI cost guardrails, plan-based access control
❌ Not good at: Precise billing, DDoS protection, enterprise compliance

**Think of it like:**
- A smoke detector (not a fire suppression system)
- A speedometer (not a GPS navigation system)
- A budget tracker (not an accounting system)

**Use it to:**
- Prevent catastrophic mistakes
- Provide basic fairness across plans
- Get started quickly with minimal setup

**Don't use it to:**
- Replace your billing system
- Protect against DDoS attacks
- Meet compliance requirements
- Run mission-critical infrastructure

## Migration Path

**When you outgrow LimitRate:**

1. **For better cost tracking:**
   - Keep LimitRate for pre-request guardrails
   - Add actual billing tracking via AI provider API
   - Use Stripe/payment processor for invoicing

2. **For better infrastructure protection:**
   - Keep LimitRate for app-level limits
   - Add Cloudflare/AWS Shield for DDoS
   - Use Kong/nginx for infrastructure limits

3. **For enterprise features:**
   - Migrate to Kong, Apigee, or AWS API Gateway
   - Keep LimitRate patterns (you learned the concepts)
   - Export your metrics/events to new system

## Questions?

**"Can I use LimitRate in production?"**
Yes, but use RedisStore or UpstashStore (not MemoryStore).

**"Is it accurate enough for billing?"**
No. Use it for guardrails, not invoices.

**"Can it stop DDoS attacks?"**
No. Use Cloudflare or similar.

**"Is it enterprise-ready?"**
Depends. For simple SaaS? Yes. For banks? Probably not.

**"Should I use char/4 or tiktoken?"**
- char/4 for speed, tiktoken for accuracy. Both are estimates, neither is billing-accurate.

**"What if Redis goes down?"**
- Use `onError: 'fail-open'` (allow requests) or `fail-closed` (block requests).

---

**Still have questions? Open an issue on GitHub.**

We'd rather you know the limitations upfront than be disappointed later.
