/**
 * Pre-flight validation module (v1.6.0 - C3)
 * Validates AI prompts against model limits before consuming rate limits
 */

export {
  validatePrompt,
  formatValidationError,
  type ValidationResult,
  type ValidationOptions,
} from './validator.js';

export {
  getModelLimits,
  getSuggestedAlternatives,
  MODEL_LIMITS,
  type ModelLimits,
} from './model-limits.js';
