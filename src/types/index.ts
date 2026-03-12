import { z } from 'zod';

// Agent response modes
export const AgentModeSchema = z.enum(['ACT', 'ASK', 'NOOP', 'CONTINUE']);
export type AgentMode = z.infer<typeof AgentModeSchema>;

// Risk levels for tool calls
export const RiskLevelSchema = z.enum(['low', 'medium', 'high']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

// Tool definition for API requests (dynamic, JSON serializable)
export const ToolInputSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.object({
    type: z.string(),
    description: z.string().optional(),
    required: z.boolean().optional(),
  })).optional(),
  requires_approval: z.boolean().default(true),
  risk: RiskLevelSchema.default('medium'),
});
export type ToolInput = z.infer<typeof ToolInputSchema>;

// Tool request schema (agent output)
export const ToolRequestSchema = z.object({
  name: z.string(),
  args: z.record(z.unknown()),
  requires_approval: z.boolean(),
  risk: RiskLevelSchema,
});
export type ToolRequest = z.infer<typeof ToolRequestSchema>;

// Plan step schema (for Plan-and-Execute pattern)
export const PlanStepSchema = z.object({
  description: z.string(),
  status: z.enum(['pending', 'in_progress', 'done', 'skipped']),
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const AgentPlanSchema = z.object({
  goal: z.string().min(1),
  steps: z.array(PlanStepSchema).min(1).max(10),
  current_step: z.number().int().min(0),
});
export type AgentPlan = z.infer<typeof AgentPlanSchema>;

// Agent response schema (model output)
export const AgentResponseSchema = z.object({
  mode: AgentModeSchema,
  message: z.string(),
  tool_request: ToolRequestSchema.nullable().optional(),
  plan: AgentPlanSchema.nullable().optional(),
});
export type AgentResponse = z.infer<typeof AgentResponseSchema>;

// Chat request schema
export const ChatRequestSchema = z.object({
  project_id: z.string(),
  user_id: z.string(),
  thread_id: z.string().optional(),
  message: z.string().min(1),
  tools: z.array(ToolInputSchema).optional().default([]),
  context: z
    .object({
      source: z.string(),
      meta: z.record(z.unknown()).optional(),
    })
    .optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

// Chat response
export interface ChatResponse {
  thread_id: string;
  response_json: AgentResponse;
  tool_call_id?: string;
  /** true when the tool was auto-executed on API side (e.g. memory tools) */
  tool_auto_executed?: boolean;
  /** Result of the auto-executed tool — caller can pass it straight to POST /tools/result */
  tool_result?: { ok: boolean; data?: unknown; error?: string };
  /** Active plan on the thread (null if no plan, undefined if unchanged) */
  active_plan?: AgentPlan | null;
  render: {
    text_to_send_to_user: string;
  };
}

// Project creation request
export const CreateProjectSchema = z.object({
  name: z.string().min(1),
  roleStatement: z.string().min(1),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectSchema>;

// Document upload
export const DocumentCategorySchema = z.enum(['FACTS', 'RULES', 'STATE']);
export type DocumentCategory = z.infer<typeof DocumentCategorySchema>;

export const DocumentUploadSchema = z.object({
  category: DocumentCategorySchema,
  filename: z.string(),
  url: z.string().url().optional(),
});
export type DocumentUploadRequest = z.infer<typeof DocumentUploadSchema>;

// Tool result callback
export const ToolResultSchema = z.object({
  tool_call_id: z.string(),
  project_id: z.string(),
  user_id: z.string().optional().default('system'),
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  tools: z.array(ToolInputSchema).optional().default([]),
});
export type ToolResultRequest = z.infer<typeof ToolResultSchema>;

// Tool definition (static, with Zod schema - for internal use)
export interface ToolDefinition {
  name: string;
  description: string;
  argsSchema: z.ZodSchema;
  requiresApproval: boolean;
  defaultRisk: RiskLevel;
}

// RAG context
export interface RetrievedContext {
  kbChunks: Array<{
    text: string;
    documentId: string;
    category: string;
    score: number;
  }>;
  preferences: string[];
  lessons: string[];
  playbook: string | null;
  brief: string | null;
  recentMessages: Array<{
    role: string;
    content: string;
  }>;
  memoryContext?: MemoryContext;
  learnedRules?: MemoryItem[];
  learnedRulesTotal?: number;
}

// Embedding provider result
export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  dims: number;
}

// Memory Item Types
export const MemoryItemTypeSchema = z.enum([
  'fact',
  'rule',
  'event',
  'decision',
  'open_loop',
  'idea',
  'metric',
  'preference',
  'lesson',
  'finding',
  'impl_task',
]);
export type MemoryItemType = z.infer<typeof MemoryItemTypeSchema>;

export const MemoryItemSourceSchema = z.enum([
  'user_chat',
  'doc_upload',
  'tool_result',
  'cron',
  'system',
]);
export type MemoryItemSource = z.infer<typeof MemoryItemSourceSchema>;

export const MemoryItemStatusSchema = z.enum([
  'proposed',
  'accepted',
  'rejected',
  'done',
  'blocked',
  'active',
]);
export type MemoryItemStatus = z.infer<typeof MemoryItemStatusSchema>;

// Memory Item schemas
export const MemoryItemContentSchema = z.record(z.unknown());
export type MemoryItemContent = z.infer<typeof MemoryItemContentSchema>;

export const CreateMemoryItemSchema = z.object({
  projectId: z.string(),
  userId: z.string().optional(),
  type: MemoryItemTypeSchema,
  title: z.string().min(1),
  content: MemoryItemContentSchema,
  status: MemoryItemStatusSchema.optional().default('proposed'),
  source: MemoryItemSourceSchema.optional().default('user_chat'),
  confidence: z.number().min(0).max(1).optional().default(0.5),
  expiresAt: z.date().optional(),
  supersedesId: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
});
export type CreateMemoryItemRequest = z.infer<typeof CreateMemoryItemSchema>;

export const UpdateMemoryItemSchema = z.object({
  title: z.string().min(1).optional(),
  content: MemoryItemContentSchema.optional(),
  status: MemoryItemStatusSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  expiresAt: z.date().nullable().optional(),
  tags: z.array(z.string()).optional(),
});
export type UpdateMemoryItemRequest = z.infer<typeof UpdateMemoryItemSchema>;

// Memory Item (full object from database)
export interface MemoryItem {
  id: string;
  projectId: string;
  userId: string | null;
  type: MemoryItemType;
  title: string;
  content: MemoryItemContent;
  status: MemoryItemStatus | null;
  source: MemoryItemSource;
  confidence: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  supersedesId: string | null;
  tags: string[];
  qdrantPointId: string | null;
}

// Memory context for retrieval
export interface MemoryContext {
  openLoops: MemoryItem[];
  recentEvents: MemoryItem[];
  relevantMemory: MemoryItem[];
  activeIdeas: MemoryItem[];
  recentFindings: MemoryItem[];
  pendingTasks: MemoryItem[];
}

// Manager tool schemas
export const FindingSeveritySchema = z.enum(['critical', 'high', 'medium', 'low']);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const FindingTypeSchema = z.enum([
  'bug',
  'ux_issue',
  'regression',
  'improvement',
  'inconsistency',
  'missing_feature',
  'technical_debt',
]);
export type FindingType = z.infer<typeof FindingTypeSchema>;

export const ManagerLogFindingSchema = z.object({
  finding_type: FindingTypeSchema,
  severity: FindingSeveritySchema,
  title: z.string().min(1),
  description: z.string().min(1),
  component: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type ManagerLogFindingRequest = z.infer<typeof ManagerLogFindingSchema>;

export const TaskPrioritySchema = z.enum(['critical', 'high', 'medium', 'low']);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const ManagerCreateTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  priority: TaskPrioritySchema,
  acceptance_criteria: z.string().optional(),
  rationale: z.string().min(1),
  finding_ids: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});
export type ManagerCreateTaskRequest = z.infer<typeof ManagerCreateTaskSchema>;

export const ManagerDecideFindingSchema = z.object({
  finding_id: z.string(),
  decision: z.enum(['rejected', 'deferred']),
  rationale: z.string().min(1),
});
export type ManagerDecideFindingRequest = z.infer<typeof ManagerDecideFindingSchema>;

// Memory proposal tool schemas
export const MemoryProposeAddSchema = z.object({
  type: MemoryItemTypeSchema,
  title: z.string().min(1),
  content: MemoryItemContentSchema,
  status: MemoryItemStatusSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  tags: z.array(z.string()).optional(),
  expires_in_seconds: z.number().positive().optional(),
});
export type MemoryProposeAddRequest = z.infer<typeof MemoryProposeAddSchema>;

export const MemoryProposeUpdateSchema = z.object({
  memory_item_id: z.string(),
  patch: UpdateMemoryItemSchema,
  reason: z.string().min(1),
});
export type MemoryProposeUpdateRequest = z.infer<typeof MemoryProposeUpdateSchema>;

// Memory point payload for Qdrant
export interface MemoryPointPayload {
  [key: string]: unknown;
  memory_item_id: string;
  type: MemoryItemType;
  title: string;
  content_text: string;
  status: string | null;
  created_at: string;
  expires_at: string | null;
  user_id: string | null;
}
