import { FastifyInstance } from 'fastify';
import { prisma } from '../db/client.js';
import { getQdrantClient } from '../services/qdrant.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', {
    schema: {
      tags: ['Health'],
      summary: 'Health check',
      description: 'Check the health status of the API and its dependencies',
      security: [],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok', 'degraded'] },
            timestamp: { type: 'string', format: 'date-time' },
            database: { type: 'string', enum: ['ok', 'error'] },
            qdrant: { type: 'string', enum: ['ok', 'error'] },
          },
        },
        503: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok', 'degraded'] },
            timestamp: { type: 'string', format: 'date-time' },
            database: { type: 'string', enum: ['ok', 'error'] },
            qdrant: { type: 'string', enum: ['ok', 'error'] },
          },
        },
      },
    },
  }, async (_request, reply) => {
    const checks: Record<string, string> = {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };

    // Check database
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
      checks.status = 'degraded';
    }

    // Check Qdrant
    try {
      const qdrant = getQdrantClient();
      await qdrant.getCollections();
      checks.qdrant = 'ok';
    } catch {
      checks.qdrant = 'error';
      checks.status = 'degraded';
    }

    if (checks.status === 'ok') {
      return reply.status(200).send(checks);
    }
    return reply.code(503).send(checks);
  });
}
