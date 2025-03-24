#!/bin/bash
# Local testing script with optimal settings for Render compatibility

# Build the TypeScript code with type errors ignored
npm run build:force

# Run in WhatsApp API mode with settings that match our previous success
node dist/main.js \
  --mode whatsapp-api \
  --api-port 3000 \
  --auth-data-path ./.wwebjs_auth \
  --log-level info
