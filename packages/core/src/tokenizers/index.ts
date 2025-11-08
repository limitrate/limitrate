/**
 * Tokenizer utilities for accurate token counting
 * Supports OpenAI (tiktoken) and Anthropic tokenizers as optional dependencies
 */

export interface Tokenizer {
  /**
   * Count tokens in text or array of texts
   */
  count(text: string | string[]): Promise<number>;

  /**
   * Model name
   */
  model: string;

  /**
   * Whether this is a fallback tokenizer (length/4 approximation)
   */
  isFallback: boolean;
}

export type TokenizerFunction = (text: string | string[]) => Promise<number> | number;

/**
 * Cache for tokenizer instances to avoid re-initialization
 */
const tokenizerCache = new Map<string, Tokenizer>();

/**
 * Create a tokenizer for the specified model
 *
 * Supports:
 * - OpenAI models: gpt-3.5-turbo, gpt-4, gpt-4-turbo, gpt-4o, gpt-4o-mini (requires tiktoken)
 * - Anthropic models: claude-3-opus, claude-3-sonnet, claude-3-haiku (requires @anthropic-ai/sdk)
 * - Custom function
 * - Fallback (length/4 approximation) if dependencies not installed
 *
 * @param modelOrFunction - Model name string or custom tokenizer function
 * @param options - Options for tokenizer creation
 * @returns Tokenizer instance
 *
 * @example
 * ```typescript
 * // Using OpenAI model (requires: npm install tiktoken)
 * const tokenizer = await createTokenizer('gpt-4');
 * const count = await tokenizer.count('Hello world');
 *
 * // Using Anthropic model (requires: npm install @anthropic-ai/sdk)
 * const tokenizer = await createTokenizer('claude-3-opus');
 *
 * // Using custom function
 * const tokenizer = await createTokenizer((text) => {
 *   // Your custom counting logic
 *   return text.length / 3.5;
 * });
 * ```
 */
export async function createTokenizer(
  modelOrFunction: string | TokenizerFunction,
  options: { warnOnFallback?: boolean } = {}
): Promise<Tokenizer> {
  const { warnOnFallback = true } = options;

  // If function provided, wrap it
  if (typeof modelOrFunction === 'function') {
    return {
      count: (text) => Promise.resolve(modelOrFunction(text)),
      model: 'custom',
      isFallback: false,
    };
  }

  const model = modelOrFunction.toLowerCase();

  // Check cache
  if (tokenizerCache.has(model)) {
    return tokenizerCache.get(model)!;
  }

  let tokenizer: Tokenizer;

  // Try OpenAI models
  if (model.startsWith('gpt-')) {
    try {
      const { createOpenAITokenizer } = await import('./openai.js');
      tokenizer = await createOpenAITokenizer(model);
      tokenizerCache.set(model, tokenizer);
      return tokenizer;
    } catch (error) {
      if (warnOnFallback) {
        console.warn(
          `[LimitRate] tiktoken not available for ${model}, using fallback tokenizer (length/4). ` +
            `Install with: npm install tiktoken`
        );
      }
      tokenizer = createFallbackTokenizer(model);
      tokenizerCache.set(model, tokenizer);
      return tokenizer;
    }
  }

  // Try Anthropic models
  if (model.startsWith('claude-')) {
    try {
      const { createAnthropicTokenizer } = await import('./anthropic.js');
      tokenizer = await createAnthropicTokenizer(model);
      tokenizerCache.set(model, tokenizer);
      return tokenizer;
    } catch (error) {
      if (warnOnFallback) {
        console.warn(
          `[LimitRate] @anthropic-ai/sdk not available for ${model}, using fallback tokenizer (length/4). ` +
            `Install with: npm install @anthropic-ai/sdk`
        );
      }
      tokenizer = createFallbackTokenizer(model);
      tokenizerCache.set(model, tokenizer);
      return tokenizer;
    }
  }

  // Unknown model - use fallback
  if (warnOnFallback) {
    console.warn(`[LimitRate] Unknown model "${model}", using fallback tokenizer (length/4)`);
  }
  tokenizer = createFallbackTokenizer(model);
  tokenizerCache.set(model, tokenizer);
  return tokenizer;
}

/**
 * Create a fallback tokenizer that approximates tokens as length/4
 * This is the default when official tokenizers are not available
 *
 * @param model - Model name for identification
 * @returns Fallback tokenizer instance
 */
function createFallbackTokenizer(model: string): Tokenizer {
  return {
    count: async (text: string | string[]) => {
      const combined = Array.isArray(text) ? text.join(' ') : text;
      return Math.ceil(combined.length / 4);
    },
    model,
    isFallback: true,
  };
}

/**
 * Clear the tokenizer cache
 * Useful for testing or if you need to reinitialize tokenizers
 */
export function clearTokenizerCache(): void {
  tokenizerCache.clear();
}
