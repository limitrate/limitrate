import express from 'express';
import { limitrate } from '@limitrate/express';
import { saveEvent } from '@limitrate/cli';
import OpenAI from 'openai';

const app = express();
const port = 3002;

app.use(express.json());

// Initialize OpenAI (optional - for testing with real API)
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

/**
 * OpenAI Cost Estimator
 * Based on https://openai.com/pricing (as of Nov 2024)
 */
function estimateOpenAICost(req: any): number {
  const model = req.body?.model || 'gpt-3.5-turbo';
  const prompt = req.body?.prompt || '';

  // Rough token estimation: ~4 chars = 1 token
  const estimatedTokens = Math.ceil(prompt.length / 4);

  // Pricing per 1M tokens (input + output combined average)
  const pricing: Record<string, number> = {
    'gpt-3.5-turbo': 1.50 / 1_000_000,  // $1.50/1M tokens
    'gpt-4': 30.00 / 1_000_000,         // $30/1M tokens
    'gpt-4-turbo': 10.00 / 1_000_000,   // $10/1M tokens
    'gpt-4o': 5.00 / 1_000_000,         // $5/1M tokens
    'gpt-4o-mini': 0.15 / 1_000_000,    // $0.15/1M tokens
  };

  const pricePerToken = pricing[model] || pricing['gpt-3.5-turbo'];
  const estimatedCost = estimatedTokens * pricePerToken;

  console.log(`💵 Cost estimate: ${estimatedTokens} tokens × $${pricePerToken.toFixed(8)} = $${estimatedCost.toFixed(6)}`);

  return estimatedCost;
}

// Apply LimitRate middleware with AI cost caps
app.use(
  limitrate({
    identifyUser: (req) => req.get('x-user-id') || req.ip || 'anonymous',
    identifyPlan: (req) => {
      const plan = req.get('x-user-plan');
      return plan === 'pro' || plan === 'enterprise' ? plan : 'free';
    },

    store: { type: 'memory' },
    trustProxy: false,

    policies: {
      free: {
        endpoints: {
          // AI endpoint with cost cap
          'POST|/api/ask': {
            // Rate limit: 10 requests per minute
            rate: {
              maxPerMinute: 10,
              actionOnExceed: 'block',
            },
            // Cost cap: $0.10 per hour (~67 gpt-3.5-turbo requests)
            cost: {
              estimateCost: estimateOpenAICost,
              hourlyCap: 0.10,
              actionOnExceed: 'block',
            },
          },
        },
        defaults: {
          rate: { maxPerMinute: 30, actionOnExceed: 'block' },
        },
      },
      pro: {
        endpoints: {
          'POST|/api/ask': {
            rate: {
              maxPerMinute: 100,
              actionOnExceed: 'slowdown',
              slowdownMs: 500,
            },
            cost: {
              estimateCost: estimateOpenAICost,
              hourlyCap: 5.00,  // $5/hour (~3,333 gpt-3.5 requests)
              actionOnExceed: 'block',
            },
          },
        },
        defaults: {
          rate: { maxPerMinute: 300, actionOnExceed: 'allow-and-log' },
        },
      },
      enterprise: {
        endpoints: {
          'POST|/api/ask': {
            rate: {
              maxPerMinute: 1000,
              actionOnExceed: 'allow-and-log',
            },
            cost: {
              estimateCost: estimateOpenAICost,
              dailyCap: 500.00,  // $500/day
              actionOnExceed: 'allow-and-log',
            },
          },
        },
        defaults: {
          rate: { maxPerMinute: 5000, actionOnExceed: 'allow-and-log' },
        },
      },
    },

    upgradeHint: (plan) => {
      if (plan === 'free') {
        return 'Upgrade to Pro for 50x higher AI budget: https://yourapp.com/pricing';
      }
      if (plan === 'pro') {
        return 'Upgrade to Enterprise for unlimited AI requests: https://yourapp.com/enterprise';
      }
      return undefined;
    },

    onEvent: (event) => {
      // Save to SQLite for CLI dashboard
      saveEvent(event);

      // Log important events
      if (event.type === 'cost_exceeded') {
        console.log('🚨 COST CAP EXCEEDED:', JSON.stringify(event, null, 2));
      } else if (event.type === 'rate_exceeded') {
        console.log('🚨 RATE LIMIT EXCEEDED:', JSON.stringify(event, null, 2));
      }
    },
  })
);

// Example routes
app.get('/', (req, res) => {
  res.json({
    message: 'LimitRate AI Cost Tracking Example',
    endpoints: {
      'POST /api/ask': 'Ask AI a question (with cost tracking)',
      'GET /api/models': 'List available models with pricing',
    },
    plans: {
      free: {
        rateLimit: '10 req/min',
        costCap: '$0.10/hour',
        estimatedRequests: '~67 GPT-3.5 requests/hour',
      },
      pro: {
        rateLimit: '100 req/min',
        costCap: '$5/hour',
        estimatedRequests: '~3,333 GPT-3.5 requests/hour',
      },
      enterprise: {
        rateLimit: '1000 req/min',
        costCap: '$500/day',
        estimatedRequests: '~333,333 GPT-3.5 requests/day',
      },
    },
    tip: 'Send "x-user-plan: pro" header to test pro tier limits',
  });
});

app.get('/api/models', (req, res) => {
  res.json({
    models: [
      { name: 'gpt-4o-mini', costPer1kTokens: '$0.00015', recommended: true },
      { name: 'gpt-3.5-turbo', costPer1kTokens: '$0.0015' },
      { name: 'gpt-4o', costPer1kTokens: '$0.005' },
      { name: 'gpt-4-turbo', costPer1kTokens: '$0.01' },
      { name: 'gpt-4', costPer1kTokens: '$0.03' },
    ],
    note: 'Costs are approximate averages of input + output tokens',
  });
});

app.post('/api/ask', async (req, res) => {
  const { prompt, model = 'gpt-3.5-turbo' } = req.body;

  if (!prompt) {
    return res.status(400).json({
      error: 'Missing "prompt" field in request body',
    });
  }

  try {
    // If real OpenAI key is configured, call the API
    if (openai) {
      const completion = await openai.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
      });

      const actualCost = estimateOpenAICost(req);

      res.json({
        success: true,
        model,
        response: completion.choices[0]?.message?.content || 'No response',
        usage: completion.usage,
        estimatedCost: `$${actualCost.toFixed(6)}`,
        note: 'Real OpenAI API call',
      });
    } else {
      // Simulate AI response for testing without API key
      const estimatedCost = estimateOpenAICost(req);
      const estimatedTokens = Math.ceil(prompt.length / 4);

      res.json({
        success: true,
        model,
        response: `This is a simulated response. In production, this would call ${model}.`,
        usage: {
          prompt_tokens: estimatedTokens,
          completion_tokens: 30,
          total_tokens: estimatedTokens + 30,
        },
        estimatedCost: `$${estimatedCost.toFixed(6)}`,
        note: 'Simulated response (set OPENAI_API_KEY to use real API)',
      });
    }
  } catch (error: any) {
    console.error('OpenAI API error:', error);
    res.status(500).json({
      error: 'AI request failed',
      message: error.message,
    });
  }
});

app.listen(port, () => {
  console.log(`\n🤖 LimitRate AI Example Server running on http://localhost:${port}\n`);
  console.log('Environment:');
  console.log(`  OpenAI API: ${openai ? '✅ Configured' : '❌ Not configured (using mock)'}\n`);
  console.log('Try these commands:');
  console.log('  # Free user (10 req/min, $0.10/hour cap)');
  console.log(`  curl -X POST http://localhost:${port}/api/ask -H "Content-Type: application/json" -d '{"prompt":"Hello!"}'\n`);
  console.log('  # Pro user ($5/hour cap)');
  console.log(`  curl -X POST http://localhost:${port}/api/ask -H "x-user-plan: pro" -H "Content-Type: application/json" -d '{"prompt":"Write a poem about rate limiting"}'\n`);
  console.log('  # Test cost cap by sending expensive prompts');
  console.log(`  for i in {{1..100}}; do curl -X POST http://localhost:${port}/api/ask -H "Content-Type: application/json" -d '{"prompt":"$(head -c 10000 </dev/urandom | base64)"}' & done\n`);
  console.log('  # View dashboard');
  console.log('  npx limitrate inspect\n');
});
