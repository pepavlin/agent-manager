import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { processChat } from '../services/agent.js';
import { ChatRequestSchema } from '../types/index.js';
import { createChildLogger } from '../utils/logger.js';
import { ChatRequestBody, ChatResponseSchema, ErrorResponse } from '../schemas/index.js';
import { isAppError } from '../utils/errors.js';

const logger = createChildLogger('routes:chat');

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  // POST /chat - Send message to AI agent
  app.post('/chat', {
    schema: {
      tags: ['Chat'],
      summary: 'Send a message to the AI agent',
      description: `Send a message to the project AI agent and receive a response.

**Response Modes:**
- \`NOOP\` - Agent provides information or suggestions without executing tools
- \`ASK\` - Agent needs clarification before proceeding
- \`ACT\` - Agent requests to execute a tool (requires approval if specified)

**Tools:**
Pass available tools in the \`tools\` array. Each project/request can have different tools.

**Memory:**
The agent automatically extracts user preferences and lessons from conversations.

---

## Example Request (Simple message)
\`\`\`json
{
  "project_id": "clx1234567890abcdef",
  "user_id": "user_123",
  "message": "What is the current status of the project?"
}
\`\`\`

## Example Request (With tools)
\`\`\`json
{
  "project_id": "clx1234567890abcdef",
  "user_id": "user_123",
  "message": "Create a ticket for the login bug",
  "tools": [
    {
      "name": "jira.create_ticket",
      "description": "Create a new Jira ticket",
      "parameters": {
        "summary": {"type": "string", "required": true},
        "project": {"type": "string", "required": true}
      },
      "requires_approval": true,
      "risk": "low"
    }
  ]
}
\`\`\`

## Example Response (NOOP)
\`\`\`json
{
  "thread_id": "thread_xyz789",
  "response_json": {
    "mode": "NOOP",
    "message": "The sprint ends Friday with 3 tasks remaining.",
    "tool_request": null,
    "memory_updates": {"preferences_add": [], "preferences_remove": [], "lessons_add": []}
  },
  "render": {"text_to_send_to_user": "The sprint ends Friday with 3 tasks remaining."}
}
\`\`\`

## Example Response (ACT - Tool request)
\`\`\`json
{
  "thread_id": "thread_xyz789",
  "response_json": {
    "mode": "ACT",
    "message": "I'll create a Jira ticket for the login bug.",
    "tool_request": {
      "name": "jira.create_ticket",
      "args": {"summary": "Login bug on mobile", "project": "ECOM"},
      "requires_approval": true,
      "risk": "low"
    },
    "memory_updates": {"preferences_add": [], "preferences_remove": [], "lessons_add": []}
  },
  "render": {"text_to_send_to_user": "I'll create a Jira ticket for the login bug."}
}
\`\`\``,
      body: ChatRequestBody,
      response: {
        200: ChatResponseSchema,
        400: ErrorResponse,
        404: ErrorResponse,
        500: ErrorResponse,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = ChatRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: body.error.errors,
      });
    }

    try {
      const response = await processChat(body.data);

      return reply.send({
        thread_id: response.thread_id,
        response_json: response.response_json,
        ...(response.tool_call_id && { tool_call_id: response.tool_call_id }),
        render: response.render,
      });
    } catch (error) {
      logger.error({ error }, 'Chat processing failed');

      if (isAppError(error)) {
        return reply.status(error.statusCode).send({
          error: error.message,
          code: error.code,
          details: error.details,
        });
      }

      return reply.status(500).send({
        error: 'Chat processing failed',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
