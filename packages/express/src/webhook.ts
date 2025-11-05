/**
 * Webhook integration with exponential backoff retry
 */

import type { LimitRateEvent } from '@limitrate/core';

export interface WebhookOptions {
  url: string;
  maxRetries?: number;
  timeouts?: number[]; // [1000, 4000, 16000] = 1s, 4s, 16s
}

/**
 * Send event to webhook with retry logic
 */
export async function sendToWebhook(event: LimitRateEvent, options: WebhookOptions): Promise<void> {
  const { url, maxRetries = 3, timeouts = [1000, 4000, 16000] } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'LimitRate/1.0.0',
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(5000), // 5s timeout
      });

      if (response.ok) {
        return; // Success!
      }

      lastError = new Error(`Webhook returned ${response.status}: ${response.statusText}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    // If not last attempt, wait before retrying
    if (attempt < maxRetries - 1) {
      const delay = timeouts[attempt] || timeouts[timeouts.length - 1];
      await sleep(delay);
    }
  }

  // All retries failed, log error
  console.error(`[LimitRate] Webhook failed after ${maxRetries} attempts:`, lastError);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
