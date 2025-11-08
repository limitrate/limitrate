/**
 * Job Scheduler Types (v2.1.0 - D6)
 * Schedule rate-limited jobs for future execution
 */

import type { PlanName } from '../types';

/**
 * Job status
 */
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Scheduled job
 */
export interface ScheduledJob<T = any> {
  /** Unique job identifier */
  id: string;
  /** Timestamp when job should execute (Unix milliseconds) */
  executeAt: number;
  /** Endpoint this job belongs to (for rate limiting) */
  endpoint: string;
  /** User identifier */
  user: string;
  /** User's plan */
  plan: PlanName;
  /** Job data payload */
  data: T;
  /** Current job status */
  status: JobStatus;
  /** Number of retry attempts */
  retries?: number;
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** Created timestamp */
  createdAt: number;
  /** Last updated timestamp */
  updatedAt: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Job processor function
 */
export type JobProcessor<T = any> = (job: ScheduledJob<T>) => Promise<void>;

/**
 * Scheduler options
 */
export interface SchedulerOptions {
  /** Poll interval in milliseconds (default: 1000) */
  pollInterval?: number;
  /** Maximum concurrent jobs (default: 10) */
  maxConcurrency?: number;
  /** Job TTL in seconds after completion (default: 86400 = 24h) */
  completedJobTTL?: number;
}
