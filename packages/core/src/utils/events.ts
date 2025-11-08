/**
 * Event emitter for LimitRate events
 */

import type { LimitRateEvent } from '../types';
import { logger } from '../logger';

export type EventHandler = (event: LimitRateEvent) => void | Promise<void>;

export class EventEmitter {
  private handlers: Set<EventHandler>;

  constructor() {
    this.handlers = new Set();
  }

  /**
   * Register an event handler
   */
  on(handler: EventHandler): void {
    this.handlers.add(handler);
  }

  /**
   * Unregister an event handler
   */
  off(handler: EventHandler): void {
    this.handlers.delete(handler);
  }

  /**
   * Emit an event to all handlers
   */
  async emit(event: LimitRateEvent): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const handler of this.handlers) {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          promises.push(result);
        }
      } catch (error) {
        logger.error('[LimitRate] Event handler error:', error);
      }
    }

    // Wait for all async handlers
    if (promises.length > 0) {
      const results = await Promise.allSettled(promises);

      // BUG FIX #5: Log rejected promises so failures aren't silent
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'rejected') {
          logger.error(
            `[LimitRate] Async event handler failed for event "${event.type}":`,
            result.reason
          );
        }
      }
    }
  }

  /**
   * Get number of registered handlers
   */
  getHandlerCount(): number {
    return this.handlers.size;
  }

  /**
   * Clear all handlers
   */
  clear(): void {
    this.handlers.clear();
  }
}
