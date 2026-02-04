import { z } from 'zod';

// Agent response modes
export const AgentModeSchema = z.enum(['ACT', 'ASK', 'NOOP']);
export type AgentMode = z.infer<typeof AgentModeSchema>;

// Risk levels for tool calls
export const RiskLevelSchema = z.enum(['low', 'medium', 'high']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

// Tool request schema
export const ToolRequestSchema = z.object({
  name: z.string(),
  args: z.record(z.unknown()),
  requires_approval: z.boolean(),
  risk: RiskLevelSchema,
});
export type ToolRequest = z.infer<typeof ToolRequestSchema>;

// Memory updates schema
export const MemoryUpdatesSchema = z.object({
  preferences_add: z.array(z.string()).optional().default([]),
  preferences_remove: z.array(z.string()).optional().default([]),
  lessons_add: z.array(z.string()).optional().default([]),
});
export type MemoryUpdates = z.infer<typeof MemoryUpdatesSchema>;

// Agent response schema (model output)
export const AgentResponseSchema = z.object({
  mode: AgentModeSchema,
  message: z.string(),
  tool_request: ToolRequestSchema.nullable().optional(),
  memory_updates: MemoryUpdatesSchema.optional().default({
    preferences_add: [],
    preferences_remove: [],
    lessons_add: [],
  }),
});
export type AgentResponse = z.infer<typeof AgentResponseSchema>;

// Chat request schema
export const ChatRequestSchema = z.object({
  project_id: z.string(),
  user_id: z.string(),
  thread_id: z.string().optional(),
  message: z.string().min(1),
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
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});
export type ToolResultRequest = z.infer<typeof ToolResultSchema>;

// Tool definition
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
}

// Embedding provider result
export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  dims: number;
}

// Provider interfaces are in their own files
