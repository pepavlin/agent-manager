import { describe, it, expect } from 'vitest';
import { assembleSystemPrompt, assembleUserPrompt } from '../src/services/prompts.js';
import { RetrievedContext, ToolInput, MemoryItem } from '../src/types/index.js';

function makeEmptyContext(): RetrievedContext {
  return {
    kbChunks: [],
    preferences: [],
    lessons: [],
    playbook: null,
    brief: null,
    recentMessages: [],
  };
}

function makeMemoryItem(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: 'mi-1',
    projectId: 'proj-1',
    userId: 'user-1',
    type: 'fact',
    title: 'Test fact',
    content: { key: 'value' },
    status: 'accepted',
    source: 'user_chat',
    confidence: 0.8,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
    supersedesId: null,
    tags: [],
    qdrantPointId: null,
    ...overrides,
  };
}

describe('Prompt Assembly', () => {
  describe('assembleSystemPrompt', () => {
    it('should include project name and role', () => {
      const prompt = assembleSystemPrompt('MyProject', 'PM assistant', makeEmptyContext(), []);
      expect(prompt).toContain('MyProject');
      expect(prompt).toContain('PM assistant');
    });

    it('should include base system prompt', () => {
      const prompt = assembleSystemPrompt('Test', 'Test', makeEmptyContext(), []);
      expect(prompt).toContain('DECISION LOOP');
      expect(prompt).toContain('STRICT RESPONSE FORMAT');
      expect(prompt).toContain('SAFETY RULES');
    });

    it('should include tools when provided', () => {
      const tools: ToolInput[] = [
        {
          name: 'jira.create',
          description: 'Create a Jira ticket',
          parameters: {
            summary: { type: 'string', required: true, description: 'Ticket summary' },
          },
          requires_approval: true,
          risk: 'medium',
        },
      ];
      const prompt = assembleSystemPrompt('Test', 'Test', makeEmptyContext(), tools);
      expect(prompt).toContain('jira.create');
      expect(prompt).toContain('Create a Jira ticket');
      expect(prompt).toContain('summary');
    });

    it('should show "No tools available" when empty', () => {
      const prompt = assembleSystemPrompt('Test', 'Test', makeEmptyContext(), []);
      expect(prompt).toContain('No tools available');
    });

    it('should include playbook when present', () => {
      const context = makeEmptyContext();
      context.playbook = 'Always use snake_case for variables';
      const prompt = assembleSystemPrompt('Test', 'Test', context, []);
      expect(prompt).toContain('PROJECT RULES (PLAYBOOK)');
      expect(prompt).toContain('snake_case');
    });

    it('should include preferences when present', () => {
      const context = makeEmptyContext();
      context.preferences = ['Use TypeScript', 'Prefer functional style'];
      const prompt = assembleSystemPrompt('Test', 'Test', context, []);
      expect(prompt).toContain('USER PREFERENCES');
      expect(prompt).toContain('Use TypeScript');
      expect(prompt).toContain('Prefer functional style');
    });

    it('should include lessons when present', () => {
      const context = makeEmptyContext();
      context.lessons = ['Tests prevent regressions'];
      const prompt = assembleSystemPrompt('Test', 'Test', context, []);
      expect(prompt).toContain('LESSONS LEARNED');
      expect(prompt).toContain('Tests prevent regressions');
    });

    it('should include brief when present', () => {
      const context = makeEmptyContext();
      context.brief = '# Project Brief\nThis is a web app.';
      const prompt = assembleSystemPrompt('Test', 'Test', context, []);
      expect(prompt).toContain('PROJECT BRIEF');
      expect(prompt).toContain('This is a web app');
    });

    it('should omit sections when context is empty', () => {
      const prompt = assembleSystemPrompt('Test', 'Test', makeEmptyContext(), []);
      expect(prompt).not.toContain('USER PREFERENCES');
      expect(prompt).not.toContain('LESSONS LEARNED');
      expect(prompt).not.toContain('PROJECT BRIEF');
      expect(prompt).not.toContain('PROJECT RULES (PLAYBOOK)');
    });

    it('should include LEARNED RULES when learnedRules are present', () => {
      const context = makeEmptyContext();
      context.learnedRules = [
        makeMemoryItem({ type: 'rule', title: 'Always validate input before API calls', content: { detail: 'Prevents 400 errors' } }),
        makeMemoryItem({ type: 'rule', title: 'Use batch mode for bulk operations', content: { detail: 'Improves performance' } }),
      ];
      const prompt = assembleSystemPrompt('Test', 'Test', context, []);
      expect(prompt).toContain('LEARNED RULES (Self-Discovered)');
      expect(prompt).toContain('Always follow them');
      expect(prompt).toContain('Always validate input before API calls');
      expect(prompt).toContain('Use batch mode for bulk operations');
    });

    it('should omit LEARNED RULES when learnedRules is empty', () => {
      const context = makeEmptyContext();
      context.learnedRules = [];
      const prompt = assembleSystemPrompt('Test', 'Test', context, []);
      expect(prompt).not.toContain('LEARNED RULES');
    });

    it('should omit LEARNED RULES when learnedRules is undefined', () => {
      const prompt = assembleSystemPrompt('Test', 'Test', makeEmptyContext(), []);
      expect(prompt).not.toContain('LEARNED RULES');
    });

    it('should include MEMORY CONSOLIDATION section in cron mode', () => {
      const prompt = assembleSystemPrompt('Test', 'Test', makeEmptyContext(), [], 'cron');
      expect(prompt).toContain('MEMORY CONSOLIDATION (Periodic Maintenance)');
      expect(prompt).toContain('Detect conflicts');
      expect(prompt).toContain('Merge duplicates');
      expect(prompt).toContain('Archive stale items');
      expect(prompt).toContain('Promote patterns');
    });

    it('should NOT include MEMORY CONSOLIDATION in chat mode', () => {
      const prompt = assembleSystemPrompt('Test', 'Test', makeEmptyContext(), []);
      expect(prompt).not.toContain('MEMORY CONSOLIDATION');
    });

    it('should NOT include memory_updates in response schema', () => {
      const prompt = assembleSystemPrompt('Test', 'Test', makeEmptyContext(), []);
      expect(prompt).not.toContain('memory_updates');
      expect(prompt).not.toContain('preferences_add');
      expect(prompt).not.toContain('preferences_remove');
      expect(prompt).not.toContain('lessons_add');
    });

    it('should include mandatory memory.propose_add instruction for remember requests', () => {
      const prompt = assembleSystemPrompt('Test', 'Test', makeEmptyContext(), []);
      expect(prompt).toContain('MUST respond with ACT mode and use memory.propose_add');
      expect(prompt).toContain('WILL BE LOST');
    });

    it('should state memory.propose_add is the only way to store memory', () => {
      const prompt = assembleSystemPrompt('Test', 'Test', makeEmptyContext(), []);
      expect(prompt).toContain('There is NO other way to remember information');
    });
  });

  describe('assembleUserPrompt', () => {
    it('should include the user message', () => {
      const prompt = assembleUserPrompt('What is the budget?', makeEmptyContext());
      expect(prompt).toContain('What is the budget?');
      expect(prompt).toContain('CURRENT USER MESSAGE');
    });

    it('should include KB chunks when present', () => {
      const context = makeEmptyContext();
      context.kbChunks = [
        { text: 'Budget is $50,000', documentId: 'doc-1', category: 'FACTS', score: 0.95 },
      ];
      const prompt = assembleUserPrompt('What is the budget?', context);
      expect(prompt).toContain('RELEVANT KNOWLEDGE BASE CONTEXT');
      expect(prompt).toContain('Budget is $50,000');
      expect(prompt).toContain('[FACTS]');
      expect(prompt).toContain('0.950');
    });

    it('should include multiple KB chunks', () => {
      const context = makeEmptyContext();
      context.kbChunks = [
        { text: 'Chunk 1', documentId: 'doc-1', category: 'FACTS', score: 0.9 },
        { text: 'Chunk 2', documentId: 'doc-1', category: 'RULES', score: 0.8 },
      ];
      const prompt = assembleUserPrompt('test', context);
      expect(prompt).toContain('Chunk 1');
      expect(prompt).toContain('Chunk 2');
    });

    it('should include recent messages when present', () => {
      const context = makeEmptyContext();
      context.recentMessages = [
        { role: 'user', content: 'Previous question' },
        { role: 'assistant', content: 'Previous answer' },
      ];
      const prompt = assembleUserPrompt('Follow up', context);
      expect(prompt).toContain('RECENT CONVERSATION');
      expect(prompt).toContain('USER: Previous question');
      expect(prompt).toContain('ASSISTANT: Previous answer');
    });

    it('should include situational picture with open loops', () => {
      const context = makeEmptyContext();
      context.memoryContext = {
        openLoops: [makeMemoryItem({ type: 'open_loop', title: 'Fix login bug', status: 'active' })],
        recentEvents: [],
        activeIdeas: [],
        relevantMemory: [],
      };
      const prompt = assembleUserPrompt('status?', context);
      expect(prompt).toContain('SITUATIONAL PICTURE');
      expect(prompt).toContain('Open Loops');
      expect(prompt).toContain('Fix login bug');
    });

    it('should include situational picture with recent events', () => {
      const context = makeEmptyContext();
      context.memoryContext = {
        openLoops: [],
        recentEvents: [makeMemoryItem({ type: 'event', title: 'Deployed v1.2' })],
        activeIdeas: [],
        relevantMemory: [],
      };
      const prompt = assembleUserPrompt('test', context);
      expect(prompt).toContain('Recent Events');
      expect(prompt).toContain('Deployed v1.2');
    });

    it('should include situational picture with active ideas', () => {
      const context = makeEmptyContext();
      context.memoryContext = {
        openLoops: [],
        recentEvents: [],
        activeIdeas: [makeMemoryItem({ type: 'idea', title: 'Add dark mode' })],
        relevantMemory: [],
      };
      const prompt = assembleUserPrompt('test', context);
      expect(prompt).toContain('Active Ideas');
      expect(prompt).toContain('Add dark mode');
    });

    it('should include situational picture with relevant memory', () => {
      const context = makeEmptyContext();
      context.memoryContext = {
        openLoops: [],
        recentEvents: [],
        activeIdeas: [],
        relevantMemory: [makeMemoryItem({ type: 'decision', title: 'Use Kubernetes' })],
      };
      const prompt = assembleUserPrompt('test', context);
      expect(prompt).toContain('Relevant Memory');
      expect(prompt).toContain('Use Kubernetes');
    });

    it('should omit situational picture when all empty', () => {
      const context = makeEmptyContext();
      context.memoryContext = {
        openLoops: [],
        recentEvents: [],
        activeIdeas: [],
        relevantMemory: [],
      };
      const prompt = assembleUserPrompt('test', context);
      expect(prompt).not.toContain('SITUATIONAL PICTURE');
    });

    it('should omit situational picture when memoryContext is undefined', () => {
      const prompt = assembleUserPrompt('test', makeEmptyContext());
      expect(prompt).not.toContain('SITUATIONAL PICTURE');
    });

    it('should end with JSON instruction', () => {
      const prompt = assembleUserPrompt('Hello', makeEmptyContext());
      expect(prompt).toContain('Respond with ONLY valid JSON');
    });
  });
});
