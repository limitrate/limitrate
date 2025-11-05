#!/usr/bin/env node

/**
 * LimitRate CLI
 */

import { Command } from 'commander';
import { inspect } from './commands/inspect';

const program = new Command();

program
  .name('limitrate')
  .description('LimitRate CLI - Inspect rate limiting and cost control events')
  .version('0.1.0');

program
  .command('inspect')
  .description('Show dashboard with endpoint stats, top offenders, and recent events')
  .action(() => {
    inspect();
  });

// Default command is inspect
if (process.argv.length === 2) {
  inspect();
} else {
  program.parse();
}
