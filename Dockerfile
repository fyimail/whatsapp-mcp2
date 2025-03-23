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

# A simpler approach - just copy files and strip TypeScript syntax with basic text replacement
RUN mkdir -p dist && \
    find src -name "*.ts" | while read file; do \
    dest_dir="dist/$(dirname "$file" | sed 's|^src/||')"; \
    mkdir -p "$dest_dir"; \
    dest_file="$dest_dir/$(basename "$file" .ts).js"; \
    # Strip TypeScript-specific syntax and convert to JavaScript \
    cat "$file" | \
    sed 's/: [^{=;)]*//g' | \
    sed 's/export //g' | \
    sed 's/import \(.*\) from \(.*\);/const \1 = require(\2);/g' | \
    sed 's/interface \([^ ]*\) {/\/\/ interface \1 {/g' | \
    sed 's/^\s*readonly //g' | \
    sed 's/^\s*private //g' | \
    sed 's/^\s*public //g' | \
    sed 's/^\s*protected //g' \
    > "$dest_file"; \
    done

# Expose port 3000 (aligning with the memory about port 3000)
EXPOSE 3000

# Start command with API port set to 3000 (as per memory)
CMD ["node", "dist/main.js", "--mode", "whatsapp-api", "--auth-dir", "/app/data/whatsapp", "--auth-strategy", "local", "--api-port", "3000", "--api-key", "09d3e482988c47ae0daf3185c44faa20b5b9851412fc2fa54d910a689437f27b"]