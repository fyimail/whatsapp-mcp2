import * as express from 'express';

// Create a simple express server
const app = express();
const PORT = process.env.PORT || 3000;

// Add basic request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Simple error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(`[ERROR] ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

// Root endpoint - simple HTML response
app.get('/', (_req, res) => {
  res.send(`
    <html>
      <head><title>Minimal WhatsApp API</title></head>
      <body>
        <h1>Minimal WhatsApp API</h1>
        <p>Server is running</p>
        <p>Server time: ${new Date().toISOString()}</p>
        <p>Node version: ${process.version}</p>
        <p>Available endpoints:</p>
        <ul>
          <li><a href="/health">Health Check</a></li>
          <li><a href="/env">Environment Info</a></li>
        </ul>
      </body>
    </html>
  `);
});

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Environment variables endpoint
app.get('/env', (_req, res) => {
  // Filter out any sensitive variables
  const safeEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.toLowerCase().includes('key') &&
        !key.toLowerCase().includes('token') &&
        !key.toLowerCase().includes('secret') &&
        !key.toLowerCase().includes('pass') &&
        !key.toLowerCase().includes('auth'),
    ),
  );

  res.status(200).json({
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    env: safeEnv,
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[${new Date().toISOString()}] Minimal server listening on port ${PORT}`);
});

// Handle termination gracefully
process.on('SIGINT', () => {
  console.log(`[${new Date().toISOString()}] Server shutting down`);
  process.exit(0);
});

process.on('uncaughtException', error => {
  console.error(`[${new Date().toISOString()}] Uncaught exception: ${error.message}`);
  // Keep server running despite errors
});
