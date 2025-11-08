/**
 * OpenAI tokenizer integration using tiktoken
 * Requires: npm install tiktoken (optional peer dependency)
 */

import type { Tokenizer } from './index.js';
import { logger } from '../logger';

/**
 * Create OpenAI tokenizer using tiktoken
 *
 * @param model - OpenAI model name (e.g., 'gpt-4', 'gpt-3.5-turbo')
 * @returns Tokenizer instance
 * @throws Error if tiktoken is not installed
 *
 * @example
 * ```typescript
 * const tokenizer = await createOpenAITokenizer('gpt-4');
 * const count = await tokenizer.count('Hello world');
 * logger.info(`Tokens: ${count}`);
 * ```
 */
export async function createOpenAITokenizer(model: string): Promise<Tokenizer> {
  // Dynamic import - throws if not installed
  const tiktoken = await import('tiktoken');

  // Map model names to tiktoken model identifiers
  const modelMap: Record<string, string> = {
    'gpt-3.5-turbo': 'gpt-3.5-turbo',
    'gpt-3.5-turbo-0301': 'gpt-3.5-turbo-0301',
    'gpt-3.5-turbo-0613': 'gpt-3.5-turbo-0613',
    'gpt-3.5-turbo-1106': 'gpt-3.5-turbo-1106',
    'gpt-3.5-turbo-16k': 'gpt-3.5-turbo-16k',
    'gpt-4': 'gpt-4',
    'gpt-4-0314': 'gpt-4-0314',
    'gpt-4-0613': 'gpt-4-0613',
    'gpt-4-32k': 'gpt-4-32k',
    'gpt-4-turbo': 'gpt-4-turbo',
    'gpt-4-turbo-preview': 'gpt-4-turbo-preview',
    'gpt-4o': 'gpt-4o',
    'gpt-4o-mini': 'gpt-4o-mini',
  };

  // Get encoding model (fallback to gpt-3.5-turbo if unknown)
  const encodingModel = modelMap[model] || 'gpt-3.5-turbo';

  // Get encoding for model
  let encoding: any;
  try {
    encoding = tiktoken.encoding_for_model(encodingModel as any);
  } catch (error) {
    // If model not recognized, use cl100k_base (GPT-4 encoding)
    logger.warn(`[LimitRate] Unknown OpenAI model "${model}", using cl100k_base encoding`);
    encoding = tiktoken.get_encoding('cl100k_base');
  }

  return {
    count: async (text: string | string[]) => {
      const combined = Array.isArray(text) ? text.join('\n') : text;
      const tokens = encoding.encode(combined);
      return tokens.length;
    },
    model,
    isFallback: false,
  };
}
