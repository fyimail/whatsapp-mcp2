FROM node:16

# Install Chrome
RUN apt-get update && apt-get install -y \
    chromium \
    --no-install-recommends

# Set Puppeteer to use Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy application files
COPY . .

# Install dependencies
RUN npm install

# Build app
RUN npm run build

# Set up environment
ENV NODE_ENV=production
ENV DOCKER_CONTAINER=true

# Create directory for auth data
RUN mkdir -p /var/data/whatsapp && chmod -R 777 /var/data/whatsapp

# Expose port (let Render assign the port via environment)
EXPOSE 10000

# Start command (using whatsapp-api mode)
CMD ["node", "dist/main.js", "--mode", "whatsapp-api", "--auth-dir", "/var/data/whatsapp", "--auth-strategy", "local", "--api-port", "0", "--api-key", "09d3e482988c47ae0daf3185c44faa20b5b9851412fc2fa54d910a689437f27b"]