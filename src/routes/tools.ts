import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { processToolResult } from '../services/agent.js';
import { ToolResultSchema } from '../types/index.js';
import { createChildLogger } from '../utils/logger.js';
import { ToolResultBody, ChatResponseSchema, ErrorResponse } from '../schemas/index.js';
import { isAppError } from '../utils/errors.js';

const logger = createChildLogger('routes:tools');

export async function toolRoutes(app: FastifyInstance): Promise<void> {
  // POST /tools/result - Tool result callback from n8n
  app.post('/tools/result', {
    schema: {
      tags: ['Tools'],
      summary: 'Submit tool execution result',
      description: `Submit the result of a tool execution. This endpoint is called by the external execution system (e.g., n8n) after executing a tool requested by the agent.

**Flow:**
1. Agent responds with \`mode: ACT\` and a \`tool_request\`
2. External system executes the tool
3. External system calls this endpoint with the result
4. The agent is automatically called to process the tool result and generate a follow-up response

The response has the same format as \`POST /chat\` — the agent sees the tool result and responds accordingly. If the agent wants to call another tool, a new \`tool_call_id\` will be in the response.

---

## Example Request (Success)
\`\`\`json
{
  "tool_call_id": "tc_abc123xyz",
  "project_id": "clx1234567890abcdef",
  "user_id": "user_123",
  "ok": true,
  "data": {
    "ticket_id": "ECOM-1234",
    "ticket_url": "https://jira.example.com/browse/ECOM-1234",
    "status": "created"
  },
  "tools": [
    {
      "name": "jira.create_ticket",
      "description": "Create a Jira ticket",
      "requires_approval": true,
      "risk": "low"
    }
  ]
}
\`\`\`

## Example Request (Failure)
\`\`\`json
{
  "tool_call_id": "tc_abc123xyz",
  "project_id": "clx1234567890abcdef",
  "ok": false,
  "error": "Permission denied: User does not have access to project ECOM"
}
\`\`\`

## Example Response
\`\`\`json
{
  "thread_id": "thread_xyz789",
  "response_json": {
    "mode": "NOOP",
    "message": "The ticket ECOM-1234 has been created successfully.",
    "tool_request": null
  },
  "render": {"text_to_send_to_user": "The ticket ECOM-1234 has been created successfully."}
}
\`\`\``,
      body: ToolResultBody,
      response: {
        200: ChatResponseSchema,
        400: ErrorResponse,
        404: ErrorResponse,
        500: ErrorResponse,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = ToolResultSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: body.error.errors,
      });
    }

    const { tool_call_id, project_id, user_id, ok, data, error, tools } = body.data;

    try {
      const chatResponse = await processToolResult(tool_call_id, project_id, ok, data, error, user_id, tools);

      return reply.send({
        thread_id: chatResponse.thread_id,
        response_json: chatResponse.response_json,
        ...(chatResponse.tool_call_id && { tool_call_id: chatResponse.tool_call_id }),
        ...(chatResponse.tool_auto_executed && { tool_auto_executed: true, tool_result: chatResponse.tool_result }),
        render: chatResponse.render,
      });
    } catch (err) {
      logger.error({ error: err, tool_call_id }, 'Tool result processing failed');

      if (isAppError(err)) {
        return reply.status(err.statusCode).send({
          error: err.message,
          code: err.code,
          details: err.details,
        });
      }

      return reply.status(500).send({
        error: 'Tool result processing failed',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
