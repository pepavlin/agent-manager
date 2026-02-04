import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { logger, createChildLogger } from './utils/logger.js';
import { prisma, connectDatabase, disconnectDatabase } from './db/client.js';
import { registerRoutes } from './routes/index.js';

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
    // Skip auth for health check
    if (request.url === '/healthz') {
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
  app.setErrorHandler(async (error, request, reply) => {
    serverLogger.error({ error, url: request.url }, 'Request error');

    // Handle validation errors
    if (error.validation) {
      return reply.status(400).send({
        error: 'Validation error',
        details: error.validation,
      });
    }

    // Handle known errors
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
