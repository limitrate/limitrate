/**
 * Job Scheduler (v2.1.0 - D6)
 * Schedule rate-limited jobs for future execution
 */

import type { Store } from '../types';
import type { ScheduledJob, JobProcessor, SchedulerOptions } from './types';

export class JobScheduler {
  private store: Store;
  private options: Required<SchedulerOptions>;
  private processor: JobProcessor | null = null;
  private running = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private runningJobs = new Set<string>();

  constructor(store: Store, options: SchedulerOptions = {}) {
    this.store = store;
    this.options = {
      pollInterval: options.pollInterval ?? 1000,
      maxConcurrency: options.maxConcurrency ?? 10,
      completedJobTTL: options.completedJobTTL ?? 86400, // 24 hours
    };
  }

  /**
   * Schedule a job for future execution
   */
  async schedule<T = any>(job: Omit<ScheduledJob<T>, 'status' | 'createdAt' | 'updatedAt'>): Promise<void> {
    const now = Date.now();
    const fullJob: ScheduledJob<T> = {
      ...job,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      retries: job.retries ?? 0,
      maxRetries: job.maxRetries ?? 3,
    };

    const key = `scheduler:job:${job.id}`;
    await this.store.set(key, fullJob);

    // Add to sorted set by executeAt time for efficient polling
    await this.addToQueue(job.id, job.executeAt);
  }

  /**
   * Get a job by ID
   */
  async getJob<T = any>(jobId: string): Promise<ScheduledJob<T> | null> {
    const key = `scheduler:job:${jobId}`;
    return await this.store.get<ScheduledJob<T>>(key);
  }

  /**
   * Cancel a scheduled job
   */
  async cancel(jobId: string): Promise<boolean> {
    const job = await this.getJob(jobId);
    if (!job || job.status === 'completed' || job.status === 'cancelled') {
      return false;
    }

    job.status = 'cancelled';
    job.updatedAt = Date.now();

    const key = `scheduler:job:${jobId}`;
    await this.store.set(key, job, this.options.completedJobTTL);
    await this.removeFromQueue(jobId);

    return true;
  }

  /**
   * Register a job processor and start processing
   */
  process(processor: JobProcessor): void {
    this.processor = processor;
    this.start();
  }

  /**
   * Start processing scheduled jobs
   */
  start(): void {
    if (this.running) return;
    if (!this.processor) {
      throw new Error('Job processor not registered. Call process() first.');
    }

    this.running = true;
    this.poll();
  }

  /**
   * Stop processing scheduled jobs
   */
  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Poll for jobs ready to execute
   */
  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      await this.processReadyJobs();
    } catch (error) {
      console.error('[JobScheduler] Poll error:', error);
    }

    // Schedule next poll
    this.pollTimer = setTimeout(() => this.poll(), this.options.pollInterval);
  }

  /**
   * Process jobs that are ready to execute
   */
  private async processReadyJobs(): Promise<void> {
    // Check if we have capacity
    if (this.runningJobs.size >= this.options.maxConcurrency) {
      return;
    }

    const now = Date.now();
    const readyJobIds = await this.getReadyJobs(now, this.options.maxConcurrency - this.runningJobs.size);

    for (const jobId of readyJobIds) {
      if (this.runningJobs.size >= this.options.maxConcurrency) break;

      const job = await this.getJob(jobId);
      if (!job || job.status !== 'pending') continue;

      // Mark as running
      this.runningJobs.add(jobId);
      this.executeJob(job).finally(() => {
        this.runningJobs.delete(jobId);
      });
    }
  }

  /**
   * Execute a single job
   */
  private async executeJob(job: ScheduledJob): Promise<void> {
    const jobKey = `scheduler:job:${job.id}`;

    try {
      // Update status to running
      job.status = 'running';
      job.updatedAt = Date.now();
      await this.store.set(jobKey, job);

      // Execute the job
      if (this.processor) {
        await this.processor(job);
      }

      // Mark as completed
      job.status = 'completed';
      job.updatedAt = Date.now();
      await this.store.set(jobKey, job, this.options.completedJobTTL);
      await this.removeFromQueue(job.id);

    } catch (error) {
      // Handle failure with retry logic
      const errorMessage = error instanceof Error ? error.message : String(error);
      job.retries = (job.retries ?? 0) + 1;
      job.error = errorMessage;
      job.updatedAt = Date.now();

      if (job.retries < (job.maxRetries ?? 3)) {
        // Retry: reset to pending and reschedule
        job.status = 'pending';
        const retryDelay = Math.pow(2, job.retries) * 1000; // Exponential backoff
        job.executeAt = Date.now() + retryDelay;
        await this.store.set(jobKey, job);
        await this.addToQueue(job.id, job.executeAt);
      } else {
        // Max retries reached: mark as failed
        job.status = 'failed';
        await this.store.set(jobKey, job, this.options.completedJobTTL);
        await this.removeFromQueue(job.id);
      }
    }
  }

  /**
   * Add job to execution queue (sorted by executeAt time)
   */
  private async addToQueue(jobId: string, executeAt: number): Promise<void> {
    const queueKey = 'scheduler:queue';
    const queue = await this.store.get<Record<string, number>>(queueKey) || {};
    queue[jobId] = executeAt;
    await this.store.set(queueKey, queue);
  }

  /**
   * Remove job from execution queue
   */
  private async removeFromQueue(jobId: string): Promise<void> {
    const queueKey = 'scheduler:queue';
    const queue = await this.store.get<Record<string, number>>(queueKey);
    if (queue && queue[jobId]) {
      delete queue[jobId];
      await this.store.set(queueKey, queue);
    }
  }

  /**
   * Get jobs ready to execute
   */
  private async getReadyJobs(now: number, limit: number): Promise<string[]> {
    const queueKey = 'scheduler:queue';
    const queue = await this.store.get<Record<string, number>>(queueKey) || {};

    // Filter and sort by executeAt time
    const readyJobs = Object.entries(queue)
      .filter(([_, executeAt]) => executeAt <= now)
      .sort(([, a], [, b]) => a - b)
      .slice(0, limit)
      .map(([jobId]) => jobId);

    return readyJobs;
  }

  /**
   * Get all scheduled jobs (for debugging/monitoring)
   */
  async getAllJobs(): Promise<ScheduledJob[]> {
    const queueKey = 'scheduler:queue';
    const queue = await this.store.get<Record<string, number>>(queueKey) || {};

    const jobs: ScheduledJob[] = [];
    for (const jobId of Object.keys(queue)) {
      const job = await this.getJob(jobId);
      if (job) jobs.push(job);
    }

    return jobs.sort((a, b) => a.executeAt - b.executeAt);
  }

  /**
   * Clear all jobs (for testing)
   */
  async clearAll(): Promise<void> {
    const queueKey = 'scheduler:queue';
    const queue = await this.store.get<Record<string, number>>(queueKey) || {};

    for (const jobId of Object.keys(queue)) {
      const jobKey = `scheduler:job:${jobId}`;
      await this.store.delete(jobKey);
    }

    await this.store.delete(queueKey);
  }
}

export type { ScheduledJob, JobProcessor, SchedulerOptions, JobStatus } from './types';
