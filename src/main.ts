import express, { NextFunction, Request, Response } from 'express';
import { createMcpServer, McpConfig } from './mcp-server';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createWhatsAppClient, WhatsAppConfig } from './whatsapp-client';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import logger, { configureForCommandMode } from './logger';
import { requestLogger, errorHandler } from './middleware';
import { routerFactory } from './api';
import { Client } from 'whatsapp-web.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const isDockerContainer = process.env.DOCKER_CONTAINER === 'true';

function parseCommandLineArgs(): ReturnType<typeof yargs.parseSync> {
  return yargs(hideBin(process.argv))
    .option('mode', {
      alias: 'm',
      description: 'Run mode: mcp or whatsapp-api',
      type: 'string',
      choices: ['mcp', 'whatsapp-api'],
      default: 'mcp',
    })
    .option('mcp-mode', {
      alias: 'c',
      description:
        'MCP connection mode: standalone (direct WhatsApp client) or api (connect to WhatsApp API)',
      type: 'string',
      choices: ['standalone', 'api'],
      default: 'standalone',
    })
    .option('transport', {
      alias: 't',
      description: 'MCP transport mode: sse or command',
      type: 'string',
      choices: ['sse', 'command'],
      default: 'sse',
    })
    .option('sse-port', {
      alias: 'p',
      description: 'Port for SSE server',
      type: 'number',
      default: 3002,
    })
    .option('api-port', {
      description: 'Port for WhatsApp API server',
      type: 'number',
      default: 3002,
    })
    .option('auth-data-path', {
      alias: 'a',
      description: 'Path to store authentication data',
      type: 'string',
      default: '.wwebjs_auth',
    })
    .option('auth-strategy', {
      alias: 's',
      description: 'Authentication strategy: local or none',
      type: 'string',
      choices: ['local', 'none'],
      default: 'local',
    })
    .option('api-key', {
      alias: 'k',
      description: 'API key for WhatsApp Web REST API when using api mode',
      type: 'string',
      default: '',
    })
    .option('log-level', {
      alias: 'l',
      description: 'Log level: error, warn, info, http, debug',
      type: 'string',
      choices: ['error', 'warn', 'info', 'http', 'debug'],
      default: 'info',
    })
    .help()
    .alias('help', 'h')
    .parseSync();
}

function configureLogger(argv: ReturnType<typeof parseCommandLineArgs>): void {
  logger.level = argv['log-level'] as string;

  // Configure logger to use stderr for all levels when in MCP command mode
  if (argv.mode === 'mcp' && argv.transport === 'command') {
    configureForCommandMode();
  }
}

function createConfigurations(argv: ReturnType<typeof parseCommandLineArgs>): {
  whatsAppConfig: WhatsAppConfig;
  mcpConfig: McpConfig;
} {
  const whatsAppConfig: WhatsAppConfig = {
    authDir: argv['auth-data-path'] as string,
    authStrategy: argv['auth-strategy'] as 'local' | 'none',
    dockerContainer: isDockerContainer,
  };

  const mcpConfig: McpConfig = {
    useApiClient: argv['mcp-mode'] === 'api',
    apiKey: argv['api-key'] as string,
    whatsappConfig: whatsAppConfig,
  };

  return { whatsAppConfig, mcpConfig };
}

async function startMcpSseServer(
  server: ReturnType<typeof createMcpServer>,
  port: number,
  mode: string,
): Promise<void> {
  const app = express();
  app.use(requestLogger);

  let transport: SSEServerTransport;

  app.get('/sse', async (_req, res) => {
    logger.info('Received SSE connection');
    transport = new SSEServerTransport('/message', res);
    await server.connect(transport);
  });

  app.post('/message', async (req, res) => {
    await transport?.handlePostMessage(req, res);
  });

  app.use(errorHandler);

  app.listen(port, '0.0.0.0', () => {
    logger.info(`MCP server is running on port ${port} in ${mode} mode`);
  });
}

async function startMcpCommandServer(
  server: ReturnType<typeof createMcpServer>,
  mode: string,
): Promise<void> {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info(`WhatsApp MCP server started successfully in ${mode} mode`);

    process.stdin.on('close', () => {
      logger.info('WhatsApp MCP Server closed');
      server.close();
    });
  } catch (error) {
    logger.error('Error connecting to MCP server', error);
  }
}

async function getWhatsAppApiKey(whatsAppConfig: WhatsAppConfig): Promise<string> {
  if (whatsAppConfig.authStrategy === 'none') {
    return crypto.randomBytes(32).toString('hex');
  }
  const authDataPath = whatsAppConfig.authDir;
  if (!authDataPath) {
    throw new Error('The auth-data-path is required when using whatsapp-api mode');
  }
  const apiKeyPath = path.join(authDataPath, 'api_key.txt');
  if (!fs.existsSync(apiKeyPath)) {
    const apiKey = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(apiKeyPath, apiKey);
    return apiKey;
  }
  return fs.readFileSync(apiKeyPath, 'utf8');
}

async function startWhatsAppApiServer(whatsAppConfig: WhatsAppConfig, port: number): Promise<void> {
  logger.info('[WA] Starting WhatsApp Web REST API...');

  // Create the Express app before initializing WhatsApp client
  const app = express();

  // Add error handling to all middleware
  app.use((req, res, next) => {
    try {
      requestLogger(req, res, next);
    } catch (error) {
      logger.error('[WA] Error in request logger middleware:', error);
      next();
    }
  });

  app.use(express.json());

  // Create a variable to store the QR code
  let latestQrCode: string | null = null;

  // Add server status tracking
  let whatsappInitializing = true;
  let whatsappError: Error | null = null;
  let clientReady = false;

  // Add health check endpoint that doesn't require authentication
  // CRITICAL: This must be minimal and not depend on any WhatsApp state
  app.get('/health', (_req, res) => {
    try {
      // Always return 200 for Render health check, even if WhatsApp is still initializing
      res.status(200).json({
        status: 'ok',
        server: 'running',
        whatsapp: clientReady ? 'ready' : whatsappError ? 'error' : 'initializing',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[WA] Error in health check endpoint:', error);
      // Still return 200 to keep Render happy
      res.status(200).send('OK');
    }
  });

  // Add QR code endpoint with enhanced error handling
  app.get('/qr', (req, res) => {
    try {
      // First try to get QR from file
      try {
        const qrPath = path.join('/var/data/whatsapp', 'last-qr.txt');
        if (fs.existsSync(qrPath)) {
          try {
            const qrCode = fs.readFileSync(qrPath, 'utf8');
            return res.send(`
              <html>
                <head>
                  <title>WhatsApp QR Code</title>
                  <meta name="viewport" content="width=device-width, initial-scale=1">
                  <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 20px; }
                    .qr-container { margin: 20px auto; }
                    pre { background: #f4f4f4; padding: 20px; display: inline-block; text-align: left; }
                    .status { color: #555; margin: 20px 0; }
                  </style>
                </head>
                <body>
                  <h1>WhatsApp QR Code</h1>
                  <p>Scan this QR code with your WhatsApp app to link your device</p>
                  <div class="qr-container">
                    <pre>${qrCode}</pre>
                  </div>
                  <p class="status">Server status: ${whatsappInitializing ? 'Initializing WhatsApp...' : clientReady ? 'WhatsApp Ready' : 'Waiting for authentication'}</p>
                  <p><small>Last updated: ${new Date().toISOString()}</small></p>
                </body>
              </html>
            `);
          } catch (readError) {
            logger.error('[WA] Error reading QR file:', readError);
            // Continue to fallback methods
          }
        }
      } catch (fileError) {
        logger.error('[WA] Error accessing QR file system:', fileError);
        // Continue to fallback methods
      }

      // Fallback to in-memory QR code
      if (latestQrCode) {
        try {
          res.type('text/plain');
          return res.send(latestQrCode);
        } catch (error) {
          logger.error('[WA] Error sending QR code as text:', error);
          // Continue to final fallback
        }
      }

      // Final fallback - just return status
      if (whatsappError) {
        return res.status(500).send(`WhatsApp initialization error: ${whatsappError.message}`);
      } else if (whatsappInitializing) {
        return res
          .status(202)
          .send('WhatsApp client is still initializing. Please try again in a minute.');
      } else if (clientReady) {
        return res.status(200).send('WhatsApp client is already authenticated. No QR code needed.');
      } else {
        return res.status(404).send('QR code not yet available. Please try again in a moment.');
      }
    } catch (error) {
      logger.error('[WA] Unhandled error in QR endpoint:', error);
      res.status(500).send('Internal server error processing QR request');
    }
  });

  // Add status endpoint with enhanced error handling
  app.get('/status', (_req, res) => {
    try {
      res.status(200).json({
        server: 'running',
        whatsapp: clientReady ? 'ready' : whatsappError ? 'error' : 'initializing',
        error: whatsappError ? whatsappError.message : null,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[WA] Error in status endpoint:', error);
      res.status(500).send('Error getting status');
    }
  });

  // Start server IMMEDIATELY - BEFORE client initialization
  // This is CRITICAL to prevent Render deployment failures
  const serverPort = port || 3000;
  const server = app.listen(serverPort, '0.0.0.0', () => {
    logger.info(`[WA] WhatsApp Web Client API server started on port ${serverPort}`);
  });

  // Initialize WhatsApp client in the background
  let client: Client | null = null;

  const initializeClient = async () => {
    try {
      logger.info('[WA] Starting WhatsApp client initialization...');

      // Create the client
      client = createWhatsAppClient(whatsAppConfig);

      // Capture the QR code
      client.on('qr', qr => {
        logger.info('[WA] New QR code received');
        latestQrCode = qr;
        // QR code file saving is handled in whatsapp-client.ts

        // Also log QR code to console for terminal access
        try {
          // Use a smaller QR code with proper formatting
          logger.info('[WA] Scan this QR code with your WhatsApp app:');
          const qrcodeTerminal = require('qrcode-terminal');
          qrcodeTerminal.generate(qr, { small: true }, function (qrcode: string) {
            // Split the QR code by lines and log each line separately to preserve formatting
            const qrLines = qrcode.split('\n');
            qrLines.forEach((line: string) => {
              logger.info(`[WA-QR] ${line}`);
            });
          });
        } catch (error) {
          logger.error('[WA] Failed to generate terminal QR code', error);
        }
      });

      client.on('ready', () => {
        clientReady = true;
        whatsappInitializing = false;
        logger.info('[WA] Client is ready');
      });

      client.on('auth_failure', error => {
        whatsappError = new Error(`Authentication failed: ${error}`);
        logger.error('[WA] Authentication failed:', error);
      });

      client.on('disconnected', reason => {
        logger.warn('[WA] Client disconnected:', reason);
        clientReady = false;
      });

      await client.initialize();
    } catch (error) {
      whatsappInitializing = false;
      whatsappError = error as Error;
      logger.error('[WA] Error during client initialization:', error);

      // Don't throw here - we want the server to keep running even if WhatsApp fails
    }
  };

  // Start client initialization in the background
  initializeClient();

  // Set additional error handlers for process
  process.on('uncaughtException', error => {
    logger.error('[WA] Uncaught exception:', error);
    // Don't crash the server
  });

  process.on('unhandledRejection', reason => {
    logger.error('[WA] Unhandled rejection:', reason);
    // Don't crash the server
  });

  // Keep the process running
  process.on('SIGINT', async () => {
    logger.info('[WA] Shutting down WhatsApp Web Client API...');
    if (client) {
      await client.destroy();
    }
    server.close();
    process.exit(0);
  });
}

async function startMcpServer(
  mcpConfig: McpConfig,
  transport: string,
  port: number,
  mode: string,
): Promise<void> {
  let client: Client | null = null;
  if (mode === 'standalone') {
    logger.info('Starting WhatsApp Web Client...');
    client = createWhatsAppClient(mcpConfig.whatsappConfig);
    await client.initialize();
  }

  logger.info(`Starting MCP server in ${mode} mode...`);
  logger.debug('MCP Configuration:', mcpConfig);

  const server = createMcpServer(mcpConfig, client);

  if (transport === 'sse') {
    await startMcpSseServer(server, port, mode);
  } else if (transport === 'command') {
    await startMcpCommandServer(server, mode);
  }
}

async function main(): Promise<void> {
  try {
    const argv = parseCommandLineArgs();
    configureLogger(argv);

    const { whatsAppConfig, mcpConfig } = createConfigurations(argv);

    if (argv.mode === 'mcp') {
      await startMcpServer(
        mcpConfig,
        argv['transport'] as string,
        argv['sse-port'] as number,
        argv['mcp-mode'] as string,
      );
    } else if (argv.mode === 'whatsapp-api') {
      await startWhatsAppApiServer(whatsAppConfig, argv['api-port'] as number);
    }
  } catch (error) {
    logger.error('Error starting application:', error);
    process.exit(1);
  }
}

main();
