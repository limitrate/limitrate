/**
 * Penalty/Reward Manager (v2.0.0 - D4)
 * Dynamically adjust rate limits based on user behavior
 */

import type { Store, PenaltyConfig } from '../types';

export interface PenaltyState {
  multiplier: number;
  expiresAt: number;
  reason: 'violation' | 'reward';
}

/**
 * Penalty/Reward Manager
 */
export class PenaltyManager {
  private store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  /**
   * Get penalty state key for a user/endpoint
   */
  private getPenaltyKey(user: string, endpoint: string): string {
    return `penalty:${user}:${endpoint}`;
  }

  /**
   * Get current penalty/reward multiplier for a user/endpoint
   * Returns 1.0 if no penalty/reward is active
   */
  async getMultiplier(user: string, endpoint: string): Promise<number> {
    try {
      const key = this.getPenaltyKey(user, endpoint);
      const state = await this.store.get<PenaltyState>(key);

      if (!state) {
        return 1.0;  // No penalty/reward
      }

      // Check if expired
      if (Date.now() > state.expiresAt) {
        await this.store.delete(key);
        return 1.0;
      }

      return state.multiplier;
    } catch (error) {
      console.warn('[LimitRate] Failed to get penalty multiplier:', error);
      return 1.0;  // Default to no penalty on error
    }
  }

  /**
   * Apply a penalty to a user/endpoint
   */
  async applyPenalty(
    user: string,
    endpoint: string,
    config: NonNullable<PenaltyConfig['onViolation']>
  ): Promise<void> {
    try {
      const key = this.getPenaltyKey(user, endpoint);
      const state: PenaltyState = {
        multiplier: config.multiplier,
        expiresAt: Date.now() + config.duration * 1000,
        reason: 'violation',
      };

      await this.store.set(key, state, config.duration);
    } catch (error) {
      console.error('[LimitRate] Failed to apply penalty:', error);
    }
  }

  /**
   * Apply a reward to a user/endpoint
   */
  async applyReward(
    user: string,
    endpoint: string,
    config: NonNullable<PenaltyConfig['rewards']>
  ): Promise<void> {
    try {
      const key = this.getPenaltyKey(user, endpoint);
      const state: PenaltyState = {
        multiplier: config.multiplier,
        expiresAt: Date.now() + config.duration * 1000,
        reason: 'reward',
      };

      await this.store.set(key, state, config.duration);
    } catch (error) {
      console.error('[LimitRate] Failed to apply reward:', error);
    }
  }

  /**
   * Check if a reward should be granted based on usage
   */
  shouldGrantReward(
    currentUsage: number,
    limit: number,
    rewardConfig: NonNullable<PenaltyConfig['rewards']>
  ): boolean {
    const usagePercent = (currentUsage / limit) * 100;

    switch (rewardConfig.trigger) {
      case 'below_10_percent':
        return usagePercent < 10;
      case 'below_25_percent':
        return usagePercent < 25;
      case 'below_50_percent':
        return usagePercent < 50;
      default:
        return false;
    }
  }

  /**
   * Clear penalty/reward for a user/endpoint
   */
  async clear(user: string, endpoint: string): Promise<void> {
    try {
      const key = this.getPenaltyKey(user, endpoint);
      await this.store.delete(key);
    } catch (error) {
      console.error('[LimitRate] Failed to clear penalty:', error);
    }
  }
}
