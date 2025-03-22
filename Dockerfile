FROM node:16

# Install Chrome dependencies and Chromium properly with retry logic
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    # Add retry logic for apt-get
    for i in $(seq 1 3); do \
      apt-get update -y && \
      apt-get install -y --no-install-recommends \
      chromium \
      libx11-xcb1 \
      libxcomposite1 \
      libxcursor1 \
      libxdamage1 \
      libxi6 \
      libxtst6 \
      libnss3 \
      libcups2 \
      libxss1 \
      libxrandr2 \
      libasound2 \
      libatk1.0-0 \
      libatk-bridge2.0-0 \
      libpangocairo-1.0-0 \
      libgtk-3-0 \
      dbus && \
      rm -rf /var/lib/apt/lists/* && \
      break || \
      if [ $i -lt 3 ]; then \
        sleep 5; \
      else \
        exit 1; \
      fi; \
    done

# Set Puppeteer to use Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create specific data directories needed by Chromium with proper permissions
RUN mkdir -p /tmp/puppeteer_data && chmod -R 777 /tmp/puppeteer_data

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
ENV DBUS_SESSION_BUS_ADDRESS=/dev/null
ENV DEBUG=puppeteer:*,whatsapp-web:*

# Create directory for auth data with proper permissions
RUN mkdir -p /var/data/whatsapp && chmod -R 777 /var/data/whatsapp

# Create .wwebjs_auth directory with proper permissions
RUN mkdir -p .wwebjs_auth && chmod -R 777 .wwebjs_auth

# Expose port (Render is using port 10000)
EXPOSE 10000

# Start command (using whatsapp-api mode with dynamic port)
CMD ["node", "dist/main.js", "--mode", "whatsapp-api", "--auth-dir", "/var/data/whatsapp", "--auth-strategy", "local", "--api-port", "0", "--api-key", "09d3e482988c47ae0daf3185c44faa20b5b9851412fc2fa54d910a689437f27b"]