/**
 * Anthropic tokenizer integration
 * Requires: npm install @anthropic-ai/sdk (optional peer dependency)
 */

import type { Tokenizer } from './index.js';

/**
 * Create Anthropic tokenizer using @anthropic-ai/sdk
 *
 * @param model - Anthropic model name (e.g., 'claude-3-opus', 'claude-3-sonnet')
 * @returns Tokenizer instance
 * @throws Error if @anthropic-ai/sdk is not installed
 *
 * @example
 * ```typescript
 * const tokenizer = await createAnthropicTokenizer('claude-3-opus');
 * const count = await tokenizer.count('Hello world');
 * console.log(`Tokens: ${count}`);
 * ```
 */
export async function createAnthropicTokenizer(model: string): Promise<Tokenizer> {
  // Dynamic import - throws if not installed
  const AnthropicModule = await import('@anthropic-ai/sdk');
  const Anthropic = AnthropicModule.default || AnthropicModule;

  // Create client (API key not required for token counting)
  const client = new (Anthropic as any)({
    apiKey: 'dummy-key-for-counting', // API key not needed for countTokens
  });

  // Map model names
  const modelMap: Record<string, string> = {
    'claude-3-opus': 'claude-3-opus-20240229',
    'claude-3-opus-20240229': 'claude-3-opus-20240229',
    'claude-3-sonnet': 'claude-3-sonnet-20240229',
    'claude-3-sonnet-20240229': 'claude-3-sonnet-20240229',
    'claude-3-haiku': 'claude-3-haiku-20240307',
    'claude-3-haiku-20240307': 'claude-3-haiku-20240307',
    'claude-3-5-sonnet': 'claude-3-5-sonnet-20240620',
    'claude-3-5-sonnet-20240620': 'claude-3-5-sonnet-20240620',
    'claude-3-5-sonnet-20241022': 'claude-3-5-sonnet-20241022',
  };

  const fullModel = modelMap[model] || model;

  return {
    count: async (text: string | string[]) => {
      const combined = Array.isArray(text) ? text.join('\n') : text;

      try {
        // Use Anthropic's beta.messages.countTokens API
        const result = await client.beta.messages.countTokens({
          model: fullModel,
          messages: [{ role: 'user', content: combined }],
        });

        return result.input_tokens || 0;
      } catch (error: any) {
        // If API call fails (e.g., no internet, invalid model), fall back to estimation
        if (error.message?.includes('Could not resolve')) {
          console.warn(`[LimitRate] Anthropic token counting failed (${error.message}), using fallback`);
          return Math.ceil(combined.length / 4);
        }
        throw error;
      }
    },
    model,
    isFallback: false,
  };
}
