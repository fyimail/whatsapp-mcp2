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

# Install TypeScript globally 
RUN npm install -g typescript

# Install Babel for transpiling TypeScript without type checking
RUN npm install --save-dev @babel/core @babel/cli @babel/preset-env @babel/preset-typescript

# Create a minimal Babel config
RUN echo '{ \
  "presets": [ \
    ["@babel/preset-env", { "targets": { "node": "16" } }], \
    ["@babel/preset-typescript", { "allowDeclareFields": true }] \
  ] \
}' > babel.config.json

# Transpile TypeScript to JavaScript using Babel (which strips type annotations)
RUN npx babel src --extensions ".ts" --out-dir dist

# Expose port 3000 (aligning with the memory about port 3000)
EXPOSE 3000

# Start command with API port set to 3000 (as per memory)
CMD ["node", "dist/main.js", "--mode", "whatsapp-api", "--auth-dir", "/app/data/whatsapp", "--auth-strategy", "local", "--api-port", "3000", "--api-key", "09d3e482988c47ae0daf3185c44faa20b5b9851412fc2fa54d910a689437f27b"]