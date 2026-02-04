import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { processToolResult } from '../services/agent.js';
import { ToolResultSchema } from '../types/index.js';
import { createChildLogger } from '../utils/logger.js';
import { ToolResultBody, ErrorResponse } from '../schemas/index.js';
import { isAppError } from '../utils/errors.js';

const logger = createChildLogger('routes:tools');

export async function toolRoutes(app: FastifyInstance): Promise<void> {
  // POST /tools/result - Tool result callback from n8n
  app.post('/tools/result', {
    schema: {
      tags: ['Tools'],
      summary: 'Submit tool execution result',
      description: 'Submit the result of a tool execution (called by n8n after executing a tool)',
      body: ToolResultBody,
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['acknowledged'] },
            tool_call_id: { type: 'string' },
          },
        },
        404: ErrorResponse,
        500: ErrorResponse,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = ToolResultSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: body.error.errors,
      });
    }

    const { tool_call_id, project_id, ok, data, error } = body.data;

    try {
      await processToolResult(tool_call_id, project_id, ok, data, error);

      return reply.send({
        status: 'acknowledged',
        tool_call_id,
      });
    } catch (err) {
      logger.error({ error: err, tool_call_id }, 'Tool result processing failed');

      if (isAppError(err)) {
        return reply.status(err.statusCode).send({
          error: err.message,
          code: err.code,
          details: err.details,
        });
      }

      return reply.status(500).send({
        error: 'Tool result processing failed',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
