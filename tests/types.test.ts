import { describe, it, expect } from 'vitest';
import {
  AgentModeSchema,
  RiskLevelSchema,
  ToolInputSchema,
  ToolRequestSchema,
  MemoryUpdatesSchema,
  AgentResponseSchema,
  ChatRequestSchema,
  CreateProjectSchema,
  DocumentCategorySchema,
  ToolResultSchema,
  MemoryItemTypeSchema,
  MemoryItemSourceSchema,
  MemoryItemStatusSchema,
  CreateMemoryItemSchema,
  UpdateMemoryItemSchema,
  MemoryProposeAddSchema,
  MemoryProposeUpdateSchema,
} from '../src/types/index.js';

describe('Zod Schema Validation', () => {
  describe('AgentModeSchema', () => {
    it('should accept valid modes', () => {
      expect(AgentModeSchema.parse('ACT')).toBe('ACT');
      expect(AgentModeSchema.parse('ASK')).toBe('ASK');
      expect(AgentModeSchema.parse('NOOP')).toBe('NOOP');
    });

    it('should reject invalid modes', () => {
      expect(() => AgentModeSchema.parse('INVALID')).toThrow();
      expect(() => AgentModeSchema.parse('')).toThrow();
    });
  });

  describe('RiskLevelSchema', () => {
    it('should accept valid risk levels', () => {
      expect(RiskLevelSchema.parse('low')).toBe('low');
      expect(RiskLevelSchema.parse('medium')).toBe('medium');
      expect(RiskLevelSchema.parse('high')).toBe('high');
    });

    it('should reject invalid risk levels', () => {
      expect(() => RiskLevelSchema.parse('critical')).toThrow();
    });
  });

  describe('ToolInputSchema', () => {
    it('should accept valid tool input', () => {
      const result = ToolInputSchema.parse({
        name: 'jira.create_ticket',
        description: 'Create a Jira ticket',
        parameters: {
          summary: { type: 'string', required: true },
        },
        requires_approval: true,
        risk: 'medium',
      });
      expect(result.name).toBe('jira.create_ticket');
      expect(result.requires_approval).toBe(true);
    });

    it('should apply defaults', () => {
      const result = ToolInputSchema.parse({
        name: 'test.tool',
        description: 'A test tool',
      });
      expect(result.requires_approval).toBe(true);
      expect(result.risk).toBe('medium');
    });

    it('should accept tool without parameters', () => {
      const result = ToolInputSchema.parse({
        name: 'test.tool',
        description: 'No params',
      });
      expect(result.parameters).toBeUndefined();
    });

    it('should reject missing name', () => {
      expect(() =>
        ToolInputSchema.parse({ description: 'No name' })
      ).toThrow();
    });
  });

  describe('ToolRequestSchema', () => {
    it('should accept valid tool request', () => {
      const result = ToolRequestSchema.parse({
        name: 'jira.create_ticket',
        args: { summary: 'Bug fix', project: 'PROJ' },
        requires_approval: true,
        risk: 'medium',
      });
      expect(result.name).toBe('jira.create_ticket');
      expect(result.args).toEqual({ summary: 'Bug fix', project: 'PROJ' });
    });

    it('should accept empty args', () => {
      const result = ToolRequestSchema.parse({
        name: 'test',
        args: {},
        requires_approval: false,
        risk: 'low',
      });
      expect(result.args).toEqual({});
    });
  });

  describe('MemoryUpdatesSchema', () => {
    it('should accept full updates', () => {
      const result = MemoryUpdatesSchema.parse({
        preferences_add: ['Use tabs'],
        preferences_remove: ['Use spaces'],
        lessons_add: ['Tests are important'],
      });
      expect(result.preferences_add).toEqual(['Use tabs']);
      expect(result.preferences_remove).toEqual(['Use spaces']);
      expect(result.lessons_add).toEqual(['Tests are important']);
    });

    it('should apply defaults for missing fields', () => {
      const result = MemoryUpdatesSchema.parse({});
      expect(result.preferences_add).toEqual([]);
      expect(result.preferences_remove).toEqual([]);
      expect(result.lessons_add).toEqual([]);
    });
  });

  describe('AgentResponseSchema', () => {
    it('should accept NOOP response', () => {
      const result = AgentResponseSchema.parse({
        mode: 'NOOP',
        message: 'Hello',
        tool_request: null,
        memory_updates: {
          preferences_add: [],
          preferences_remove: [],
          lessons_add: [],
        },
      });
      expect(result.mode).toBe('NOOP');
      expect(result.tool_request).toBeNull();
    });

    it('should accept ACT response with tool_request', () => {
      const result = AgentResponseSchema.parse({
        mode: 'ACT',
        message: 'Creating ticket',
        tool_request: {
          name: 'jira.create',
          args: { summary: 'test' },
          requires_approval: true,
          risk: 'medium',
        },
      });
      expect(result.mode).toBe('ACT');
      expect(result.tool_request?.name).toBe('jira.create');
    });

    it('should accept ASK response', () => {
      const result = AgentResponseSchema.parse({
        mode: 'ASK',
        message: 'What project?',
      });
      expect(result.mode).toBe('ASK');
      expect(result.memory_updates).toBeDefined();
    });

    it('should apply default memory_updates', () => {
      const result = AgentResponseSchema.parse({
        mode: 'NOOP',
        message: 'test',
      });
      expect(result.memory_updates.preferences_add).toEqual([]);
    });

    it('should reject missing message', () => {
      expect(() =>
        AgentResponseSchema.parse({ mode: 'NOOP' })
      ).toThrow();
    });
  });

  describe('ChatRequestSchema', () => {
    it('should accept valid chat request', () => {
      const result = ChatRequestSchema.parse({
        project_id: 'proj-1',
        user_id: 'user-1',
        message: 'Hello',
      });
      expect(result.project_id).toBe('proj-1');
      expect(result.tools).toEqual([]);
    });

    it('should accept request with tools', () => {
      const result = ChatRequestSchema.parse({
        project_id: 'proj-1',
        user_id: 'user-1',
        message: 'Create ticket',
        tools: [
          {
            name: 'jira.create',
            description: 'Create ticket',
            requires_approval: true,
            risk: 'low',
          },
        ],
      });
      expect(result.tools).toHaveLength(1);
    });

    it('should accept request with context', () => {
      const result = ChatRequestSchema.parse({
        project_id: 'proj-1',
        user_id: 'user-1',
        message: 'Hello',
        context: { source: 'slack', meta: { channel: '#general' } },
      });
      expect(result.context?.source).toBe('slack');
    });

    it('should reject empty message', () => {
      expect(() =>
        ChatRequestSchema.parse({
          project_id: 'proj-1',
          user_id: 'user-1',
          message: '',
        })
      ).toThrow();
    });

    it('should reject missing project_id', () => {
      expect(() =>
        ChatRequestSchema.parse({
          user_id: 'user-1',
          message: 'Hello',
        })
      ).toThrow();
    });
  });

  describe('CreateProjectSchema', () => {
    it('should accept valid project', () => {
      const result = CreateProjectSchema.parse({
        name: 'My Project',
        roleStatement: 'Project manager',
      });
      expect(result.name).toBe('My Project');
    });

    it('should reject empty name', () => {
      expect(() =>
        CreateProjectSchema.parse({ name: '', roleStatement: 'test' })
      ).toThrow();
    });

    it('should reject empty roleStatement', () => {
      expect(() =>
        CreateProjectSchema.parse({ name: 'test', roleStatement: '' })
      ).toThrow();
    });
  });

  describe('DocumentCategorySchema', () => {
    it('should accept valid categories', () => {
      expect(DocumentCategorySchema.parse('FACTS')).toBe('FACTS');
      expect(DocumentCategorySchema.parse('RULES')).toBe('RULES');
      expect(DocumentCategorySchema.parse('STATE')).toBe('STATE');
    });

    it('should reject invalid category', () => {
      expect(() => DocumentCategorySchema.parse('NOTES')).toThrow();
    });
  });

  describe('ToolResultSchema', () => {
    it('should accept successful result', () => {
      const result = ToolResultSchema.parse({
        tool_call_id: 'tc-1',
        project_id: 'proj-1',
        ok: true,
        data: { ticket_id: 'PROJ-123' },
      });
      expect(result.ok).toBe(true);
    });

    it('should accept failed result', () => {
      const result = ToolResultSchema.parse({
        tool_call_id: 'tc-1',
        project_id: 'proj-1',
        ok: false,
        error: 'Permission denied',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Permission denied');
    });
  });

  describe('MemoryItemTypeSchema', () => {
    it('should accept all valid types', () => {
      const validTypes = ['fact', 'rule', 'event', 'decision', 'open_loop', 'idea', 'metric', 'preference', 'lesson'];
      for (const type of validTypes) {
        expect(MemoryItemTypeSchema.parse(type)).toBe(type);
      }
    });

    it('should reject invalid type', () => {
      expect(() => MemoryItemTypeSchema.parse('note')).toThrow();
    });
  });

  describe('MemoryItemSourceSchema', () => {
    it('should accept all valid sources', () => {
      const validSources = ['user_chat', 'doc_upload', 'tool_result', 'cron', 'system'];
      for (const source of validSources) {
        expect(MemoryItemSourceSchema.parse(source)).toBe(source);
      }
    });
  });

  describe('MemoryItemStatusSchema', () => {
    it('should accept all valid statuses', () => {
      const validStatuses = ['proposed', 'accepted', 'rejected', 'done', 'blocked', 'active'];
      for (const status of validStatuses) {
        expect(MemoryItemStatusSchema.parse(status)).toBe(status);
      }
    });
  });

  describe('CreateMemoryItemSchema', () => {
    it('should accept valid create request', () => {
      const result = CreateMemoryItemSchema.parse({
        projectId: 'proj-1',
        type: 'fact',
        title: 'Python is used',
        content: { language: 'Python' },
      });
      expect(result.projectId).toBe('proj-1');
      expect(result.status).toBe('proposed');
      expect(result.confidence).toBe(0.5);
      expect(result.tags).toEqual([]);
    });

    it('should accept full create request', () => {
      const result = CreateMemoryItemSchema.parse({
        projectId: 'proj-1',
        userId: 'user-1',
        type: 'event',
        title: 'Deploy completed',
        content: { version: '1.0' },
        status: 'accepted',
        source: 'system',
        confidence: 1.0,
        tags: ['deploy'],
      });
      expect(result.status).toBe('accepted');
      expect(result.confidence).toBe(1.0);
    });

    it('should reject confidence out of range', () => {
      expect(() =>
        CreateMemoryItemSchema.parse({
          projectId: 'proj-1',
          type: 'fact',
          title: 'test',
          content: {},
          confidence: 1.5,
        })
      ).toThrow();
    });

    it('should reject empty title', () => {
      expect(() =>
        CreateMemoryItemSchema.parse({
          projectId: 'proj-1',
          type: 'fact',
          title: '',
          content: {},
        })
      ).toThrow();
    });
  });

  describe('UpdateMemoryItemSchema', () => {
    it('should accept partial update', () => {
      const result = UpdateMemoryItemSchema.parse({
        status: 'accepted',
      });
      expect(result.status).toBe('accepted');
      expect(result.title).toBeUndefined();
    });

    it('should accept full update', () => {
      const result = UpdateMemoryItemSchema.parse({
        title: 'Updated title',
        content: { new: 'data' },
        status: 'done',
        confidence: 0.9,
        tags: ['updated'],
      });
      expect(result.title).toBe('Updated title');
    });

    it('should accept nullable expiresAt', () => {
      const result = UpdateMemoryItemSchema.parse({
        expiresAt: null,
      });
      expect(result.expiresAt).toBeNull();
    });
  });

  describe('MemoryProposeAddSchema', () => {
    it('should accept valid proposal', () => {
      const result = MemoryProposeAddSchema.parse({
        type: 'fact',
        title: 'Budget is 50k',
        content: { budget: 50000 },
      });
      expect(result.type).toBe('fact');
    });

    it('should accept proposal with TTL', () => {
      const result = MemoryProposeAddSchema.parse({
        type: 'metric',
        title: 'Response time',
        content: { value: 200, unit: 'ms' },
        expires_in_seconds: 3600,
      });
      expect(result.expires_in_seconds).toBe(3600);
    });

    it('should reject negative TTL', () => {
      expect(() =>
        MemoryProposeAddSchema.parse({
          type: 'metric',
          title: 'test',
          content: {},
          expires_in_seconds: -1,
        })
      ).toThrow();
    });
  });

  describe('MemoryProposeUpdateSchema', () => {
    it('should accept valid update proposal', () => {
      const result = MemoryProposeUpdateSchema.parse({
        memory_item_id: 'mem-1',
        patch: { status: 'done' },
        reason: 'Task completed',
      });
      expect(result.memory_item_id).toBe('mem-1');
    });

    it('should reject empty reason', () => {
      expect(() =>
        MemoryProposeUpdateSchema.parse({
          memory_item_id: 'mem-1',
          patch: { status: 'done' },
          reason: '',
        })
      ).toThrow();
    });
  });
});
