/**
 * Benchmark Test Server
 * Supports multiple rate limiting libraries for comparison
 */

import express from 'express';
import { limitrate } from '@limitrate/express';

const PORT = process.env.PORT || 3000;
const STORE = process.env.STORE || 'memory';
const LIBRARY = process.env.LIBRARY || 'limitrate';

const app = express();

console.log(`🚀 Starting benchmark server: ${LIBRARY} with ${STORE} store`);

// LimitRate implementation
if (LIBRARY === 'limitrate') {
  const gate = limitrate({
    identifyUser: (req) => req.get('x-user-id') || 'anonymous',
    identifyPlan: (req) => req.get('x-plan') || 'free',
    store: STORE === 'redis'
      ? { type: 'redis', url: process.env.REDIS_URL || 'redis://localhost:6379' }
      : { type: 'memory' },
    policies: {
      free: {
        endpoints: {
          'GET|/test': {
            rate: {
              maxPerMinute: 60,
              actionOnExceed: 'block',
            },
          },
        },
      },
    },
  });

  app.use(gate);
}

// Express Rate Limit implementation (for comparison)
else if (LIBRARY === 'express-rate-limit') {
  const rateLimit = (await import('express-rate-limit')).default;

  let store;
  if (STORE === 'redis') {
    const { RedisStore } = await import('rate-limit-redis');
    const { createClient } = await import('redis');
    const client = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    await client.connect();
    store = new RedisStore({ client });
  }

  app.use('/test', rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    ...(store && { store }),
  }));
}

// Rate Limiter Flexible implementation (for comparison)
else if (LIBRARY === 'rate-limiter-flexible') {
  const { RateLimiterMemory, RateLimiterRedis } = await import('rate-limiter-flexible');

  let rateLimiter;
  if (STORE === 'redis') {
    const Redis = (await import('ioredis')).default;
    const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    rateLimiter = new RateLimiterRedis({
      storeClient: redisClient,
      points: 60, // 60 requests
      duration: 60, // per 60 seconds
    });
  } else {
    rateLimiter = new RateLimiterMemory({
      points: 60, // 60 requests
      duration: 60, // per 60 seconds
    });
  }

  app.use('/test', async (req, res, next) => {
    const userId = req.get('x-user-id') || 'anonymous';

    try {
      await rateLimiter.consume(userId, 1);
      next();
    } catch (rejRes) {
      res.status(429).json({
        ok: false,
        error: 'Too many requests',
      });
    }
  });
}

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ ok: true, message: 'Request allowed' });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, library: LIBRARY, store: STORE });
});

const server = app.listen(PORT, () => {
  console.log(`✅ Benchmark server running on port ${PORT}`);
  console.log(`   Library: ${LIBRARY}`);
  console.log(`   Store: ${STORE}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
