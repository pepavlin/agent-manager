import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { processChat } from '../services/agent.js';
import { prisma } from '../db/client.js';
import { ChatRequestSchema } from '../types/index.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('routes:chat');

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post('/chat', async (request: FastifyRequest, reply: FastifyReply) => {
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

  // Get thread messages
  app.get(
    '/threads/:id',
    async (
      request: FastifyRequest<{ Params: { id: string }; Querystring: { limit?: string } }>,
      reply: FastifyReply
    ) => {
      const { id: threadId } = request.params;
      const limit = parseInt(request.query.limit || '50', 10);

      const thread = await prisma.thread.findUnique({
        where: { id: threadId },
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: limit,
          },
          project: {
            select: { id: true, name: true },
          },
        },
      });

      if (!thread) {
        return reply.status(404).send({ error: 'Thread not found' });
      }

      return reply.send({
        id: thread.id,
        project_id: thread.projectId,
        project_name: thread.project.name,
        user_id: thread.userId,
        created_at: thread.createdAt,
        messages: thread.messages.reverse().map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          created_at: m.createdAt,
        })),
      });
    }
  );

  // List threads for a project
  app.get(
    '/projects/:id/threads',
    async (
      request: FastifyRequest<{ Params: { id: string }; Querystring: { user_id?: string } }>,
      reply: FastifyReply
    ) => {
      const { id: projectId } = request.params;
      const { user_id } = request.query;

      const where: { projectId: string; userId?: string } = { projectId };
      if (user_id) {
        where.userId = user_id;
      }

      const threads = await prisma.thread.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          userId: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { messages: true },
          },
        },
      });

      return reply.send({
        threads: threads.map((t) => ({
          id: t.id,
          user_id: t.userId,
          created_at: t.createdAt,
          updated_at: t.updatedAt,
          messages_count: t._count.messages,
        })),
      });
    }
  );
}
