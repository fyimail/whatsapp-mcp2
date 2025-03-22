import { Client, LocalAuth, Message, NoAuth, ClientOptions } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import logger from './logger';
import fs from 'fs';
import path from 'path';

// Configuration interface
export interface WhatsAppConfig {
  authStrategy?: string;
  authDataPath?: string;
  dockerContainer?: boolean;
}

class EnhancedWhatsAppClient extends Client {
  constructor(options: ClientOptions) {
    super(options);
    this.registerDebugEvents();
  }

  private registerDebugEvents() {
    this.on('qr', (qr: string) => {
      logger.info(`QR Code received: length=${qr.length} characters`);
      // Could save QR code to file for web access if needed
      const qrDir = '/var/data/whatsapp';
      try {
        fs.writeFileSync(path.join(qrDir, 'last-qr.txt'), qr);
        logger.info(`QR code saved to ${path.join(qrDir, 'last-qr.txt')}`);
      } catch (error) {
        logger.error('Failed to save QR code:', error);
      }
      // Display QR code in terminal
      qrcode.generate(qr, { small: true }, qrcode => {
        logger.info(`QR code generated. Scan it with your phone to log in.\n${qrcode}`);
      });

      // Also log the raw QR code for backup
      logger.info(`Raw QR Code: ${qr}`);
    });

    this.on('loading_screen', (percent, message) => {
      logger.info(`Loading: ${percent}% - ${message}`);
    });

    this.on('change_state', state => {
      logger.info(`Client state changed to: ${state}`);
    });

    this.on('ready', async () => {
      logger.info('Client is ready!');
    });

    this.on('authenticated', () => {
      logger.info('Authentication successful!');
    });

    this.on('auth_failure', error => {
      logger.error('Authentication failed:', error);
    });

    this.on('disconnected', reason => {
      logger.warn('Client was disconnected:', reason);
    });

    // Add error event handler
    this.on('error', error => {
      logger.error('Client error:', error);
    });

    // Handle incoming messages
    this.on('message', async (message: Message) => {
      const contact = await message.getContact();
      logger.debug(`${contact.pushname} (${contact.number}): ${message.body}`);
    });
  }

  async initialize() {
    logger.info('Starting client initialization...');
    try {
      logger.info('Calling original initialize method');
      const result = await super.initialize();
      logger.info('Client initialization completed successfully');
      return result;
    } catch (error) {
      logger.error('Error during client initialization:', error);
      throw error;
    }
  }
}

export function createWhatsAppClient(config: WhatsAppConfig = {}): Client {
  const authDataPath = config.authDataPath || '.wwebjs_auth';

  // Set auth strategy with default to 'local'  
  let authStrategy;
  if (config.authStrategy === undefined || config.authStrategy === 'local') {
    logger.info(`Using LocalAuth with data path: ${authDataPath}`);
    authStrategy = new LocalAuth({
      dataPath: authDataPath
    });
  } else {
    logger.info('Using NoAuth strategy');
    authStrategy = new NoAuth();
  }

  // Log when auth file is saved
  try {
    fs.mkdirSync(authDataPath, { recursive: true });
    logger.info(`Auth directory created: ${authDataPath}`);
  } catch (err) {
    // Ignore if file doesn't exist
  }

  // Log auth strategy
  logger.info(`Using auth strategy: ${config.authStrategy || 'local'}`);
  
  // Set up puppeteer args for docker
  const isLocalAuth = config.authStrategy === undefined || config.authStrategy === 'local';

  // Configure Puppeteer options - Important: When using LocalAuth,
  // DON'T set userDataDir in puppeteer options or --user-data-dir in args
  const puppeteerOptions = {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-extensions',
      '--ignore-certificate-errors',
      '--disable-storage-reset',
      '--disable-web-security',
    ],
    timeout: 120000, // 2 minute timeout
  };

  // Log puppeteer configuration
  logger.info(`Using Puppeteer executable path: ${puppeteerOptions.executablePath}`);
  logger.debug('Puppeteer options:', puppeteerOptions);

  // Create client options
  const clientOptions: ClientOptions = {
    puppeteer: puppeteerOptions,
    authStrategy: authStrategy,
    restartOnAuthFail: true,
    authTimeoutMs: 60000,
  };

  // Create custom options with any non-standard parameters
  const customOptions = {
    qrTimeoutMs: 60000,
  };

  // Merge options for the enhanced client
  const enhancedOptions = { ...clientOptions, ...customOptions };

  logger.info('Creating enhanced WhatsApp client');
  return new EnhancedWhatsAppClient(enhancedOptions);
}
