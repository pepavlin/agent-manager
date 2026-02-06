// Shared OpenAPI schemas for Fastify routes

// Common response schemas
export const ErrorResponse = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    details: { type: 'string' },
  },
  required: ['error'],
} as const;

// Project schemas
export const ProjectSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    role_statement: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
    documents_count: { type: 'number' },
    threads_count: { type: 'number' },
    brief: {
      type: 'object',
      nullable: true,
      properties: {
        updated_at: { type: 'string', format: 'date-time' },
        missing_info: { type: 'array', items: { type: 'string' } },
      },
    },
  },
} as const;

export const CreateProjectBody = {
  type: 'object',
  required: ['name', 'roleStatement'],
  properties: {
    name: { type: 'string', minLength: 1, description: 'Project name' },
    roleStatement: { type: 'string', minLength: 1, description: 'Role statement for the AI agent' },
  },
} as const;

// Document schemas
export const DocumentSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    project_id: { type: 'string' },
    category: { type: 'string', enum: ['FACTS', 'RULES', 'STATE'] },
    filename: { type: 'string' },
    chunks_count: { type: 'number' },
    status: { type: 'string', enum: ['indexed', 'pending', 'failed'] },
    error: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' },
  },
} as const;

// Tool input schema for chat requests
export const ToolInputSchema = {
  type: 'object',
  required: ['name', 'description'],
  properties: {
    name: { type: 'string', description: 'Unique tool identifier (e.g., "jira.create_ticket")' },
    description: { type: 'string', description: 'What the tool does' },
    parameters: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Parameter type (string, number, boolean, etc.)' },
          description: { type: 'string', description: 'Parameter description' },
          required: { type: 'boolean', description: 'Whether parameter is required' },
        },
      },
      description: 'Tool parameters definition',
    },
    requires_approval: { type: 'boolean', default: true, description: 'Whether tool execution needs approval' },
    risk: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium', description: 'Risk level' },
  },
} as const;

// Chat schemas
export const ChatRequestBody = {
  type: 'object',
  required: ['project_id', 'user_id', 'message'],
  properties: {
    project_id: { type: 'string', description: 'Project ID' },
    user_id: { type: 'string', description: 'User ID' },
    thread_id: { type: 'string', description: 'Optional thread ID to continue conversation' },
    message: { type: 'string', minLength: 1, description: 'User message' },
    tools: {
      type: 'array',
      items: ToolInputSchema,
      default: [],
      description: 'Available tools for this request. Each project/request can have different tools.',
    },
    context: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Message source (e.g., messenger)' },
        meta: { type: 'object', additionalProperties: true },
      },
    },
  },
} as const;

export const AgentResponseSchema = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['ACT', 'ASK', 'NOOP'] },
    message: { type: 'string' },
    tool_request: {
      type: 'object',
      nullable: true,
      properties: {
        name: { type: 'string' },
        args: { type: 'object', additionalProperties: true },
        requires_approval: { type: 'boolean' },
        risk: { type: 'string', enum: ['low', 'medium', 'high'] },
      },
    },
    memory_updates: {
      type: 'object',
      properties: {
        preferences_add: { type: 'array', items: { type: 'string' } },
        preferences_remove: { type: 'array', items: { type: 'string' } },
        lessons_add: { type: 'array', items: { type: 'string' } },
      },
    },
  },
} as const;

export const ChatResponseSchema = {
  type: 'object',
  properties: {
    thread_id: { type: 'string' },
    response_json: AgentResponseSchema,
    tool_call_id: { type: 'string', description: 'ID of pending tool call (present for ACT responses). Use this to send results back via POST /tools/result.' },
    tool_auto_executed: { type: 'boolean', description: 'True when the tool was auto-executed on the API side (e.g. memory tools). The caller should skip execution and call POST /tools/result directly with the provided tool_result.' },
    tool_result: {
      type: 'object',
      description: 'Result of the auto-executed tool. Pass ok/data/error straight to POST /tools/result.',
      properties: {
        ok: { type: 'boolean' },
        data: { type: 'object', additionalProperties: true },
        error: { type: 'string' },
      },
    },
    render: {
      type: 'object',
      properties: {
        text_to_send_to_user: { type: 'string' },
      },
    },
  },
} as const;

// Thread schemas
export const ThreadSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    project_id: { type: 'string' },
    project_name: { type: 'string' },
    user_id: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' },
    messages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          role: { type: 'string', enum: ['user', 'assistant', 'system', 'tool'] },
          content: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
} as const;

// Tool schemas
export const ToolDefinitionSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    requires_approval: { type: 'boolean' },
    default_risk: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
} as const;

export const ToolResultBody = {
  type: 'object',
  required: ['tool_call_id', 'project_id', 'ok'],
  properties: {
    tool_call_id: { type: 'string', description: 'ID of the tool call to report result for' },
    project_id: { type: 'string', description: 'Project ID' },
    user_id: { type: 'string', default: 'system', description: 'User ID (used for the follow-up agent call)' },
    ok: { type: 'boolean', description: 'Whether the tool execution succeeded' },
    data: { type: 'object', additionalProperties: true, description: 'Tool execution result data' },
    error: { type: 'string', description: 'Error message if tool execution failed' },
    tools: {
      type: 'array',
      items: ToolInputSchema,
      default: [],
      description: 'Available tools for the follow-up agent response. Pass the same tools as the original chat request.',
    },
  },
} as const;

export const PendingToolCallSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    args: { type: 'object', additionalProperties: true },
    requires_approval: { type: 'boolean' },
    risk: { type: 'string', enum: ['low', 'medium', 'high'] },
    user_id: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' },
  },
} as const;

// Brief schemas
export const ProjectBriefSchema = {
  type: 'object',
  properties: {
    brief_markdown: { type: 'string' },
    kb_index_markdown: { type: 'string' },
    missing_info: { type: 'array', items: { type: 'string' } },
  },
} as const;
