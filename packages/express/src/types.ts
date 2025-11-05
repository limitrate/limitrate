/**
 * Express-specific types for LimitRate
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { PolicyConfig, PlanName, StoreConfig } from '@limitrate/core';

export interface LimitRateOptions {
  /**
   * Function to identify the user from request
   * @example (req) => req.user?.id || req.ip
   */
  identifyUser: (req: Request) => string;

  /**
   * Function to identify the user's plan from request
   * @example (req) => req.user?.plan || 'free'
   */
  identifyPlan: (req: Request) => PlanName;

  /**
   * Store configuration
   */
  store: StoreConfig;

  /**
   * Policy configuration (plan -> endpoints -> rules)
   */
  policies: PolicyConfig;

  /**
   * Trust proxy headers (X-Forwarded-For)
   * @default false
   */
  trustProxy?: boolean;

  /**
   * IP addresses that always pass (skip all checks)
   */
  ipAllowlist?: string[];

  /**
   * IP addresses that are always blocked (403)
   */
  ipBlocklist?: string[];

  /**
   * Webhook URL for events (optional)
   */
  webhookUrl?: string;

  /**
   * Event handler (alternative to webhook)
   */
  onEvent?: (event: any) => void | Promise<void>;

  /**
   * Action when Redis fails
   * @default 'allow'
   */
  onRedisError?: 'allow' | 'block';

  /**
   * Custom upgrade hint for 429 responses
   * @example "Upgrade to Pro: https://yourapp.com/pricing"
   */
  upgradeHint?: string | ((plan: PlanName) => string);

  /**
   * Skip rate limiting for certain paths (health checks, etc.)
   */
  skip?: (req: Request) => boolean;
}

export interface BlockedResponse {
  ok: false;
  reason: 'rate_limited' | 'cost_exceeded' | 'ip_blocked';
  message: string;
  retry_after_seconds?: number;
  used: number;
  allowed: number;
  plan: PlanName;
  endpoint: string;
  upgrade_hint?: string;
}

export { Request, Response, NextFunction, RequestHandler };
