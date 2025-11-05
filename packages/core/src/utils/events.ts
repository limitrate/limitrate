/**
 * Event emitter for LimitRate events
 */

import type { LimitRateEvent } from '../types';

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
        console.error('[LimitRate] Event handler error:', error);
      }
    }

    // Wait for all async handlers
    if (promises.length > 0) {
      await Promise.allSettled(promises);
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
