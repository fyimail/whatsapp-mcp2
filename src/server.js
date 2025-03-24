// HTTP server with WhatsApp integration
const http = require('http');
const url = require('url');

// Import WhatsApp integration (but don't wait for it)
const whatsapp = require('./whatsapp-integration');

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
  if (url === '/api' || url === '/api/') {
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

  // MCP Tool specific endpoint - status check with API key
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
