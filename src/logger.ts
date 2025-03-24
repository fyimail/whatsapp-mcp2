import winston from 'winston';
import util from 'util';

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define log level based on environment
const level = (): string => {
  const env = process.env.NODE_ENV || 'development';
  return env === 'production' ? 'info' : 'debug';
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue',
};

// Add colors to winston
winston.addColors(colors);

// Define the format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`),
);

// Create a simple filter to reduce unnecessary logs
const filterLogs = winston.format((info: winston.Logform.TransformableInfo) => {
  // Always keep QR code logs (they have the special [WA-QR] prefix)
  if (typeof info.message === 'string' && info.message.includes('[WA-QR]')) {
    return info;
  }

  // Filter out noisy puppeteer logs
  if (
    typeof info.message === 'string' &&
    // Protocol messages
    (info.message.includes('puppeteer:protocol') ||
      info.message.includes('SEND') ||
      info.message.includes('RECV') ||
      // Network and WebSocket traffic
      info.message.includes('Network.') ||
      info.message.includes('webSocket') ||
      // Session and protocol IDs
      info.message.includes('sessionId') ||
      info.message.includes('targetId') ||
      // General puppeteer noise
      info.message.includes('puppeteer') ||
      info.message.includes('browser') ||
      info.message.includes('checking') ||
      info.message.includes('polling') ||
      // Protocol payloads and results
      info.message.includes('payloadData') ||
      info.message.includes('result:{"result"') ||
      // Runtime evaluations
      info.message.includes('Runtime.') ||
      info.message.includes('execute') ||
      // Common patterns in the logs you showed
      info.message.includes('method') ||
      info.message.includes('params'))
  ) {
    // Filter these out completely regardless of level, except for errors
    return info.level === 'error' ? info : false;
  }

  return info;
})();

// Create transports
const transports: winston.transport[] = [
  // Console transport
  new winston.transports.Console({
    format: winston.format.combine(filterLogs, consoleFormat),
    stderrLevels: ['error', 'warn'],
  }),
];

// Create the logger
const logger = winston.createLogger({
  level: level(),
  levels,
  transports,
});

// Define types for the logger methods
type LogMethod = (message: unknown, ...meta: unknown[]) => winston.Logger;
interface LoggerMethods {
  error: LogMethod;
  warn: LogMethod;
  info: LogMethod;
  http: LogMethod;
  debug: LogMethod;
}

// Add a method to log objects with proper formatting
const originalLoggers: LoggerMethods = {
  error: logger.error.bind(logger),
  warn: logger.warn.bind(logger),
  info: logger.info.bind(logger),
  http: logger.http.bind(logger),
  debug: logger.debug.bind(logger),
};

// Override the logger methods to handle objects
(Object.keys(originalLoggers) as Array<keyof LoggerMethods>).forEach(level => {
  logger[level] = function (message: unknown, ...meta: unknown[]): winston.Logger {
    // If message is an object, format it
    if (typeof message === 'object' && message !== null) {
      message = util.inspect(message, { depth: 4, colors: false });
    }

    // If there are additional arguments, format them
    if (meta.length > 0) {
      const formattedMeta = meta.map(item => {
        if (typeof item === 'object' && item !== null) {
          return util.inspect(item, { depth: 4, colors: false });
        }
        return item;
      });

      return originalLoggers[level].call(logger, `${message} ${formattedMeta.join(' ')}`);
    }

    return originalLoggers[level].call(logger, message);
  };
});

/**
 * Configure the logger for MCP command mode
 * In command mode, all logs should go to stderr
 */
export function configureForCommandMode(): void {
  // Remove existing console transport
  logger.transports.forEach(transport => {
    if (transport instanceof winston.transports.Console) {
      logger.remove(transport);
    }
  });

  // Add new console transport that sends everything to stderr
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(filterLogs, consoleFormat),
      stderrLevels: Object.keys(levels),
    }),
  );
}

export default logger;
