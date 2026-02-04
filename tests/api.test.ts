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
        memory_updates: {
          preferences_add: [],
          preferences_remove: [],
          lessons_add: [],
        },
      })
    ),
  })),
}));

// Mock embedding provider - use async function that returns proper values
vi.mock('../src/providers/embeddings/index.js', () => {
  return {
    getEmbeddingProvider: () => ({
      name: 'mock',
      embed: async (texts: string[]) => texts.map(() => new Array(384).fill(0.1)),
      dims: () => 384,
    }),
  };
});

// Mock RAG service to avoid complex embedding/search dependencies
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
    it('GET /healthz should return 200', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ '?column?': 1 }]);

      const response = await app.inject({
        method: 'GET',
        url: '/healthz',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBeDefined();
    });
  });

  describe('Authentication', () => {
    it('should reject requests without API key', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/projects',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject requests with invalid API key', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/projects',
        headers: {
          'x-agent-key': 'wrong-key',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should accept requests with valid API key', async () => {
      vi.mocked(prisma.project.findMany).mockResolvedValueOnce([]);

      const response = await app.inject({
        method: 'GET',
        url: '/projects',
        headers: {
          'x-agent-key': 'test-api-key',
        },
      });

      expect(response.statusCode).toBe(200);
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

    it('GET /projects/:id should return project', async () => {
      const mockProject = {
        id: 'test-project-id',
        name: 'Test Project',
        roleStatement: 'Test role statement',
        createdAt: new Date(),
        updatedAt: new Date(),
        brief: null,
        _count: {
          documents: 5,
          threads: 2,
        },
      };

      vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(mockProject as never);

      const response = await app.inject({
        method: 'GET',
        url: '/projects/test-project-id',
        headers: {
          'x-agent-key': 'test-api-key',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe('test-project-id');
      expect(body.documents_count).toBe(5);
    });

    it('GET /projects/:id should return 404 for non-existent project', async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(null);

      const response = await app.inject({
        method: 'GET',
        url: '/projects/non-existent-id',
        headers: {
          'x-agent-key': 'test-api-key',
        },
      });

      expect(response.statusCode).toBe(404);
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

      // Debug: log response if not 200
      if (response.statusCode !== 200) {
        console.log('Chat response error:', response.body);
      }

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.thread_id).toBeDefined();
      expect(body.response_json).toBeDefined();
      expect(body.response_json.mode).toBe('NOOP');
      expect(body.render.text_to_send_to_user).toBeDefined();
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

  describe('Tools API', () => {
    it('GET /tools should list available tools', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tools',
        headers: {
          'x-agent-key': 'test-api-key',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.tools).toBeDefined();
      expect(Array.isArray(body.tools)).toBe(true);
      expect(body.tools.length).toBeGreaterThan(0);

      // Check tool structure
      const tool = body.tools[0];
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.requires_approval).toBeDefined();
    });

    it('POST /tools/result should process tool result', async () => {
      const mockToolCall = {
        id: 'tool-call-id',
        projectId: 'test-project-id',
        threadId: 'test-thread-id',
        name: 'backlog.add_item',
        argsJson: '{}',
        requiresApproval: true,
        risk: 'low',
        status: 'pending',
        resultJson: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        thread: {
          id: 'test-thread-id',
          projectId: 'test-project-id',
          userId: 'test-user-id',
        },
      };

      vi.mocked(prisma.toolCall.update).mockResolvedValueOnce(mockToolCall as never);
      vi.mocked(prisma.toolCall.findUnique).mockResolvedValueOnce(mockToolCall as never);
      vi.mocked(prisma.message.create).mockResolvedValueOnce({} as never);
      vi.mocked(prisma.auditLog.create).mockResolvedValueOnce({} as never);

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
          data: { item_id: 'new-item-123' },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('acknowledged');
    });
  });
});
