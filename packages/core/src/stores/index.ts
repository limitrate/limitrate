/**
 * Store factory and exports
 */

import type { Store, StoreConfig } from '../types';
import { MemoryStore } from './memory';
import { RedisStore } from './redis';
import { UpstashStore } from './upstash';

export { MemoryStore, RedisStore, UpstashStore };

export function createStore(config: StoreConfig): Store {
  switch (config.type) {
    case 'memory':
      return new MemoryStore();

    case 'redis':
      if (!config.url) {
        throw new Error('Redis store requires url');
      }
      return new RedisStore({ client: config.url, redisOptions: config.options });

    case 'upstash':
      if (!config.url || !config.token) {
        throw new Error('Upstash store requires url and token');
      }
      return new UpstashStore({ url: config.url, token: config.token });

    default:
      throw new Error(`Unknown store type: ${(config as any).type}`);
  }
}
