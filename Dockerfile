FROM node:16-alpine

# Set environment variables
ENV NODE_ENV=production
ENV DOCKER_CONTAINER=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV DBUS_SESSION_BUS_ADDRESS=/dev/null
ENV DEBUG=puppeteer:*,whatsapp-web:*

WORKDIR /app

# Create necessary directories
RUN mkdir -p /app/data/whatsapp /app/.wwebjs_auth /tmp/puppeteer_data \
    && chmod -R 777 /app/data /app/.wwebjs_auth /tmp/puppeteer_data

# Install Chromium - Alpine has a much smaller package set with fewer dependencies
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Tell Puppeteer to use the installed Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copy application files
COPY . .

# Install dependencies
RUN npm install

# Install TypeScript globally and the Jest types needed for build
RUN npm install -g typescript
RUN npm install --save-dev @types/jest

# Build app - skip tests in production build
RUN npm run build -- --skipLibCheck

# Expose port
EXPOSE 10000

# Start command
CMD ["node", "dist/main.js", "--mode", "whatsapp-api", "--auth-dir", "/app/data/whatsapp", "--auth-strategy", "local", "--api-port", "0", "--api-key", "09d3e482988c47ae0daf3185c44faa20b5b9851412fc2fa54d910a689437f27b"]