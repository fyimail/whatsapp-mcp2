FROM node:16-slim

# Set environment variables
ENV NODE_ENV=production
ENV DOCKER_CONTAINER=true
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV DBUS_SESSION_BUS_ADDRESS=/dev/null
ENV DEBUG=puppeteer:*,whatsapp-web:*

WORKDIR /app

# Create data directory structure
RUN mkdir -p /app/data/whatsapp /app/.wwebjs_auth /tmp/puppeteer_data \
    && chmod -R 777 /app/data /app/.wwebjs_auth /tmp/puppeteer_data

# Install Puppeteer dependencies (minimal set)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst \
    && rm -rf /var/lib/apt/lists/*

# Set Chrome path
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Copy application files
COPY . .

# Install dependencies
RUN npm install

# Build app
RUN npm run build

# Expose port
EXPOSE 10000

# Start command
CMD ["node", "dist/main.js", "--mode", "whatsapp-api", "--auth-dir", "/app/data/whatsapp", "--auth-strategy", "local", "--api-port", "0", "--api-key", "09d3e482988c47ae0daf3185c44faa20b5b9851412fc2fa54d910a689437f27b"]