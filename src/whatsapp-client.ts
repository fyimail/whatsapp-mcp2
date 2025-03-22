import { Client, LocalAuth, Message, NoAuth, ClientOptions, AuthStrategy } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import logger from './logger';
import fs from 'fs';
import path from 'path';

// Configuration interface
export interface WhatsAppConfig {
  authStrategy?: string;
  authDir?: string;
}

// Enhanced WhatsApp client with detailed logging
class EnhancedWhatsAppClient extends Client {
  constructor(options: ClientOptions) {
    super(options);
    logger.info('Enhanced WhatsApp client created with options', {
      authStrategy: options.authStrategy ? 'provided' : 'not provided',
      puppeteerOptions: {
        executablePath: options.puppeteer?.executablePath || 'default',
        headless: options.puppeteer?.headless,
        args: options.puppeteer?.args?.join(', ') || 'none',
      },
    });

    // Add detailed event logging
    this.on('qr', qr => {
      logger.info('QR Code received', { length: qr.length });

      // Save QR code to a file for easy access
      try {
        const qrPath = '/var/data/whatsapp/last-qr.txt';
        fs.writeFileSync(qrPath, qr);
        logger.info(`QR Code saved to ${qrPath}`);
      } catch (error) {
        logger.error('Failed to save QR code to file', error);
      }
    });

    this.on('ready', () => {
      logger.info('WhatsApp client is ready and fully operational');
    });

    this.on('authenticated', () => {
      logger.info('WhatsApp client authenticated successfully');
    });

    this.on('auth_failure', msg => {
      logger.error('Authentication failure', msg);
    });

    this.on('disconnected', reason => {
      logger.warn('WhatsApp client disconnected', reason);
    });

    this.on('loading_screen', (percent, message) => {
      logger.info(`Loading: ${percent}% - ${message}`);
    });

    this.on('change_state', state => {
      logger.info(`Client state changed to: ${state}`);
    });

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
      // Check Puppeteer data directory
      const userDataDir = '/tmp/puppeteer_data';
      if (!fs.existsSync(userDataDir)) {
        logger.info(`Creating Puppeteer data directory: ${userDataDir}`);
        fs.mkdirSync(userDataDir, { recursive: true });
        fs.chmodSync(userDataDir, '777');
      }

      // Log environment variables
      logger.info('Environment variables for Puppeteer', {
        PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH,
        DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
        NODE_ENV: process.env.NODE_ENV,
      });

      // Check if Chromium exists
      try {
        const { execSync } = require('child_process');
        const chromiumVersion = execSync('chromium --version 2>&1').toString().trim();
        logger.info(`Chromium version: ${chromiumVersion}`);
      } catch (error) {
        logger.error('Error checking Chromium version', error);
      }

      logger.info('Calling original initialize method');
      return super.initialize();
    } catch (error) {
      logger.error('Error during client initialization', error);
      throw error;
    }
  }
}

export function createWhatsAppClient(config: WhatsAppConfig = {}): Client {
  const authDataPath = path.join(config.authDir || '.', 'wwebjs_auth');
  logger.info(`Using LocalAuth with data path: ${authDataPath}`);

  // Ensure auth directory exists
  if (!fs.existsSync(authDataPath)) {
    logger.info(`Auth directory created: ${authDataPath}`);
    fs.mkdirSync(authDataPath, { recursive: true });
  }

  let authStrategy: AuthStrategy | undefined = undefined;
  if (typeof config.authStrategy === 'undefined' || config.authStrategy === 'local') {
    logger.info(`Using auth strategy: local`);
    authStrategy = new LocalAuth({ dataPath: authDataPath });
  } else {
    logger.info('Using NoAuth strategy');
    authStrategy = new NoAuth();
  }

  // DON'T set userDataDir in puppeteer options or --user-data-dir in args
  const puppeteerOptions = {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--disable-extensions',
      '--ignore-certificate-errors',
      '--disable-storage-reset',
      '--disable-infobars',
      '--window-size=1280,720',
      '--remote-debugging-port=0',
      '--user-data-dir=/tmp/puppeteer_data',
      '--disable-features=AudioServiceOutOfProcess',
      '--mute-audio',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36',
    ],
    timeout: 0, // No timeout to allow for slower initialization
    dumpio: true, // Output browser process stdout and stderr
  };

  // Log puppeteer configuration
  logger.info(`Using Puppeteer executable path: ${puppeteerOptions.executablePath}`);
  logger.debug('Puppeteer options:', puppeteerOptions);

  // Create client options
  const clientOptions: ClientOptions = {
    puppeteer: puppeteerOptions,
    authStrategy: authStrategy,
    restartOnAuthFail: true,
    authTimeoutMs: 120000, // Increase auth timeout to 2 minutes
  };

  // Create custom options with any non-standard parameters
  const customOptions = {
    qrTimeoutMs: 120000,
  };

  // Merge options for the enhanced client
  const enhancedOptions = { ...clientOptions, ...customOptions };

  logger.info('Creating enhanced WhatsApp client');
  return new EnhancedWhatsAppClient(enhancedOptions);
}
