import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { uploadDocument } from '../services/docs.js';
import { generateProjectBrief } from '../services/brief.js';
import { ensureCollection } from '../services/qdrant.js';
import { CreateProjectSchema, DocumentCategorySchema, DocumentCategory } from '../types/index.js';
import { createChildLogger } from '../utils/logger.js';
import { CreateProjectBody, DocumentSchema, ErrorResponse } from '../schemas/index.js';

const logger = createChildLogger('routes:projects');

const SUPPORTED_MIMES = ['text/plain', 'text/markdown', 'application/pdf'];

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  // POST /projects - Create project
  app.post('/projects', {
    schema: {
      tags: ['Projects'],
      summary: 'Create a new project',
      description: `Create a new project with a name and role statement for the AI agent.

**Example request:**
\`\`\`json
{
  "name": "E-commerce Platform",
  "roleStatement": "You are a project manager for an e-commerce platform. Help track tasks, manage sprints, and coordinate between teams."
}
\`\`\`

**Example response:**
\`\`\`json
{
  "id": "clx1234567890abcdef",
  "name": "E-commerce Platform",
  "role_statement": "You are a project manager...",
  "created_at": "2024-01-15T10:30:00.000Z"
}
\`\`\``,
      body: CreateProjectBody,
      response: {
        201: {
          description: 'Project created successfully',
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            role_statement: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        400: ErrorResponse,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = CreateProjectSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request', details: body.error.errors });
    }

    const { name, roleStatement } = body.data;

    const project = await prisma.project.create({
      data: { name, roleStatement },
    });

    await ensureCollection(project.id);

    logger.info({ projectId: project.id, name }, 'Project created');

    return reply.status(201).send({
      id: project.id,
      name: project.name,
      role_statement: project.roleStatement,
      created_at: project.createdAt,
    });
  });

  // POST /projects/:id/docs - Upload document
  app.post('/projects/:id/docs', {
    // Skip body validation for multipart — @fastify/multipart parses it, not Fastify's JSON validator
    validatorCompiler: ({ httpPart }) => {
      if (httpPart === 'body') return () => true;
      // Fall through to default for params/querystring/headers
      return app.validatorCompiler!({ schema: {} as never, method: '', url: '', httpPart });
    },
    schema: {
      tags: ['Documents'],
      summary: 'Upload a document',
      description: `Upload a document to a project knowledge base. The document will be chunked, embedded, and indexed for RAG retrieval.

**Supported file types:** text/plain, text/markdown, application/pdf

**Categories:**
- \`FACTS\` - General project information, documentation, specs
- \`RULES\` - Playbook rules, guidelines, processes the agent should follow
- \`STATE\` - Current project state, status updates, meeting notes

**Form fields:**
- \`file\` - The document file (required)
- \`category\` - One of FACTS, RULES, STATE (required)

**Example response:**
\`\`\`json
{
  "id": "doc_abc123",
  "project_id": "clx1234567890abcdef",
  "category": "FACTS",
  "filename": "project-requirements.md",
  "chunks_count": 12,
  "status": "indexed"
}
\`\`\``,
      consumes: ['multipart/form-data'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Project ID' },
        },
        required: ['id'],
      },
      body: {
        type: 'object',
        required: ['file', 'category'],
        properties: {
          file: { type: 'string', format: 'binary', description: 'Document file (text/plain, text/markdown, application/pdf)' },
          category: { type: 'string', enum: ['FACTS', 'RULES', 'STATE'], description: 'Document category' },
        },
      },
      response: {
        201: DocumentSchema,
        400: ErrorResponse,
        404: ErrorResponse,
      },
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id: projectId } = request.params;

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const categoryField = (data.fields.category as { value?: string })?.value;
    const categoryResult = DocumentCategorySchema.safeParse(categoryField);
    if (!categoryResult.success) {
      return reply.status(400).send({
        error: 'Invalid category',
        details: 'category must be one of: FACTS, RULES, STATE',
      });
    }
    const category: DocumentCategory = categoryResult.data;

    const mime = data.mimetype;
    if (!SUPPORTED_MIMES.includes(mime)) {
      return reply.status(400).send({
        error: 'Unsupported file type',
        details: `Supported types: ${SUPPORTED_MIMES.join(', ')}`,
      });
    }

    const buffer = await data.toBuffer();
    const result = await uploadDocument(projectId, category, data.filename, buffer, mime);

    // Generate brief in background
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
  });
}
