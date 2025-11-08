/**
 * 429 response builder with human-readable messages
 */

import type { Response } from 'express';
import type { PlanName } from '@limitrate/core';
import type { BlockedResponse } from './types';

export interface ResponseOptions {
  reason: 'rate_limited' | 'cost_exceeded' | 'token_limit_exceeded' | 'ip_blocked';
  plan: PlanName;
  endpoint: string;
  used: number;
  allowed: number;
  retryAfterSeconds: number;
  upgradeHint?: string;
}

/**
 * Set standard rate limit headers
 */
export function setRateLimitHeaders(
  res: Response,
  limit: number,
  remaining: number,
  resetInSeconds: number,
  burstTokens?: number
): void {
  res.setHeader('RateLimit-Limit', limit.toString());
  res.setHeader('RateLimit-Remaining', Math.max(0, remaining).toString());
  res.setHeader('RateLimit-Reset', (Math.floor(Date.now() / 1000) + resetInSeconds).toString());

  // Add burst tokens header if burst is enabled
  if (burstTokens !== undefined) {
    res.setHeader('RateLimit-Burst-Remaining', burstTokens.toString());
  }
}

/**
 * Send 429 response with human-readable message
 */
export function send429Response(res: Response, options: ResponseOptions): void {
  const { reason, plan, endpoint, used, allowed, retryAfterSeconds, upgradeHint } = options;

  // Set Retry-After header
  res.setHeader('Retry-After', retryAfterSeconds.toString());

  // Set rate limit headers
  setRateLimitHeaders(res, allowed, 0, retryAfterSeconds);

  // Build human-readable message
  let message: string;

  if (reason === 'rate_limited') {
    const [method, path] = endpoint.split('|');
    message = `${capitalize(plan)} plan allows ${allowed} req/min on ${method} ${path}. You sent ${used}.`;
  } else if (reason === 'cost_exceeded') {
    const [method, path] = endpoint.split('|');
    message = `${capitalize(plan)} plan allows $${allowed.toFixed(2)}/day on ${method} ${path}. You've used $${used.toFixed(2)}.`;
  } else if (reason === 'token_limit_exceeded') {
    const [method, path] = endpoint.split('|');
    const formattedUsed = used.toLocaleString();
    const formattedAllowed = allowed.toLocaleString();
    message = `${capitalize(plan)} plan allows ${formattedAllowed} tokens/min on ${method} ${path}. You've used ${formattedUsed}. Please wait ${retryAfterSeconds} seconds.`;
  } else {
    message = 'Your IP address has been blocked.';
  }

  const body: BlockedResponse = {
    ok: false,
    reason,
    message,
    retry_after_seconds: retryAfterSeconds,
    used,
    allowed,
    plan,
    endpoint,
  };

  if (upgradeHint) {
    body.upgrade_hint = upgradeHint;
  }

  res.status(429).json(body);
}

/**
 * Send 403 response for blocked IPs
 */
export function send403Response(res: Response, ip: string): void {
  res.status(403).json({
    ok: false,
    reason: 'ip_blocked',
    message: `IP address ${ip} is blocked.`,
  });
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
