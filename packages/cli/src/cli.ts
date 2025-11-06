#!/usr/bin/env node

/**
 * LimitRate CLI
 */

import { Command } from 'commander';
import { inspect } from './commands/inspect';
import { inspectEndpoints } from './commands/inspect-endpoints';

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

program
  .command('inspect-endpoints')
  .description('Show endpoint auto-discovery (v1.4.0) - which endpoints have rate limits')
  .option('--json', 'Output as JSON for CI/CD')
  .option('--fail-on-unprotected', 'Exit with code 1 if unprotected endpoints found (for CI/CD)')
  .action((options) => {
    inspectEndpoints({ json: options.json, failOnUnprotected: options.failOnUnprotected });
  });

// Default command is inspect
if (process.argv.length === 2) {
  inspect();
} else {
  program.parse();
}
