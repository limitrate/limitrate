# LimitRate AI Cost Tracking Example

This example demonstrates how to use LimitRate to protect your AI/LLM endpoints with both **rate limits** and **cost caps**.

## Features

- ✅ **Rate Limiting**: 10 req/min (free), 100 req/min (pro), 1000 req/min (enterprise)
- ✅ **Cost Caps**: $0.10/hour (free), $5/hour (pro), $500/day (enterprise)
- ✅ **Real-time Cost Estimation**: Calculates OpenAI API costs before making requests
- ✅ **Multi-Model Support**: GPT-3.5, GPT-4, GPT-4 Turbo, GPT-4o, GPT-4o-mini
- ✅ **CLI Dashboard**: Track costs and limits with `npx limitrate inspect`
- ✅ **Simulated Mode**: Test without OpenAI API key

## Quick Start

```bash
# Install dependencies
pnpm install

# Run the server (uses mock responses)
pnpm dev

# Or with real OpenAI API
OPENAI_API_KEY=sk-... pnpm dev
```

Server runs on http://localhost:3002

## API Endpoints

### `POST /api/ask`
Ask AI a question with automatic cost tracking.

**Request:**
```bash
curl -X POST http://localhost:3002/api/ask \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello!", "model": "gpt-3.5-turbo"}'
```

**Response:**
```json
{
  "success": true,
  "model": "gpt-3.5-turbo",
  "response": "This is a simulated response...",
  "usage": {
    "prompt_tokens": 8,
    "completion_tokens": 30,
    "total_tokens": 38
  },
  "estimatedCost": "$0.000012"
}
```

### `GET /api/models`
List available AI models with pricing.

## Testing Cost Caps

### Test Free Tier ($0.10/hour cap)
```bash
# Send expensive prompts to hit cost cap
for i in {1..100}; do
  curl -X POST http://localhost:3002/api/ask \
    -H "Content-Type: application/json" \
    -d "{\"prompt\":\"$(python3 -c 'print("a" * 4000)')\"}"
done
```

### Test Pro Tier ($5/hour cap)
```bash
curl -X POST http://localhost:3002/api/ask \
  -H "x-user-plan: pro" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Write a long essay about AI safety"}'
```

## Plan Comparison

| Plan | Rate Limit | Cost Cap | Est. GPT-3.5 Requests |
|------|------------|----------|----------------------|
| **Free** | 10 req/min | $0.10/hour | ~67/hour |
| **Pro** | 100 req/min | $5/hour | ~3,333/hour |
| **Enterprise** | 1000 req/min | $500/day | ~333,333/day |

## Cost Estimation

LimitRate estimates costs **before** making API calls using:

1. **Token Estimation**: ~4 characters = 1 token
2. **Model Pricing**: Based on official OpenAI pricing
3. **Pre-request Check**: Blocks requests that would exceed cap

### Model Pricing (per 1M tokens)

- **gpt-4o-mini**: $0.15
- **gpt-3.5-turbo**: $1.50
- **gpt-4o**: $5.00
- **gpt-4-turbo**: $10.00
- **gpt-4**: $30.00

## View Dashboard

```bash
# View real-time stats
npx limitrate inspect
```

Shows:
- Total API cost spent
- Requests per endpoint
- Top spenders
- Cost-exceeded events

## How It Works

```typescript
cost: {
  // Estimate cost based on request
  estimateCost: (req) => {
    const prompt = req.body.prompt;
    const tokens = prompt.length / 4;
    const pricePerToken = 0.0000015; // GPT-3.5
    return tokens * pricePerToken;
  },

  // Set cap
  hourlyCap: 0.10,  // $0.10/hour for free tier

  // What to do when cap is hit
  actionOnExceed: 'block'
}
```

## Production Deployment

1. **Set Environment Variable:**
   ```bash
   export OPENAI_API_KEY=sk-your-key
   ```

2. **Use Redis for distributed tracking:**
   ```typescript
   store: {
     type: 'redis',
     url: process.env.REDIS_URL
   }
   ```

3. **Monitor with webhooks:**
   ```typescript
   webhookUrl: 'https://your-app.com/webhooks/limitrate',
   onEvent: (event) => {
     if (event.type === 'cost_exceeded') {
       // Alert your team
     }
   }
   ```

## Learn More

- [LimitRate Documentation](https://github.com/limitrate/limitrate)
- [OpenAI Pricing](https://openai.com/pricing)
- [Cost Optimization Guide](../../docs/COST_OPTIMIZATION.md)
