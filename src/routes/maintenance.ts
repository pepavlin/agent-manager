import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { purgeExpiredItems } from '../services/memory-items.js';
import { consolidateMemory } from '../services/memory-consolidation.js';
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

  // POST /maintenance/consolidate - Memory v2: Full memory consolidation
  app.post('/maintenance/consolidate', {
    schema: {
      tags: ['Maintenance'],
      summary: 'Consolidate memory (Memory v2)',
      description: 'Performs full memory hygiene: purges expired items, merges near-duplicate items, archives stale open_loops. Should be called periodically (e.g., every 24h) per project.',
      body: {
        type: 'object',
        required: ['project_id'],
        properties: {
          project_id: { type: 'string', description: 'Project ID to consolidate memory for' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            project_id: { type: 'string' },
            purged_expired: { type: 'number' },
            merged_duplicates: { type: 'number' },
            archived_stale: { type: 'number' },
            total_processed: { type: 'number' },
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

    const result = await consolidateMemory(project_id);
    logger.info({ projectId: project_id, result }, 'Consolidation completed');

    return reply.status(200).send({
      project_id,
      purged_expired: result.purgedExpired,
      merged_duplicates: result.mergedDuplicates,
      archived_stale: result.archivedStale,
      total_processed: result.totalProcessed,
    });
  });
}
