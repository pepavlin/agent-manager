import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { processToolResult } from '../services/agent.js';
import { ToolResultSchema } from '../types/index.js';
import { createChildLogger } from '../utils/logger.js';
import { ToolResultBody, ErrorResponse } from '../schemas/index.js';
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
4. Result is stored in the conversation thread for context

---

## Memory Tools Flow

For memory proposal tools (\`memory.propose_add\`, \`memory.propose_update\`):
1. Agent returns \`tool_request\` with \`name: "memory.propose_add"\`
2. N8N shows proposal to user for approval
3. User approves/rejects
4. N8N calls this endpoint:
   - Approved: \`{ ok: true, data: { memory_item_id: "..." } }\`
   - Rejected: \`{ ok: false, error: "User rejected" }\`
5. API stores memory item accordingly (accepted/rejected status)

**Note:** Events and metrics with TTL are auto-approved and don't go through this flow.

---

## Example Request (Success)
\`\`\`json
{
  "tool_call_id": "tc_abc123xyz",
  "project_id": "clx1234567890abcdef",
  "ok": true,
  "data": {
    "ticket_id": "ECOM-1234",
    "ticket_url": "https://jira.example.com/browse/ECOM-1234",
    "status": "created"
  }
}
\`\`\`

## Example Request (Memory Proposal Approved)
\`\`\`json
{
  "tool_call_id": "tc_mem123xyz",
  "project_id": "clx1234567890abcdef",
  "ok": true,
  "data": {
    "memory_item_id": "mem_abc123"
  }
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
  "status": "acknowledged",
  "tool_call_id": "tc_abc123xyz"
}
\`\`\``,
      body: ToolResultBody,
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['acknowledged'] },
            tool_call_id: { type: 'string' },
          },
        },
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

    const { tool_call_id, project_id, ok, data, error } = body.data;

    try {
      await processToolResult(tool_call_id, project_id, ok, data, error);

      return reply.send({
        status: 'acknowledged',
        tool_call_id,
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
