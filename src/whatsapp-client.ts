import { Client, LocalAuth, Message, NoAuth, ClientOptions } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import logger from './logger';
import fs from 'fs';
import path from 'path';

// Configuration interface
export interface WhatsAppConfig {
  authDataPath?: string;
  authStrategy?: 'local' | 'none';
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

  logger.debug(
    'Creating WhatsApp client with config:',
    JSON.stringify({
      authStrategy: config.authStrategy,
      dockerContainer: config.dockerContainer,
      authDataPath: authDataPath,
    }),
  );

  // remove Chrome lock file if it exists
  try {
    fs.rmSync(authDataPath + '/SingletonLock', { force: true });
  } catch {
    // Ignore if file doesn't exist
  }

  // Set up Puppeteer options for different environments
  const npx_args = { headless: true };
  const docker_args = {
    headless: true,
    userDataDir: authDataPath,
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
      '--user-data-dir=/var/data/whatsapp/chrome-data',
      '--disable-web-security',
    ],
    timeout: 120000, // 2 minute timeout
  };

  // Log puppeteer configuration
  logger.debug('Puppeteer configuration:', config.dockerContainer ? docker_args : npx_args);
  logger.info(
    `Using Chrome executable: ${config.dockerContainer ? docker_args.executablePath : 'default'}`,
  );

  const authStrategy =
    config.authStrategy === 'local' && !config.dockerContainer
      ? new LocalAuth({
          dataPath: authDataPath,
        })
      : new NoAuth();

  logger.debug('Creating Client with auth strategy:', config.authStrategy);

  const puppeteer = config.dockerContainer ? docker_args : npx_args;

  const clientOptions: ClientOptions = {
    puppeteer,
    authStrategy,
    restartOnAuthFail: true,
    authTimeoutMs: 60000,
  };

  if (config.authStrategy === 'local') {
    clientOptions.authStrategy = new LocalAuth({
      dataPath: authDataPath,
    });
    logger.info(`Using LocalAuth with data path: ${authDataPath}`);
  }

  // Add any custom options to client options
  const customOptions = {
    qrTimeoutMs: 60000,
  };

  // Merge options for the enhanced client
  const enhancedOptions = { ...clientOptions, ...customOptions };

  return new EnhancedWhatsAppClient(enhancedOptions);
}
