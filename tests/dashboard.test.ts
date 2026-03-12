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
      findUnique: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    kbChunk: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    thread: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
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
      deleteMany: vi.fn(),
      count: vi.fn(),
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
  ensureMemoryCollection: vi.fn(),
  upsertMemoryPoints: vi.fn(),
  searchMemory: vi.fn().mockResolvedValue([]),
  deleteMemoryPoint: vi.fn(),
  getMemoryCollectionName: vi.fn((id: string) => `mem_${id}`),
  getCollectionName: vi.fn((id: string) => `kb_${id}`),
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

// Mock storage utility
vi.mock('../src/utils/storage.js', () => ({
  storeFile: vi.fn().mockResolvedValue({ path: 'test/path', sha256: 'abc' }),
  readStoredFile: vi.fn().mockResolvedValue(Buffer.from('test')),
  deleteStoredFile: vi.fn().mockResolvedValue(undefined),
}));

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

import { buildApp } from '../src/server.js';
import { prisma } from '../src/db/client.js';

const API_KEY = 'test-api-key';
const PROJECT_ID = 'test-project-id';

describe('Dashboard API Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/project/:id', () => {
    it('should return project details', async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({
        id: PROJECT_ID,
        name: 'Test Project',
        roleStatement: 'You are a test agent',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        _count: { documents: 3, threads: 5, memoryItems: 10 },
        brief: null,
      } as never);

      const res = await app.inject({
        method: 'GET',
        url: `/api/project/${PROJECT_ID}`,
        headers: { 'x-agent-key': API_KEY },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.id).toBe(PROJECT_ID);
      expect(body.name).toBe('Test Project');
      expect(body.counts).toBeDefined();
    });

    it('should return 404 for non-existent project', async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'GET',
        url: '/api/project/non-existent',
        headers: { 'x-agent-key': API_KEY },
      });

      expect(res.statusCode).toBe(404);
    });

    it('should return 401 without API key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/project/${PROJECT_ID}`,
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/project/:id/threads', () => {
    it('should list threads with pagination', async () => {
      const mockThreads = [
        {
          id: 'thread-1',
          projectId: PROJECT_ID,
          userId: 'user-1',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-02'),
          _count: { messages: 5 },
          messages: [{
            id: 'msg-1',
            role: 'assistant',
            content: 'Hello there, how can I help?',
            createdAt: new Date('2024-01-02'),
          }],
        },
      ];

      vi.mocked(prisma.thread.findMany).mockResolvedValueOnce(mockThreads as never);
      vi.mocked(prisma.thread.count).mockResolvedValueOnce(1);

      const res = await app.inject({
        method: 'GET',
        url: `/api/project/${PROJECT_ID}/threads?limit=10`,
        headers: { 'x-agent-key': API_KEY },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe('thread-1');
      expect(body.items[0].message_count).toBe(5);
      expect(body.items[0].last_message).toBeDefined();
      expect(body.total).toBe(1);
    });
  });

  describe('GET /api/project/:id/threads/:threadId', () => {
    it('should return thread with messages', async () => {
      vi.mocked(prisma.thread.findUnique).mockResolvedValueOnce({
        id: 'thread-1',
        projectId: PROJECT_ID,
        userId: 'user-1',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
        messages: [
          { id: 'msg-1', role: 'user', content: 'Hello', createdAt: new Date() },
          { id: 'msg-2', role: 'assistant', content: 'Hi!', createdAt: new Date() },
        ],
      } as never);

      const res = await app.inject({
        method: 'GET',
        url: `/api/project/${PROJECT_ID}/threads/thread-1`,
        headers: { 'x-agent-key': API_KEY },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.messages).toHaveLength(2);
    });

    it('should return 404 for non-existent thread', async () => {
      vi.mocked(prisma.thread.findUnique).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'GET',
        url: `/api/project/${PROJECT_ID}/threads/nonexistent`,
        headers: { 'x-agent-key': API_KEY },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/project/:id/memory-items', () => {
    it('should list memory items', async () => {
      const mockItems = [
        {
          id: 'mem-1',
          projectId: PROJECT_ID,
          type: 'fact',
          title: 'Test fact',
          content: { text: 'Something important' },
          status: 'accepted',
          source: 'user_chat',
          confidence: 0.9,
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: null,
          tags: ['test'],
        },
      ];

      vi.mocked(prisma.memoryItem.findMany).mockResolvedValueOnce(mockItems as never);
      vi.mocked(prisma.memoryItem.count).mockResolvedValueOnce(1);

      const res = await app.inject({
        method: 'GET',
        url: `/api/project/${PROJECT_ID}/memory-items`,
        headers: { 'x-agent-key': API_KEY },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].type).toBe('fact');
      expect(body.total).toBe(1);
    });

    it('should filter by type and status', async () => {
      vi.mocked(prisma.memoryItem.findMany).mockResolvedValueOnce([] as never);
      vi.mocked(prisma.memoryItem.count).mockResolvedValueOnce(0);

      const res = await app.inject({
        method: 'GET',
        url: `/api/project/${PROJECT_ID}/memory-items?type=event&status=accepted`,
        headers: { 'x-agent-key': API_KEY },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.items).toHaveLength(0);
    });
  });

  describe('PATCH /api/memory-items/:id', () => {
    it('should update memory item status', async () => {
      vi.mocked(prisma.memoryItem.findUnique).mockResolvedValueOnce({
        id: 'mem-1',
        projectId: PROJECT_ID,
        type: 'fact',
        title: 'Test',
        content: {},
        status: 'proposed',
        source: 'user_chat',
        confidence: 0.5,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
        tags: [],
        qdrantPointId: null,
        userId: null,
        supersedesId: null,
      } as never);

      vi.mocked(prisma.memoryItem.update).mockResolvedValueOnce({
        id: 'mem-1',
        projectId: PROJECT_ID,
        type: 'fact',
        title: 'Test',
        content: {},
        status: 'accepted',
        source: 'user_chat',
        confidence: 0.5,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
        tags: [],
        qdrantPointId: null,
        userId: null,
        supersedesId: null,
      } as never);

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/memory-items/mem-1',
        headers: {
          'x-agent-key': API_KEY,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'accepted' }),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('accepted');
    });
  });

  describe('DELETE /api/memory-items/:id', () => {
    it('should delete memory item', async () => {
      vi.mocked(prisma.memoryItem.findUnique).mockResolvedValueOnce({
        id: 'mem-1',
        projectId: PROJECT_ID,
        qdrantPointId: 'point-1',
      } as never);

      vi.mocked(prisma.memoryItem.delete).mockResolvedValueOnce({} as never);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/memory-items/mem-1',
        headers: { 'x-agent-key': API_KEY },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
    });
  });

  describe('GET /api/project/:id/documents', () => {
    it('should list documents', async () => {
      vi.mocked(prisma.document.findMany).mockResolvedValueOnce([
        {
          id: 'doc-1',
          projectId: PROJECT_ID,
          category: 'FACTS',
          filename: 'readme.md',
          mime: 'text/markdown',
          version: 1,
          createdAt: new Date(),
          _count: { kbChunks: 5 },
        },
      ] as never);

      const res = await app.inject({
        method: 'GET',
        url: `/api/project/${PROJECT_ID}/documents`,
        headers: { 'x-agent-key': API_KEY },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].filename).toBe('readme.md');
      expect(body.items[0].chunks_count).toBe(5);
    });
  });

  describe('GET /api/project/:id/tool-calls', () => {
    it('should list tool calls', async () => {
      vi.mocked(prisma.toolCall.findMany).mockResolvedValueOnce([
        {
          id: 'tc-1',
          projectId: PROJECT_ID,
          name: 'jira.create_ticket',
          argsJson: '{"summary":"Test"}',
          requiresApproval: true,
          risk: 'medium',
          status: 'pending',
          resultJson: null,
          createdAt: new Date(),
        },
      ] as never);

      const res = await app.inject({
        method: 'GET',
        url: `/api/project/${PROJECT_ID}/tool-calls`,
        headers: { 'x-agent-key': API_KEY },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].name).toBe('jira.create_ticket');
      expect(body.items[0].args).toEqual({ summary: 'Test' });
    });
  });

  describe('DELETE /api/documents/:id', () => {
    it('should delete a document', async () => {
      vi.mocked(prisma.document.findUnique).mockResolvedValueOnce({
        id: 'doc-1',
        projectId: PROJECT_ID,
        category: 'FACTS',
        filename: 'readme.md',
        mime: 'text/markdown',
        storagePath: 'data/uploads/test/readme.md',
        sha256: 'abc',
        version: 1,
        createdAt: new Date(),
      } as never);
      vi.mocked(prisma.kbChunk.deleteMany).mockResolvedValueOnce({ count: 5 } as never);
      vi.mocked(prisma.document.delete).mockResolvedValueOnce({} as never);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/documents/doc-1',
        headers: { 'x-agent-key': API_KEY },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
    });

    it('should return 404 for non-existent document', async () => {
      vi.mocked(prisma.document.findUnique).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/documents/nonexistent',
        headers: { 'x-agent-key': API_KEY },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/project/:id/memory-items/bulk', () => {
    it('should accept multiple memory items', async () => {
      // Mock for each item in the loop (updateMemoryItem calls findUnique + update)
      for (let i = 0; i < 2; i++) {
        vi.mocked(prisma.memoryItem.findUnique).mockResolvedValueOnce({
          id: `mem-${i}`,
          projectId: PROJECT_ID,
          type: 'fact',
          title: 'Test',
          content: {},
          status: 'proposed',
          source: 'user_chat',
          confidence: 0.5,
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: null,
          tags: [],
          qdrantPointId: null,
          userId: null,
          supersedesId: null,
        } as never);
        vi.mocked(prisma.memoryItem.update).mockResolvedValueOnce({
          id: `mem-${i}`,
          status: 'accepted',
        } as never);
      }

      const res = await app.inject({
        method: 'POST',
        url: `/api/project/${PROJECT_ID}/memory-items/bulk`,
        headers: {
          'x-agent-key': API_KEY,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ action: 'accept', ids: ['mem-0', 'mem-1'] }),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.processed).toBe(2);
      expect(body.errors).toHaveLength(0);
    });

    it('should delete multiple memory items', async () => {
      for (let i = 0; i < 2; i++) {
        vi.mocked(prisma.memoryItem.findUnique).mockResolvedValueOnce({
          id: `mem-${i}`,
          projectId: PROJECT_ID,
          qdrantPointId: null,
        } as never);
        vi.mocked(prisma.memoryItem.delete).mockResolvedValueOnce({} as never);
      }

      const res = await app.inject({
        method: 'POST',
        url: `/api/project/${PROJECT_ID}/memory-items/bulk`,
        headers: {
          'x-agent-key': API_KEY,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ action: 'delete', ids: ['mem-0', 'mem-1'] }),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.processed).toBe(2);
    });

    it('should report errors for failed items', async () => {
      vi.mocked(prisma.memoryItem.findUnique).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'POST',
        url: `/api/project/${PROJECT_ID}/memory-items/bulk`,
        headers: {
          'x-agent-key': API_KEY,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ action: 'delete', ids: ['nonexistent'] }),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.processed).toBe(0);
      expect(body.errors).toHaveLength(1);
    });
  });

  describe('DELETE /api/project/:id/memory-items/purge', () => {
    it('should purge memory items by type filter', async () => {
      vi.mocked(prisma.memoryItem.findMany).mockResolvedValueOnce([
        { id: 'mem-1' },
        { id: 'mem-2' },
      ] as never);

      // deleteMemoryItem calls for each item
      for (let i = 0; i < 2; i++) {
        vi.mocked(prisma.memoryItem.findUnique).mockResolvedValueOnce({
          id: `mem-${i + 1}`,
          projectId: PROJECT_ID,
          qdrantPointId: null,
        } as never);
        vi.mocked(prisma.memoryItem.delete).mockResolvedValueOnce({} as never);
      }

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/project/${PROJECT_ID}/memory-items/purge?type=event`,
        headers: { 'x-agent-key': API_KEY },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.deleted).toBe(2);
      expect(body.total).toBe(2);
    });

    it('should require at least type or status filter', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/project/${PROJECT_ID}/memory-items/purge`,
        headers: { 'x-agent-key': API_KEY },
      });

      expect(res.statusCode).toBe(400);
    });

    it('should reject invalid type', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/project/${PROJECT_ID}/memory-items/purge?type=invalid_type`,
        headers: { 'x-agent-key': API_KEY },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('Static file serving', () => {
    it('should serve index.html at root', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('Agent Manager Dashboard');
    });
  });
});
