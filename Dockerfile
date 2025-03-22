FROM ghcr.io/puppeteer/puppeteer:21.5.2

# Set working directory
WORKDIR /app

# Set environment variables
ENV NODE_ENV=production
ENV DOCKER_CONTAINER=true
ENV DBUS_SESSION_BUS_ADDRESS=/dev/null
ENV DEBUG=puppeteer:*,whatsapp-web:*
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Create specific data directories needed by Chromium with proper permissions
RUN mkdir -p /tmp/puppeteer_data && chmod -R 777 /tmp/puppeteer_data

# Create directory for auth data with proper permissions
RUN mkdir -p /var/data/whatsapp && chmod -R 777 /var/data/whatsapp

# Create .wwebjs_auth directory with proper permissions
RUN mkdir -p /app/.wwebjs_auth && chmod -R 777 /app/.wwebjs_auth

# Copy application files
COPY . .

# Install dependencies
RUN npm install

# Build app
RUN npm run build

# Expose port (Render is using port 10000)
EXPOSE 10000

# Start command (using whatsapp-api mode with dynamic port)
CMD ["node", "dist/main.js", "--mode", "whatsapp-api", "--auth-dir", "/var/data/whatsapp", "--auth-strategy", "local", "--api-port", "0", "--api-key", "09d3e482988c47ae0daf3185c44faa20b5b9851412fc2fa54d910a689437f27b"]