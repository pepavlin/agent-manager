import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { processChat } from '../services/agent.js';
import { ChatRequestSchema } from '../types/index.js';
import { createChildLogger } from '../utils/logger.js';
import { ChatRequestBody, ChatResponseSchema, ErrorResponse } from '../schemas/index.js';

const logger = createChildLogger('routes:chat');

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  // POST /chat - Send message to AI agent
  app.post('/chat', {
    schema: {
      tags: ['Chat'],
      summary: 'Send a message to the AI agent',
      description: 'Send a message to the project AI agent and receive a response. The agent will respond in ACT, ASK, or NOOP mode.',
      body: ChatRequestBody,
      response: {
        200: ChatResponseSchema,
        400: ErrorResponse,
        404: ErrorResponse,
        500: ErrorResponse,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = ChatRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: body.error.errors,
      });
    }

    try {
      const response = await processChat(body.data);

      return reply.send({
        thread_id: response.thread_id,
        response_json: response.response_json,
        render: response.render,
      });
    } catch (error) {
      logger.error({ error }, 'Chat processing failed');

      if (error instanceof Error && error.message.includes('Project not found')) {
        return reply.status(404).send({ error: error.message });
      }

      return reply.status(500).send({
        error: 'Chat processing failed',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
