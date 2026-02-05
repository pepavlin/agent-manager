import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma
vi.mock('../src/db/client.js', () => {
  const mockPrisma = {
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $on: vi.fn(),
    memoryItem: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  return { prisma: mockPrisma };
});

// Mock Qdrant
vi.mock('../src/services/qdrant.js', () => ({
  upsertMemoryPoints: vi.fn(),
  deleteMemoryPoint: vi.fn(),
  ensureMemoryCollection: vi.fn(),
  searchMemory: vi.fn().mockResolvedValue([]),
  getMemoryCollectionName: vi.fn((id: string) => `mem_${id}`),
  getQdrantClient: vi.fn(() => ({
    getCollections: vi.fn().mockResolvedValue({ collections: [] }),
    createCollection: vi.fn(),
    upsert: vi.fn(),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
  })),
}));

// Mock embedding provider
vi.mock('../src/providers/embeddings/index.js', () => ({
  getEmbeddingProvider: () => ({
    name: 'mock',
    embed: async (texts: string[]) => texts.map(() => new Array(384).fill(0.1)),
    dims: () => 384,
  }),
}));

import {
  createMemoryItem,
  updateMemoryItem,
  getMemoryItems,
  proposeMemoryItem,
  acceptProposal,
  rejectProposal,
  markDone,
  deleteMemoryItem,
  searchMemoryItems,
  getOpenLoops,
  getRecentEvents,
  getActiveIdeas,
  createEvent,
  createMetric,
} from '../src/services/memory-items.js';
import { prisma } from '../src/db/client.js';
import { upsertMemoryPoints, deleteMemoryPoint, searchMemory } from '../src/services/qdrant.js';

const baseMockItem = {
  id: 'mi-1',
  projectId: 'proj-1',
  userId: 'user-1',
  type: 'fact',
  title: 'Test fact',
  content: { key: 'value' },
  status: 'proposed',
  source: 'user_chat',
  confidence: 0.5,
  createdAt: new Date(),
  updatedAt: new Date(),
  expiresAt: null,
  supersedesId: null,
  tags: [],
  qdrantPointId: 'qp-1',
};

describe('Memory Items Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createMemoryItem', () => {
    it('should create a memory item in DB and Qdrant', async () => {
      vi.mocked(prisma.memoryItem.create).mockResolvedValue(baseMockItem as never);

      const result = await createMemoryItem({
        projectId: 'proj-1',
        userId: 'user-1',
        type: 'fact',
        title: 'Test fact',
        content: { key: 'value' },
        source: 'user_chat',
        confidence: 0.5,
        tags: [],
      });

      expect(result.id).toBe('mi-1');
      expect(result.type).toBe('fact');
      expect(vi.mocked(prisma.memoryItem.create)).toHaveBeenCalled();
      expect(vi.mocked(upsertMemoryPoints)).toHaveBeenCalledWith(
        'proj-1',
        expect.arrayContaining([
          expect.objectContaining({
            payload: expect.objectContaining({
              memory_item_id: 'mi-1',
              type: 'fact',
            }),
          }),
        ])
      );
    });

    it('should generate embedding for content', async () => {
      vi.mocked(prisma.memoryItem.create).mockResolvedValue(baseMockItem as never);

      await createMemoryItem({
        projectId: 'proj-1',
        type: 'fact',
        title: 'Python project',
        content: { language: 'Python' },
        tags: [],
      });

      // Embedding provider should have been called
      expect(vi.mocked(upsertMemoryPoints)).toHaveBeenCalledWith(
        'proj-1',
        expect.arrayContaining([
          expect.objectContaining({
            vector: expect.any(Array),
          }),
        ])
      );
    });
  });

  describe('updateMemoryItem', () => {
    it('should update item in DB', async () => {
      vi.mocked(prisma.memoryItem.findUnique).mockResolvedValue(baseMockItem as never);
      vi.mocked(prisma.memoryItem.update).mockResolvedValue({
        ...baseMockItem,
        status: 'accepted',
      } as never);

      const result = await updateMemoryItem('mi-1', { status: 'accepted' });
      expect(result.status).toBe('accepted');
      expect(vi.mocked(prisma.memoryItem.update)).toHaveBeenCalledWith({
        where: { id: 'mi-1' },
        data: { status: 'accepted' },
      });
    });

    it('should re-embed when content changes', async () => {
      vi.mocked(prisma.memoryItem.findUnique).mockResolvedValue(baseMockItem as never);
      vi.mocked(prisma.memoryItem.update).mockResolvedValue({
        ...baseMockItem,
        content: { key: 'new_value' },
      } as never);

      await updateMemoryItem('mi-1', { content: { key: 'new_value' } });

      expect(vi.mocked(upsertMemoryPoints)).toHaveBeenCalled();
    });

    it('should re-embed when title changes', async () => {
      vi.mocked(prisma.memoryItem.findUnique).mockResolvedValue(baseMockItem as never);
      vi.mocked(prisma.memoryItem.update).mockResolvedValue({
        ...baseMockItem,
        title: 'New title',
      } as never);

      await updateMemoryItem('mi-1', { title: 'New title' });

      expect(vi.mocked(upsertMemoryPoints)).toHaveBeenCalled();
    });

    it('should NOT re-embed when only status changes', async () => {
      vi.mocked(prisma.memoryItem.findUnique).mockResolvedValue(baseMockItem as never);
      vi.mocked(prisma.memoryItem.update).mockResolvedValue({
        ...baseMockItem,
        status: 'accepted',
      } as never);

      await updateMemoryItem('mi-1', { status: 'accepted' });

      expect(vi.mocked(upsertMemoryPoints)).not.toHaveBeenCalled();
    });

    it('should throw for non-existent item', async () => {
      vi.mocked(prisma.memoryItem.findUnique).mockResolvedValue(null);

      await expect(updateMemoryItem('nonexistent', { status: 'done' }))
        .rejects.toThrow('Memory item not found');
    });
  });

  describe('getMemoryItems', () => {
    it('should return items with default options', async () => {
      vi.mocked(prisma.memoryItem.findMany).mockResolvedValue([baseMockItem] as never);

      const result = await getMemoryItems('proj-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('mi-1');
    });

    it('should filter by types', async () => {
      vi.mocked(prisma.memoryItem.findMany).mockResolvedValue([]);

      await getMemoryItems('proj-1', { types: ['fact', 'decision'] });

      expect(vi.mocked(prisma.memoryItem.findMany)).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: { in: ['fact', 'decision'] },
          }),
        })
      );
    });

    it('should filter by statuses', async () => {
      vi.mocked(prisma.memoryItem.findMany).mockResolvedValue([]);

      await getMemoryItems('proj-1', { statuses: ['accepted'] });

      expect(vi.mocked(prisma.memoryItem.findMany)).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['accepted'] },
          }),
        })
      );
    });

    it('should exclude expired items by default', async () => {
      vi.mocked(prisma.memoryItem.findMany).mockResolvedValue([]);

      await getMemoryItems('proj-1');

      expect(vi.mocked(prisma.memoryItem.findMany)).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { expiresAt: null },
              { expiresAt: expect.objectContaining({ gt: expect.any(Date) }) },
            ],
          }),
        })
      );
    });

    it('should include expired items when excludeExpired=false', async () => {
      vi.mocked(prisma.memoryItem.findMany).mockResolvedValue([]);

      await getMemoryItems('proj-1', { excludeExpired: false });

      const callArgs = vi.mocked(prisma.memoryItem.findMany).mock.calls[0][0] as Record<string, unknown>;
      const where = callArgs.where as Record<string, unknown>;
      expect(where.OR).toBeUndefined();
    });

    it('should filter by userId', async () => {
      vi.mocked(prisma.memoryItem.findMany).mockResolvedValue([]);

      await getMemoryItems('proj-1', { userId: 'user-1' });

      expect(vi.mocked(prisma.memoryItem.findMany)).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
          }),
        })
      );
    });

    it('should respect limit parameter', async () => {
      vi.mocked(prisma.memoryItem.findMany).mockResolvedValue([]);

      await getMemoryItems('proj-1', { limit: 5 });

      expect(vi.mocked(prisma.memoryItem.findMany)).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 5,
        })
      );
    });
  });

  describe('proposeMemoryItem', () => {
    it('should create with status=proposed', async () => {
      vi.mocked(prisma.memoryItem.create).mockResolvedValue({
        ...baseMockItem,
        status: 'proposed',
      } as never);

      const result = await proposeMemoryItem({
        projectId: 'proj-1',
        type: 'fact',
        title: 'Proposed fact',
        content: { info: 'test' },
        source: 'user_chat',
        confidence: 0.5,
        tags: [],
      });

      expect(result.status).toBe('proposed');
    });
  });

  describe('acceptProposal', () => {
    it('should change status to accepted', async () => {
      vi.mocked(prisma.memoryItem.findUnique).mockResolvedValue({
        ...baseMockItem,
        status: 'proposed',
      } as never);
      vi.mocked(prisma.memoryItem.update).mockResolvedValue({
        ...baseMockItem,
        status: 'accepted',
      } as never);

      const result = await acceptProposal('mi-1');
      expect(result.status).toBe('accepted');
    });

    it('should throw for non-existent item', async () => {
      vi.mocked(prisma.memoryItem.findUnique).mockResolvedValue(null);

      await expect(acceptProposal('nonexistent'))
        .rejects.toThrow('Memory item not found');
    });
  });

  describe('rejectProposal', () => {
    it('should change status to rejected', async () => {
      vi.mocked(prisma.memoryItem.findUnique).mockResolvedValue({
        ...baseMockItem,
        status: 'proposed',
      } as never);
      vi.mocked(prisma.memoryItem.update).mockResolvedValue({
        ...baseMockItem,
        status: 'rejected',
      } as never);

      const result = await rejectProposal('mi-1');
      expect(result.status).toBe('rejected');
    });
  });

  describe('markDone', () => {
    it('should change status to done', async () => {
      vi.mocked(prisma.memoryItem.findUnique).mockResolvedValue({
        ...baseMockItem,
        type: 'open_loop',
        status: 'active',
      } as never);
      vi.mocked(prisma.memoryItem.update).mockResolvedValue({
        ...baseMockItem,
        type: 'open_loop',
        status: 'done',
      } as never);

      const result = await markDone('mi-1');
      expect(result.status).toBe('done');
    });
  });

  describe('deleteMemoryItem', () => {
    it('should delete from both DB and Qdrant', async () => {
      vi.mocked(prisma.memoryItem.findUnique).mockResolvedValue(baseMockItem as never);
      vi.mocked(prisma.memoryItem.delete).mockResolvedValue(baseMockItem as never);

      await deleteMemoryItem('mi-1');

      expect(vi.mocked(deleteMemoryPoint)).toHaveBeenCalledWith('proj-1', 'qp-1');
      expect(vi.mocked(prisma.memoryItem.delete)).toHaveBeenCalledWith({
        where: { id: 'mi-1' },
      });
    });

    it('should handle missing Qdrant point gracefully', async () => {
      vi.mocked(prisma.memoryItem.findUnique).mockResolvedValue({
        ...baseMockItem,
        qdrantPointId: null,
      } as never);
      vi.mocked(prisma.memoryItem.delete).mockResolvedValue(baseMockItem as never);

      await deleteMemoryItem('mi-1');

      expect(vi.mocked(deleteMemoryPoint)).not.toHaveBeenCalled();
      expect(vi.mocked(prisma.memoryItem.delete)).toHaveBeenCalled();
    });

    it('should throw for non-existent item', async () => {
      vi.mocked(prisma.memoryItem.findUnique).mockResolvedValue(null);

      await expect(deleteMemoryItem('nonexistent'))
        .rejects.toThrow('Memory item not found');
    });
  });

  describe('searchMemoryItems', () => {
    it('should return items with scores', async () => {
      vi.mocked(searchMemory).mockResolvedValue([
        {
          id: 'qp-1',
          score: 0.95,
          payload: {
            memory_item_id: 'mi-1',
            type: 'fact',
            title: 'Python project',
            content_text: 'language: Python',
            status: 'accepted',
            created_at: new Date().toISOString(),
            expires_at: null,
            user_id: 'user-1',
          },
        },
      ]);

      vi.mocked(prisma.memoryItem.findMany).mockResolvedValue([baseMockItem] as never);

      const result = await searchMemoryItems('proj-1', 'What language?', 10);
      expect(result).toHaveLength(1);
      expect(result[0].score).toBe(0.95);
      expect(result[0].id).toBe('mi-1');
    });

    it('should return empty array when no results', async () => {
      vi.mocked(searchMemory).mockResolvedValue([]);

      const result = await searchMemoryItems('proj-1', 'unknown query');
      expect(result).toEqual([]);
    });

    it('should filter expired items at DB level', async () => {
      vi.mocked(searchMemory).mockResolvedValue([
        {
          id: 'qp-1',
          score: 0.9,
          payload: {
            memory_item_id: 'mi-1',
            type: 'metric',
            title: 'Expired metric',
            content_text: 'value: 100',
            status: 'accepted',
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() - 3600000).toISOString(),
            user_id: null,
          },
        },
      ]);

      // DB returns nothing because it's expired
      vi.mocked(prisma.memoryItem.findMany).mockResolvedValue([]);

      const result = await searchMemoryItems('proj-1', 'metric', 10, { excludeExpired: true });
      expect(result).toEqual([]);
    });
  });

  describe('getOpenLoops', () => {
    it('should call getMemoryItems with correct filters', async () => {
      vi.mocked(prisma.memoryItem.findMany).mockResolvedValue([]);

      await getOpenLoops('proj-1', 'user-1', 5);

      expect(vi.mocked(prisma.memoryItem.findMany)).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: 'proj-1',
            type: { in: ['open_loop'] },
            userId: 'user-1',
            status: { in: ['proposed', 'accepted', 'active', 'blocked'] },
          }),
          take: 5,
        })
      );
    });
  });

  describe('getRecentEvents', () => {
    it('should return recent events', async () => {
      vi.mocked(prisma.memoryItem.findMany).mockResolvedValue([
        { ...baseMockItem, type: 'event', status: 'accepted' },
      ] as never);

      const result = await getRecentEvents('proj-1', 3);
      expect(result).toHaveLength(1);
      expect(vi.mocked(prisma.memoryItem.findMany)).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: { in: ['event'] },
            status: { in: ['accepted'] },
          }),
          take: 3,
        })
      );
    });
  });

  describe('getActiveIdeas', () => {
    it('should return active ideas', async () => {
      vi.mocked(prisma.memoryItem.findMany).mockResolvedValue([]);

      await getActiveIdeas('proj-1', 5);

      expect(vi.mocked(prisma.memoryItem.findMany)).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: { in: ['idea'] },
            status: { in: ['proposed', 'accepted'] },
          }),
        })
      );
    });
  });

  describe('createEvent', () => {
    it('should create auto-approved event', async () => {
      vi.mocked(prisma.memoryItem.create).mockResolvedValue({
        ...baseMockItem,
        type: 'event',
        status: 'accepted',
        confidence: 1.0,
      } as never);

      const result = await createEvent('proj-1', 'Deploy done', { version: '1.0' });
      expect(result.type).toBe('event');
      expect(result.status).toBe('accepted');
    });

    it('should pass userId and tags', async () => {
      vi.mocked(prisma.memoryItem.create).mockResolvedValue({
        ...baseMockItem,
        type: 'event',
        status: 'accepted',
      } as never);

      await createEvent('proj-1', 'Deploy done', { version: '1.0' }, {
        userId: 'user-1',
        tags: ['deploy'],
      });

      expect(vi.mocked(prisma.memoryItem.create)).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            tags: ['deploy'],
          }),
        })
      );
    });
  });

  describe('createMetric', () => {
    it('should create metric with expiration', async () => {
      vi.mocked(prisma.memoryItem.create).mockResolvedValue({
        ...baseMockItem,
        type: 'metric',
        status: 'accepted',
        expiresAt: new Date(Date.now() + 3600000),
      } as never);

      const result = await createMetric('proj-1', 'Response time', { value: 200 }, 3600);
      expect(result.type).toBe('metric');
      expect(result.status).toBe('accepted');
      expect(result.expiresAt).not.toBeNull();
    });
  });
});
