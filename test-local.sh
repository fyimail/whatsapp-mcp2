#!/bin/bash
# Local testing script with optimal settings for Render compatibility

# Build the TypeScript code with type errors ignored
npm run build:force

# Kill any existing server instances
pkill -f "node dist/main.js" || true

# Run in WhatsApp API mode with settings that match our Render deployment
# This ensures the Express server starts IMMEDIATELY and doesn't wait for WhatsApp initialization
node dist/main.js \
  --mode whatsapp-api \
  --api-port 3000 \
  --auth-data-path ./.wwebjs_auth \
  --log-level info
