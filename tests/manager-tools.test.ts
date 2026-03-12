import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    },
    thread: {
      create: vi.fn(),
      findUnique: vi.fn(),
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
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    projectBrief: {
      findUnique: vi.fn(),
    },
    memoryItem: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  };
  return { prisma: mockPrisma, connectDatabase: vi.fn(), disconnectDatabase: vi.fn() };
});

// Mock Qdrant
vi.mock('../src/services/qdrant.js', () => ({
  getQdrantClient: vi.fn(() => ({
    getCollections: vi.fn().mockResolvedValue({ collections: [] }),
    createCollection: vi.fn(),
    upsert: vi.fn(),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
  })),
  ensureCollection: vi.fn(),
  upsertPoints: vi.fn(),
  searchSimilar: vi.fn().mockResolvedValue([]),
  deleteByDocumentId: vi.fn(),
  getCollectionName: vi.fn((id: string) => `kb_${id}`),
  getMemoryCollectionName: vi.fn((id: string) => `mem_${id}`),
  ensureMemoryCollection: vi.fn(),
  upsertMemoryPoints: vi.fn(),
  searchMemory: vi.fn().mockResolvedValue([]),
  deleteMemoryPoint: vi.fn(),
}));

// Mock chat provider
const mockGenerateJSON = vi.fn();
vi.mock('../src/providers/chat/index.js', () => ({
  getChatProvider: vi.fn(() => ({
    name: 'mock',
    generateJSON: mockGenerateJSON,
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

// Mock RAG
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

import { processChat } from '../src/services/agent.js';
import { prisma } from '../src/db/client.js';
import {
  ManagerLogFindingSchema,
  ManagerCreateTaskSchema,
  ManagerDecideFindingSchema,
  MemoryItemTypeSchema,
} from '../src/types/index.js';

const mockProject = {
  id: 'proj-1',
  name: 'Test Project',
  roleStatement: 'Test assistant',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockThread = {
  id: 'thread-1',
  projectId: 'proj-1',
  userId: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function setupBasicMocks() {
  vi.mocked(prisma.project.findUnique).mockResolvedValue(mockProject);
  vi.mocked(prisma.thread.create).mockResolvedValue(mockThread);
  vi.mocked(prisma.message.create).mockResolvedValue({
    id: 'msg-1',
    threadId: 'thread-1',
    role: 'user',
    content: 'test',
    createdAt: new Date(),
  } as never);
  vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  vi.mocked(prisma.memoryItem.count).mockResolvedValue(0);
}

function mockMemoryItemCreate(overrides: Record<string, unknown> = {}) {
  const defaultItem = {
    id: 'mi-1',
    projectId: 'proj-1',
    userId: 'user-1',
    type: 'finding',
    title: 'Test finding',
    content: {},
    status: 'proposed',
    source: 'user_chat',
    confidence: 0.8,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
    supersedesId: null,
    tags: [],
    qdrantPointId: 'qp-1',
    ...overrides,
  };
  vi.mocked(prisma.memoryItem.create).mockResolvedValue(defaultItem);
  return defaultItem;
}

function mockToolCallCreate(id: string = 'tc-1') {
  vi.mocked(prisma.toolCall.create).mockResolvedValueOnce({
    id,
    projectId: 'proj-1',
    threadId: 'thread-1',
    name: 'manager.log_finding',
    argsJson: '{}',
    requiresApproval: false,
    risk: 'low',
    status: 'completed',
    resultJson: null,
    toolsJson: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
}

describe('Manager Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBasicMocks();
  });

  describe('Schema validation', () => {
    it('should accept finding and impl_task as valid memory item types', () => {
      expect(MemoryItemTypeSchema.parse('finding')).toBe('finding');
      expect(MemoryItemTypeSchema.parse('impl_task')).toBe('impl_task');
    });

    it('should validate ManagerLogFindingSchema', () => {
      const valid = ManagerLogFindingSchema.parse({
        finding_type: 'bug',
        severity: 'high',
        title: 'Navigation broken on mobile',
        description: 'Menu overlaps with content on screens < 768px',
        component: 'navigation',
        tags: ['mobile', 'ui'],
      });
      expect(valid.finding_type).toBe('bug');
      expect(valid.severity).toBe('high');
    });

    it('should reject invalid finding type', () => {
      expect(() =>
        ManagerLogFindingSchema.parse({
          finding_type: 'invalid',
          severity: 'high',
          title: 'Test',
          description: 'Test',
        })
      ).toThrow();
    });

    it('should reject invalid severity', () => {
      expect(() =>
        ManagerLogFindingSchema.parse({
          finding_type: 'bug',
          severity: 'super_critical',
          title: 'Test',
          description: 'Test',
        })
      ).toThrow();
    });

    it('should validate ManagerCreateTaskSchema', () => {
      const valid = ManagerCreateTaskSchema.parse({
        title: 'Fix mobile navigation',
        description: 'Refactor nav component to use responsive breakpoints',
        priority: 'high',
        rationale: 'Multiple findings indicate navigation is broken on mobile, affects core UX',
        acceptance_criteria: 'Navigation works on all screen sizes without overlap',
        finding_ids: ['finding-1', 'finding-2'],
      });
      expect(valid.priority).toBe('high');
      expect(valid.finding_ids).toHaveLength(2);
    });

    it('should require rationale in ManagerCreateTaskSchema', () => {
      expect(() =>
        ManagerCreateTaskSchema.parse({
          title: 'Fix something',
          description: 'Details',
          priority: 'medium',
        })
      ).toThrow();
    });

    it('should validate ManagerDecideFindingSchema', () => {
      const valid = ManagerDecideFindingSchema.parse({
        finding_id: 'finding-1',
        decision: 'rejected',
        rationale: 'This change conflicts with minimalist design principle from product brief',
      });
      expect(valid.decision).toBe('rejected');
    });

    it('should only allow rejected or deferred decisions', () => {
      expect(() =>
        ManagerDecideFindingSchema.parse({
          finding_id: 'finding-1',
          decision: 'accepted',
          rationale: 'Test',
        })
      ).toThrow();
    });
  });

  describe('manager.log_finding auto-execution', () => {
    it('should auto-execute manager.log_finding and create a finding memory item', async () => {
      const mockItem = mockMemoryItemCreate({
        id: 'finding-1',
        type: 'finding',
        title: 'Broken nav on mobile',
        content: {
          finding_type: 'bug',
          severity: 'high',
          description: 'Menu overlaps content',
        },
        status: 'proposed',
      });
      mockToolCallCreate('tc-finding-1');

      mockGenerateJSON.mockResolvedValueOnce(
        JSON.stringify({
          mode: 'ACT',
          message: 'Logging the finding from tester.',
          tool_request: {
            name: 'manager.log_finding',
            args: {
              finding_type: 'bug',
              severity: 'high',
              title: 'Broken nav on mobile',
              description: 'Menu overlaps content',
              component: 'navigation',
            },
            requires_approval: false,
            risk: 'low',
          },
        })
      );

      const result = await processChat({
        project_id: 'proj-1',
        user_id: 'user-1',
        message: 'Tester reports: navigation is broken on mobile, menu overlaps content',
        tools: [],
      });

      // Should be auto-executed
      expect(result.tool_auto_executed).toBe(true);
      expect(result.tool_result).toBeDefined();
      expect(result.tool_result!.ok).toBe(true);
      expect(result.tool_result!.data).toEqual({
        finding_id: 'finding-1',
        status: 'proposed',
      });

      // Should create memory item with type 'finding'
      expect(vi.mocked(prisma.memoryItem.create)).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'finding',
            title: 'Broken nav on mobile',
            status: 'proposed',
          }),
        })
      );

      // Tool call should be stored as completed
      const toolCallArg = vi.mocked(prisma.toolCall.create).mock.calls[0][0];
      expect(toolCallArg.data.status).toBe('completed');
      expect(toolCallArg.data.requiresApproval).toBe(false);
    });
  });

  describe('manager.create_task auto-execution', () => {
    it('should auto-execute manager.create_task and create a task memory item', async () => {
      mockMemoryItemCreate({
        id: 'task-1',
        type: 'impl_task',
        title: 'Fix mobile navigation layout',
        status: 'proposed',
      });
      mockToolCallCreate('tc-task-1');

      // Mock findUnique for finding update
      vi.mocked(prisma.memoryItem.findUnique).mockResolvedValue({
        id: 'finding-1',
        projectId: 'proj-1',
        userId: 'user-1',
        type: 'finding',
        title: 'Broken nav',
        content: {},
        status: 'proposed',
        source: 'user_chat',
        confidence: 0.8,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
        supersedesId: null,
        tags: [],
        qdrantPointId: 'qp-1',
      });
      vi.mocked(prisma.memoryItem.update).mockResolvedValue({
        id: 'finding-1',
        projectId: 'proj-1',
        userId: 'user-1',
        type: 'finding',
        title: 'Broken nav',
        content: {},
        status: 'done',
        source: 'user_chat',
        confidence: 0.8,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
        supersedesId: null,
        tags: [],
        qdrantPointId: 'qp-1',
      });

      mockGenerateJSON.mockResolvedValueOnce(
        JSON.stringify({
          mode: 'ACT',
          message: 'Creating implementation task for the navigation fix.',
          tool_request: {
            name: 'manager.create_task',
            args: {
              title: 'Fix mobile navigation layout',
              description: 'Refactor nav component to use responsive breakpoints',
              priority: 'high',
              rationale: 'Critical UX issue affecting mobile users',
              acceptance_criteria: 'Nav works on all screen sizes',
              finding_ids: ['finding-1'],
            },
            requires_approval: false,
            risk: 'low',
          },
        })
      );

      const result = await processChat({
        project_id: 'proj-1',
        user_id: 'user-1',
        message: 'Process this finding and create a task if needed',
        tools: [],
      });

      expect(result.tool_auto_executed).toBe(true);
      expect(result.tool_result!.ok).toBe(true);
      expect(result.tool_result!.data).toEqual({
        task_id: 'task-1',
        status: 'proposed',
      });

      // Should create memory item with type 'impl_task'
      expect(vi.mocked(prisma.memoryItem.create)).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'impl_task',
            title: 'Fix mobile navigation layout',
            status: 'proposed',
          }),
        })
      );

      // Should mark linked finding as done
      expect(vi.mocked(prisma.memoryItem.update)).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'finding-1' },
          data: expect.objectContaining({ status: 'done' }),
        })
      );
    });
  });

  describe('manager.decide_finding auto-execution', () => {
    it('should reject a finding with rationale and preserve original content', async () => {
      // Mock the finding to be updated — findUnique is called twice: once for content merge, once in updateMemoryItem
      const originalFinding = {
        id: 'finding-2',
        projectId: 'proj-1',
        userId: 'user-1',
        type: 'finding',
        title: 'Add dark mode toggle',
        content: { finding_type: 'improvement', severity: 'low', description: 'User wants dark mode' },
        status: 'proposed',
        source: 'user_chat',
        confidence: 0.8,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
        supersedesId: null,
        tags: [],
        qdrantPointId: 'qp-2',
      };
      vi.mocked(prisma.memoryItem.findUnique).mockResolvedValue(originalFinding);
      vi.mocked(prisma.memoryItem.update).mockResolvedValue({
        ...originalFinding,
        content: {
          finding_type: 'improvement',
          severity: 'low',
          description: 'User wants dark mode',
          decision: 'rejected',
          decision_rationale: 'Out of scope per product brief',
        },
        status: 'rejected',
      });
      // Mock event creation for decision log
      vi.mocked(prisma.memoryItem.create).mockResolvedValue({
        id: 'event-1',
        projectId: 'proj-1',
        userId: 'user-1',
        type: 'event',
        title: 'Finding rejected: Add dark mode toggle',
        content: {},
        status: 'accepted',
        source: 'user_chat',
        confidence: 1.0,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
        supersedesId: null,
        tags: [],
        qdrantPointId: 'qp-3',
      });
      mockToolCallCreate('tc-decide-1');

      mockGenerateJSON.mockResolvedValueOnce(
        JSON.stringify({
          mode: 'ACT',
          message: 'Rejecting this finding — dark mode is out of scope.',
          tool_request: {
            name: 'manager.decide_finding',
            args: {
              finding_id: 'finding-2',
              decision: 'rejected',
              rationale: 'Out of scope per product brief — minimalist design, no theme switching',
            },
            requires_approval: false,
            risk: 'low',
          },
        })
      );

      const result = await processChat({
        project_id: 'proj-1',
        user_id: 'user-1',
        message: 'Tester suggests adding dark mode',
        tools: [],
      });

      expect(result.tool_auto_executed).toBe(true);
      expect(result.tool_result!.ok).toBe(true);
      expect(result.tool_result!.data).toEqual({
        finding_id: 'finding-2',
        status: 'rejected',
        decision: 'rejected',
      });

      // Should update finding status to rejected with merged content (original fields preserved)
      expect(vi.mocked(prisma.memoryItem.update)).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'finding-2' },
          data: expect.objectContaining({
            status: 'rejected',
            content: expect.objectContaining({
              finding_type: 'improvement',
              severity: 'low',
              description: 'User wants dark mode',
              decision: 'rejected',
              decision_rationale: 'Out of scope per product brief — minimalist design, no theme switching',
            }),
          }),
        })
      );

      // Should log an event for the decision
      expect(vi.mocked(prisma.memoryItem.create)).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'event',
            title: expect.stringContaining('rejected'),
          }),
        })
      );
    });

    it('should defer a finding', async () => {
      const originalFinding = {
        id: 'finding-3',
        projectId: 'proj-1',
        userId: 'user-1',
        type: 'finding',
        title: 'Minor color inconsistency',
        content: { finding_type: 'ux_issue', severity: 'low', description: 'Footer color mismatch' },
        status: 'proposed',
        source: 'user_chat',
        confidence: 0.8,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
        supersedesId: null,
        tags: [],
        qdrantPointId: 'qp-3',
      };
      vi.mocked(prisma.memoryItem.findUnique).mockResolvedValue(originalFinding);
      vi.mocked(prisma.memoryItem.update).mockResolvedValue({
        ...originalFinding,
        content: { ...originalFinding.content as object, decision: 'deferred', decision_rationale: 'Valid but low priority' },
        status: 'blocked',
      });
      vi.mocked(prisma.memoryItem.create).mockResolvedValue({
        id: 'event-2',
        projectId: 'proj-1',
        userId: 'user-1',
        type: 'event',
        title: 'Finding deferred: Minor color inconsistency',
        content: {},
        status: 'accepted',
        source: 'user_chat',
        confidence: 1.0,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
        supersedesId: null,
        tags: [],
        qdrantPointId: 'qp-4',
      });
      mockToolCallCreate('tc-decide-2');

      mockGenerateJSON.mockResolvedValueOnce(
        JSON.stringify({
          mode: 'ACT',
          message: 'Deferring this finding — valid but not priority right now.',
          tool_request: {
            name: 'manager.decide_finding',
            args: {
              finding_id: 'finding-3',
              decision: 'deferred',
              rationale: 'Valid issue but low priority — focus is on core functionality first',
            },
            requires_approval: false,
            risk: 'low',
          },
        })
      );

      const result = await processChat({
        project_id: 'proj-1',
        user_id: 'user-1',
        message: 'Tester found a minor color mismatch in footer',
        tools: [],
      });

      expect(result.tool_auto_executed).toBe(true);
      expect(result.tool_result!.data).toEqual({
        finding_id: 'finding-3',
        status: 'blocked',
        decision: 'deferred',
      });
    });
  });

  describe('manager tools included in system prompt', () => {
    it('should include manager tools in available tools', async () => {
      mockGenerateJSON.mockResolvedValueOnce(
        JSON.stringify({
          mode: 'NOOP',
          message: 'Hi',
          tool_request: null,
        })
      );

      await processChat({
        project_id: 'proj-1',
        user_id: 'user-1',
        message: 'Hello',
        tools: [],
      });

      const generateCallArgs = mockGenerateJSON.mock.calls[0][0];
      expect(generateCallArgs.system).toContain('manager.log_finding');
      expect(generateCallArgs.system).toContain('manager.create_task');
      expect(generateCallArgs.system).toContain('manager.decide_finding');
    });
  });

  describe('manager.log_finding validation errors', () => {
    it('should return error for invalid finding args', async () => {
      mockToolCallCreate('tc-bad-1');

      mockGenerateJSON.mockResolvedValueOnce(
        JSON.stringify({
          mode: 'ACT',
          message: 'Logging finding.',
          tool_request: {
            name: 'manager.log_finding',
            args: {
              finding_type: 'invalid_type',
              severity: 'high',
              title: 'Test',
              description: 'Test',
            },
            requires_approval: false,
            risk: 'low',
          },
        })
      );

      const result = await processChat({
        project_id: 'proj-1',
        user_id: 'user-1',
        message: 'Log a finding',
        tools: [],
      });

      expect(result.tool_auto_executed).toBe(true);
      expect(result.tool_result!.ok).toBe(false);
      expect(result.tool_result!.error).toContain('Invalid arguments');
    });
  });

  describe('manager.decide_finding error handling', () => {
    it('should return error for non-existent finding', async () => {
      vi.mocked(prisma.memoryItem.findUnique).mockResolvedValue(null);
      mockToolCallCreate('tc-notfound-1');

      mockGenerateJSON.mockResolvedValueOnce(
        JSON.stringify({
          mode: 'ACT',
          message: 'Rejecting finding.',
          tool_request: {
            name: 'manager.decide_finding',
            args: {
              finding_id: 'nonexistent',
              decision: 'rejected',
              rationale: 'Not relevant',
            },
            requires_approval: false,
            risk: 'low',
          },
        })
      );

      const result = await processChat({
        project_id: 'proj-1',
        user_id: 'user-1',
        message: 'Reject this finding',
        tools: [],
      });

      expect(result.tool_auto_executed).toBe(true);
      expect(result.tool_result!.ok).toBe(false);
      expect(result.tool_result!.error).toContain('Finding not found');
    });
  });

  describe('manager tool prompt instructions', () => {
    it('should include manager tool usage instructions in system prompt', async () => {
      mockGenerateJSON.mockResolvedValueOnce(
        JSON.stringify({
          mode: 'NOOP',
          message: 'Hi',
          tool_request: null,
        })
      );

      await processChat({
        project_id: 'proj-1',
        user_id: 'user-1',
        message: 'Hello',
        tools: [],
      });

      const generateCallArgs = mockGenerateJSON.mock.calls[0][0];
      // Should have instructions on when to use manager tools
      expect(generateCallArgs.system).toContain('MANAGER TOOLS');
      expect(generateCallArgs.system).toContain('manager.log_finding');
      // Should distinguish from memory tools
      expect(generateCallArgs.system).toContain('manager tools vs memory tools');
      // Should have evaluation rules
      expect(generateCallArgs.system).toContain('FINDING EVALUATION RULES');
    });
  });
});
