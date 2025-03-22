FROM node:16

# Install Chrome dependencies with retry logic
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    wget \
    gnupg \
    ca-certificates && \
    # Add Chrome stable repository
    wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - && \
    echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google.list && \
    # Install Chrome with retry logic
    for i in $(seq 1 3); do \
      apt-get update -y && \
      apt-get install -y --no-install-recommends \
      google-chrome-stable && \
      rm -rf /var/lib/apt/lists/* && \
      break || \
      if [ $i -lt 3 ]; then \
        sleep 5; \
      else \
        exit 1; \
      fi; \
    done

# Set Puppeteer to use the installed Chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV NODE_ENV=production
ENV DOCKER_CONTAINER=true
ENV DBUS_SESSION_BUS_ADDRESS=/dev/null
ENV DEBUG=puppeteer:*,whatsapp-web:*

# Create directories for Chrome data
RUN mkdir -p /tmp/puppeteer_data && chmod -R 777 /tmp/puppeteer_data

# Create directory for auth data
RUN mkdir -p /app/data/whatsapp && chmod -R 777 /app/data/whatsapp

# Create .wwebjs_auth directory
RUN mkdir -p /home/node/.wwebjs_auth && chown -R node:node /home/node/.wwebjs_auth

WORKDIR /app

# Copy application files
COPY . .

# Install dependencies
RUN npm install

# Build app
RUN npm run build

# Switch to non-root user
USER node

# Expose port
EXPOSE 10000

# Start command
CMD ["node", "dist/main.js", "--mode", "whatsapp-api", "--auth-dir", "/app/data/whatsapp", "--auth-strategy", "local", "--api-port", "0", "--api-key", "09d3e482988c47ae0daf3185c44faa20b5b9851412fc2fa54d910a689437f27b"]