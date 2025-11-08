/**
 * Pre-flight validation for AI prompts
 * Validates token counts against model limits BEFORE consuming rate limits
 */

import { getModelLimits, getSuggestedAlternatives, ModelLimits } from './model-limits.js';
import type { Tokenizer } from '../tokenizers/index.js';

/**
 * Validation result
 */
export interface ValidationResult {
  /**
   * Whether the prompt is valid (within limits)
   */
  valid: boolean;

  /**
   * Reason for failure (if invalid)
   */
  reason?: string;

  /**
   * Detected input token count
   */
  inputTokens: number;

  /**
   * Maximum allowed input tokens for this model
   */
  maxInputTokens?: number;

  /**
   * Requested output tokens (if provided)
   */
  outputTokens?: number;

  /**
   * Maximum allowed output tokens for this model
   */
  maxOutputTokens?: number;

  /**
   * Total tokens (input + output)
   */
  totalTokens: number;

  /**
   * Suggested alternative models (if validation failed)
   */
  suggestedModels?: string[];

  /**
   * Model display name
   */
  modelDisplayName?: string;
}

/**
 * Validation options
 */
export interface ValidationOptions {
  /**
   * Model name (e.g., 'gpt-4', 'claude-3-opus')
   */
  model: string;

  /**
   * Tokenizer to use for counting tokens
   */
  tokenizer: Tokenizer;

  /**
   * Prompt text or array of messages
   */
  prompt: string | string[];

  /**
   * Requested output tokens (optional)
   * If provided, total tokens will be validated
   */
  maxOutputTokens?: number;

  /**
   * Custom model limits (overrides built-in database)
   * Useful for new models or fine-tuned models
   */
  customLimits?: Partial<ModelLimits>;
}

/**
 * Validate a prompt against model limits
 *
 * @example
 * ```typescript
 * const tokenizer = await createTokenizer('gpt-4');
 * const result = await validatePrompt({
 *   model: 'gpt-4',
 *   tokenizer,
 *   prompt: 'Hello world',
 *   maxOutputTokens: 1000
 * });
 *
 * if (!result.valid) {
 *   throw new Error(result.reason);
 * }
 * ```
 */
export async function validatePrompt(options: ValidationOptions): Promise<ValidationResult> {
  const { model, tokenizer, prompt, maxOutputTokens = 0, customLimits } = options;

  // Get model limits (custom or from database)
  let limits: ModelLimits | undefined;

  if (customLimits) {
    // User provided custom limits
    const builtInLimits = getModelLimits(model);
    limits = {
      maxInputTokens: customLimits.maxInputTokens ?? builtInLimits?.maxInputTokens ?? Infinity,
      maxOutputTokens: customLimits.maxOutputTokens ?? builtInLimits?.maxOutputTokens ?? Infinity,
      provider: customLimits.provider ?? builtInLimits?.provider ?? 'other',
      displayName: customLimits.displayName ?? builtInLimits?.displayName ?? model,
    };
  } else {
    limits = getModelLimits(model);
  }

  // Count input tokens
  const inputTokens = await tokenizer.count(prompt);

  // If no limits found and no custom limits, pass validation
  if (!limits) {
    return {
      valid: true,
      inputTokens,
      outputTokens: maxOutputTokens,
      totalTokens: inputTokens + maxOutputTokens,
    };
  }

  // Check input token limit
  if (inputTokens > limits.maxInputTokens) {
    const suggestedModels = getSuggestedAlternatives(model, inputTokens);

    return {
      valid: false,
      reason: `Input exceeds model limit: ${inputTokens.toLocaleString()} tokens > ${limits.maxInputTokens.toLocaleString()} max for ${limits.displayName}`,
      inputTokens,
      maxInputTokens: limits.maxInputTokens,
      outputTokens: maxOutputTokens,
      maxOutputTokens: limits.maxOutputTokens,
      totalTokens: inputTokens + maxOutputTokens,
      suggestedModels,
      modelDisplayName: limits.displayName,
    };
  }

  // Check output token limit
  if (maxOutputTokens > limits.maxOutputTokens) {
    return {
      valid: false,
      reason: `Requested output exceeds model limit: ${maxOutputTokens.toLocaleString()} tokens > ${limits.maxOutputTokens.toLocaleString()} max for ${limits.displayName}`,
      inputTokens,
      maxInputTokens: limits.maxInputTokens,
      outputTokens: maxOutputTokens,
      maxOutputTokens: limits.maxOutputTokens,
      totalTokens: inputTokens + maxOutputTokens,
      modelDisplayName: limits.displayName,
    };
  }

  // Check total context window (input + output)
  const totalTokens = inputTokens + maxOutputTokens;
  const maxTotalTokens = limits.maxInputTokens; // Context window is typically the input limit

  if (totalTokens > maxTotalTokens) {
    const suggestedModels = getSuggestedAlternatives(model, totalTokens);

    return {
      valid: false,
      reason: `Total tokens exceed model context window: ${totalTokens.toLocaleString()} tokens (${inputTokens.toLocaleString()} input + ${maxOutputTokens.toLocaleString()} output) > ${maxTotalTokens.toLocaleString()} max for ${limits.displayName}`,
      inputTokens,
      maxInputTokens: limits.maxInputTokens,
      outputTokens: maxOutputTokens,
      maxOutputTokens: limits.maxOutputTokens,
      totalTokens,
      suggestedModels,
      modelDisplayName: limits.displayName,
    };
  }

  // Validation passed
  return {
    valid: true,
    inputTokens,
    maxInputTokens: limits.maxInputTokens,
    outputTokens: maxOutputTokens,
    maxOutputTokens: limits.maxOutputTokens,
    totalTokens,
    modelDisplayName: limits.displayName,
  };
}

/**
 * Format a validation error message for user display
 *
 * @example
 * ```typescript
 * const result = await validatePrompt(options);
 * if (!result.valid) {
 *   console.error(formatValidationError(result));
 * }
 * ```
 */
export function formatValidationError(result: ValidationResult): string {
  if (result.valid) {
    return '';
  }

  let message = `❌ Validation Failed: ${result.reason}\n\n`;

  message += `📊 Token Breakdown:\n`;
  message += `   Input:  ${result.inputTokens.toLocaleString()} tokens`;
  if (result.maxInputTokens) {
    message += ` (max: ${result.maxInputTokens.toLocaleString()})`;
  }
  message += `\n`;

  if (result.outputTokens) {
    message += `   Output: ${result.outputTokens.toLocaleString()} tokens`;
    if (result.maxOutputTokens) {
      message += ` (max: ${result.maxOutputTokens.toLocaleString()})`;
    }
    message += `\n`;
    message += `   Total:  ${result.totalTokens.toLocaleString()} tokens\n`;
  }

  if (result.suggestedModels && result.suggestedModels.length > 0) {
    message += `\n💡 Suggested Alternatives:\n`;
    for (const suggested of result.suggestedModels) {
      message += `   • ${suggested}\n`;
    }
  }

  return message;
}
