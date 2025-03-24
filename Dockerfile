FROM node:16-alpine

# Set environment variables
ENV NODE_ENV=production
ENV DOCKER_CONTAINER=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV DBUS_SESSION_BUS_ADDRESS=/dev/null
ENV DEBUG=puppeteer:error

WORKDIR /app

# Create necessary directories
RUN mkdir -p /app/data/whatsapp /app/.wwebjs_auth /var/data/whatsapp /tmp/puppeteer_data \
    && chmod -R 777 /app/data /app/.wwebjs_auth /var/data/whatsapp /tmp/puppeteer_data

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

# Copy package files first (for better caching)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application files
COPY . .

# Install ts-node for direct TypeScript execution without type checking
RUN npm install -g ts-node typescript

# Expose port for the web service (Render will override with PORT env var)
EXPOSE 3000

# Use our standalone pure Node.js HTTP server with zero dependencies
# Extremely minimal server to ensure Render deployment works
# This ensures the server starts IMMEDIATELY for Render port detection
# The server is now correctly located in the src directory
CMD ["node", "--trace-warnings", "src/server.js"]