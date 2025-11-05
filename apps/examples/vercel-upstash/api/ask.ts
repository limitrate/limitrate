import type { VercelRequest, VercelResponse } from '@vercel/node';
import { limitrate } from '@limitrate/express';
import express from 'express';

// Create Express app for serverless function
const app = express();
app.use(express.json());

// Configure LimitRate with Upstash
app.use(
  limitrate({
    store: {
      type: 'upstash',
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    },
    policies: {
      free: {
        endpoints: {
          'POST|/api/ask': {
            rate: {
              maxPerMinute: 10,
              maxPerHour: 100,
              actionOnExceed: 'block',
            },
            cost: {
              perRequest: 0.002, // $0.002 per request
              maxPerHour: 0.20,  // $0.20/hour
              maxPerDay: 2.00,   // $2.00/day
              actionOnExceed: 'block',
            },
          },
        },
        defaults: {
          rate: {
            maxPerMinute: 60,
            maxPerHour: 1000,
            actionOnExceed: 'block',
          },
        },
      },
      pro: {
        endpoints: {
          'POST|/api/ask': {
            rate: {
              maxPerMinute: 100,
              maxPerHour: 10000,
              actionOnExceed: 'slowdown',
            },
            cost: {
              perRequest: 0.002,
              maxPerHour: 10.00,
              maxPerDay: 100.00,
              actionOnExceed: 'allow-and-log',
            },
          },
        },
      },
    },
    identifyUser: (req) => {
      // In production, get from JWT or session
      return (req.headers['x-user-id'] as string) || 'anonymous';
    },
    identifyPlan: (req) => {
      // In production, get from database
      return (req.headers['x-plan'] as string) || 'free';
    },
    onEvent: (event) => {
      // Log important events
      if (event.type === 'rate_exceeded' || event.type === 'cost_exceeded') {
        console.log(`[LimitRate] ${event.type}:`, {
          user: event.user,
          plan: event.plan,
          endpoint: event.endpoint,
        });
      }
    },
  })
);

// API route handler
app.post('/api/ask', (req, res) => {
  const { question } = req.body;

  if (!question) {
    return res.status(400).json({
      ok: false,
      error: 'Missing question parameter',
    });
  }

  // Simulate AI processing
  const answer = `You asked: "${question}". This is a demo response from a serverless function protected by LimitRate rate limiting with Upstash Redis.`;

  res.json({
    ok: true,
    answer,
    timestamp: new Date().toISOString(),
  });
});

// Export serverless function handler
export default async (req: VercelRequest, res: VercelResponse) => {
  return new Promise((resolve, reject) => {
    app(req as any, res as any, (err: any) => {
      if (err) {
        reject(err);
      } else {
        resolve(undefined);
      }
    });
  });
};
