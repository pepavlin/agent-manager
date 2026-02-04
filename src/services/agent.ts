import { prisma } from '../db/client.js';
import { getChatProvider } from '../providers/chat/index.js';
import { retrieveContext } from './rag.js';
import { applyMemoryUpdates } from './memory.js';
import { assembleSystemPrompt, assembleUserPrompt } from './prompts.js';
import { AgentResponse, AgentResponseSchema, ChatRequest, ChatResponse, ToolInput, ToolRequest } from '../types/index.js';
import { extractJson } from '../utils/json-repair.js';
import { createChildLogger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js';

const logger = createChildLogger('agent');

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

  logger.info({ project_id, user_id, thread_id, messageLength: message.length, toolsCount: tools.length }, 'Processing chat');

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

  // Assemble prompts with dynamic tools
  const systemPrompt = assembleSystemPrompt(project.name, project.roleStatement, ragContext, tools);
  const userPrompt = assembleUserPrompt(message, ragContext);

  // Generate response
  const chatProvider = getChatProvider();
  const rawResponse = await chatProvider.generateJSON({
    system: systemPrompt,
    user: userPrompt,
  });

  // Parse and validate response
  const agentResponse = parseAgentResponse(rawResponse);

  // Apply memory updates
  if (agentResponse.memory_updates) {
    await applyMemoryUpdates(project_id, user_id, agentResponse.memory_updates);
  }

  // Handle tool request
  if (agentResponse.mode === 'ACT' && agentResponse.tool_request) {
    const validation = validateToolRequest(agentResponse.tool_request, tools);
    if (!validation.valid) {
      logger.warn({ error: validation.error }, 'Invalid tool request');
      // Convert to ASK mode with error
      agentResponse.mode = 'ASK';
      agentResponse.message = `I tried to use a tool but encountered an error: ${validation.error}. Could you clarify what you need?`;
      agentResponse.tool_request = null;
    } else {
      // Get tool definition for defaults
      const toolDef = tools.find((t) => t.name === agentResponse.tool_request!.name);

      // Store tool call for callback
      await prisma.toolCall.create({
        data: {
          projectId: project_id,
          threadId: threadIdToUse,
          name: agentResponse.tool_request.name,
          argsJson: JSON.stringify(agentResponse.tool_request.args),
          requiresApproval: agentResponse.tool_request.requires_approval ?? toolDef?.requires_approval ?? true,
          risk: agentResponse.tool_request.risk ?? toolDef?.risk ?? 'medium',
          status: 'pending',
        },
      });
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
        tools_available: tools.map((t) => t.name),
        source: requestContext?.source,
      }),
    },
  });

  logger.info({ threadId: threadIdToUse, mode: agentResponse.mode }, 'Chat processed');

  return {
    thread_id: threadIdToUse,
    response_json: agentResponse,
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
  error?: string
): Promise<void> {
  logger.info({ toolCallId, projectId, ok }, 'Processing tool result');

  // Update tool call
  await prisma.toolCall.update({
    where: { id: toolCallId },
    data: {
      status: ok ? 'completed' : 'failed',
      resultJson: JSON.stringify(ok ? { ok: true, data } : { ok: false, error }),
      updatedAt: new Date(),
    },
  });

  // Get tool call for context
  const toolCall = await prisma.toolCall.findUnique({
    where: { id: toolCallId },
    include: { thread: true },
  });

  if (!toolCall) {
    throw new NotFoundError('Tool call', toolCallId);
  }

  // Store tool result as message
  await prisma.message.create({
    data: {
      threadId: toolCall.threadId,
      role: 'tool',
      content: JSON.stringify({
        tool_name: toolCall.name,
        ok,
        data,
        error,
      }),
    },
  });

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

  logger.info({ toolCallId, toolName: toolCall.name, ok }, 'Tool result processed');
}
