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

// Agent response schema (model output)
export const AgentResponseSchema = z.object({
  mode: AgentModeSchema,
  message: z.string(),
  tool_request: ToolRequestSchema.nullable().optional(),
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
}

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
