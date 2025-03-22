import { Client, LocalAuth, Message, NoAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import logger from './logger';
import fs from 'fs';

// Configuration interface
export interface WhatsAppConfig {
  authDataPath?: string;
  authStrategy?: 'local' | 'none';
  dockerContainer?: boolean;
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

  const client = new Client({
    puppeteer,
    authStrategy,
    restartOnAuthFail: true,
  });

  logger.debug('Client created, setting up event handlers');

  // Add more detailed initialization logging
  client.on('qr', (qr: string) => {
    logger.debug('QR code event triggered');
    // Display QR code in terminal
    qrcode.generate(qr, { small: true }, qrcode => {
      logger.info(`QR code generated. Scan it with your phone to log in.\n${qrcode}`);
    });

    // Also log the raw QR code for backup
    logger.info(`Raw QR Code: ${qr}`);
  });

  // Log initialization events with more detail
  client.on('loading_screen', (percent, message) => {
    logger.info(`Loading: ${percent}% - ${message}`);
  });

  // Add detailed logging for Puppeteer/browser events
  client.on('change_state', state => {
    logger.info(`Client state changed to: ${state}`);
  });

  client.on('ready', async () => {
    logger.info('Client is ready!');
  });

  client.on('authenticated', () => {
    logger.info('Authentication successful!');
  });

  client.on('auth_failure', error => {
    logger.error('Authentication failed:', error);
  });

  client.on('disconnected', reason => {
    logger.warn('Client was disconnected:', reason);
  });

  // Handle incoming messages
  client.on('message', async (message: Message) => {
    const contact = await message.getContact();
    logger.debug(`${contact.pushname} (${contact.number}): ${message.body}`);
  });

  // Add more debugging for initialization
  const originalInitialize = client.initialize.bind(client);
  client.initialize = async () => {
    logger.debug('Starting client initialization...');
    try {
      logger.debug('Calling original initialize method');
      const result = await originalInitialize();
      logger.debug('Initialize method completed successfully');
      return result;
    } catch (error) {
      logger.error('Error during initialization:', error);
      throw error;
    }
  };

  return client;
}
