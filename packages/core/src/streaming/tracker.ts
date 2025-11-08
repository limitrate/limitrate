/**
 * Streaming response token tracker (v1.7.0 - C4)
 * Manual tracking API for streaming responses
 */

/**
 * Streaming tracker for manual token tracking
 * Simple accumulator for tracking tokens during streaming
 */
export class StreamingTracker {
  private accumulatedTokens: number = 0;

  /**
   * Track tokens from a streaming chunk
   * Call this for each chunk received from the streaming API
   *
   * @param tokens Number of tokens in this chunk
   * @returns Current accumulated token count
   *
   * @example
   * ```typescript
   * const tracker = new StreamingTracker();
   *
   * for await (const chunk of stream) {
   *   const tokens = countTokensInChunk(chunk);
   *   tracker.trackChunk(tokens);
   * }
   *
   * const total = tracker.getTotalTokens();
   * ```
   */
  trackChunk(tokens: number): number {
    if (tokens <= 0 || !isFinite(tokens)) {
      return this.accumulatedTokens;
    }

    this.accumulatedTokens += tokens;
    return this.accumulatedTokens;
  }

  /**
   * Get total accumulated tokens so far
   */
  getTotalTokens(): number {
    return this.accumulatedTokens;
  }

  /**
   * Reset the accumulated token count
   * Useful if you want to reuse the tracker
   */
  reset(): void {
    this.accumulatedTokens = 0;
  }
}

/**
 * Parse OpenAI streaming chunk for token usage
 * OpenAI streams usage info in the final chunk
 *
 * @example
 * ```typescript
 * for await (const chunk of stream) {
 *   const tokens = parseOpenAIChunk(chunk);
 *   if (tokens) {
 *     await tracker.trackChunk(tokens);
 *   }
 * }
 * ```
 */
export function parseOpenAIChunk(chunk: string): number | null {
  try {
    // OpenAI sends "data: " prefix for SSE
    const data = chunk.replace(/^data: /, '').trim();

    if (data === '[DONE]') {
      return null;
    }

    const parsed = JSON.parse(data);

    // Usage is in the final chunk
    if (parsed.usage) {
      return parsed.usage.total_tokens || 0;
    }

    // For streaming, we can estimate from delta
    if (parsed.choices?.[0]?.delta?.content) {
      // Rough estimate: 4 chars per token
      return Math.ceil(parsed.choices[0].delta.content.length / 4);
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Parse Anthropic streaming chunk for token usage
 * Anthropic sends usage info in specific message types
 *
 * @example
 * ```typescript
 * for await (const chunk of stream) {
 *   const tokens = parseAnthropicChunk(chunk);
 *   if (tokens) {
 *     await tracker.trackChunk(tokens);
 *   }
 * }
 * ```
 */
export function parseAnthropicChunk(chunk: string): number | null {
  try {
    // Anthropic sends "event: " and "data: " for SSE
    const lines = chunk.split('\n');
    let eventType = '';
    let data = '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.replace('event: ', '').trim();
      } else if (line.startsWith('data: ')) {
        data = line.replace('data: ', '').trim();
      }
    }

    if (!data) return null;

    const parsed = JSON.parse(data);

    // Usage info comes in message_start or message_delta events
    if (eventType === 'message_start' && parsed.message?.usage) {
      return parsed.message.usage.input_tokens || 0;
    }

    if (eventType === 'message_delta' && parsed.usage) {
      return parsed.usage.output_tokens || 0;
    }

    // For content chunks, estimate from text
    if (eventType === 'content_block_delta' && parsed.delta?.text) {
      // Rough estimate: 4 chars per token
      return Math.ceil(parsed.delta.text.length / 4);
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Helper to count tokens in any text (fallback)
 * Uses simple length/4 approximation
 *
 * @example
 * ```typescript
 * const tokens = estimateTokens(chunkText);
 * await tracker.trackChunk(tokens);
 * ```
 */
export function estimateTokens(text: string): number {
  if (!text || typeof text !== 'string') {
    return 0;
  }
  return Math.ceil(text.length / 4);
}
