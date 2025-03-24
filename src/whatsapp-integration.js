// WhatsApp client initialization module
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

// Global variables to track WhatsApp client status
let whatsappClient = null;
let connectionStatus = 'disconnected';
let qrCodeData = null;
let initializationError = null;

// Function to initialize WhatsApp client
async function initializeWhatsAppClient() {
  console.log('[WhatsApp] Starting WhatsApp client initialization');
  
  try {
    // Initialize the WhatsApp client
    whatsappClient = new Client({
      authStrategy: new LocalAuth({ dataPath: '/app/.wwebjs_auth' }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
      }
    });

    // Set up event handlers
    whatsappClient.on('qr', (qr) => {
      console.log('[WhatsApp] QR code received');
      qrCodeData = qr;
      connectionStatus = 'qr_received';
    });

    whatsappClient.on('ready', () => {
      console.log('[WhatsApp] Client is ready');
      connectionStatus = 'ready';
      qrCodeData = null;
    });

    whatsappClient.on('authenticated', () => {
      console.log('[WhatsApp] Client is authenticated');
      connectionStatus = 'authenticated';
    });

    whatsappClient.on('auth_failure', (error) => {
      console.error('[WhatsApp] Authentication failure', error);
      connectionStatus = 'auth_failure';
      initializationError = error.message;
    });

    whatsappClient.on('disconnected', (reason) => {
      console.log('[WhatsApp] Client disconnected', reason);
      connectionStatus = 'disconnected';
      // Attempt to reinitialize after disconnection
      setTimeout(initializeWhatsAppClient, 5000);
    });

    // Initialize the client (this will trigger the QR code event)
    console.log('[WhatsApp] Initializing client...');
    connectionStatus = 'initializing';
    await whatsappClient.initialize();
    
  } catch (error) {
    console.error('[WhatsApp] Failed to initialize WhatsApp client', error);
    connectionStatus = 'error';
    initializationError = error.message;
    // Retry initialization after a delay
    setTimeout(initializeWhatsAppClient, 10000);
  }
}

// Export functions and state for the HTTP server to use
module.exports = {
  initializeWhatsAppClient,
  getStatus: () => ({
    status: connectionStatus,
    error: initializationError
  }),
  getQRCode: async () => {
    if (!qrCodeData) {
      return null;
    }
    
    try {
      // Generate QR code as data URL
      return await qrcode.toDataURL(qrCodeData);
    } catch (error) {
      console.error('[WhatsApp] Failed to generate QR code', error);
      return null;
    }
  },
  sendMessage: async (to, message) => {
    if (connectionStatus !== 'ready') {
      throw new Error(`Cannot send message. WhatsApp status: ${connectionStatus}`);
    }
    
    try {
      const formattedNumber = to.includes('@c.us') ? to : `${to}@c.us`;
      return await whatsappClient.sendMessage(formattedNumber, message);
    } catch (error) {
      console.error('[WhatsApp] Failed to send message', error);
      throw error;
    }
  }
};
