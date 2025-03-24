// Ultra-minimal HTTP server with no dependencies
const http = require('http');

// Start logging immediately
console.log(`[STARTUP] Starting minimal HTTP server`);
console.log(`[STARTUP] Node version: ${process.version}`);
console.log(`[STARTUP] Platform: ${process.platform}`);
console.log(`[STARTUP] PORT: ${process.env.PORT || 3000}`);

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
  if (url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html>
        <head><title>Minimal Server</title></head>
        <body>
          <h1>Minimal Node.js Server</h1>
          <p>Server is running without any dependencies</p>
          <p>Server time: ${new Date().toISOString()}</p>
          <p>Node version: ${process.version}</p>
          <p><a href="/health">Health Check</a></p>
        </body>
      </html>
    `);
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
