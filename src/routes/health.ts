import { FastifyInstance } from 'fastify';
import { prisma } from '../db/client.js';
import { getQdrantClient } from '../services/qdrant.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async (_request, reply) => {
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

    const statusCode = checks.status === 'ok' ? 200 : 503;
    return reply.status(statusCode).send(checks);
  });
}
