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
  logger.info('Starting WhatsApp Web REST API...');

  // Create the Express app before initializing WhatsApp client
  const app = express();
  app.use(requestLogger);
  app.use(express.json());

  // Add health check endpoint that doesn't require authentication
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Get port from environment or use the provided port
  const serverPort = process.env.PORT ? parseInt(process.env.PORT) : port;

  // Start the server immediately so Render can detect it
  // Important: Listen on 0.0.0.0 to bind to all network interfaces
  const server = app.listen(serverPort, '0.0.0.0', () => {
    logger.info(`WhatsApp Web Client API server started on port ${serverPort}`);
  });

  // Initialize WhatsApp client in the background
  let client: Client | null = null;
  let clientReady = false;
  let clientError: Error | null = null;

  const initializeClient = async () => {
    try {
      logger.info('Starting WhatsApp client initialization...');
      client = createWhatsAppClient(whatsAppConfig);

      client.on('ready', () => {
        clientReady = true;
        logger.info('WhatsApp client is ready and fully operational');
      });

      await client.initialize();
      logger.info('WhatsApp client initialization completed');

      // Get API key after client is initialized
      const apiKey = await getWhatsAppApiKey(whatsAppConfig);
      logger.info(`WhatsApp API key: ${apiKey}`);

      // Set up API routes
      app.use((req: Request, res: Response, next: NextFunction) => {
        const authHeader = req.headers['authorization'];
        if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
        next();
      });

      app.use('/api', routerFactory(client));

      // Add status endpoint
      app.get('/status', (_req, res) => {
        res.status(200).json({
          status: clientReady ? 'ready' : 'initializing',
          connected: !!client?.info,
          timestamp: new Date().toISOString(),
        });
      });

      app.use(errorHandler);
    } catch (error) {
      clientError = error as Error;
      logger.error('Error during client initialization:', error);

      // Add error status endpoint
      app.get('/status', (_req, res) => {
        res.status(500).json({
          status: 'error',
          error: clientError?.message || 'Unknown error',
          timestamp: new Date().toISOString(),
        });
      });
    }
  };

  // Start client initialization in the background
  initializeClient();

  // Keep the process running
  process.on('SIGINT', async () => {
    logger.info('Shutting down WhatsApp Web Client API...');
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
