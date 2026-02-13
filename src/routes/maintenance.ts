import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { purgeExpiredItems } from '../services/memory-items.js';
import { createChildLogger } from '../utils/logger.js';
import { ErrorResponse } from '../schemas/index.js';

const logger = createChildLogger('routes:maintenance');

export async function maintenanceRoutes(app: FastifyInstance): Promise<void> {
  // POST /maintenance/purge-expired - Purge expired memory items
  app.post('/maintenance/purge-expired', {
    schema: {
      tags: ['Maintenance'],
      summary: 'Purge expired memory items',
      description: 'Removes expired memory items (metrics with TTL, etc.) from both Postgres and Qdrant. Call periodically from cron or manually.',
      body: {
        type: 'object',
        required: ['project_id'],
        properties: {
          project_id: { type: 'string', description: 'Project ID to purge expired items for' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            purged: { type: 'number', description: 'Number of expired items purged' },
            project_id: { type: 'string' },
          },
        },
        400: ErrorResponse,
      },
    },
  }, async (request: FastifyRequest<{ Body: { project_id: string } }>, reply: FastifyReply) => {
    const { project_id } = request.body;

    if (!project_id) {
      return reply.status(400).send({ error: 'project_id is required' });
    }

    const purged = await purgeExpiredItems(project_id);
    logger.info({ projectId: project_id, purged }, 'Purge completed');

    return reply.status(200).send({ purged, project_id });
  });
}
