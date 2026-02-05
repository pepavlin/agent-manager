import { prisma } from '../db/client.js';
import { getChatProvider } from '../providers/chat/index.js';
import { retrieveContext } from './rag.js';
import { applyMemoryUpdates } from './memory.js';
import { assembleSystemPrompt, assembleUserPrompt } from './prompts.js';
import {
  AgentResponse,
  AgentResponseSchema,
  ChatRequest,
  ChatResponse,
  ToolInput,
  ToolRequest,
  MemoryProposeAddSchema,
  MemoryProposeUpdateSchema,
} from '../types/index.js';
import { extractJson } from '../utils/json-repair.js';
import { createChildLogger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js';
import {
  createMemoryItem,
  createEvent,
  createMetric,
  updateMemoryItem,
  acceptProposal,
  rejectProposal,
} from './memory-items.js';

const logger = createChildLogger('agent');

// Built-in memory tools
const MEMORY_TOOLS: ToolInput[] = [
  {
    name: 'memory.propose_add',
    description: 'Propose adding a new memory item (fact, decision, open_loop, idea, event, metric). Events and metrics with TTL are auto-approved.',
    parameters: {
      type: {
        type: 'string',
        description: 'Type of memory item: fact, decision, open_loop, idea, event, metric',
        required: true,
      },
      title: {
        type: 'string',
        description: 'Short title for the memory item',
        required: true,
      },
      content: {
        type: 'object',
        description: 'Content of the memory item as key-value pairs',
        required: true,
      },
      status: {
        type: 'string',
        description: 'Initial status (for open_loop: active, blocked; for idea: proposed)',
        required: false,
      },
      confidence: {
        type: 'number',
        description: 'Confidence level 0-1 for proposed facts',
        required: false,
      },
      tags: {
        type: 'array',
        description: 'Tags for categorization',
        required: false,
      },
      expires_in_seconds: {
        type: 'number',
        description: 'TTL for metrics (enables auto-approval)',
        required: false,
      },
    },
    requires_approval: true,
    risk: 'low',
  },
  {
    name: 'memory.propose_update',
    description: 'Propose updating an existing memory item',
    parameters: {
      memory_item_id: {
        type: 'string',
        description: 'ID of the memory item to update',
        required: true,
      },
      patch: {
        type: 'object',
        description: 'Fields to update: title, content, status, confidence, tags',
        required: true,
      },
      reason: {
        type: 'string',
        description: 'Reason for the update',
        required: true,
      },
    },
    requires_approval: true,
    risk: 'low',
  },
];

/**
 * Check if a memory tool request should be auto-approved
 */
function shouldAutoApproveMemoryTool(toolRequest: ToolRequest): boolean {
  // Auto-approve all memory tools (propose_add and propose_update)
  return toolRequest.name.startsWith('memory.');
}

/**
 * Handle memory tool execution (for auto-approved items)
 */
async function executeMemoryTool(
  projectId: string,
  userId: string,
  toolRequest: ToolRequest
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    if (toolRequest.name === 'memory.propose_add') {
      const parsed = MemoryProposeAddSchema.safeParse(toolRequest.args);
      if (!parsed.success) {
        return { ok: false, error: `Invalid arguments: ${parsed.error.message}` };
      }

      const args = parsed.data;
      const expiresAt = args.expires_in_seconds
        ? new Date(Date.now() + args.expires_in_seconds * 1000)
        : undefined;

      // Events use dedicated helper
      if (args.type === 'event') {
        const item = await createEvent(projectId, args.title, args.content, {
          userId,
          source: 'user_chat',
          tags: args.tags,
        });
        return { ok: true, data: { memory_item_id: item.id, status: 'accepted' } };
      }

      // Metrics with TTL use dedicated helper
      if (args.type === 'metric' && args.expires_in_seconds) {
        const item = await createMetric(
          projectId,
          args.title,
          args.content,
          args.expires_in_seconds,
          { userId, tags: args.tags }
        );
        return { ok: true, data: { memory_item_id: item.id, status: 'accepted' } };
      }

      // All other types (fact, decision, open_loop, idea, etc.) - auto-approve
      const item = await createMemoryItem({
        projectId,
        userId,
        type: args.type,
        title: args.title,
        content: args.content,
        status: 'accepted',
        source: 'user_chat',
        confidence: args.confidence ?? 0.5,
        expiresAt,
        tags: args.tags ?? [],
      });

      return { ok: true, data: { memory_item_id: item.id, status: 'accepted' } };
    }

    if (toolRequest.name === 'memory.propose_update') {
      const parsed = MemoryProposeUpdateSchema.safeParse(toolRequest.args);
      if (!parsed.success) {
        return { ok: false, error: `Invalid arguments: ${parsed.error.message}` };
      }

      const args = parsed.data;
      const item = await updateMemoryItem(args.memory_item_id, args.patch);
      return { ok: true, data: { memory_item_id: item.id, status: item.status } };
    }

    return { ok: false, error: `Unknown memory tool: ${toolRequest.name}` };
  } catch (error) {
    logger.error({ error, toolRequest }, 'Memory tool execution failed');
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function validateToolRequest(
  toolRequest: ToolRequest,
  availableTools: ToolInput[]
): { valid: boolean; error?: string } {
  const tool = availableTools.find((t) => t.name === toolRequest.name);

  if (!tool) {
    const availableNames = availableTools.map((t) => t.name).join(', ');
    return {
      valid: false,
      error: `Unknown tool: ${toolRequest.name}. Available tools: ${availableNames || 'none'}`,
    };
  }

  // Basic parameter validation
  if (tool.parameters) {
    const requiredParams = Object.entries(tool.parameters)
      .filter(([_, v]) => v.required)
      .map(([k]) => k);

    for (const param of requiredParams) {
      if (!(param in (toolRequest.args || {}))) {
        return {
          valid: false,
          error: `Missing required parameter: ${param} for tool ${toolRequest.name}`,
        };
      }
    }
  }

  return { valid: true };
}

export async function processChat(request: ChatRequest): Promise<ChatResponse> {
  const { project_id, user_id, thread_id, message, tools, context: requestContext } = request;

  // Merge user-provided tools with built-in memory tools
  const allTools = [...tools, ...MEMORY_TOOLS];

  logger.info({ project_id, user_id, thread_id, messageLength: message.length, toolsCount: allTools.length }, 'Processing chat');

  // Get or create thread
  let threadIdToUse = thread_id;
  if (!threadIdToUse) {
    const newThread = await prisma.thread.create({
      data: {
        projectId: project_id,
        userId: user_id,
      },
    });
    threadIdToUse = newThread.id;
    logger.debug({ threadId: threadIdToUse }, 'Created new thread');
  } else {
    // Try to find existing thread, create with specified ID if not found
    const existingThread = await prisma.thread.findUnique({
      where: { id: threadIdToUse },
    });
    if (!existingThread) {
      logger.debug({ threadId: threadIdToUse }, 'Thread not found, creating with specified ID');
      await prisma.thread.create({
        data: {
          id: threadIdToUse,
          projectId: project_id,
          userId: user_id,
        },
      });
      logger.debug({ threadId: threadIdToUse }, 'Created new thread with specified ID');
    }
  }

  // Store user message
  await prisma.message.create({
    data: {
      threadId: threadIdToUse,
      role: 'user',
      content: message,
    },
  });

  // Get project
  const project = await prisma.project.findUnique({
    where: { id: project_id },
  });

  if (!project) {
    throw new NotFoundError('Project', project_id);
  }

  // Retrieve RAG context
  const ragContext = await retrieveContext(project_id, user_id, message, threadIdToUse);

  // Assemble prompts with all tools (including memory tools)
  const systemPrompt = assembleSystemPrompt(project.name, project.roleStatement, ragContext, allTools);
  const userPrompt = assembleUserPrompt(message, ragContext);

  // Generate response
  const chatProvider = getChatProvider();
  let rawResponse: string;
  try {
    rawResponse = await chatProvider.generateJSON({
      system: systemPrompt,
      user: userPrompt,
    });
  } catch (providerError) {
    logger.error({ error: providerError }, 'Chat provider failed to generate response');
    rawResponse = '';
  }

  // Parse and validate response (gracefully falls back to ASK on bad/empty input)
  const agentResponse = parseAgentResponse(rawResponse);

  // Apply memory updates
  if (agentResponse.memory_updates) {
    await applyMemoryUpdates(project_id, user_id, agentResponse.memory_updates);
  }

  // Handle tool request
  let pendingToolCallId: string | undefined;
  if (agentResponse.mode === 'ACT' && agentResponse.tool_request) {
    const validation = validateToolRequest(agentResponse.tool_request, allTools);
    if (!validation.valid) {
      logger.warn({ error: validation.error }, 'Invalid tool request');
      // Convert to ASK mode with error
      agentResponse.mode = 'ASK';
      agentResponse.message = `I tried to use a tool but encountered an error: ${validation.error}. Could you clarify what you need?`;
      agentResponse.tool_request = null;
    } else {
      // Check if this is a memory tool that should be auto-approved
      const isMemoryTool = agentResponse.tool_request.name.startsWith('memory.');
      const shouldAutoApprove = isMemoryTool && shouldAutoApproveMemoryTool(agentResponse.tool_request);

      if (shouldAutoApprove) {
        // Execute memory tool immediately (auto-approved)
        logger.debug({ tool: agentResponse.tool_request.name }, 'Auto-approving memory tool');
        const result = await executeMemoryTool(project_id, user_id, agentResponse.tool_request);

        // Store tool call as completed
        await prisma.toolCall.create({
          data: {
            projectId: project_id,
            threadId: threadIdToUse,
            name: agentResponse.tool_request.name,
            argsJson: JSON.stringify(agentResponse.tool_request.args),
            requiresApproval: false,
            risk: 'low',
            status: result.ok ? 'completed' : 'failed',
            resultJson: JSON.stringify(result),
          },
        });

        // Store tool result as message
        await prisma.message.create({
          data: {
            threadId: threadIdToUse,
            role: 'tool',
            content: JSON.stringify({
              tool_name: agentResponse.tool_request.name,
              ok: result.ok,
              data: result.data,
              error: result.error,
            }),
          },
        });
      } else {
        // Get tool definition for defaults
        const toolDef = allTools.find((t) => t.name === agentResponse.tool_request!.name);

        // Store tool call for callback (pending) — include available tools
        // so processToolResult can pass them to the follow-up agent call
        const toolCall = await prisma.toolCall.create({
          data: {
            projectId: project_id,
            threadId: threadIdToUse,
            name: agentResponse.tool_request.name,
            argsJson: JSON.stringify(agentResponse.tool_request.args),
            requiresApproval: agentResponse.tool_request.requires_approval ?? toolDef?.requires_approval ?? true,
            risk: agentResponse.tool_request.risk ?? toolDef?.risk ?? 'medium',
            status: 'pending',
            toolsJson: JSON.stringify(tools),
          },
        });
        pendingToolCallId = toolCall.id;
      }
    }
  }

  // Store assistant message
  await prisma.message.create({
    data: {
      threadId: threadIdToUse,
      role: 'assistant',
      content: agentResponse.message,
    },
  });

  // Audit log
  await prisma.auditLog.create({
    data: {
      projectId: project_id,
      userId: user_id,
      eventType: 'chat',
      payloadJson: JSON.stringify({
        thread_id: threadIdToUse,
        mode: agentResponse.mode,
        has_tool_request: !!agentResponse.tool_request,
        tools_available: allTools.map((t) => t.name),
        source: requestContext?.source,
      }),
    },
  });

  logger.info({ threadId: threadIdToUse, mode: agentResponse.mode }, 'Chat processed');

  return {
    thread_id: threadIdToUse,
    response_json: agentResponse,
    ...(pendingToolCallId && { tool_call_id: pendingToolCallId }),
    render: {
      text_to_send_to_user: agentResponse.message,
    },
  };
}

function parseAgentResponse(raw: string): AgentResponse {
  // Try to extract JSON
  const extracted = extractJson(raw);
  if (!extracted) {
    logger.warn({ raw: raw.slice(0, 200) }, 'Could not extract JSON from response');
    return createSafeResponse('I encountered an issue processing your request. Could you rephrase?');
  }

  try {
    const parsed = JSON.parse(extracted);
    const validated = AgentResponseSchema.safeParse(parsed);

    if (!validated.success) {
      logger.warn({ errors: validated.error.errors }, 'Response validation failed');
      return createSafeResponse('I encountered an issue processing your request. Could you rephrase?');
    }

    return validated.data;
  } catch (error) {
    logger.error({ error, raw: raw.slice(0, 200) }, 'Failed to parse response');
    return createSafeResponse('I encountered an issue processing your request. Could you rephrase?');
  }
}

/**
 * Truncate data for inclusion in LLM context to avoid token limit issues.
 * Full data is always preserved in toolCall.resultJson and auditLog.
 */
function truncateForContext(data: unknown, maxChars = 2000): string {
  const serialized = typeof data === 'string' ? data : JSON.stringify(data);
  if (serialized.length <= maxChars) return serialized;
  return serialized.slice(0, maxChars) + `... [truncated, ${serialized.length} chars total]`;
}

function createSafeResponse(message: string): AgentResponse {
  return {
    mode: 'ASK',
    message,
    tool_request: null,
    memory_updates: {
      preferences_add: [],
      preferences_remove: [],
      lessons_add: [],
    },
  };
}

export async function processToolResult(
  toolCallId: string,
  projectId: string,
  ok: boolean,
  data?: unknown,
  error?: string,
  userId?: string,
  tools?: ToolInput[]
): Promise<ChatResponse> {
  logger.info({ toolCallId, projectId, ok }, 'Processing tool result');

  // Get tool call for context
  const toolCall = await prisma.toolCall.findUnique({
    where: { id: toolCallId },
    include: { thread: true },
  });

  if (!toolCall) {
    throw new NotFoundError('Tool call', toolCallId);
  }

  // Handle memory tool results specially
  if (toolCall.name.startsWith('memory.')) {
    await processMemoryToolResult(toolCall, ok, data, error);
  }

  // Update tool call
  await prisma.toolCall.update({
    where: { id: toolCallId },
    data: {
      status: ok ? 'completed' : 'failed',
      resultJson: JSON.stringify(ok ? { ok: true, data } : { ok: false, error }),
      updatedAt: new Date(),
    },
  });

  // Store tool result as message (truncated to avoid blowing up LLM context)
  await prisma.message.create({
    data: {
      threadId: toolCall.threadId,
      role: 'tool',
      content: JSON.stringify({
        tool_name: toolCall.name,
        ok,
        data: ok ? truncateForContext(data) : undefined,
        error,
      }),
    },
  });

  // Log tool result event in memory
  try {
    await createEvent(
      projectId,
      `Tool ${toolCall.name} ${ok ? 'succeeded' : 'failed'}`,
      {
        tool_name: toolCall.name,
        ok,
        data: ok ? data : undefined,
        error: ok ? undefined : error,
      },
      { source: 'tool_result' }
    );
  } catch (err) {
    logger.warn({ err, toolCallId }, 'Failed to log tool result event');
  }

  // Audit log
  await prisma.auditLog.create({
    data: {
      projectId,
      eventType: 'tool_result',
      payloadJson: JSON.stringify({
        tool_call_id: toolCallId,
        tool_name: toolCall.name,
        ok,
        error,
      }),
    },
  });

  logger.info({ toolCallId, toolName: toolCall.name, ok }, 'Tool result stored, calling agent for follow-up');

  // Resolve tools: prefer caller-provided, fall back to tools stored on the tool call
  let resolvedTools = tools && tools.length > 0 ? tools : [];
  if (resolvedTools.length === 0 && toolCall.toolsJson) {
    try {
      resolvedTools = JSON.parse(toolCall.toolsJson) as ToolInput[];
    } catch {
      logger.warn({ toolCallId }, 'Failed to parse stored toolsJson');
    }
  }

  // Automatically call processChat so the agent can respond to the tool result
  const resultSummary = ok
    ? `Tool "${toolCall.name}" completed successfully. Result: ${truncateForContext(data)}`
    : `Tool "${toolCall.name}" failed. Error: ${error || 'Unknown error'}`;

  const chatResponse = await processChat({
    project_id: projectId,
    user_id: userId || toolCall.thread.userId,
    thread_id: toolCall.threadId,
    message: resultSummary,
    tools: resolvedTools,
  });

  return chatResponse;
}

/**
 * Process memory-specific tool results
 */
async function processMemoryToolResult(
  toolCall: { id: string; name: string; argsJson: string },
  ok: boolean,
  data?: unknown,
  error?: string
): Promise<void> {
  const args = JSON.parse(toolCall.argsJson) as Record<string, unknown>;

  if (toolCall.name === 'memory.propose_add') {
    // The proposal was already created when the tool was requested
    // The data should contain the memory_item_id
    const originalData = data as { memory_item_id?: string } | undefined;

    if (ok && originalData?.memory_item_id) {
      // Accept the proposal
      try {
        await acceptProposal(originalData.memory_item_id);
        logger.info({ memoryItemId: originalData.memory_item_id }, 'Memory proposal accepted');
      } catch (err) {
        logger.error({ err, memoryItemId: originalData.memory_item_id }, 'Failed to accept memory proposal');
      }
    } else if (!ok) {
      // Try to find and reject the proposal if we have the ID
      const memoryItemId = originalData?.memory_item_id || (args as { memory_item_id?: string }).memory_item_id;
      if (memoryItemId) {
        try {
          await rejectProposal(memoryItemId);
          logger.info({ memoryItemId, error }, 'Memory proposal rejected');
        } catch (err) {
          logger.warn({ err, memoryItemId }, 'Failed to reject memory proposal');
        }
      }
    }
  } else if (toolCall.name === 'memory.propose_update') {
    if (ok) {
      const memoryItemId = args.memory_item_id as string;
      const patch = args.patch as Record<string, unknown>;

      try {
        await updateMemoryItem(memoryItemId, patch);
        logger.info({ memoryItemId }, 'Memory item updated');
      } catch (err) {
        logger.error({ err, memoryItemId }, 'Failed to update memory item');
      }
    }
  }
}
