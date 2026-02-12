import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from './config.js';
import { logger, createChildLogger } from './utils/logger.js';
import { prisma, connectDatabase, disconnectDatabase } from './db/client.js';
import { registerRoutes } from './routes/index.js';
import { isAppError } from './utils/errors.js';
import { initMcpClients, shutdownMcpClients } from './services/mcp-client.js';

const serverLogger = createChildLogger('server');

// Extend Fastify with prisma
declare module 'fastify' {
  interface FastifyInstance {
    prisma: typeof prisma;
  }
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // We use our own logger
  });

  // Register plugins
  await app.register(cors, {
    origin: true,
  });

  // Swagger documentation
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Agent Manager API',
        description: 'Document-first Project Manager AI Agent API',
        version: '1.0.0',
      },
      servers: [],
      components: {
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            name: 'X-AGENT-KEY',
            in: 'header',
            description: 'API key for authentication',
          },
        },
      },
      security: [{ apiKey: [] }],
      tags: [
        { name: 'Health', description: 'Health check endpoint' },
        { name: 'Projects', description: 'Project creation' },
        { name: 'Documents', description: 'Document upload and indexing' },
        { name: 'Chat', description: 'Chat with the AI agent' },
        { name: 'Tools', description: 'Tool execution callbacks' },
      ],
    },
    transform: ({ schema, url, ...rest }) => {
      return { schema, url, ...rest };
    },
  });

  // Dynamically set OpenAPI server URL from incoming request
  app.addHook('onRequest', async (request) => {
    if (request.url === '/docs/json' || request.url === '/docs/yaml') {
      const proto = (request.headers['x-forwarded-proto'] as string) || request.protocol;
      const host = request.headers['x-forwarded-host'] as string || request.hostname;
      const spec = app.swagger() as Record<string, unknown>;
      spec.servers = [{ url: `${proto}://${host}`, description: 'Current server' }];
    }
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      persistAuthorization: true,
    },
    staticCSP: true,
  });

  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadSizeMb * 1024 * 1024,
    },
  });

  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
    keyGenerator: (request) => {
      // Rate limit by user_id if provided, otherwise by IP
      const body = request.body as { user_id?: string } | undefined;
      return body?.user_id || request.ip;
    },
  });

  // Decorate with prisma
  app.decorate('prisma', prisma);

  // API key authentication hook
  app.addHook('preHandler', async (request, reply) => {
    // Skip auth for health check and docs
    if (
      request.url === '/health' ||
      request.url.startsWith('/docs')
    ) {
      return;
    }

    const apiKey = request.headers['x-agent-key'];
    if (apiKey !== config.agentApiKey) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // Request logging
  app.addHook('onRequest', async (request) => {
    serverLogger.info({ method: request.method, url: request.url }, 'Request');
  });

  // Response logging
  app.addHook('onResponse', async (request, reply) => {
    serverLogger.info(
      { method: request.method, url: request.url, status: reply.statusCode },
      'Response'
    );
  });

  // Error handler
  app.setErrorHandler(async (error: Error & { validation?: unknown; statusCode?: number }, request, reply) => {
    serverLogger.error({ error, url: request.url }, 'Request error');

    // Handle validation errors
    if (error.validation) {
      return reply.status(400).send({
        error: 'Validation error',
        details: error.validation,
      });
    }

    // Handle custom app errors
    if (isAppError(error)) {
      return reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
        details: error.details,
      });
    }

    // Handle Fastify errors with statusCode
    if (error.statusCode) {
      return reply.status(error.statusCode).send({
        error: error.message,
      });
    }

    // Unknown errors
    return reply.status(500).send({
      error: 'Internal server error',
    });
  });

  // Register routes
  await registerRoutes(app);

  return app;
}

async function start(): Promise<void> {
  try {
    // Connect to database
    await connectDatabase();

    // Initialize MCP clients (non-fatal on failure)
    await initMcpClients();

    // Build and start app
    const app = await buildApp();

    await app.listen({
      port: config.port,
      host: config.host,
    });

    logger.info({ port: config.port, host: config.host }, 'Server started');

    // Graceful shutdown
    const signals = ['SIGINT', 'SIGTERM'];
    for (const signal of signals) {
      process.on(signal, async () => {
        logger.info({ signal }, 'Shutting down');
        await shutdownMcpClients();
        await app.close();
        await disconnectDatabase();
        process.exit(0);
      });
    }
  } catch (error) {
    logger.fatal({ error }, 'Failed to start server');
    process.exit(1);
  }
}

// Export for testing
export { buildApp };

// Start server if not imported
if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  start();
}
