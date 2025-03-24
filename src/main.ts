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

  app.get('/sse', async (_req: Request, res: Response) => {
    logger.info('Received SSE connection');
    transport = new SSEServerTransport('/message', res);
    await server.connect(transport);
  });

  app.post('/message', async (req: Request, res: Response) => {
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
  app.use((req: Request, res: Response, next: NextFunction) => {
    try {
      requestLogger(req, res, next);
    } catch (error) {
      logger.error('[WA] Error in request logger middleware:', error);
      next();
    }
  });

  app.use(express.json());

  // CRITICAL: Track server start time - helps with troubleshooting
  const serverStartTime = new Date();

  // Set up minimal state management for diagnostics
  const state = {
    whatsappInitializing: false,
    whatsappInitStarted: false,
    whatsappError: null as Error | null,
    clientReady: false,
    latestQrCode: null as string | null,
    client: null as any, // Will hold the WhatsApp client instance once initialized
    environment: {
      node: process.version,
      platform: process.platform,
      port: port || process.env.PORT || 3000,
      pid: process.pid,
      uptime: () => Math.floor((new Date().getTime() - serverStartTime.getTime()) / 1000),
    },
  };

  // Log important startup information
  logger.info(
    `[WA] Server starting with Node ${state.environment.node} on ${state.environment.platform}`,
  );
  logger.info(`[WA] Process ID: ${state.environment.pid}`);
  logger.info(`[WA] Port: ${state.environment.port}`);
  logger.info(`[WA] Start time: ${serverStartTime.toISOString()}`);

  // EMERGENCY DIAGNOSTIC endpoint - absolutely minimal, will help diagnose deployment issues
  app.get('/', (_req: Request, res: Response) => {
    res.status(200).send(`
      <html>
        <head><title>WhatsApp API Service</title></head>
        <body>
          <h1>WhatsApp API Service</h1>
          <p>Server is running</p>
          <p>Uptime: ${state.environment.uptime()} seconds</p>
          <p>Started: ${serverStartTime.toISOString()}</p>
          <p>Node: ${state.environment.node}</p>
          <p>Platform: ${state.environment.platform}</p>
          <p>WhatsApp Status: ${
            state.whatsappInitStarted
              ? state.clientReady
                ? 'Ready'
                : state.whatsappError
                  ? 'Error'
                  : 'Initializing'
              : 'Not started'
          }</p>
          <ul>
            <li><a href="/health">Health Check</a></li>
            <li><a href="/memory-usage">Memory Usage</a></li>
            <li><a href="/container-env">Container Environment</a></li>
            <li><a href="/filesys">File System Check</a></li>
            <li><a href="/qr">QR Code</a> (if available)</li>
          </ul>
        </body>
      </html>
    `);
  });

  // Add health check endpoint that doesn't require authentication
  // CRITICAL: This must be minimal and not depend on any WhatsApp state
  app.get('/health', (_req: Request, res: Response) => {
    try {
      // Always return 200 for Render health check, even if WhatsApp is still initializing
      res.status(200).json({
        status: 'ok',
        server: 'running',
        uptime: state.environment.uptime(),
        startTime: serverStartTime.toISOString(),
        whatsappStarted: state.whatsappInitStarted,
        whatsapp: state.clientReady
          ? 'ready'
          : state.whatsappError
            ? 'error'
            : state.whatsappInitializing
              ? 'initializing'
              : 'not_started',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[WA] Error in health check endpoint:', error);
      // Still return 200 to keep Render happy
      res.status(200).send('OK');
    }
  });

  // Add /wa-api endpoint for backwards compatibility with previous implementation
  app.get('/wa-api', (_req: Request, res: Response) => {
    try {
      // Get the API key from the same place as the official implementation
      const apiKeyPath = path.join(whatsAppConfig.authDir || '.wwebjs_auth', 'api_key.txt');

      if (fs.existsSync(apiKeyPath)) {
        const apiKey = fs.readFileSync(apiKeyPath, 'utf8');
        logger.info('[WA] API key retrieved for /wa-api endpoint');

        res.status(200).json({
          status: 'success',
          message: 'WhatsApp API key',
          apiKey: apiKey,
        });
      } else {
        logger.warn('[WA] API key file not found for /wa-api endpoint');
        res.status(404).json({
          status: 'error',
          message: 'API key not found. Service might still be initializing.',
        });
      }
    } catch (error) {
      logger.error('[WA] Error retrieving API key for /wa-api endpoint:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to retrieve API key',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Add QR code endpoint with enhanced error handling
  app.get('/qr', (_req: Request, res: Response) => {
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
                  <p class="status">Server status: ${state.whatsappInitializing ? 'Initializing WhatsApp...' : state.clientReady ? 'WhatsApp Ready' : 'Waiting for authentication'}</p>
                  <p><small>Last updated: ${new Date().toISOString()}</small></p>
                  <p><a href="/">Back to Home</a></p>
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
      if (state.latestQrCode) {
        try {
          res.type('text/plain');
          return res.send(state.latestQrCode);
        } catch (error) {
          logger.error('[WA] Error sending QR code as text:', error);
          // Continue to final fallback
        }
      }

      // Final fallback - just return status
      if (state.whatsappError) {
        return res
          .status(500)
          .send(`WhatsApp initialization error: ${state.whatsappError.message}`);
      } else if (state.whatsappInitializing) {
        return res
          .status(202)
          .send('WhatsApp client is still initializing. Please try again in a minute.');
      } else if (state.clientReady) {
        return res.status(200).send('WhatsApp client is already authenticated. No QR code needed.');
      } else if (!state.whatsappInitStarted) {
        return res
          .status(200)
          .send('WhatsApp initialization has not been started yet. Check server logs.');
      } else {
        return res.status(404).send('QR code not yet available. Please try again in a moment.');
      }
    } catch (error) {
      logger.error('[WA] Unhandled error in QR endpoint:', error);
      res.status(500).send('Internal server error processing QR request');
    }
  });

  // Add status endpoint with enhanced error handling
  app.get('/status', (_req: Request, res: Response) => {
    try {
      res.status(200).json({
        server: 'running',
        uptime: state.environment.uptime(),
        startTime: serverStartTime.toISOString(),
        whatsappStarted: state.whatsappInitStarted,
        whatsapp: state.clientReady
          ? 'ready'
          : state.whatsappError
            ? 'error'
            : state.whatsappInitializing
              ? 'initializing'
              : 'not_started',
        error: state.whatsappError ? state.whatsappError.message : null,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[WA] Error in status endpoint:', error);
      res.status(500).send('Error getting status');
    }
  });

  // Add memory usage endpoint for troubleshooting
  app.get('/memory-usage', (_req: Request, res: Response) => {
    try {
      const formatMemoryUsage = (data: number) =>
        `${Math.round((data / 1024 / 1024) * 100) / 100} MB`;

      const memoryData = process.memoryUsage();

      const memoryUsage = {
        rss: formatMemoryUsage(memoryData.rss),
        heapTotal: formatMemoryUsage(memoryData.heapTotal),
        heapUsed: formatMemoryUsage(memoryData.heapUsed),
        external: formatMemoryUsage(memoryData.external),
        arrayBuffers: formatMemoryUsage(memoryData.arrayBuffers || 0),
        rawData: memoryData,
        timestamp: new Date().toISOString(),
      };

      logger.info('[WA] Memory usage report:', memoryUsage);
      res.status(200).json(memoryUsage);
    } catch (error) {
      logger.error('[WA] Error in memory-usage endpoint:', error);
      res.status(500).send('Error getting memory usage');
    }
  });

  // API endpoint to get all chats (leverages the MCP get_chats tool)
  app.get('/api/chats', async (_req: Request, res: Response) => {
    try {
      if (!state.clientReady) {
        return res.status(503).json({
          status: 'error',
          message: 'WhatsApp client not ready',
          whatsappStatus: state.clientReady ? 'ready' : state.whatsappError ? 'error' : 'initializing',
        });
      }

      const whatsappClient = state.client;
      if (!whatsappClient) {
        return res.status(500).json({
          status: 'error',
          message: 'WhatsApp client not available',
        });
      }

      logger.info('[WA] Getting all chats');
      const chats = await whatsappClient.getChats();
      
      // Format the chats in a more API-friendly format
      const formattedChats = chats.map(chat => ({
        id: chat.id._serialized,
        name: chat.name,
        isGroup: chat.isGroup,
        timestamp: chat.timestamp ? new Date(chat.timestamp * 1000).toISOString() : null,
        unreadCount: chat.unreadCount,
      }));

      res.status(200).json({
        status: 'success',
        chats: formattedChats,
      });
    } catch (error) {
      logger.error('[WA] Error getting chats:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to get chats',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // API endpoint to get messages from a specific chat
  app.get('/api/chats/:chatId/messages', async (req: Request, res: Response) => {
    try {
      const { chatId } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

      if (!state.clientReady) {
        return res.status(503).json({
          status: 'error',
          message: 'WhatsApp client not ready',
          whatsappStatus: state.clientReady ? 'ready' : state.whatsappError ? 'error' : 'initializing',
        });
      }

      const whatsappClient = state.client;
      if (!whatsappClient) {
        return res.status(500).json({
          status: 'error',
          message: 'WhatsApp client not available',
        });
      }

      logger.info(`[WA] Getting messages for chat ${chatId} (limit: ${limit})`);
      
      // Get the chat by ID
      const chat = await whatsappClient.getChatById(chatId);
      if (!chat) {
        return res.status(404).json({
          status: 'error',
          message: `Chat with ID ${chatId} not found`,
        });
      }

      // Fetch messages
      const messages = await chat.fetchMessages({ limit });
      
      // Format messages in a more API-friendly format
      const formattedMessages = messages.map(msg => ({
        id: msg.id._serialized,
        body: msg.body,
        type: msg.type,
        timestamp: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : null,
        from: msg.from,
        fromMe: msg.fromMe,
        hasMedia: msg.hasMedia,
      }));

      res.status(200).json({
        status: 'success',
        chatId: chatId,
        messages: formattedMessages,
      });
    } catch (error) {
      logger.error(`[WA] Error getting messages for chat:`, error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to get messages',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ===================================================
  // REST API ENDPOINTS THAT MAP TO ALL MCP TOOLS
  // ===================================================

  // Utility function to check if WhatsApp client is ready
  const ensureClientReady = (res: Response) => {
    if (!state.clientReady) {
      res.status(503).json({
        status: 'error',
        message: 'WhatsApp client not ready',
        whatsappStatus: state.clientReady ? 'ready' : state.whatsappError ? 'error' : 'initializing',
      });
      return false;
    }
    return true;
  };

  // 1. GET STATUS ENDPOINT - Maps to get_status tool
  app.get('/api/status', (_req: Request, res: Response) => {
    try {
      const whatsappStatus = state.clientReady 
        ? 'ready' 
        : state.whatsappError 
          ? 'error' 
          : state.whatsappInitializing 
            ? 'initializing' 
            : 'not_started';
      
      res.status(200).json({
        status: 'success',
        whatsappStatus: whatsappStatus,
        uptime: state.environment.uptime(),
        startTime: serverStartTime.toISOString(),
        error: state.whatsappError ? state.whatsappError.message : null,
      });
    } catch (error) {
      logger.error('[WA] Error in status endpoint:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to get status',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // 2. SEARCH CONTACTS ENDPOINT - Maps to search_contacts tool
  app.get('/api/contacts/search', async (req: Request, res: Response) => {
    try {
      if (!ensureClientReady(res)) return;

      const query = req.query.query as string;
      if (!query) {
        return res.status(400).json({
          status: 'error',
          message: 'Missing query parameter',
        });
      }

      const whatsappClient = state.client;
      const contacts = await whatsappClient.getContacts();
      const filtered = contacts.filter(contact => {
        const name = contact.name || contact.pushname || '';
        const number = contact.number || contact.id?.user || '';
        return name.toLowerCase().includes(query.toLowerCase()) || number.includes(query);
      }).map(contact => ({
        id: contact.id._serialized,
        name: contact.name || contact.pushname || 'Unknown',
        number: contact.number || contact.id?.user || 'Unknown',
        type: contact.isGroup ? 'group' : 'individual',
      }));

      res.status(200).json({
        status: 'success',
        query: query,
        contacts: filtered,
      });
    } catch (error) {
      logger.error('[WA] Error searching contacts:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to search contacts',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // 3. GET MESSAGES ENDPOINT - Maps to get_messages tool
  app.get('/api/chats/:chatId/messages', async (req: Request, res: Response) => {
    try {
      if (!ensureClientReady(res)) return;

      const { chatId } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

      const whatsappClient = state.client;
      
      // Get the chat by ID
      const chat = await whatsappClient.getChatById(chatId);
      if (!chat) {
        return res.status(404).json({
          status: 'error',
          message: `Chat with ID ${chatId} not found`,
        });
      }

      // Fetch messages
      const messages = await chat.fetchMessages({ limit });
      
      // Format messages in a more API-friendly format
      const formattedMessages = messages.map(msg => ({
        id: msg.id._serialized,
        body: msg.body,
        type: msg.type,
        timestamp: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : null,
        from: msg.from,
        fromMe: msg.fromMe,
        hasMedia: msg.hasMedia,
      }));

      res.status(200).json({
        status: 'success',
        chatId: chatId,
        messages: formattedMessages,
      });
    } catch (error) {
      logger.error(`[WA] Error getting messages for chat:`, error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to get messages',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // 4. GET CHATS ENDPOINT - Maps to get_chats tool
  app.get('/api/chats', async (_req: Request, res: Response) => {
    try {
      if (!ensureClientReady(res)) return;

      const whatsappClient = state.client;
      const chats = await whatsappClient.getChats();
      
      // Format the chats in a more API-friendly format
      const formattedChats = chats.map(chat => ({
        id: chat.id._serialized,
        name: chat.name,
        isGroup: chat.isGroup,
        timestamp: chat.timestamp ? new Date(chat.timestamp * 1000).toISOString() : null,
        unreadCount: chat.unreadCount,
      }));

      res.status(200).json({
        status: 'success',
        chats: formattedChats,
      });
    } catch (error) {
      logger.error('[WA] Error getting chats:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to get chats',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // 5. SEND MESSAGE ENDPOINT - Maps to send_message tool
  app.post('/api/chats/:chatId/messages', async (req: Request, res: Response) => {
    try {
      if (!ensureClientReady(res)) return;

      const { chatId } = req.params;
      const { message } = req.body;

      if (!message) {
        return res.status(400).json({
          status: 'error',
          message: 'Missing message in request body',
        });
      }

      const whatsappClient = state.client;
      
      // Get the chat by ID
      const chat = await whatsappClient.getChatById(chatId);
      if (!chat) {
        return res.status(404).json({
          status: 'error',
          message: `Chat with ID ${chatId} not found`,
        });
      }

      // Send the message
      const sentMessage = await chat.sendMessage(message);
      
      res.status(200).json({
        status: 'success',
        chatId: chatId,
        messageId: sentMessage.id._serialized,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error(`[WA] Error sending message to chat:`, error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to send message',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // 6. GET GROUPS ENDPOINT - Maps to groups resource
  app.get('/api/groups', async (_req: Request, res: Response) => {
    try {
      if (!ensureClientReady(res)) return;

      const whatsappClient = state.client;
      const chats = await whatsappClient.getChats();
      const groups = chats.filter(chat => chat.isGroup).map(group => ({
        id: group.id._serialized,
        name: group.name,
        participants: group.participants?.map(p => ({
          id: p.id._serialized,
          isAdmin: p.isAdmin || false,
        })) || [],
        timestamp: group.timestamp ? new Date(group.timestamp * 1000).toISOString() : null,
      }));

      res.status(200).json({
        status: 'success',
        groups: groups,
      });
    } catch (error) {
      logger.error('[WA] Error getting groups:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to get groups',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // 7. SEARCH GROUPS ENDPOINT - Maps to search_groups resource
  app.get('/api/groups/search', async (req: Request, res: Response) => {
    try {
      if (!ensureClientReady(res)) return;

      const query = req.query.query as string;
      if (!query) {
        return res.status(400).json({
          status: 'error',
          message: 'Missing query parameter',
        });
      }

      const whatsappClient = state.client;
      const chats = await whatsappClient.getChats();
      const groups = chats.filter(chat => {
        return chat.isGroup && chat.name.toLowerCase().includes(query.toLowerCase());
      }).map(group => ({
        id: group.id._serialized,
        name: group.name,
        participants: group.participants?.length || 0,
        timestamp: group.timestamp ? new Date(group.timestamp * 1000).toISOString() : null,
      }));

      res.status(200).json({
        status: 'success',
        query: query,
        groups: groups,
      });
    } catch (error) {
      logger.error('[WA] Error searching groups:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to search groups',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // 8. GET GROUP MESSAGES ENDPOINT - Maps to group_messages resource
  app.get('/api/groups/:groupId/messages', async (req: Request, res: Response) => {
    try {
      if (!ensureClientReady(res)) return;

      const { groupId } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

      const whatsappClient = state.client;
      
      // Get the group chat by ID
      const chat = await whatsappClient.getChatById(groupId);
      if (!chat || !chat.isGroup) {
        return res.status(404).json({
          status: 'error',
          message: `Group with ID ${groupId} not found`,
        });
      }

      // Fetch messages
      const messages = await chat.fetchMessages({ limit });
      
      // Format messages
      const formattedMessages = messages.map(msg => ({
        id: msg.id._serialized,
        body: msg.body,
        type: msg.type,
        timestamp: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : null,
        author: msg.author || msg.from,
        fromMe: msg.fromMe,
        hasMedia: msg.hasMedia,
      }));

      res.status(200).json({
        status: 'success',
        groupId: groupId,
        messages: formattedMessages,
      });
    } catch (error) {
      logger.error(`[WA] Error getting messages for group:`, error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to get group messages',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // 9. CREATE GROUP ENDPOINT - Maps to create_group tool
  app.post('/api/groups', async (req: Request, res: Response) => {
    try {
      if (!ensureClientReady(res)) return;

      const { name, participants } = req.body;

      if (!name || !participants || !Array.isArray(participants)) {
        return res.status(400).json({
          status: 'error',
          message: 'Missing name or participants array in request body',
        });
      }

      const whatsappClient = state.client;
      const result = await whatsappClient.createGroup(name, participants);

      res.status(200).json({
        status: 'success',
        group: {
          id: result.gid._serialized,
          name: name,
          participants: participants,
        },
      });
    } catch (error) {
      logger.error('[WA] Error creating group:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to create group',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // 10. ADD PARTICIPANTS TO GROUP ENDPOINT - Maps to add_participants_to_group tool
  app.post('/api/groups/:groupId/participants', async (req: Request, res: Response) => {
    try {
      if (!ensureClientReady(res)) return;

      const { groupId } = req.params;
      const { participants } = req.body;

      if (!participants || !Array.isArray(participants)) {
        return res.status(400).json({
          status: 'error',
          message: 'Missing participants array in request body',
        });
      }

      const whatsappClient = state.client;
      
      // Get the group chat by ID
      const chat = await whatsappClient.getChatById(groupId);
      if (!chat || !chat.isGroup) {
        return res.status(404).json({
          status: 'error',
          message: `Group with ID ${groupId} not found`,
        });
      }

      // Add participants
      const result = await chat.addParticipants(participants);

      res.status(200).json({
        status: 'success',
        groupId: groupId,
        added: result,
      });
    } catch (error) {
      logger.error(`[WA] Error adding participants to group:`, error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to add participants to group',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Add environment variables endpoint for troubleshooting
  app.get('/container-env', (_req: Request, res: Response) => {
    try {
      // Don't log or expose sensitive values
      const sanitizedEnv = Object.fromEntries(
        Object.entries(process.env)
          .filter(
            ([key]) =>
              !key.toLowerCase().includes('key') &&
              !key.toLowerCase().includes('token') &&
              !key.toLowerCase().includes('secret') &&
              !key.toLowerCase().includes('pass') &&
              !key.toLowerCase().includes('auth'),
          )
          .map(([key, value]) => [key, value]),
      );

      const envData = {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        containerVars: {
          PORT: process.env.PORT,
          NODE_ENV: process.env.NODE_ENV,
          DOCKER_CONTAINER: process.env.DOCKER_CONTAINER,
          RENDER: process.env.RENDER,
        },
        // Include sanitized env for debugging only
        fullEnv: sanitizedEnv,
        timestamp: new Date().toISOString(),
      };

      logger.info('[WA] Container environment report');
      res.status(200).json(envData);
    } catch (error) {
      logger.error('[WA] Error in container-env endpoint:', error);
      res.status(500).send('Error getting container environment');
    }
  });

  // Add file system exploration endpoint for troubleshooting
  app.get('/filesys', (_req: Request, res: Response) => {
    try {
      const directoriesToCheck = [
        '/',
        '/app',
        '/app/data',
        '/app/data/whatsapp',
        '/var',
        '/var/data',
        '/var/data/whatsapp',
        '/tmp',
        '/tmp/puppeteer_data',
      ];

      const fsData = directoriesToCheck.map(dir => {
        try {
          const exists = fs.existsSync(dir);
          let files: string[] = [];
          let stats = null;

          if (exists) {
            try {
              stats = fs.statSync(dir);
              files = fs.readdirSync(dir).slice(0, 20); // Only get first 20 files
            } catch (e) {
              files = [`Error reading directory: ${e instanceof Error ? e.message : String(e)}`];
            }
          }

          return {
            directory: dir,
            exists,
            stats: stats
              ? {
                  isDirectory: stats.isDirectory(),
                  size: stats.size,
                  mode: stats.mode,
                  uid: stats.uid,
                  gid: stats.gid,
                }
              : null,
            files,
          };
        } catch (e) {
          return {
            directory: dir,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      });

      logger.info('[WA] File system exploration report');
      res.status(200).json(fsData);
    } catch (error) {
      logger.error('[WA] Error in filesys endpoint:', error);
      res.status(500).send('Error exploring file system');
    }
  });

  // Add start WhatsApp endpoint - separated from server start
  app.get('/start-whatsapp', (_req: Request, res: Response) => {
    // Only start once
    if (state.whatsappInitStarted) {
      return res.status(200).json({
        status: 'WhatsApp initialization already started',
        clientReady: state.clientReady,
        error: state.whatsappError ? state.whatsappError.message : null,
      });
    }

    // Start WhatsApp initialization
    state.whatsappInitStarted = true;
    state.whatsappInitializing = true;

    // Launch initialization in the background
    initializeWhatsAppClient(whatsAppConfig, state);

    return res.status(200).json({
      status: 'WhatsApp initialization started',
      message: 'Check /status for updates',
    });
  });

  // Start server IMMEDIATELY - BEFORE client initialization
  // This is CRITICAL to prevent Render deployment failures
  const serverPort = port || parseInt(process.env.PORT || '') || 3000;
  logger.info(`[WA] Starting HTTP server on port ${serverPort}`);

  const server = app.listen(serverPort, '0.0.0.0', () => {
    logger.info(`[WA] WhatsApp Web Client API server started on port ${serverPort}`);
  });

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
    server.close();
    process.exit(0);
  });
}

// Separate function to initialize WhatsApp client
async function initializeWhatsAppClient(whatsAppConfig: WhatsAppConfig, state: any): Promise<void> {
  let client: Client | null = null;

  try {
    logger.info('[WA] Starting WhatsApp client initialization...');

    // Create the client
    client = createWhatsAppClient(whatsAppConfig);

    // Capture the QR code
    client.on('qr', qr => {
      logger.info('[WA] New QR code received');
      state.latestQrCode = qr;
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
      state.clientReady = true;
      state.whatsappInitializing = false;
      logger.info('[WA] Client is ready');
    });

    client.on('auth_failure', error => {
      state.whatsappError = new Error(`Authentication failed: ${error}`);
      logger.error('[WA] Authentication failed:', error);
    });

    client.on('disconnected', reason => {
      logger.warn('[WA] Client disconnected:', reason);
      state.clientReady = false;
    });

    await client.initialize();
  } catch (error) {
    state.whatsappInitializing = false;
    state.whatsappError = error as Error;
    logger.error('[WA] Error during client initialization:', error);
    // Don't throw here - we want the server to keep running even if WhatsApp fails
  }
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
