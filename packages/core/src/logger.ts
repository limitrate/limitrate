/**
 * Pluggable logger interface for LimitRate
 * Allows users to integrate with their existing logging infrastructure
 */

export interface Logger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

/**
 * Default console logger implementation
 */
class ConsoleLogger implements Logger {
  debug(message: string, ...args: any[]): void {
    console.debug(message, ...args);
  }

  info(message: string, ...args: any[]): void {
    console.log(message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(message, ...args);
  }

  error(message: string, ...args: any[]): void {
    console.error(message, ...args);
  }
}

/**
 * Silent logger (no output)
 */
class SilentLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}

/**
 * Global logger instance
 */
let globalLogger: Logger = new ConsoleLogger();

/**
 * Set the global logger instance
 * @param logger - Logger implementation to use
 */
export function setLogger(logger: Logger): void {
  globalLogger = logger;
}

/**
 * Get the current global logger
 */
export function getLogger(): Logger {
  return globalLogger;
}

/**
 * Create a silent logger (disables all output)
 */
export function createSilentLogger(): Logger {
  return new SilentLogger();
}

/**
 * Create a console logger (default)
 */
export function createConsoleLogger(): Logger {
  return new ConsoleLogger();
}

/**
 * Convenience methods that use the global logger
 */
export const logger = {
  debug: (message: string, ...args: any[]) => globalLogger.debug(message, ...args),
  info: (message: string, ...args: any[]) => globalLogger.info(message, ...args),
  warn: (message: string, ...args: any[]) => globalLogger.warn(message, ...args),
  error: (message: string, ...args: any[]) => globalLogger.error(message, ...args),
};
