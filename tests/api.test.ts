import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Mock Prisma
vi.mock('../src/db/client.js', () => {
  const mockPrisma = {
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $queryRaw: vi.fn(),
    $on: vi.fn(),
    project: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    document: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    kbChunk: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    thread: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    message: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    preference: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    lesson: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    toolCall: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    projectBrief: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    memoryItem: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };

  return {
    prisma: mockPrisma,
    connectDatabase: vi.fn(),
    disconnectDatabase: vi.fn(),
  };
});

// Mock Qdrant
vi.mock('../src/services/qdrant.js', () => ({
  getQdrantClient: vi.fn(() => ({
    getCollections: vi.fn().mockResolvedValue({ collections: [] }),
    createCollection: vi.fn(),
    upsert: vi.fn(),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
    deleteCollection: vi.fn(),
  })),
  ensureCollection: vi.fn(),
  upsertPoints: vi.fn(),
  searchSimilar: vi.fn().mockResolvedValue([]),
  deleteByDocumentId: vi.fn(),
  deleteCollection: vi.fn(),
  getCollectionName: vi.fn((id: string) => `kb_${id}`),
}));

// Mock chat provider
vi.mock('../src/providers/chat/index.js', () => ({
  getChatProvider: vi.fn(() => ({
    name: 'mock',
    generateJSON: vi.fn().mockResolvedValue(
      JSON.stringify({
        mode: 'NOOP',
        message: 'This is a test response.',
        tool_request: null,
      })
    ),
  })),
}));

// Mock embedding provider
vi.mock('../src/providers/embeddings/index.js', () => {
  return {
    getEmbeddingProvider: () => ({
      name: 'mock',
      embed: async (texts: string[]) => texts.map(() => new Array(384).fill(0.1)),
      dims: () => 384,
    }),
  };
});

// Mock RAG service
vi.mock('../src/services/rag.js', () => ({
  retrieveContext: vi.fn().mockResolvedValue({
    kbChunks: [],
    preferences: [],
    lessons: [],
    playbook: null,
    brief: null,
    recentMessages: [],
  }),
}));

// Import after mocks are set up
import { buildApp } from '../src/server.js';
import { prisma } from '../src/db/client.js';

describe('API Integration Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Health Check', () => {
    it('GET /health should return 200', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ '?column?': 1 }]);

      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBeDefined();
    });

    it('GET /health should not require authentication', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ '?column?': 1 }]);

      const response = await app.inject({
        method: 'GET',
        url: '/health',
        // No x-agent-key header
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('Authentication', () => {
    it('should reject requests without API key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/projects',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          name: 'Test',
          roleStatement: 'Test',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject requests with invalid API key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/projects',
        headers: {
          'x-agent-key': 'wrong-key',
          'content-type': 'application/json',
        },
        payload: {
          name: 'Test',
          roleStatement: 'Test',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should accept requests with valid API key', async () => {
      const mockProject = {
        id: 'test-project-id',
        name: 'Test Project',
        roleStatement: 'Test role statement',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.project.create).mockResolvedValueOnce(mockProject);

      const response = await app.inject({
        method: 'POST',
        url: '/projects',
        headers: {
          'x-agent-key': 'test-api-key',
          'content-type': 'application/json',
        },
        payload: {
          name: 'Test Project',
          roleStatement: 'Test role statement',
        },
      });

      expect(response.statusCode).toBe(201);
    });
  });

  describe('Projects API', () => {
    it('POST /projects should create a project', async () => {
      const mockProject = {
        id: 'test-project-id',
        name: 'Test Project',
        roleStatement: 'Test role statement',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.project.create).mockResolvedValueOnce(mockProject);

      const response = await app.inject({
        method: 'POST',
        url: '/projects',
        headers: {
          'x-agent-key': 'test-api-key',
          'content-type': 'application/json',
        },
        payload: {
          name: 'Test Project',
          roleStatement: 'Test role statement',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.id).toBe('test-project-id');
      expect(body.name).toBe('Test Project');
    });

    it('POST /projects should reject invalid request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/projects',
        headers: {
          'x-agent-key': 'test-api-key',
          'content-type': 'application/json',
        },
        payload: {
          name: '', // Invalid: empty name
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Chat API', () => {
    it('POST /chat should process chat message', async () => {
      const mockProject = {
        id: 'test-project-id',
        name: 'Test Project',
        roleStatement: 'Test role statement',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockThread = {
        id: 'test-thread-id',
        projectId: 'test-project-id',
        userId: 'test-user-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(mockProject);
      vi.mocked(prisma.thread.create).mockResolvedValueOnce(mockThread);
      vi.mocked(prisma.message.create).mockResolvedValue({
        id: 'msg-id',
        threadId: 'test-thread-id',
        role: 'user',
        content: 'test',
        createdAt: new Date(),
      } as never);
      vi.mocked(prisma.preference.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.lesson.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.projectBrief.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.message.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.auditLog.create).mockResolvedValueOnce({} as never);

      const response = await app.inject({
        method: 'POST',
        url: '/chat',
        headers: {
          'x-agent-key': 'test-api-key',
          'content-type': 'application/json',
        },
        payload: {
          project_id: 'test-project-id',
          user_id: 'test-user-id',
          message: 'Hello, agent!',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.thread_id).toBeDefined();
      expect(body.response_json).toBeDefined();
      expect(body.response_json.mode).toBe('NOOP');
      expect(body.render.text_to_send_to_user).toBeDefined();
    });

    it('POST /chat should accept dynamic tools', async () => {
      const mockProject = {
        id: 'test-project-id',
        name: 'Test Project',
        roleStatement: 'Test role statement',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockThread = {
        id: 'test-thread-id',
        projectId: 'test-project-id',
        userId: 'test-user-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(mockProject);
      vi.mocked(prisma.thread.create).mockResolvedValueOnce(mockThread);
      vi.mocked(prisma.message.create).mockResolvedValue({
        id: 'msg-id',
        threadId: 'test-thread-id',
        role: 'user',
        content: 'test',
        createdAt: new Date(),
      } as never);
      vi.mocked(prisma.auditLog.create).mockResolvedValueOnce({} as never);

      const response = await app.inject({
        method: 'POST',
        url: '/chat',
        headers: {
          'x-agent-key': 'test-api-key',
          'content-type': 'application/json',
        },
        payload: {
          project_id: 'test-project-id',
          user_id: 'test-user-id',
          message: 'Hello!',
          tools: [
            {
              name: 'custom.tool',
              description: 'A custom tool',
              parameters: {
                param1: { type: 'string', required: true },
              },
              requires_approval: true,
              risk: 'low',
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('POST /chat should reject invalid request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/chat',
        headers: {
          'x-agent-key': 'test-api-key',
          'content-type': 'application/json',
        },
        payload: {
          project_id: 'test-project-id',
          // Missing user_id and message
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Tools Result API', () => {
    it('POST /tools/result should process tool result and return agent response', async () => {
      const mockProject = {
        id: 'test-project-id',
        name: 'Test Project',
        roleStatement: 'Test role statement',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockThread = {
        id: 'test-thread-id',
        projectId: 'test-project-id',
        userId: 'test-user-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockToolCall = {
        id: 'tool-call-id',
        projectId: 'test-project-id',
        threadId: 'test-thread-id',
        name: 'custom.tool',
        argsJson: '{}',
        requiresApproval: true,
        risk: 'low',
        status: 'pending',
        resultJson: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        thread: mockThread,
      };

      vi.mocked(prisma.toolCall.update).mockResolvedValueOnce(mockToolCall as never);
      vi.mocked(prisma.toolCall.findUnique).mockResolvedValueOnce(mockToolCall as never);
      vi.mocked(prisma.message.create).mockResolvedValue({} as never);
      vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
      vi.mocked(prisma.memoryItem.create).mockResolvedValue({
        id: 'mi-1',
        projectId: 'test-project-id',
        userId: null,
        type: 'event',
        title: 'Tool custom.tool succeeded',
        content: {},
        status: 'accepted',
        source: 'tool_result',
        confidence: 1.0,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
        supersedesId: null,
        tags: [],
        qdrantPointId: 'qp-1',
      } as never);
      // processToolResult now calls processChat, so need project + thread mocks
      vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(mockProject);
      vi.mocked(prisma.thread.findUnique).mockResolvedValueOnce(mockThread);

      const response = await app.inject({
        method: 'POST',
        url: '/tools/result',
        headers: {
          'x-agent-key': 'test-api-key',
          'content-type': 'application/json',
        },
        payload: {
          tool_call_id: 'tool-call-id',
          project_id: 'test-project-id',
          ok: true,
          data: { result: 'success' },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // Now returns ChatResponse format instead of { status: 'acknowledged' }
      expect(body.thread_id).toBeDefined();
      expect(body.response_json).toBeDefined();
      expect(body.response_json.mode).toBe('NOOP');
      expect(body.render.text_to_send_to_user).toBeDefined();
    });
  });

  describe('Swagger Documentation', () => {
    it('GET /docs should return Swagger UI', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/docs',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
    });

    it('GET /docs/json should return OpenAPI spec', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/docs/json',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.openapi).toBeDefined();
      expect(body.paths['/chat']).toBeDefined();
      expect(body.paths['/projects']).toBeDefined();
    });
  });
});
