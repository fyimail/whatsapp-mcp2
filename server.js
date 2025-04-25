// Ultra-minimal HTTP server with no dependencies
const http = require('http');

// Start logging immediately
console.log(`[STARTUP] Starting minimal HTTP server`);
console.log(`[STARTUP] Node version: ${process.version}`);
console.log(`[STARTUP] Platform: ${process.platform}`);
console.log(`[STARTUP] PORT: ${process.env.PORT || 3000}`);

// Create timestamp helper function
const timestamp = () => new Date().toISOString();

// Error logging helper
const logError = (context, error) => {
  console.error(`[${timestamp()}] [ERROR] ${context}: ${error.message}`);
  console.error(error.stack);
  return error;
};

// Create server with no dependencies
const server = http.createServer((req, res) => {
  try {
    const url = req.url;
    const method = req.method;
    const requestId = Math.random().toString(36).substring(2, 10);
    
    console.log(`[${timestamp()}] [${requestId}] ${method} ${url}`);

    // Set common headers
    res.setHeader('X-Request-ID', requestId);
    res.setHeader('Server', 'WhatsApp-MCP-Server');
    
    // CORS support
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle OPTIONS requests for CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check endpoint
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        status: 'ok', 
        timestamp: timestamp(),
        uptime: process.uptime(),
        memory: process.memoryUsage()
      }));
      return;
    }

    // Root endpoint
    if (url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <head>
            <title>WhatsApp MCP Server</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
              h1 { color: #075E54; }
              .info { background: #f5f5f5; padding: 20px; border-radius: 5px; }
            </style>
          </head>
          <body>
            <h1>WhatsApp MCP Server</h1>
            <div class="info">
              <p>Server is running without any dependencies</p>
              <p>Server time: ${timestamp()}</p>
              <p>Node version: ${process.version}</p>
              <p>Platform: ${process.platform}</p>
              <p>Uptime: ${Math.floor(process.uptime())} seconds</p>
              <p><a href="/health">Health Check</a></p>
            </div>
          </body>
        </html>
      `);
      return;
    }

    // 404 for everything else
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'error', 
      code: 'NOT_FOUND',
      message: 'The requested resource was not found',
      path: url,
      timestamp: timestamp()
    }));
    
  } catch (error) {
    logError('Request handler', error);
    
    // Send error response if headers not sent yet
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        status: 'error', 
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
        timestamp: timestamp()
      }));
    }
  }
});

// Listen on all interfaces
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[${timestamp()}] Server listening on port ${PORT}`);
});

// Handle server errors
server.on('error', (error) => {
  logError('Server error', error);
  
  if (error.code === 'EADDRINUSE') {
    console.error(`[${timestamp()}] Port ${PORT} is already in use`);
    process.exit(1);
  }
});

// Handle termination gracefully
process.on('SIGINT', () => {
  console.log(`[${timestamp()}] Server shutting down`);
  server.close(() => {
    console.log(`[${timestamp()}] Server closed`);
    process.exit(0);
  });
  
  // Force close after timeout
  setTimeout(() => {
    console.error(`[${timestamp()}] Server forced to close after timeout`);
    process.exit(1);
  }, 5000);
});

process.on('uncaughtException', error => {
  logError('Uncaught exception', error);
  // Keep server running despite errors
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`[${timestamp()}] Unhandled Promise Rejection`);
  console.error('Promise:', promise);
  console.error('Reason:', reason);
});

console.log(`[${timestamp()}] Server initialization complete`);
