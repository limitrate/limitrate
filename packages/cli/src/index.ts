/**
 * @limitrate/cli
 * CLI dashboard for LimitRate inspection
 */

export { EventStorage, getStorage, saveEvent } from './storage';
export type { StoredEvent, EventStats, TopOffender } from './storage';
export { inspect } from './commands/inspect';
