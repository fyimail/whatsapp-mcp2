import { Client, LocalAuth, Message, NoAuth, ClientOptions, AuthStrategy } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import logger from './logger';
import fs from 'fs';
import path from 'path';

// Configuration interface
export interface WhatsAppConfig {
  authStrategy?: string;
  authDir?: string;
  dockerContainer?: boolean;
}

// Enhanced WhatsApp client with detailed logging
class EnhancedWhatsAppClient extends Client {
  constructor(options: ClientOptions) {
    super(options);
    logger.info('[WA] Enhanced WhatsApp client created with options', {
      authStrategy: options.authStrategy ? 'provided' : 'not provided',
      puppeteerOptions: {
        executablePath: options.puppeteer?.executablePath || 'default',
        headless: options.puppeteer?.headless,
        // Log only first few args to reduce verbosity
        args: options.puppeteer?.args?.slice(0, 3).join(', ') + '...' || 'none',
      },
    });

    // Add detailed event logging
    this.on('qr', qr => {
      logger.info('[WA] QR Code received', { length: qr.length });

      // Save QR code to a file for easy access
      try {
        const qrDir = '/var/data/whatsapp';
        const qrPath = `${qrDir}/last-qr.txt`;

        // Ensure the directory exists
        if (!fs.existsSync(qrDir)) {
          fs.mkdirSync(qrDir, { recursive: true });
          logger.info(`[WA] Created directory ${qrDir}`);
        }

        // Write the QR code to the file with explicit permissions
        fs.writeFileSync(qrPath, qr, { mode: 0o666 });
        logger.info(`[WA] QR Code saved to ${qrPath}`);

        // Verify the file was written
        if (fs.existsSync(qrPath)) {
          const stats = fs.statSync(qrPath);
          logger.info(`[WA] QR file created successfully: ${stats.size} bytes`);
        } else {
          logger.error(`[WA] QR file not found after write attempt!`);
        }
      } catch (error) {
        logger.error('[WA] Failed to save QR code to file', error);
      }
    });

    this.on('ready', () => {
      logger.info('[WA] WhatsApp client is ready and fully operational');
      // Log a marker for minimal post-initialization logs
      logger.info('[WA] --------- INITIALIZATION COMPLETE - REDUCING LOG VERBOSITY ---------');
    });

    this.on('authenticated', () => {
      logger.info('[WA] WhatsApp client authenticated successfully');
    });

    this.on('auth_failure', msg => {
      logger.error('[WA] Authentication failure', msg);
    });

    this.on('disconnected', reason => {
      logger.warn('[WA] WhatsApp client disconnected', reason);
    });

    // Reduce loading screen log frequency
    let lastLoggedPercent = 0;
    this.on('loading_screen', (percent, message) => {
      // Convert percent to a number to ensure proper comparison
      const percentNum = parseInt(percent.toString(), 10);
      // Only log every 20% to reduce log spam
      if (percentNum - lastLoggedPercent >= 20 || percentNum === 100) {
        logger.info(`[WA] Loading: ${percentNum}% - ${message}`);
        lastLoggedPercent = percentNum;
      }
    });

    // Only log significant state changes
    this.on('change_state', state => {
      // Log only important state changes
      if (['CONNECTED', 'DISCONNECTED', 'CONFLICT', 'UNLAUNCHED'].includes(state)) {
        logger.info(`[WA] Client state changed to: ${state}`);
      } else {
        logger.debug(`[WA] Client state changed to: ${state}`);
      }
    });

    this.on('error', error => {
      logger.error('[WA] Client error:', error);
    });

    // Minimize message logging to debug level and only for new conversations
    const recentChats = new Set<string>();
    this.on('message', async (message: Message) => {
      try {
        // Only log at debug level and only first message from each contact
        if (process.env.NODE_ENV !== 'production') {
          const chatId = message.from || '';
          if (chatId && !recentChats.has(chatId)) {
            const contact = await message.getContact();
            logger.debug(`[WA] Message from ${contact.pushname || 'unknown'} (${contact.number})`);
            // Add to recent chats and limit size to prevent memory growth
            recentChats.add(chatId);
            if (recentChats.size > 50) {
              const firstItem = recentChats.values().next().value;
              if (firstItem !== undefined) {
                recentChats.delete(firstItem);
              }
            }
          }
        }
      } catch (error) {
        // Silently ignore message logging errors
      }
    });
  }

  async initialize() {
    logger.info('[WA] Starting client initialization...');

    try {
      // Check Puppeteer data directory
      const userDataDir = '/tmp/puppeteer_data';
      if (!fs.existsSync(userDataDir)) {
        logger.info(`[WA] Creating Puppeteer data directory: ${userDataDir}`);
        fs.mkdirSync(userDataDir, { recursive: true });
        fs.chmodSync(userDataDir, '777');
      }

      // Log environment variables (at debug level to reduce production logs)
      logger.debug('[WA] Environment variables for Puppeteer', {
        PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH,
        DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
        NODE_ENV: process.env.NODE_ENV,
      });

      // Check if Chromium exists - only in dev environment
      if (process.env.NODE_ENV !== 'production') {
        try {
          const { execSync } = require('child_process');
          const chromiumVersion = execSync('chromium --version 2>&1').toString().trim();
          logger.debug(`[WA] Chromium version: ${chromiumVersion}`);
        } catch (error) {
          logger.error('[WA] Error checking Chromium version', error);
        }
      }

      logger.info('[WA] Calling original initialize method');
      return super.initialize();
    } catch (error) {
      logger.error('[WA] Error during client initialization', error);
      throw error;
    }
  }
}

export function createWhatsAppClient(config: WhatsAppConfig = {}): Client {
  const authDataPath = path.join(config.authDir || '.', 'wwebjs_auth');
  logger.info(`[WA] Using LocalAuth with data path: ${authDataPath}`);

  // Ensure auth directory exists
  if (!fs.existsSync(authDataPath)) {
    logger.info(`[WA] Auth directory created: ${authDataPath}`);
    fs.mkdirSync(authDataPath, { recursive: true });
  }

  let authStrategy: AuthStrategy | undefined = undefined;
  if (typeof config.authStrategy === 'undefined' || config.authStrategy === 'local') {
    logger.info(`[WA] Using auth strategy: local`);
    authStrategy = new LocalAuth({ dataPath: authDataPath });
  } else {
    logger.info('[WA] Using NoAuth strategy');
    authStrategy = new NoAuth();
  }

  // DON'T set userDataDir in puppeteer options or --user-data-dir in args
  const puppeteerOptions = {
    headless: true,
    // Detect platform and use appropriate Chrome path
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 
      (process.platform === 'darwin' 
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : '/usr/bin/google-chrome-stable'),
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
  logger.info(`[WA] Using Puppeteer executable path: ${puppeteerOptions.executablePath}`);
  logger.debug('[WA] Puppeteer options:', puppeteerOptions);

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

  logger.info('[WA] Creating enhanced WhatsApp client');
  return new EnhancedWhatsAppClient(enhancedOptions);
}
