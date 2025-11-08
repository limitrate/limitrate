/**
 * Webhook integration with exponential backoff retry
 */

import type { LimitRateEvent } from '@limitrate/core';
import { logger } from '@limitrate/core';
import { sleep } from './utils/sleep';

export interface WebhookOptions {
  url: string;
  maxRetries?: number;
  timeouts?: number[]; // [1000, 4000, 16000] = 1s, 4s, 16s
}

/**
 * Fix #6: Circuit breaker for webhook retries to prevent retry amplification
 * If 5 consecutive webhooks fail with 5xx errors, stop sending for 60 seconds
 */
class WebhookCircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private readonly threshold = 5;
  private readonly timeout = 60000; // 60 seconds

  recordFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
  }

  recordSuccess(): void {
    this.failures = 0;
  }

  isOpen(): boolean {
    if (this.failures < this.threshold) return false;
    if (Date.now() - this.lastFailure > this.timeout) {
      this.failures = 0; // Reset after timeout
      return false;
    }
    return true;
  }
}

// Global circuit breaker instance per URL
const circuitBreakers = new Map<string, WebhookCircuitBreaker>();

function getCircuitBreaker(url: string): WebhookCircuitBreaker {
  let breaker = circuitBreakers.get(url);
  if (!breaker) {
    breaker = new WebhookCircuitBreaker();
    circuitBreakers.set(url, breaker);
  }
  return breaker;
}

/**
 * Validate webhook URL at startup (SSRF protection)
 * Throws error if URL is invalid or targets blocked networks
 */
export function validateWebhookUrl(url: string): void {
  // Parse URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    throw new Error(`Invalid webhook URL: ${url} - ${(error as Error).message}`);
  }

  // Must be HTTP/HTTPS
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`Invalid webhook protocol: ${parsedUrl.protocol}. Must be http: or https:`);
  }

  // SSRF Protection: Block internal/private networks and cloud metadata
  const hostname = parsedUrl.hostname.toLowerCase();
  const blockedPatterns = [
    /^localhost$/i,
    /^127\./,                              // 127.0.0.0/8 (loopback)
    /^10\./,                               // 10.0.0.0/8 (private)
    /^172\.(1[6-9]|2[0-9]|3[01])\./,      // 172.16.0.0/12 (private)
    /^192\.168\./,                         // 192.168.0.0/16 (private)
    /^169\.254\./,                         // 169.254.0.0/16 (link-local, AWS metadata)
    /^\[::1\]$/,                           // IPv6 loopback (with brackets)
    /^\[.*::1\]$/,                         // IPv6 loopback variations
    /^\[fe80:/i,                           // IPv6 link-local (with brackets)
    /^\[fc00:/i,                           // IPv6 unique local (with brackets)
    /^\[fd00:/i,                           // IPv6 unique local (with brackets)
  ];

  if (blockedPatterns.some((pattern) => pattern.test(hostname))) {
    throw new Error(`Webhook URL targets blocked network: ${hostname} (SSRF protection)`);
  }

  // Additional check for numeric IP that might be encoded differently
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const parts = hostname.split('.').map(Number);
    if (
      parts[0] === 127 ||                  // 127.x.x.x
      parts[0] === 10 ||                   // 10.x.x.x
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || // 172.16-31.x.x
      (parts[0] === 192 && parts[1] === 168) || // 192.168.x.x
      (parts[0] === 169 && parts[1] === 254)    // 169.254.x.x (AWS metadata)
    ) {
      throw new Error(`Webhook URL targets internal/private IP: ${hostname} (SSRF protection)`);
    }
  }
}

/**
 * Send event to webhook with retry logic
 *
 * Improvements (v3.0.2):
 * - Validates URL format before sending
 * - Blocks internal/private IPs and cloud metadata endpoints (SSRF protection)
 * - Only retries on 5xx errors and network failures
 * - Skips retry on 4xx client errors (permanent failures)
 * - Uses AbortController for broader Node.js compatibility (14+)
 * - Increases timeout progressively on retries
 */
export async function sendToWebhook(event: LimitRateEvent, options: WebhookOptions): Promise<void> {
  const { url, maxRetries = 3, timeouts = [1000, 4000, 16000] } = options;

  // Fix #6: Check circuit breaker before attempting to send
  const circuitBreaker = getCircuitBreaker(url);
  if (circuitBreaker.isOpen()) {
    logger.warn('[LimitRate] Webhook circuit breaker OPEN - skipping webhook send to prevent retry amplification');
    return;
  }

  // Validate URL format and check for SSRF
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    logger.error('[LimitRate] Invalid webhook URL:', url);
    return; // Don't attempt to send to invalid URL
  }

  // SSRF Protection: Block internal/private networks and cloud metadata
  const hostname = parsedUrl.hostname.toLowerCase();
  const blockedPatterns = [
    /^localhost$/i,
    /^127\./,                              // 127.0.0.0/8 (loopback)
    /^10\./,                               // 10.0.0.0/8 (private)
    /^172\.(1[6-9]|2[0-9]|3[01])\./,      // 172.16.0.0/12 (private)
    /^192\.168\./,                         // 192.168.0.0/16 (private)
    /^169\.254\./,                         // 169.254.0.0/16 (link-local, AWS metadata)
    /^::1$/,                               // IPv6 loopback
    /^fe80:/i,                             // IPv6 link-local
    /^fc00:/i,                             // IPv6 unique local
    /^fd00:/i,                             // IPv6 unique local
  ];

  if (blockedPatterns.some((pattern) => pattern.test(hostname))) {
    logger.error('[LimitRate] Webhook URL targets internal/private network (SSRF blocked):', hostname);
    return;
  }

  // Additional check for numeric IP that might be encoded differently
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const parts = hostname.split('.').map(Number);
    if (
      parts[0] === 127 ||                  // 127.x.x.x
      parts[0] === 10 ||                   // 10.x.x.x
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || // 172.16-31.x.x
      (parts[0] === 192 && parts[1] === 168) || // 192.168.x.x
      (parts[0] === 169 && parts[1] === 254)    // 169.254.x.x (AWS metadata)
    ) {
      logger.error('[LimitRate] Webhook URL targets internal/private IP (SSRF blocked):', hostname);
      return;
    }
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Create AbortController for timeout (works in Node.js 14+)
      // Progressive timeout: 5s, 10s, 15s for subsequent retries
      const timeoutMs = 5000 + (attempt * 5000);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'LimitRate/3.0.2',
          },
          body: JSON.stringify(event),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          // Fix #6: Record success in circuit breaker
          circuitBreaker.recordSuccess();
          return; // Success!
        }

        // 4xx errors are client errors - don't retry (permanent failure)
        if (response.status >= 400 && response.status < 500) {
          logger.error(`[LimitRate] Webhook returned client error ${response.status}: ${response.statusText} - not retrying`);
          circuitBreaker.recordSuccess(); // Don't count 4xx as circuit breaker failures
          return;
        }

        // Fix #6: 5xx errors are server errors - record failure and retry
        circuitBreaker.recordFailure();
        lastError = new Error(`Webhook returned ${response.status}: ${response.statusText}`);
      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError; // Re-throw to be handled by outer catch
      }
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));

      // Fix #6: Record failure in circuit breaker for network errors
      circuitBreaker.recordFailure();

      // Check if it's a timeout error
      const isTimeout = errorObj.name === 'AbortError' || errorObj.message.includes('aborted');

      if (isTimeout) {
        lastError = new Error(`Webhook timeout after ${5000 + (attempt * 5000)}ms`);
      } else {
        lastError = errorObj;
      }
    }

    // If not last attempt, wait before retrying
    if (attempt < maxRetries - 1) {
      const delay = timeouts[attempt] || timeouts[timeouts.length - 1];
      await sleep(delay);
    }
  }

  // All retries failed, log error
  logger.error(`[LimitRate] Webhook failed after ${maxRetries} attempts:`, lastError);
}
