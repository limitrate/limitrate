/**
 * Model limits database for AI models
 * Contains context window and output limits for popular models
 */

export interface ModelLimits {
  /**
   * Maximum input context window in tokens
   */
  maxInputTokens: number;

  /**
   * Maximum output tokens
   */
  maxOutputTokens: number;

  /**
   * Model provider (for grouping and suggestions)
   */
  provider: 'openai' | 'anthropic' | 'google' | 'mistral' | 'other';

  /**
   * Model display name
   */
  displayName: string;
}

/**
 * Built-in model limits database
 * Updated as of November 2025
 */
export const MODEL_LIMITS: Record<string, ModelLimits> = {
  // OpenAI Models
  'gpt-3.5-turbo': {
    maxInputTokens: 16385,
    maxOutputTokens: 4096,
    provider: 'openai',
    displayName: 'GPT-3.5 Turbo',
  },
  'gpt-3.5-turbo-16k': {
    maxInputTokens: 16385,
    maxOutputTokens: 4096,
    provider: 'openai',
    displayName: 'GPT-3.5 Turbo 16K',
  },
  'gpt-4': {
    maxInputTokens: 8192,
    maxOutputTokens: 8192,
    provider: 'openai',
    displayName: 'GPT-4',
  },
  'gpt-4-32k': {
    maxInputTokens: 32768,
    maxOutputTokens: 32768,
    provider: 'openai',
    displayName: 'GPT-4 32K',
  },
  'gpt-4-turbo': {
    maxInputTokens: 128000,
    maxOutputTokens: 4096,
    provider: 'openai',
    displayName: 'GPT-4 Turbo',
  },
  'gpt-4-turbo-preview': {
    maxInputTokens: 128000,
    maxOutputTokens: 4096,
    provider: 'openai',
    displayName: 'GPT-4 Turbo Preview',
  },
  'gpt-4o': {
    maxInputTokens: 128000,
    maxOutputTokens: 16384,
    provider: 'openai',
    displayName: 'GPT-4o',
  },
  'gpt-4o-mini': {
    maxInputTokens: 128000,
    maxOutputTokens: 16384,
    provider: 'openai',
    displayName: 'GPT-4o Mini',
  },

  // Anthropic Claude Models
  'claude-3-opus': {
    maxInputTokens: 200000,
    maxOutputTokens: 4096,
    provider: 'anthropic',
    displayName: 'Claude 3 Opus',
  },
  'claude-3-opus-20240229': {
    maxInputTokens: 200000,
    maxOutputTokens: 4096,
    provider: 'anthropic',
    displayName: 'Claude 3 Opus',
  },
  'claude-3-sonnet': {
    maxInputTokens: 200000,
    maxOutputTokens: 4096,
    provider: 'anthropic',
    displayName: 'Claude 3 Sonnet',
  },
  'claude-3-sonnet-20240229': {
    maxInputTokens: 200000,
    maxOutputTokens: 4096,
    provider: 'anthropic',
    displayName: 'Claude 3 Sonnet',
  },
  'claude-3-haiku': {
    maxInputTokens: 200000,
    maxOutputTokens: 4096,
    provider: 'anthropic',
    displayName: 'Claude 3 Haiku',
  },
  'claude-3-haiku-20240307': {
    maxInputTokens: 200000,
    maxOutputTokens: 4096,
    provider: 'anthropic',
    displayName: 'Claude 3 Haiku',
  },
  'claude-3-5-sonnet': {
    maxInputTokens: 200000,
    maxOutputTokens: 8192,
    provider: 'anthropic',
    displayName: 'Claude 3.5 Sonnet',
  },
  'claude-3-5-sonnet-20240620': {
    maxInputTokens: 200000,
    maxOutputTokens: 8192,
    provider: 'anthropic',
    displayName: 'Claude 3.5 Sonnet',
  },
  'claude-3-5-sonnet-20241022': {
    maxInputTokens: 200000,
    maxOutputTokens: 8192,
    provider: 'anthropic',
    displayName: 'Claude 3.5 Sonnet',
  },

  // Google Gemini Models
  'gemini-pro': {
    maxInputTokens: 32760,
    maxOutputTokens: 8192,
    provider: 'google',
    displayName: 'Gemini Pro',
  },
  'gemini-1.5-pro': {
    maxInputTokens: 1000000,
    maxOutputTokens: 8192,
    provider: 'google',
    displayName: 'Gemini 1.5 Pro',
  },
  'gemini-1.5-flash': {
    maxInputTokens: 1000000,
    maxOutputTokens: 8192,
    provider: 'google',
    displayName: 'Gemini 1.5 Flash',
  },

  // Mistral Models
  'mistral-small': {
    maxInputTokens: 32000,
    maxOutputTokens: 8192,
    provider: 'mistral',
    displayName: 'Mistral Small',
  },
  'mistral-medium': {
    maxInputTokens: 32000,
    maxOutputTokens: 8192,
    provider: 'mistral',
    displayName: 'Mistral Medium',
  },
  'mistral-large': {
    maxInputTokens: 32000,
    maxOutputTokens: 8192,
    provider: 'mistral',
    displayName: 'Mistral Large',
  },
};

/**
 * Get model limits for a specific model
 * Returns undefined if model is not in the database
 */
export function getModelLimits(model: string): ModelLimits | undefined {
  return MODEL_LIMITS[model.toLowerCase()];
}

/**
 * Get suggested alternative models with larger context windows
 * Used for helpful error messages
 */
export function getSuggestedAlternatives(
  currentModel: string,
  requiredTokens: number
): string[] {
  const current = getModelLimits(currentModel);
  if (!current) return [];

  const alternatives: string[] = [];

  // Find models from same provider with larger limits
  for (const [modelName, limits] of Object.entries(MODEL_LIMITS)) {
    if (
      limits.provider === current.provider &&
      limits.maxInputTokens > current.maxInputTokens &&
      limits.maxInputTokens >= requiredTokens
    ) {
      alternatives.push(modelName);
    }
  }

  // If no alternatives from same provider, suggest from other providers
  if (alternatives.length === 0) {
    for (const [modelName, limits] of Object.entries(MODEL_LIMITS)) {
      if (limits.maxInputTokens >= requiredTokens) {
        alternatives.push(modelName);
      }
    }
  }

  // Return top 3 alternatives
  return alternatives.slice(0, 3);
}
