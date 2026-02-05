import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma
vi.mock('../src/db/client.js', () => {
  const mockPrisma = {
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $on: vi.fn(),
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
    memoryItem: {
      create: vi.fn(),
    },
  };
  return { prisma: mockPrisma };
});

// Mock Qdrant
vi.mock('../src/services/qdrant.js', () => ({
  upsertMemoryPoints: vi.fn(),
  ensureMemoryCollection: vi.fn(),
  getMemoryCollectionName: vi.fn((id: string) => `mem_${id}`),
}));

// Mock embedding provider
vi.mock('../src/providers/embeddings/index.js', () => ({
  getEmbeddingProvider: () => ({
    name: 'mock',
    embed: async (texts: string[]) => texts.map(() => new Array(384).fill(0.1)),
    dims: () => 384,
  }),
}));

import { applyMemoryUpdates, getPreferences, getLessons } from '../src/services/memory.js';
import { prisma } from '../src/db/client.js';

describe('Memory Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.memoryItem.create).mockResolvedValue({
      id: 'mi-1',
      projectId: 'proj-1',
      userId: 'user-1',
      type: 'preference',
      title: 'test',
      content: {},
      status: 'accepted',
      source: 'user_chat',
      confidence: 0.8,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
      supersedesId: null,
      tags: [],
      qdrantPointId: 'qp-1',
    });
  });

  describe('applyMemoryUpdates', () => {
    it('should add new preferences', async () => {
      vi.mocked(prisma.preference.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.preference.create).mockResolvedValue({} as never);

      await applyMemoryUpdates('proj-1', 'user-1', {
        preferences_add: ['Use TypeScript'],
        preferences_remove: [],
        lessons_add: [],
      });

      expect(vi.mocked(prisma.preference.create)).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: 'proj-1',
          userId: 'user-1',
          ruleText: 'Use TypeScript',
          isActive: true,
        }),
      });
    });

    it('should skip duplicate preferences', async () => {
      vi.mocked(prisma.preference.findFirst).mockResolvedValue({ id: 'existing' } as never);

      await applyMemoryUpdates('proj-1', 'user-1', {
        preferences_add: ['Already exists'],
        preferences_remove: [],
        lessons_add: [],
      });

      expect(vi.mocked(prisma.preference.create)).not.toHaveBeenCalled();
    });

    it('should skip empty/whitespace preferences', async () => {
      await applyMemoryUpdates('proj-1', 'user-1', {
        preferences_add: ['', '  ', '\t'],
        preferences_remove: [],
        lessons_add: [],
      });

      expect(vi.mocked(prisma.preference.findFirst)).not.toHaveBeenCalled();
    });

    it('should deactivate preferences on remove', async () => {
      vi.mocked(prisma.preference.updateMany).mockResolvedValue({ count: 1 } as never);

      await applyMemoryUpdates('proj-1', 'user-1', {
        preferences_add: [],
        preferences_remove: ['Use spaces'],
        lessons_add: [],
      });

      expect(vi.mocked(prisma.preference.updateMany)).toHaveBeenCalledWith({
        where: expect.objectContaining({
          projectId: 'proj-1',
          userId: 'user-1',
          ruleText: { contains: 'Use spaces' },
          isActive: true,
        }),
        data: expect.objectContaining({
          isActive: false,
        }),
      });
    });

    it('should add new lessons', async () => {
      vi.mocked(prisma.lesson.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.lesson.create).mockResolvedValue({} as never);

      await applyMemoryUpdates('proj-1', 'user-1', {
        preferences_add: [],
        preferences_remove: [],
        lessons_add: ['Tests are important'],
      });

      expect(vi.mocked(prisma.lesson.create)).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: 'proj-1',
          userId: 'user-1',
          lessonText: 'Tests are important',
        }),
      });
    });

    it('should skip duplicate lessons', async () => {
      vi.mocked(prisma.lesson.findFirst).mockResolvedValue({ id: 'existing' } as never);

      await applyMemoryUpdates('proj-1', 'user-1', {
        preferences_add: [],
        preferences_remove: [],
        lessons_add: ['Already learned'],
      });

      expect(vi.mocked(prisma.lesson.create)).not.toHaveBeenCalled();
    });

    it('should handle empty updates gracefully', async () => {
      await applyMemoryUpdates('proj-1', 'user-1', {
        preferences_add: [],
        preferences_remove: [],
        lessons_add: [],
      });

      expect(vi.mocked(prisma.preference.create)).not.toHaveBeenCalled();
      expect(vi.mocked(prisma.lesson.create)).not.toHaveBeenCalled();
    });

    it('should write-through preference to memory_items', async () => {
      vi.mocked(prisma.preference.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.preference.create).mockResolvedValue({} as never);

      await applyMemoryUpdates('proj-1', 'user-1', {
        preferences_add: ['Use dark mode'],
        preferences_remove: [],
        lessons_add: [],
      });

      expect(vi.mocked(prisma.memoryItem.create)).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'preference',
            status: 'accepted',
          }),
        })
      );
    });

    it('should write-through lesson to memory_items', async () => {
      vi.mocked(prisma.lesson.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.lesson.create).mockResolvedValue({} as never);

      await applyMemoryUpdates('proj-1', 'user-1', {
        preferences_add: [],
        preferences_remove: [],
        lessons_add: ['Code review catches bugs'],
      });

      expect(vi.mocked(prisma.memoryItem.create)).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'lesson',
            status: 'accepted',
          }),
        })
      );
    });

    it('should trim whitespace from inputs', async () => {
      vi.mocked(prisma.preference.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.preference.create).mockResolvedValue({} as never);

      await applyMemoryUpdates('proj-1', 'user-1', {
        preferences_add: ['  Use tabs  '],
        preferences_remove: [],
        lessons_add: [],
      });

      expect(vi.mocked(prisma.preference.create)).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ruleText: 'Use tabs',
        }),
      });
    });
  });

  describe('getPreferences', () => {
    it('should return active preferences', async () => {
      vi.mocked(prisma.preference.findMany).mockResolvedValue([
        { id: 'p1', ruleText: 'Use TypeScript', isActive: true } as never,
        { id: 'p2', ruleText: 'Dark mode', isActive: true } as never,
      ]);

      const result = await getPreferences('proj-1', 'user-1');
      expect(result).toEqual(['Use TypeScript', 'Dark mode']);
    });

    it('should return empty array when no preferences', async () => {
      vi.mocked(prisma.preference.findMany).mockResolvedValue([]);

      const result = await getPreferences('proj-1', 'user-1');
      expect(result).toEqual([]);
    });
  });

  describe('getLessons', () => {
    it('should return lessons', async () => {
      vi.mocked(prisma.lesson.findMany).mockResolvedValue([
        { id: 'l1', lessonText: 'Tests are good' } as never,
      ]);

      const result = await getLessons('proj-1', 'user-1');
      expect(result).toEqual(['Tests are good']);
    });

    it('should return empty array when no lessons', async () => {
      vi.mocked(prisma.lesson.findMany).mockResolvedValue([]);

      const result = await getLessons('proj-1', 'user-1');
      expect(result).toEqual([]);
    });
  });
});
