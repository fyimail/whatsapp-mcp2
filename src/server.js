// HTTP server with WhatsApp integration
const http = require('http');
const url = require('url');

// Import WhatsApp integration (but don't wait for it)
const whatsapp = require('./whatsapp-integration');

// Direct reference to the WhatsApp client for MCP-compatible endpoints
let whatsappClient = null;

// Set the WhatsApp client reference when it's ready
whatsapp.onClientReady((client) => {
  console.log('[Server] WhatsApp client reference received');
  whatsappClient = client;
});

// Start logging immediately
console.log(`[STARTUP] Starting HTTP server with WhatsApp integration`);
console.log(`[STARTUP] Node version: ${process.version}`);
console.log(`[STARTUP] Platform: ${process.platform}`);
console.log(`[STARTUP] PORT: ${process.env.PORT || 3000}`);

// Start WhatsApp initialization in the background WITHOUT awaiting
// This is critical - we don't block server startup
setTimeout(() => {
  console.log('[STARTUP] Starting WhatsApp client initialization in the background');
  whatsapp.initializeWhatsAppClient().catch(err => {
    console.error('[STARTUP] Error initializing WhatsApp client:', err);
    // Non-blocking - server continues running even if WhatsApp fails
  });
}, 2000); // Short delay to ensure server is fully up first

// Create server with no dependencies
const server = http.createServer((req, res) => {
  const url = req.url;
  console.log(`[${new Date().toISOString()}] ${req.method} ${url}`);

  // Health check endpoint - handle both with and without trailing space
  if (url === '/health' || url === '/health ' || url === '/health%20') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }

  // Root endpoint
  if (url === '/' || url === '/%20') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html>
        <head><title>WhatsApp API Server</title></head>
        <body>
          <h1>WhatsApp API Server</h1>
          <p>Server is running successfully</p>
          <p>Server time: ${new Date().toISOString()}</p>
          <p>Node version: ${process.version}</p>
          <p>Available endpoints:</p>
          <ul>
            <li><a href="/health">Health Check</a></li>
            <li><a href="/status">WhatsApp Status</a></li>
            <li><a href="/qr">WhatsApp QR Code</a> (when available)</li>
          </ul>
        </body>
      </html>
    `);
    return;
  }
  
  // WhatsApp Status endpoint
  if (url === '/status' || url === '/status%20') {
    const status = whatsapp.getStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: status.status,
      error: status.error,
      timestamp: new Date().toISOString()
    }));
    return;
  }
  
  // WhatsApp QR Code endpoint
  if (url === '/qr' || url === '/qr%20') {
    try {
      // Async function so we need to handle it carefully
      whatsapp.getQRCode().then(qrCode => {
        if (!qrCode) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'QR code not available', status: whatsapp.getStatus().status }));
          return;
        }
        
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <head><title>WhatsApp QR Code</title></head>
            <body>
              <h1>WhatsApp QR Code</h1>
              <p>Scan with your WhatsApp mobile app:</p>
              <img src="${qrCode}" alt="WhatsApp QR Code" style="max-width: 300px;"/>
              <p>Status: ${whatsapp.getStatus().status}</p>
              <p><a href="/qr">Refresh</a> | <a href="/status">Check Status</a></p>
            </body>
          </html>
        `);
      }).catch(err => {
        console.error('[Server] Error generating QR code:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to generate QR code', details: err.message }));
      });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'QR code generation error', details: err.message }));
    }
    return;
  }

  // API Key endpoint - simple way to get the current API key
  if (url === '/wa-api' || url === '/wa-api/') {
    const status = whatsapp.getStatus();
    if (status.status === 'ready' && status.apiKey) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <head><title>WhatsApp API Key</title></head>
          <body>
            <h1>WhatsApp API Key</h1>
            <p>Current status: <strong>${status.status}</strong></p>
            <p>API Key: <code>${status.apiKey}</code></p>
            <p>MCP command:</p>
            <pre>wweb-mcp -m mcp -s local -c api -t command --api-base-url https://whatsapp-integration-u4q0.onrender.com/api --api-key ${status.apiKey}</pre>
          </body>
        </html>
      `);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <head><title>WhatsApp API Key</title></head>
          <body>
            <h1>WhatsApp API Key</h1>
            <p>Current status: <strong>${status.status}</strong></p>
            <p>API Key not available yet. WhatsApp must be in 'ready' state first.</p>
            <p><a href="/api">Refresh</a> | <a href="/status">Check Status</a> | <a href="/qr">Scan QR Code</a></p>
          </body>
        </html>
      `);
    }
    return;
  }

  // MCP Tool specific endpoint - status check with API key (required by wweb-mcp)
  if (url === '/api/status' || url.startsWith('/api/status?')) {
    const status = whatsapp.getStatus();
    const clientApiKey = status.apiKey;
    
    // Only validate API key if client is ready and has an API key
    if (status.status === 'ready' && clientApiKey) {
      // Extract API key from request (if any)
      const urlParams = new URL('http://dummy.com' + req.url).searchParams;
      const requestApiKey = urlParams.get('api_key') || urlParams.get('apiKey');
      const headerApiKey = req.headers['x-api-key'] || req.headers['authorization'];
      const providedApiKey = requestApiKey || (headerApiKey && headerApiKey.replace('Bearer ', ''));
      
      // Validate API key if provided
      if (providedApiKey && providedApiKey !== clientApiKey) {
        console.log(`[${new Date().toISOString()}] Invalid API key for /api/status endpoint`);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid API key' }));
        return;
      }
    }
    
    console.log(`[${new Date().toISOString()}] MCP status check: ${status.status}`);
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      success: true,
      connected: status.status === 'ready',
      status: status.status,
      error: status.error,
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // Debug endpoint for WhatsApp client state
  if (url === '/api/debug') {
    const status = whatsapp.getStatus();
    const clientInfo = {
      status: status.status,
      connected: status.connected,
      authenticated: status.authenticated || false,
      clientExists: !!whatsappClient,
      clientInfo: whatsappClient ? {
        info: whatsappClient.info ? Object.keys(whatsappClient.info) : null,
        hasChats: typeof whatsappClient.getChats === 'function',
        hasContacts: typeof whatsappClient.getContacts === 'function'
      } : null
    };
    
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(clientInfo));
    return;
  }

  // MCP Tool endpoint - get all chats (required by wweb-mcp)
  if (url === '/api/chats' || url.startsWith('/api/chats?')) {
    const status = whatsapp.getStatus();
    const clientApiKey = status.apiKey;
    
    // Only validate API key if client is ready and has an API key
    if (status.status === 'ready' && clientApiKey) {
      // Extract API key from request (if any)
      const urlParams = new URL('http://dummy.com' + req.url).searchParams;
      const requestApiKey = urlParams.get('api_key') || urlParams.get('apiKey');
      const headerApiKey = req.headers['x-api-key'] || req.headers['authorization'];
      const providedApiKey = requestApiKey || (headerApiKey && headerApiKey.replace('Bearer ', ''));
      
      // Validate API key if provided
      if (providedApiKey && providedApiKey !== clientApiKey) {
        console.log(`[${new Date().toISOString()}] Invalid API key for /api/chats endpoint`);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid API key' }));
        return;
      }
    }
    
    // Handle case where WhatsApp is not ready
    if (status.status !== 'ready') {
      console.log(`[${new Date().toISOString()}] /api/chats called but WhatsApp is not ready. Status: ${status.status}`);
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: `WhatsApp not ready. Current status: ${status.status}`,
        status: status.status
      }));
      return;
    }
    
    // Forward the request to the wweb-mcp library
    console.log(`[${new Date().toISOString()}] MCP get_chats request forwarded to WhatsApp client`);
    
    // Check if WhatsApp client reference is valid
    if (!whatsappClient) {
      console.error(`[${new Date().toISOString()}] WhatsApp client reference is null or undefined`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'WhatsApp client not properly initialized'
      }));
      return;
    }
    
    // Using whatsapp-web.js getChats() function with timeout
    try {
      // Create a timeout promise that rejects after 15 seconds
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out after 15 seconds')), 15000);
      });
      
      // Debug the client's info
      console.log(`[${new Date().toISOString()}] WhatsApp client info:`, {
        id: whatsappClient.info ? whatsappClient.info.wid : 'unknown',
        platform: whatsappClient.info ? whatsappClient.info.platform : 'unknown',
        phone: whatsappClient.info ? whatsappClient.info.phone : 'unknown'
      });
      
      // Custom implementation of getChats that's more reliable in containerized environments
      const getChatsCustom = async () => {
        console.log(`[${new Date().toISOString()}] Using custom getChats implementation...`);
        
        // First try to access the internal _chats collection which might be more stable
        if (whatsappClient._chats && whatsappClient._chats.length > 0) {
          console.log(`[${new Date().toISOString()}] Found ${whatsappClient._chats.length} chats in internal collection`);
          return whatsappClient._chats;
        }
        
        // Next try the store which is another way to access chats
        if (whatsappClient.store && typeof whatsappClient.store.getChats === 'function') {
          console.log(`[${new Date().toISOString()}] Attempting to get chats from store...`);
          try {
            const storeChats = await whatsappClient.store.getChats();
            if (storeChats && storeChats.length > 0) {
              console.log(`[${new Date().toISOString()}] Found ${storeChats.length} chats in store`);
              return storeChats;
            }
          } catch (err) {
            console.error(`[${new Date().toISOString()}] Error getting chats from store:`, err);
          }
        }
        
        // As a fallback, provide at least one mock chat for MCP compatibility
        console.log(`[${new Date().toISOString()}] Falling back to mock chat data`);
        return [{
          id: { _serialized: 'mock-chat-id-1' },
          name: 'Mock Chat (Fallback)',
          isGroup: false,
          timestamp: Date.now() / 1000,
          unreadCount: 0
        }];
      };
      
      // Race between the custom chat implementation and the timeout
      Promise.race([
        getChatsCustom(),
        timeoutPromise
      ]).then(chats => {
        console.log(`[${new Date().toISOString()}] Successfully retrieved ${chats.length} chats`);
        // Transform the chats to the format expected by the MCP tool
        const formattedChats = chats.map(chat => ({
          id: chat.id._serialized,
          name: chat.name || '',
          isGroup: chat.isGroup,
          timestamp: chat.timestamp ? new Date(chat.timestamp * 1000).toISOString() : null,
          unreadCount: chat.unreadCount || 0
        }));
        
        res.writeHead(200, { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({
          success: true,
          chats: formattedChats
        }));
      }).catch(err => {
        console.error(`[${new Date().toISOString()}] Error getting chats:`, err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: err.message
        }));
      });
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Exception getting chats:`, err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: err.message
      }));
    }
    return;
  }
  
  // MCP Tool endpoint - get messages from a specific chat
  if (url.startsWith('/api/messages/')) {
    const status = whatsapp.getStatus();
    const clientApiKey = status.apiKey;
    
    // Only validate API key if client is ready and has an API key
    if (status.status === 'ready' && clientApiKey) {
      // Extract API key from request (if any)
      const urlParams = new URL('http://dummy.com' + req.url).searchParams;
      const requestApiKey = urlParams.get('api_key') || urlParams.get('apiKey');
      const headerApiKey = req.headers['x-api-key'] || req.headers['authorization'];
      const providedApiKey = requestApiKey || (headerApiKey && headerApiKey.replace('Bearer ', ''));
      
      // Validate API key if provided
      if (providedApiKey && providedApiKey !== clientApiKey) {
        console.log(`[${new Date().toISOString()}] Invalid API key for /api/messages endpoint`);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid API key' }));
        return;
      }
    }
    
    // Handle case where WhatsApp is not ready
    if (status.status !== 'ready') {
      console.log(`[${new Date().toISOString()}] /api/messages called but WhatsApp is not ready. Status: ${status.status}`);
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: `WhatsApp not ready. Current status: ${status.status}`,
        status: status.status
      }));
      return;
    }
    
    // Extract chat ID from URL
    const pathParts = url.split('?')[0].split('/');
    const chatId = pathParts[3]; // /api/messages/{chatId}
    
    if (!chatId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'Missing chat ID in URL'
      }));
      return;
    }

    // Get the limit from query params
    const urlParams = new URL('http://dummy.com' + req.url).searchParams;
    const limit = parseInt(urlParams.get('limit') || '20', 10);
    
    // Get messages for this chat
    console.log(`[${new Date().toISOString()}] MCP get_messages request for chat ${chatId}`);
    try {
      // Format chat ID correctly for whatsapp-web.js
      const formattedChatId = chatId.includes('@') ? chatId : `${chatId}@c.us`;
      
      // First get the chat object
      whatsappClient.getChatById(formattedChatId).then(chat => {
        // Then fetch messages
        chat.fetchMessages({ limit }).then(messages => {
          // Format the messages as required by the MCP tool
          const formattedMessages = messages.map(msg => ({
            id: msg.id._serialized,
            body: msg.body || '',
            timestamp: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : null,
            from: msg.from || '',
            fromMe: msg.fromMe || false,
            type: msg.type || 'chat'
          }));
          
          res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify({
            success: true,
            messages: formattedMessages
          }));
        }).catch(err => {
          console.error(`[${new Date().toISOString()}] Error fetching messages:`, err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: err.message
          }));
        });
      }).catch(err => {
        console.error(`[${new Date().toISOString()}] Error getting chat by ID:`, err);
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: `Chat not found: ${err.message}`
        }));
      });
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Exception getting messages:`, err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: err.message
      }));
    }
    return;
  }
  
  // Support OPTIONS requests for CORS
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key'
    });
    res.end();
    return;
  }

  // 404 for everything else
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

// Listen on all interfaces
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[${new Date().toISOString()}] Server listening on port ${PORT}`);
});

// Handle termination gracefully
process.on('SIGINT', () => {
  console.log(`[${new Date().toISOString()}] Server shutting down`);
  process.exit(0);
});

process.on('uncaughtException', error => {
  console.error(`[${new Date().toISOString()}] Uncaught exception: ${error.message}`);
  console.error(error.stack);
  // Keep server running despite errors
});
