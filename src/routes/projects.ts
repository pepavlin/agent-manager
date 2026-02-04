import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { uploadDocument, getDocumentsByProject } from '../services/docs.js';
import { generateProjectBrief, getProjectBrief } from '../services/brief.js';
import { ensureCollection, deleteCollection } from '../services/qdrant.js';
import { CreateProjectSchema, DocumentCategorySchema, DocumentCategory } from '../types/index.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('routes:projects');

// Supported MIME types
const SUPPORTED_MIMES = ['text/plain', 'text/markdown', 'application/pdf'];

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  // Create project
  app.post('/projects', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = CreateProjectSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request', details: body.error.errors });
    }

    const { name, roleStatement } = body.data;

    const project = await prisma.project.create({
      data: {
        name,
        roleStatement,
      },
    });

    // Create Qdrant collection
    await ensureCollection(project.id);

    logger.info({ projectId: project.id, name }, 'Project created');

    return reply.status(201).send({
      id: project.id,
      name: project.name,
      role_statement: project.roleStatement,
      created_at: project.createdAt,
    });
  });

  // Get project
  app.get('/projects/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        brief: true,
        _count: {
          select: {
            documents: true,
            threads: true,
          },
        },
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
      documents_count: project._count.documents,
      threads_count: project._count.threads,
      brief: project.brief
        ? {
            updated_at: project.brief.updatedAt,
            missing_info: JSON.parse(project.brief.missingInfoJson),
          }
        : null,
    });
  });

  // List projects
  app.get('/projects', async (_request: FastifyRequest, reply: FastifyReply) => {
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        roleStatement: true,
        createdAt: true,
        _count: {
          select: {
            documents: true,
          },
        },
      },
    });

    return reply.send({
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        role_statement: p.roleStatement,
        created_at: p.createdAt,
        documents_count: p._count.documents,
      })),
    });
  });

  // Delete project
  app.delete('/projects/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Delete Qdrant collection
    await deleteCollection(id);

    // Delete from database (cascades)
    await prisma.project.delete({ where: { id } });

    logger.info({ projectId: id }, 'Project deleted');

    return reply.status(204).send();
  });

  // Upload document
  app.post(
    '/projects/:id/docs',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id: projectId } = request.params;

      // Check project exists
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) {
        return reply.status(404).send({ error: 'Project not found' });
      }

      // Handle multipart upload
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      // Get category from fields
      const categoryField = (data.fields.category as { value?: string })?.value;
      const categoryResult = DocumentCategorySchema.safeParse(categoryField);
      if (!categoryResult.success) {
        return reply.status(400).send({
          error: 'Invalid category',
          details: 'category must be one of: FACTS, RULES, STATE',
        });
      }
      const category: DocumentCategory = categoryResult.data;

      // Validate mime type
      const mime = data.mimetype;
      if (!SUPPORTED_MIMES.includes(mime)) {
        return reply.status(400).send({
          error: 'Unsupported file type',
          details: `Supported types: ${SUPPORTED_MIMES.join(', ')}`,
        });
      }

      // Read file content
      const buffer = await data.toBuffer();

      // Upload and index
      const result = await uploadDocument(projectId, category, data.filename, buffer, mime);

      // Generate/update project brief in background
      generateProjectBrief(projectId).catch((error) => {
        logger.error({ error, projectId }, 'Failed to generate brief');
      });

      return reply.status(201).send({
        id: result.id,
        project_id: result.projectId,
        category: result.category,
        filename: result.filename,
        chunks_count: result.chunksCount,
        status: result.status,
        error: result.error,
      });
    }
  );

  // List documents
  app.get(
    '/projects/:id/docs',
    async (request: FastifyRequest<{ Params: { id: string }; Querystring: { category?: string } }>, reply: FastifyReply) => {
      const { id: projectId } = request.params;
      const { category } = request.query;

      // Check project exists
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) {
        return reply.status(404).send({ error: 'Project not found' });
      }

      let categoryFilter: DocumentCategory | undefined;
      if (category) {
        const categoryResult = DocumentCategorySchema.safeParse(category);
        if (categoryResult.success) {
          categoryFilter = categoryResult.data;
        }
      }

      const documents = await getDocumentsByProject(projectId, categoryFilter);

      return reply.send({
        documents: documents.map((d) => ({
          id: d.id,
          category: d.category,
          filename: d.filename,
          created_at: d.createdAt,
        })),
      });
    }
  );

  // Get project brief
  app.get('/projects/:id/brief', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id: projectId } = request.params;

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const brief = await getProjectBrief(projectId);
    if (!brief) {
      return reply.status(404).send({ error: 'Brief not generated yet' });
    }

    return reply.send({
      brief_markdown: brief.briefMarkdown,
      kb_index_markdown: brief.kbIndexMarkdown,
      missing_info: brief.missingInfoJson,
    });
  });

  // Regenerate project brief
  app.post('/projects/:id/brief/regenerate', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id: projectId } = request.params;

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const brief = await generateProjectBrief(projectId);

    return reply.send({
      brief_markdown: brief.briefMarkdown,
      kb_index_markdown: brief.kbIndexMarkdown,
      missing_info: brief.missingInfoJson,
    });
  });
}
