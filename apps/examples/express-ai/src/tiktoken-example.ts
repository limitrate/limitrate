/**
 * Accurate Cost Estimation with Tiktoken
 *
 * This example shows the difference between:
 * 1. char/4 estimation (±30-50% accuracy) - Fast, no dependencies
 * 2. tiktoken estimation (±5-10% accuracy) - Slower, requires tokenizer
 *
 * Run with: npx tsx src/tiktoken-example.ts
 */

import express from 'express';
import { limitrate } from '@limitrate/express';
import { encoding_for_model } from 'tiktoken';
import type { TiktokenModel } from 'tiktoken';

const app = express();
app.use(express.json());

// Initialize tokenizer (expensive, do once at startup)
const gpt35Encoder = encoding_for_model('gpt-3.5-turbo' as TiktokenModel);
const gpt4Encoder = encoding_for_model('gpt-4' as TiktokenModel);

// Model pricing (per 1M tokens)
const PRICING = {
  'gpt-3.5-turbo': { input: 1.50, output: 2.00 },
  'gpt-4o': { input: 5.00, output: 15.00 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
} as const;

// Helper: Estimate cost with char/4 (FAST, INACCURATE)
function estimateCostCharDiv4(prompt: string, model: string): number {
  const tokens = Math.ceil(prompt.length / 4);
  const pricing = PRICING[model as keyof typeof PRICING] || PRICING['gpt-3.5-turbo'];
  return (tokens * pricing.input) / 1_000_000;
}

// Helper: Estimate cost with tiktoken (SLOWER, ACCURATE)
function estimateCostTiktoken(prompt: string, model: string): number {
  const encoder = model.startsWith('gpt-4') ? gpt4Encoder : gpt35Encoder;
  const tokens = encoder.encode(prompt).length;
  const pricing = PRICING[model as keyof typeof PRICING] || PRICING['gpt-3.5-turbo'];
  return (tokens * pricing.input) / 1_000_000;
}

// ============================================================================
// Example 1: Using char/4 (Fast, less accurate)
// ============================================================================

app.use('/api/fast', limitrate({
  identifyUser: (req) => req.user?.id || req.ip || 'anonymous',
  identifyPlan: (req) => req.user?.plan || 'free',

  store: { type: 'memory' },

  policies: {
    free: {
      endpoints: {
        'POST|/api/fast/ask': {
          rate: { maxPerMinute: 10, actionOnExceed: 'block' },
          cost: {
            estimateCost: (req) => {
              const prompt = req.body?.prompt || '';
              const model = req.body?.model || 'gpt-3.5-turbo';
              return estimateCostCharDiv4(prompt, model);
            },
            hourlyCap: 0.10, // $0.10/hour
            actionOnExceed: 'block',
          },
        },
      },
    },
  },
}));

// ============================================================================
// Example 2: Using tiktoken (Slower, more accurate)
// ============================================================================

app.use('/api/accurate', limitrate({
  identifyUser: (req) => req.user?.id || req.ip || 'anonymous',
  identifyPlan: (req) => req.user?.plan || 'free',

  store: { type: 'memory' },

  policies: {
    free: {
      endpoints: {
        'POST|/api/accurate/ask': {
          rate: { maxPerMinute: 10, actionOnExceed: 'block' },
          cost: {
            estimateCost: (req) => {
              const prompt = req.body?.prompt || '';
              const model = req.body?.model || 'gpt-3.5-turbo';
              return estimateCostTiktoken(prompt, model);
            },
            hourlyCap: 0.10, // $0.10/hour
            actionOnExceed: 'block',
          },
        },
      },
    },
  },
}));

// ============================================================================
// Comparison endpoint
// ============================================================================

app.post('/api/compare', (req, res) => {
  const prompt = req.body?.prompt || '';
  const model = req.body?.model || 'gpt-3.5-turbo';

  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  // Estimate with both methods
  const charDiv4Cost = estimateCostCharDiv4(prompt, model);
  const tiktokenCost = estimateCostTiktoken(prompt, model);

  // Calculate accuracy difference
  const difference = Math.abs(charDiv4Cost - tiktokenCost);
  const percentDiff = ((difference / tiktokenCost) * 100).toFixed(1);

  res.json({
    prompt: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
    model,
    charDiv4: {
      estimatedCost: `$${charDiv4Cost.toFixed(6)}`,
      method: 'char/4 (fast, ±30-50% accuracy)',
    },
    tiktoken: {
      estimatedCost: `$${tiktokenCost.toFixed(6)}`,
      method: 'tiktoken (slower, ±5-10% accuracy)',
      actualTokens: gpt35Encoder.encode(prompt).length,
    },
    difference: {
      absolute: `$${difference.toFixed(6)}`,
      percentage: `${percentDiff}%`,
      verdict: parseFloat(percentDiff) > 30 ? 'SIGNIFICANT DIFFERENCE' : 'MINOR DIFFERENCE',
    },
    recommendation:
      parseFloat(percentDiff) > 30
        ? 'Use tiktoken for more accurate cost tracking'
        : 'char/4 is acceptable for this use case',
  });
});

// ============================================================================
// Test endpoints
// ============================================================================

app.post('/api/fast/ask', (req, res) => {
  res.json({
    ok: true,
    message: 'Request processed with char/4 estimation',
    prompt: req.body.prompt?.substring(0, 50),
  });
});

app.post('/api/accurate/ask', (req, res) => {
  res.json({
    ok: true,
    message: 'Request processed with tiktoken estimation',
    prompt: req.body.prompt?.substring(0, 50),
  });
});

// ============================================================================
// Example prompts for testing
// ============================================================================

app.get('/api/examples', (req, res) => {
  const examples = [
    {
      name: 'Short prompt (low variance)',
      prompt: 'Hello, how are you?',
      expected: 'char/4 and tiktoken should be similar (±10%)',
    },
    {
      name: 'Code snippet (high variance)',
      prompt: `
        function fibonacci(n) {
          if (n <= 1) return n;
          return fibonacci(n - 1) + fibonacci(n - 2);
        }
      `,
      expected: 'char/4 will underestimate tokens for code (±40%)',
    },
    {
      name: 'Technical text (medium variance)',
      prompt: 'Explain how neural networks work using backpropagation and gradient descent.',
      expected: 'char/4 should be close (±15-20%)',
    },
    {
      name: 'JSON data (high variance)',
      prompt: JSON.stringify({
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
      }),
      expected: 'char/4 will underestimate due to special characters (±35%)',
    },
  ];

  res.json({
    examples,
    usage: 'POST /api/compare with {"prompt": "...", "model": "gpt-3.5-turbo"}',
  });
});

// ============================================================================
// Benchmarking endpoint
// ============================================================================

app.post('/api/benchmark', (req, res) => {
  const prompt = req.body?.prompt || 'Hello, world!';
  const iterations = req.body?.iterations || 1000;

  // Benchmark char/4
  const charDiv4Start = Date.now();
  for (let i = 0; i < iterations; i++) {
    estimateCostCharDiv4(prompt, 'gpt-3.5-turbo');
  }
  const charDiv4Time = Date.now() - charDiv4Start;

  // Benchmark tiktoken
  const tiktokenStart = Date.now();
  for (let i = 0; i < iterations; i++) {
    estimateCostTiktoken(prompt, 'gpt-3.5-turbo');
  }
  const tiktokenTime = Date.now() - tiktokenStart;

  res.json({
    iterations,
    charDiv4: {
      totalTime: `${charDiv4Time}ms`,
      avgTime: `${(charDiv4Time / iterations).toFixed(3)}ms`,
      opsPerSec: Math.floor(iterations / (charDiv4Time / 1000)),
    },
    tiktoken: {
      totalTime: `${tiktokenTime}ms`,
      avgTime: `${(tiktokenTime / iterations).toFixed(3)}ms`,
      opsPerSec: Math.floor(iterations / (tiktokenTime / 1000)),
    },
    speedup: `${(tiktokenTime / charDiv4Time).toFixed(1)}x faster with char/4`,
  });
});

// ============================================================================
// Start server
// ============================================================================

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
  console.log(`\nTiktoken Example Server running on http://localhost:${PORT}\n`);
  console.log('Test endpoints:');
  console.log(`  GET  /api/examples        - View example prompts`);
  console.log(`  POST /api/compare         - Compare char/4 vs tiktoken`);
  console.log(`  POST /api/benchmark       - Benchmark performance`);
  console.log(`  POST /api/fast/ask        - Use char/4 estimation (fast)`);
  console.log(`  POST /api/accurate/ask    - Use tiktoken estimation (accurate)\n`);

  console.log('Quick test:');
  console.log(
    `  curl -X POST http://localhost:${PORT}/api/compare -H "Content-Type: application/json" -d '{"prompt":"Hello, world!"}'`
  );
  console.log('');
});

/**
 * Example Usage:
 *
 * 1. Compare estimation methods:
 *    curl -X POST http://localhost:3003/api/compare \
 *      -H "Content-Type: application/json" \
 *      -d '{"prompt":"Write a story about AI", "model":"gpt-3.5-turbo"}'
 *
 * 2. Benchmark performance:
 *    curl -X POST http://localhost:3003/api/benchmark \
 *      -H "Content-Type: application/json" \
 *      -d '{"prompt":"Hello!", "iterations":10000}'
 *
 * 3. Test with code snippet:
 *    curl -X POST http://localhost:3003/api/compare \
 *      -H "Content-Type: application/json" \
 *      -d '{"prompt":"function add(a,b) { return a + b; }"}'
 *
 * Expected Results:
 *
 * - char/4: ~0.001ms per call, ±30-50% accuracy
 * - tiktoken: ~0.1ms per call, ±5-10% accuracy
 * - Speedup: 100x faster with char/4
 *
 * When to Use Each:
 *
 * - Use char/4 for:
 *   - Budget guardrails (prevent $1000/hour mistakes)
 *   - High-throughput APIs (need speed)
 *   - Approximate limits (don't need exact billing)
 *
 * - Use tiktoken for:
 *   - More accurate pre-request limits
 *   - Cost attribution per user
 *   - When you need ±5-10% accuracy
 *
 * - Don't use either for:
 *   - Actual billing (use provider's API)
 *   - Invoice-accurate tracking (includes output tokens, system prompts)
 *   - Financial reporting (this is estimation, not measurement)
 */
