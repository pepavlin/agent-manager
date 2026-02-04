import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { processToolResult } from '../services/agent.js';
import { prisma } from '../db/client.js';
import { ToolResultSchema } from '../types/index.js';
import { getAllToolDefinitions } from '../tools/registry.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('routes:tools');

export async function toolRoutes(app: FastifyInstance): Promise<void> {
  // Tool result callback from n8n
  app.post('/tools/result', async (request: FastifyRequest, reply: FastifyReply) => {
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

      if (err instanceof Error && err.message.includes('not found')) {
        return reply.status(404).send({ error: err.message });
      }

      return reply.status(500).send({
        error: 'Tool result processing failed',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // List pending tool calls for a project
  app.get(
    '/projects/:id/tools/pending',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id: projectId } = request.params;

      const pendingCalls = await prisma.toolCall.findMany({
        where: {
          projectId,
          status: 'pending',
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          name: true,
          argsJson: true,
          requiresApproval: true,
          risk: true,
          createdAt: true,
          thread: {
            select: { userId: true },
          },
        },
      });

      return reply.send({
        pending_calls: pendingCalls.map((c) => ({
          id: c.id,
          name: c.name,
          args: JSON.parse(c.argsJson),
          requires_approval: c.requiresApproval,
          risk: c.risk,
          user_id: c.thread.userId,
          created_at: c.createdAt,
        })),
      });
    }
  );

  // Approve a pending tool call
  app.post(
    '/tools/:id/approve',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id: toolCallId } = request.params;

      const toolCall = await prisma.toolCall.findUnique({
        where: { id: toolCallId },
      });

      if (!toolCall) {
        return reply.status(404).send({ error: 'Tool call not found' });
      }

      if (toolCall.status !== 'pending') {
        return reply.status(400).send({
          error: 'Tool call is not pending',
          current_status: toolCall.status,
        });
      }

      await prisma.toolCall.update({
        where: { id: toolCallId },
        data: {
          status: 'approved',
          updatedAt: new Date(),
        },
      });

      return reply.send({
        id: toolCallId,
        status: 'approved',
        message: 'Tool call approved, ready for execution by n8n',
      });
    }
  );

  // Reject a pending tool call
  app.post(
    '/tools/:id/reject',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { reason?: string } }>,
      reply: FastifyReply
    ) => {
      const { id: toolCallId } = request.params;
      const { reason } = (request.body as { reason?: string }) || {};

      const toolCall = await prisma.toolCall.findUnique({
        where: { id: toolCallId },
      });

      if (!toolCall) {
        return reply.status(404).send({ error: 'Tool call not found' });
      }

      if (toolCall.status !== 'pending') {
        return reply.status(400).send({
          error: 'Tool call is not pending',
          current_status: toolCall.status,
        });
      }

      await prisma.toolCall.update({
        where: { id: toolCallId },
        data: {
          status: 'rejected',
          resultJson: JSON.stringify({ ok: false, error: reason || 'Rejected by user' }),
          updatedAt: new Date(),
        },
      });

      return reply.send({
        id: toolCallId,
        status: 'rejected',
      });
    }
  );

  // List available tools
  app.get('/tools', async (_request: FastifyRequest, reply: FastifyReply) => {
    const tools = getAllToolDefinitions();

    return reply.send({
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        requires_approval: t.requiresApproval,
        default_risk: t.defaultRisk,
      })),
    });
  });
}
