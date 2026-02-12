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

import { processChat, processToolResult } from '../src/services/agent.js';
import { prisma } from '../src/db/client.js';

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
  vi.mocked(prisma.toolCall.create).mockResolvedValue({} as never);
}

describe('Agent Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBasicMocks();
  });

  describe('processChat', () => {
    it('should return NOOP response', async () => {
      mockGenerateJSON.mockResolvedValueOnce(
        JSON.stringify({
          mode: 'NOOP',
          message: 'Hello! How can I help?',
          tool_request: null,

        })
      );

      const result = await processChat({
        project_id: 'proj-1',
        user_id: 'user-1',
        message: 'Hello',
        tools: [],
      });

      expect(result.response_json.mode).toBe('NOOP');
      expect(result.response_json.message).toBe('Hello! How can I help?');
      expect(result.thread_id).toBe('thread-1');
    });

    it('should return ASK response', async () => {
      mockGenerateJSON.mockResolvedValueOnce(
        JSON.stringify({
          mode: 'ASK',
          message: 'What project do you mean?',
          tool_request: null,

        })
      );

      const result = await processChat({
        project_id: 'proj-1',
        user_id: 'user-1',
        message: 'Create a ticket',
        tools: [],
      });

      expect(result.response_json.mode).toBe('ASK');
    });

    it('should handle ACT response with valid tool', async () => {
      mockGenerateJSON.mockResolvedValueOnce(
        JSON.stringify({
          mode: 'ACT',
          message: 'Creating a Jira ticket.',
          tool_request: {
            name: 'jira.create',
            args: { summary: 'Bug fix' },
            requires_approval: true,
            risk: 'medium',
          },

        })
      );

      const result = await processChat({
        project_id: 'proj-1',
        user_id: 'user-1',
        message: 'Create a ticket for bug fix',
        tools: [
          {
            name: 'jira.create',
            description: 'Create Jira ticket',
            parameters: { summary: { type: 'string', required: true } },
            requires_approval: true,
            risk: 'medium',
          },
        ],
      });

      expect(result.response_json.mode).toBe('ACT');
      expect(vi.mocked(prisma.toolCall.create)).toHaveBeenCalled();
    });

    it('should reject ACT with unknown tool', async () => {
      mockGenerateJSON.mockResolvedValueOnce(
        JSON.stringify({
          mode: 'ACT',
          message: 'Using tool',
          tool_request: {
            name: 'unknown.tool',
            args: {},
            requires_approval: true,
            risk: 'low',
          },

        })
      );

      const result = await processChat({
        project_id: 'proj-1',
        user_id: 'user-1',
        message: 'Do something',
        tools: [],
      });

      // Should be converted to ASK mode
      expect(result.response_json.mode).toBe('ASK');
      expect(result.response_json.message).toContain('error');
    });

    it('should reject ACT with missing required parameter', async () => {
      mockGenerateJSON.mockResolvedValueOnce(
        JSON.stringify({
          mode: 'ACT',
          message: 'Creating',
          tool_request: {
            name: 'jira.create',
            args: {}, // Missing required 'summary'
            requires_approval: true,
            risk: 'medium',
          },

        })
      );

      const result = await processChat({
        project_id: 'proj-1',
        user_id: 'user-1',
        message: 'Create',
        tools: [
          {
            name: 'jira.create',
            description: 'Create ticket',
            parameters: { summary: { type: 'string', required: true } },
            requires_approval: true,
            risk: 'medium',
          },
        ],
      });

      expect(result.response_json.mode).toBe('ASK');
      expect(result.response_json.message).toContain('Missing required parameter');
    });

    it('should throw NotFoundError for missing project', async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(null);

      await expect(
        processChat({
          project_id: 'nonexistent',
          user_id: 'user-1',
          message: 'Hello',
          tools: [],
        })
      ).rejects.toThrow('Project');
    });

    it('should create new thread when thread_id not provided', async () => {
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

      expect(vi.mocked(prisma.thread.create)).toHaveBeenCalled();
    });

    it('should reuse existing thread when thread_id provided', async () => {
      vi.mocked(prisma.thread.findUnique).mockResolvedValueOnce(mockThread);

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
        thread_id: 'thread-1',
        message: 'Follow up',
        tools: [],
      });

      expect(vi.mocked(prisma.thread.findUnique)).toHaveBeenCalledWith({
        where: { id: 'thread-1' },
      });
    });

    it('should handle invalid JSON from LLM gracefully', async () => {
      mockGenerateJSON.mockResolvedValueOnce('This is not JSON at all');

      const result = await processChat({
        project_id: 'proj-1',
        user_id: 'user-1',
        message: 'Hello',
        tools: [],
      });

      // Should fall back to safe ASK response
      expect(result.response_json.mode).toBe('ASK');
      expect(result.response_json.message).toContain('issue');
    });

    it('should auto-approve memory event tools and return auto_executed fields', async () => {
      vi.mocked(prisma.memoryItem.create).mockResolvedValue({
        id: 'mi-1',
        projectId: 'proj-1',
        userId: 'user-1',
        type: 'event',
        title: 'Meeting occurred',
        content: { note: 'standup' },
        status: 'accepted',
        source: 'user_chat',
        confidence: 1.0,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
        supersedesId: null,
        tags: [],
        qdrantPointId: 'qp-1',
      });

      vi.mocked(prisma.toolCall.create).mockResolvedValueOnce({
        id: 'tc-auto-1',
        projectId: 'proj-1',
        threadId: 'thread-1',
        name: 'memory.propose_add',
        argsJson: '{}',
        requiresApproval: false,
        risk: 'low',
        status: 'completed',
        resultJson: null,
        toolsJson: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      mockGenerateJSON.mockResolvedValueOnce(
        JSON.stringify({
          mode: 'ACT',
          message: 'Logging event',
          tool_request: {
            name: 'memory.propose_add',
            args: {
              type: 'event',
              title: 'Meeting occurred',
              content: { note: 'standup' },
            },
            requires_approval: true,
            risk: 'low',
          },

        })
      );

      const result = await processChat({
        project_id: 'proj-1',
        user_id: 'user-1',
        message: 'We had a standup meeting',
        tools: [],
      });

      // Tool call should be created with status completed (auto-approved)
      const toolCallArg = vi.mocked(prisma.toolCall.create).mock.calls[0][0];
      expect(toolCallArg.data.status).toBe('completed');
      expect(toolCallArg.data.requiresApproval).toBe(false);

      // Response must include auto-executed fields so n8n can drive the loop
      expect(result.tool_call_id).toBe('tc-auto-1');
      expect(result.tool_auto_executed).toBe(true);
      expect(result.tool_result).toBeDefined();
      expect(result.tool_result!.ok).toBe(true);
      expect(result.tool_result!.data).toEqual({ memory_item_id: 'mi-1', status: 'accepted' });
    });

    it('should auto-approve memory fact tools and return auto_executed fields', async () => {
      vi.mocked(prisma.memoryItem.create).mockResolvedValue({
        id: 'mi-2',
        projectId: 'proj-1',
        userId: 'user-1',
        type: 'fact',
        title: 'Budget is 50k',
        content: { budget: 50000 },
        status: 'accepted',
        source: 'user_chat',
        confidence: 0.5,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
        supersedesId: null,
        tags: [],
        qdrantPointId: 'qp-1',
      });

      vi.mocked(prisma.toolCall.create).mockResolvedValueOnce({
        id: 'tc-auto-2',
        projectId: 'proj-1',
        threadId: 'thread-1',
        name: 'memory.propose_add',
        argsJson: '{}',
        requiresApproval: false,
        risk: 'low',
        status: 'completed',
        resultJson: null,
        toolsJson: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      mockGenerateJSON.mockResolvedValueOnce(
        JSON.stringify({
          mode: 'ACT',
          message: 'Noting the budget',
          tool_request: {
            name: 'memory.propose_add',
            args: {
              type: 'fact',
              title: 'Budget is 50k',
              content: { budget: 50000 },
            },
            requires_approval: true,
            risk: 'low',
          },

        })
      );

      const result = await processChat({
        project_id: 'proj-1',
        user_id: 'user-1',
        message: 'Our budget is 50k',
        tools: [],
      });

      // All memory tools are auto-approved
      const toolCallArg = vi.mocked(prisma.toolCall.create).mock.calls[0][0];
      expect(toolCallArg.data.status).toBe('completed');

      // Must return auto-executed fields
      expect(result.tool_call_id).toBe('tc-auto-2');
      expect(result.tool_auto_executed).toBe(true);
      expect(result.tool_result).toBeDefined();
      expect(result.tool_result!.ok).toBe(true);
    });

    it('should auto-approve memory metric with TTL and return auto_executed fields', async () => {
      vi.mocked(prisma.memoryItem.create).mockResolvedValue({
        id: 'mi-3',
        projectId: 'proj-1',
        userId: 'user-1',
        type: 'metric',
        title: 'Response time',
        content: { value: 200 },
        status: 'accepted',
        source: 'system',
        confidence: 1.0,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        supersedesId: null,
        tags: [],
        qdrantPointId: 'qp-1',
      });

      vi.mocked(prisma.toolCall.create).mockResolvedValueOnce({
        id: 'tc-auto-3',
        projectId: 'proj-1',
        threadId: 'thread-1',
        name: 'memory.propose_add',
        argsJson: '{}',
        requiresApproval: false,
        risk: 'low',
        status: 'completed',
        resultJson: null,
        toolsJson: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      mockGenerateJSON.mockResolvedValueOnce(
        JSON.stringify({
          mode: 'ACT',
          message: 'Recording metric',
          tool_request: {
            name: 'memory.propose_add',
            args: {
              type: 'metric',
              title: 'Response time',
              content: { value: 200 },
              expires_in_seconds: 3600,
            },
            requires_approval: true,
            risk: 'low',
          },

        })
      );

      const result = await processChat({
        project_id: 'proj-1',
        user_id: 'user-1',
        message: 'Response time is 200ms',
        tools: [],
      });

      const toolCallArg = vi.mocked(prisma.toolCall.create).mock.calls[0][0];
      expect(toolCallArg.data.status).toBe('completed');

      // Must return auto-executed fields
      expect(result.tool_call_id).toBe('tc-auto-3');
      expect(result.tool_auto_executed).toBe(true);
      expect(result.tool_result).toBeDefined();
      expect(result.tool_result!.ok).toBe(true);
    });

    it('should NOT set tool_auto_executed for custom (non-memory) tools', async () => {
      vi.mocked(prisma.toolCall.create).mockResolvedValueOnce({
        id: 'tc-custom-1',
        projectId: 'proj-1',
        threadId: 'thread-1',
        name: 'jira.create',
        argsJson: '{}',
        requiresApproval: true,
        risk: 'medium',
        status: 'pending',
        resultJson: null,
        toolsJson: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      mockGenerateJSON.mockResolvedValueOnce(
        JSON.stringify({
          mode: 'ACT',
          message: 'Creating ticket',
          tool_request: {
            name: 'jira.create',
            args: { summary: 'Bug fix' },
            requires_approval: true,
            risk: 'medium',
          },

        })
      );

      const result = await processChat({
        project_id: 'proj-1',
        user_id: 'user-1',
        message: 'Create a ticket',
        tools: [
          {
            name: 'jira.create',
            description: 'Create Jira ticket',
            parameters: { summary: { type: 'string', required: true } },
            requires_approval: true,
            risk: 'medium',
          },
        ],
      });

      // Custom tool: pending for n8n, NOT auto-executed
      expect(result.tool_call_id).toBe('tc-custom-1');
      expect(result.tool_auto_executed).toBeUndefined();
      expect(result.tool_result).toBeUndefined();

      const toolCallArg = vi.mocked(prisma.toolCall.create).mock.calls[0][0];
      expect(toolCallArg.data.status).toBe('pending');
    });

    it('should include memory tools automatically', async () => {
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

      // The system prompt should include memory tools
      const generateCallArgs = mockGenerateJSON.mock.calls[0][0];
      expect(generateCallArgs.system).toContain('memory.propose_add');
      expect(generateCallArgs.system).toContain('memory.propose_update');
    });

    it('should store audit log', async () => {
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

      expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId: 'proj-1',
            userId: 'user-1',
            eventType: 'chat',
          }),
        })
      );
    });

    it('should set render.text_to_send_to_user', async () => {
      mockGenerateJSON.mockResolvedValueOnce(
        JSON.stringify({
          mode: 'NOOP',
          message: 'The answer is 42',
          tool_request: null,

        })
      );

      const result = await processChat({
        project_id: 'proj-1',
        user_id: 'user-1',
        message: 'Question',
        tools: [],
      });

      expect(result.render.text_to_send_to_user).toBe('The answer is 42');
    });
  });

  describe('processToolResult', () => {
    it('should update tool call status to completed on success and return agent response', async () => {
      const mockToolCall = {
        id: 'tc-1',
        projectId: 'proj-1',
        threadId: 'thread-1',
        name: 'jira.create',
        argsJson: '{"summary":"test"}',
        requiresApproval: true,
        risk: 'medium',
        status: 'pending',
        resultJson: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        thread: mockThread,
      };

      vi.mocked(prisma.toolCall.findUnique).mockResolvedValueOnce(mockToolCall as never);
      vi.mocked(prisma.toolCall.update).mockResolvedValueOnce(mockToolCall as never);
      vi.mocked(prisma.message.create).mockResolvedValue({} as never);
      vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
      vi.mocked(prisma.memoryItem.create).mockResolvedValue({
        id: 'mi-1',
        projectId: 'proj-1',
        userId: null,
        type: 'event',
        title: 'Tool jira.create succeeded',
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
      });

      // processToolResult now calls processChat internally, so mock the LLM response
      vi.mocked(prisma.thread.findUnique).mockResolvedValueOnce(mockThread);
      mockGenerateJSON.mockResolvedValueOnce(
        JSON.stringify({
          mode: 'NOOP',
          message: 'Ticket PROJ-123 has been created.',
          tool_request: null,

        })
      );

      const result = await processToolResult('tc-1', 'proj-1', true, { ticket_id: 'PROJ-123' });

      expect(vi.mocked(prisma.toolCall.update)).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tc-1' },
          data: expect.objectContaining({
            status: 'completed',
          }),
        })
      );

      // Should return a ChatResponse from the follow-up agent call
      expect(result.thread_id).toBe('thread-1');
      expect(result.response_json.mode).toBe('NOOP');
      expect(result.response_json.message).toBe('Ticket PROJ-123 has been created.');
      expect(result.render.text_to_send_to_user).toBe('Ticket PROJ-123 has been created.');
    });

    it('should update tool call status to failed on error and return agent response', async () => {
      const mockToolCall = {
        id: 'tc-1',
        projectId: 'proj-1',
        threadId: 'thread-1',
        name: 'jira.create',
        argsJson: '{"summary":"test"}',
        requiresApproval: true,
        risk: 'medium',
        status: 'pending',
        resultJson: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        thread: mockThread,
      };

      vi.mocked(prisma.toolCall.findUnique).mockResolvedValueOnce(mockToolCall as never);
      vi.mocked(prisma.toolCall.update).mockResolvedValueOnce(mockToolCall as never);
      vi.mocked(prisma.message.create).mockResolvedValue({} as never);
      vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
      vi.mocked(prisma.memoryItem.create).mockResolvedValue({
        id: 'mi-1',
        projectId: 'proj-1',
        userId: null,
        type: 'event',
        title: 'Tool jira.create failed',
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
      });

      // processToolResult now calls processChat internally
      vi.mocked(prisma.thread.findUnique).mockResolvedValueOnce(mockThread);
      mockGenerateJSON.mockResolvedValueOnce(
        JSON.stringify({
          mode: 'NOOP',
          message: 'The ticket creation failed due to permission error.',
          tool_request: null,

        })
      );

      const result = await processToolResult('tc-1', 'proj-1', false, undefined, 'Permission denied');

      expect(vi.mocked(prisma.toolCall.update)).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'failed',
          }),
        })
      );

      // Should return a ChatResponse
      expect(result.response_json.mode).toBe('NOOP');
      expect(result.render.text_to_send_to_user).toContain('failed');
    });

    it('should throw NotFoundError for missing tool call', async () => {
      vi.mocked(prisma.toolCall.findUnique).mockResolvedValueOnce(null);

      await expect(
        processToolResult('nonexistent', 'proj-1', true)
      ).rejects.toThrow('Tool call');
    });
  });
});
