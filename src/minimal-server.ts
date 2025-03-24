// minimal-server.ts
const express = require('express');
import type { Request, Response } from 'express';
const app = express();
const PORT = process.env.PORT || 3000;

// Log startup information immediately
console.log(`[STARTUP] Starting minimal server on port ${PORT}`);
console.log(`[STARTUP] Node version: ${process.version}`);

// Health check endpoint - CRITICAL for Render
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.send('Minimal server is running');
});

// Start server IMMEDIATELY for Render to detect
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
