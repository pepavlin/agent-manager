# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# OpenSSL is required by Prisma on Alpine
RUN apk add --no-cache openssl

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY tsconfig.json ./
COPY src ./src/

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install dumb-init, openssl (Prisma), bash and git (Claude Code needs them)
RUN apk add --no-cache dumb-init openssl bash git

# Create non-root user with home directory
RUN addgroup -g 1001 -S nodejs && \
    adduser -S agent -u 1001 -h /home/agent

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install production dependencies only
RUN npm ci --only=production

# Generate Prisma client
RUN npx prisma generate

# Copy built files
COPY --from=builder /app/dist ./dist

# Copy entrypoint script
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Create data directory for uploads
RUN mkdir -p /app/data/uploads && chown -R agent:nodejs /app/data

# Create .claude directory for credentials
RUN mkdir -p /home/agent/.claude && chown -R agent:nodejs /home/agent/.claude

# Switch to non-root user
USER agent

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

# Entrypoint writes credentials, then runs the command
ENTRYPOINT ["dumb-init", "--", "docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
