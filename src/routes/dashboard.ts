import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { createChildLogger } from '../utils/logger.js';
import { ErrorResponse } from '../schemas/index.js';
import { updateMemoryItem, deleteMemoryItem } from '../services/memory-items.js';
import { deleteDocument } from '../services/docs.js';
import { MemoryItemStatusSchema, MemoryItemTypeSchema } from '../types/index.js';

const logger = createChildLogger('routes:dashboard');

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/project/:id - Get project details
  app.get('/api/project/:id', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Get project details',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      response: { 404: ErrorResponse },
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            documents: true,
            threads: true,
            memoryItems: true,
          },
        },
        brief: true,
      },
    });

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    return reply.send({
      id: project.id,
      name: project.name,
      role_statement: project.roleStatement,
      created_at: project.createdAt,
      updated_at: project.updatedAt,
      counts: {
        documents: project._count.documents,
        threads: project._count.threads,
        memory_items: project._count.memoryItems,
      },
      brief: project.brief ? {
        brief_markdown: project.brief.briefMarkdown,
        kb_index_markdown: project.brief.kbIndexMarkdown,
        updated_at: project.brief.updatedAt,
      } : null,
    });
  });

  // GET /api/project/:id/threads - List threads
  app.get('/api/project/:id/threads', {
    schema: {
      tags: ['Dashboard'],
      summary: 'List project threads',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 20 },
          offset: { type: 'number', default: 0 },
        },
      },
    },
  }, async (request: FastifyRequest<{
    Params: { id: string };
    Querystring: { limit?: number; offset?: number };
  }>, reply: FastifyReply) => {
    const { id } = request.params;
    const limit = request.query.limit || 20;
    const offset = request.query.offset || 0;

    const [threads, total] = await Promise.all([
      prisma.thread.findMany({
        where: { projectId: id },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          _count: { select: { messages: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      prisma.thread.count({ where: { projectId: id } }),
    ]);

    return reply.send({
      items: threads.map(t => ({
        id: t.id,
        user_id: t.userId,
        created_at: t.createdAt,
        updated_at: t.updatedAt,
        message_count: t._count.messages,
        last_message: t.messages[0] ? {
          role: t.messages[0].role,
          content: t.messages[0].content.substring(0, 200),
          created_at: t.messages[0].createdAt,
        } : null,
      })),
      total,
    });
  });

  // GET /api/project/:id/threads/:threadId - Get thread messages
  app.get('/api/project/:id/threads/:threadId', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Get thread with messages',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          threadId: { type: 'string' },
        },
        required: ['id', 'threadId'],
      },
    },
  }, async (request: FastifyRequest<{
    Params: { id: string; threadId: string };
  }>, reply: FastifyReply) => {
    const { threadId } = request.params;

    const thread = await prisma.thread.findUnique({
      where: { id: threadId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!thread) {
      return reply.status(404).send({ error: 'Thread not found' });
    }

    return reply.send({
      id: thread.id,
      user_id: thread.userId,
      created_at: thread.createdAt,
      messages: thread.messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        created_at: m.createdAt,
      })),
    });
  });

  // GET /api/project/:id/memory-items - List memory items
  app.get('/api/project/:id/memory-items', {
    schema: {
      tags: ['Dashboard'],
      summary: 'List memory items',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      querystring: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          status: { type: 'string' },
          limit: { type: 'number', default: 50 },
          offset: { type: 'number', default: 0 },
        },
      },
    },
  }, async (request: FastifyRequest<{
    Params: { id: string };
    Querystring: { type?: string; status?: string; limit?: number; offset?: number };
  }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { type, status, limit = 50, offset = 0 } = request.query;

    const where: Record<string, unknown> = { projectId: id };
    if (type) where.type = type;
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      prisma.memoryItem.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.memoryItem.count({ where }),
    ]);

    return reply.send({
      items: items.map(item => ({
        id: item.id,
        type: item.type,
        title: item.title,
        content: item.content,
        status: item.status,
        source: item.source,
        confidence: item.confidence,
        created_at: item.createdAt,
        updated_at: item.updatedAt,
        expires_at: item.expiresAt,
        tags: item.tags,
      })),
      total,
    });
  });

  // PATCH /api/memory-items/:id - Update memory item status
  app.patch('/api/memory-items/:id', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Update memory item (status, title, etc.)',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['proposed', 'accepted', 'rejected', 'done', 'blocked', 'active'] },
          title: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  }, async (request: FastifyRequest<{
    Params: { id: string };
    Body: { status?: string; title?: string; tags?: string[] };
  }>, reply: FastifyReply) => {
    const { id } = request.params;
    const body = request.body;

    try {
      const patch: Record<string, unknown> = {};
      if (body.status) {
        const parsed = MemoryItemStatusSchema.safeParse(body.status);
        if (!parsed.success) {
          return reply.status(400).send({ error: 'Invalid status' });
        }
        patch.status = parsed.data;
      }
      if (body.title) patch.title = body.title;
      if (body.tags) patch.tags = body.tags;

      const updated = await updateMemoryItem(id, patch);
      return reply.send({
        id: updated.id,
        type: updated.type,
        title: updated.title,
        status: updated.status,
        updated_at: updated.updatedAt,
      });
    } catch (error) {
      logger.error({ error, id }, 'Failed to update memory item');
      return reply.status(404).send({ error: 'Memory item not found' });
    }
  });

  // DELETE /api/memory-items/:id - Delete memory item
  app.delete('/api/memory-items/:id', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Delete a memory item',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  }, async (request: FastifyRequest<{
    Params: { id: string };
  }>, reply: FastifyReply) => {
    const { id } = request.params;

    try {
      await deleteMemoryItem(id);
      return reply.send({ ok: true });
    } catch (error) {
      logger.error({ error, id }, 'Failed to delete memory item');
      return reply.status(404).send({ error: 'Memory item not found' });
    }
  });

  // GET /api/project/:id/documents - List documents
  app.get('/api/project/:id/documents', {
    schema: {
      tags: ['Dashboard'],
      summary: 'List project documents',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  }, async (request: FastifyRequest<{
    Params: { id: string };
  }>, reply: FastifyReply) => {
    const { id } = request.params;

    const documents = await prisma.document.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { kbChunks: true } },
      },
    });

    return reply.send({
      items: documents.map(doc => ({
        id: doc.id,
        category: doc.category,
        filename: doc.filename,
        mime: doc.mime,
        version: doc.version,
        chunks_count: doc._count.kbChunks,
        created_at: doc.createdAt,
      })),
      total: documents.length,
    });
  });

  // DELETE /api/documents/:id - Delete a document
  app.delete('/api/documents/:id', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Delete a document and its chunks',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  }, async (request: FastifyRequest<{
    Params: { id: string };
  }>, reply: FastifyReply) => {
    const { id } = request.params;

    try {
      await deleteDocument(id);
      return reply.send({ ok: true });
    } catch (error) {
      logger.error({ error, id }, 'Failed to delete document');
      return reply.status(404).send({ error: 'Document not found' });
    }
  });

  // POST /api/project/:id/memory-items/bulk - Bulk operations on memory items
  app.post('/api/project/:id/memory-items/bulk', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Bulk update or delete memory items',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        required: ['action', 'ids'],
        properties: {
          action: { type: 'string', enum: ['accept', 'reject', 'delete'] },
          ids: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  }, async (request: FastifyRequest<{
    Params: { id: string };
    Body: { action: string; ids: string[] };
  }>, reply: FastifyReply) => {
    const { action, ids } = request.body;
    let processed = 0;
    const errors: string[] = [];

    for (const id of ids) {
      try {
        if (action === 'delete') {
          await deleteMemoryItem(id);
        } else {
          const status = action === 'accept' ? 'accepted' : 'rejected';
          await updateMemoryItem(id, { status });
        }
        processed++;
      } catch (error) {
        errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return reply.send({ processed, errors });
  });

  // DELETE /api/project/:id/memory-items/purge - Purge memory items by filter
  app.delete('/api/project/:id/memory-items/purge', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Purge memory items by type and/or status',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      querystring: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          status: { type: 'string' },
        },
      },
    },
  }, async (request: FastifyRequest<{
    Params: { id: string };
    Querystring: { type?: string; status?: string };
  }>, reply: FastifyReply) => {
    const { id: projectId } = request.params;
    const { type, status } = request.query;

    if (!type && !status) {
      return reply.status(400).send({ error: 'Must specify at least type or status filter' });
    }

    // Get matching items
    const where: Record<string, unknown> = { projectId };
    if (type) {
      const parsed = MemoryItemTypeSchema.safeParse(type);
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid type' });
      where.type = parsed.data;
    }
    if (status) {
      const parsed = MemoryItemStatusSchema.safeParse(status);
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid status' });
      where.status = parsed.data;
    }

    const items = await prisma.memoryItem.findMany({
      where,
      select: { id: true },
    });

    let deleted = 0;
    for (const item of items) {
      try {
        await deleteMemoryItem(item.id);
        deleted++;
      } catch (error) {
        logger.warn({ error, id: item.id }, 'Failed to purge memory item');
      }
    }

    return reply.send({ deleted, total: items.length });
  });

  // GET /api/project/:id/tool-calls - List tool calls
  app.get('/api/project/:id/tool-calls', {
    schema: {
      tags: ['Dashboard'],
      summary: 'List tool calls',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          limit: { type: 'number', default: 20 },
        },
      },
    },
  }, async (request: FastifyRequest<{
    Params: { id: string };
    Querystring: { status?: string; limit?: number };
  }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { status, limit = 20 } = request.query;

    const where: Record<string, unknown> = { projectId: id };
    if (status) where.status = status;

    const toolCalls = await prisma.toolCall.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return reply.send({
      items: toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        args: JSON.parse(tc.argsJson),
        requires_approval: tc.requiresApproval,
        risk: tc.risk,
        status: tc.status,
        result: tc.resultJson ? JSON.parse(tc.resultJson) : null,
        created_at: tc.createdAt,
      })),
    });
  });
}
