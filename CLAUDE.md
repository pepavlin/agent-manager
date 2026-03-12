# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run dev          # Start backend dev server with hot reload (tsx watch)
npm run dev:frontend # Start frontend Vite dev server (proxies API to :3000)
npm run build        # Build backend (tsc) + frontend (vite)
npm run build:frontend # Build frontend only
npm run start        # Run compiled server
npm run typecheck    # Type check without emitting
npm run lint         # ESLint on src/

# Database
npm run db:generate  # Generate Prisma client
npm run db:migrate   # Run migrations (dev)
npm run db:push      # Push schema changes
npm run db:studio    # Open Prisma Studio GUI

# Testing
npm test             # Run all tests (vitest)
npm run test:watch   # Watch mode
npm test tests/chunker.test.ts  # Run specific test
```

## Required Environment Variables

```bash
AGENT_API_KEY=<secret>                    # API authentication
DATABASE_URL=postgresql://...             # Postgres connection
QDRANT_URL=http://localhost:6333          # Vector DB
CHAT_PROVIDER=claude_cli|openai|anthropic # LLM provider (default: claude_cli)
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...  # OAuth token from `claude setup-token`
EMBEDDING_PROVIDER=mock|openai|ollama     # Embedding provider
EMBEDDING_DIMS=384                        # Must match provider output
```

## Architecture Overview

### Agent Decision Loop

The core agent in `src/services/agent.ts` follows a strict decision loop:

1. **ACT** - Request tool execution (stored in `tool_calls` table, executed by n8n)
2. **ASK** - Ask clarifying question (default when uncertain)
3. **NOOP** - Provide information without tools

All responses are **strict JSON** validated by Zod schemas in `src/types/index.ts`.

### Request Flow

```
POST /chat → agent.processChat()
  → rag.retrieveContext()      # Vector search + memory lookup
  → prompts.assemblePrompt()   # Build system/user prompts
  → chatProvider.generateJSON() # LLM call
  → Validate & store response
  → Return {thread_id, response_json, render}
```

### Provider Pattern

Chat and embedding providers implement interfaces in `src/providers/`:
- `IChatProvider.generateJSON({system, user})` → JSON string
- `IEmbeddingProvider.embed(texts[])` → number[][]

Factories in `index.ts` select provider based on `CHAT_PROVIDER`/`EMBEDDING_PROVIDER` env vars.

### Tool System (Dynamic)

Tools are **not** defined statically in the codebase. They are passed with each `POST /chat` request:

```json
{
  "project_id": "...",
  "message": "Create a ticket",
  "tools": [
    {
      "name": "jira.create_ticket",
      "description": "Create a Jira ticket",
      "parameters": {
        "summary": {"type": "string", "required": true},
        "project": {"type": "string", "required": true}
      },
      "requires_approval": true,
      "risk": "medium"
    }
  ]
}
```

Each project/request can have different tools. Agent validates tool requests against the provided tools array. External system (n8n) executes tools and calls `POST /tools/result` with outcome.

### Manager Tools (Built-in)

Built-in auto-executed tools for product management workflow (tester → manager → implementer):

| Tool | Purpose | Creates |
|------|---------|---------|
| `manager.log_finding` | Log tester finding (bug, UX issue, regression, etc.) | `finding` memory item |
| `manager.create_task` | Create implementation task from findings | `impl_task` memory item |
| `manager.decide_finding` | Reject or defer finding with rationale | Updates finding status + logs event |

Findings and tasks are stored as memory items (types `finding`, `impl_task`) and appear in the RAG situational picture. Decisions are logged as events for learning.

Services: `src/services/agent.ts` (MANAGER_TOOLS, executeManagerTool)

### Document Processing

Documents uploaded via `POST /projects/:id/docs` are:
1. Stored to filesystem (`data/uploads/`)
2. Chunked by markdown headers (`src/utils/chunking.ts`)
3. Embedded and stored in Qdrant (collection per project: `kb_<projectId>`)
4. Metadata stored in Postgres (`kb_chunks` table)

### Memory System (4-Layer Architecture)

The memory system supports multiple layers of memory with different purposes:

#### Layer 1: KB Documents (Constitution)
- **FACTS**: Project information, specs, documentation
- **RULES**: Guidelines and processes (playbook)
- **STATE**: Current project state and updates
- Stored in Qdrant collection `kb_<projectId>`
- Authoritative source of truth

#### Layer 2: Memory Items
Stored in `memory_items` table with Qdrant collection `mem_<projectId>`:

| Type | Description | Auto-Approve |
|------|-------------|--------------|
| `fact` | Learned project facts | No |
| `rule` | User-defined rules | No |
| `decision` | Agreed-upon choices | No |
| `open_loop` | Commitments, pending items | No |
| `idea` | Proposed improvements | No |
| `event` | What happened (append-only log) | Yes |
| `metric` | Time-limited measurements | Yes (with TTL) |
| `preference` | User preferences (legacy compat) | No |
| `lesson` | Learned outcomes (legacy compat) | No |
| `finding` | Tester findings (bugs, UX issues, etc.) | Yes (via manager.log_finding) |
| `impl_task` | Implementation tasks for implementer | Yes (via manager.create_task) |

#### Layer 3: Legacy Memory
- **Preferences**: User rules (write-through to memory_items)
- **Lessons**: Outcomes learned (write-through to memory_items)

#### Memory Item Statuses
- `proposed` - Awaiting user approval
- `accepted` - Approved by user
- `rejected` - Rejected by user
- `done` - Completed (for open_loops)
- `blocked` - Blocked by dependency
- `active` - Currently active

#### Safe Learning (Proposal Flow)
1. Agent proposes memory via `memory.propose_add` tool
2. Events and metrics with TTL are auto-approved
3. Facts/decisions/open_loops require user approval via n8n
4. User approves/rejects in n8n
5. n8n calls `POST /tools/result` with decision
6. API updates memory item status accordingly

#### Built-in Memory Tools
```typescript
// Available automatically in all chat requests
memory.propose_add     // Propose new memory item
memory.propose_update  // Propose updating existing item
```

#### Built-in Manager Tools
```typescript
// Available automatically in all chat requests
manager.log_finding    // Log a finding from tester
manager.create_task    // Create implementation task
manager.decide_finding // Reject or defer a finding
```

#### Situational Picture
RAG retrieval includes memory context:
- Open loops (commitments not done)
- Recent events (last 5)
- Active ideas
- Semantically relevant memory items

Services: `src/services/memory-items.ts`, `src/services/memory.ts`, `src/services/rag.ts`

## Database Schema

Key tables in `prisma/schema.prisma`:
- `projects` - Project with name + roleStatement
- `documents` - Uploaded files (FACTS/RULES/STATE categories)
- `kb_chunks` - Text chunks with Qdrant point references
- `threads` / `messages` - Conversation history
- `tool_calls` - Pending/completed tool executions
- `memory_items` - New unified memory system (facts, events, decisions, etc.)
- `preferences` / `lessons` - Legacy memory system (write-through to memory_items)

## Frontend (Admin Dashboard)

React SPA in `frontend/` built with Vite + Tailwind CSS v4. Build output goes to `public/`, served by Fastify via `@fastify/static`.

- **Login**: Agent API Key + Project ID (stored in sessionStorage)
- **Tabs**: Overview, Chat, Memory, Documents, Threads, Tool Calls
- **Dev workflow**: Run `npm run dev` (backend) + `npm run dev:frontend` (Vite with API proxy)
- **Docker**: Frontend is built in a separate Docker stage, output copied to production image

## API Endpoints (Simplified)

```
GET  /health              # Health check (no auth)
POST /projects            # Create project
POST /projects/:id/docs   # Upload document
POST /chat                # Chat with agent
POST /tools/result        # Tool execution callback

# Dashboard API (require X-AGENT-KEY)
GET  /api/project/:id              # Project details
GET  /api/project/:id/threads      # List threads
GET  /api/project/:id/threads/:tid # Thread messages
GET  /api/project/:id/memory-items # List memory items
GET  /api/project/:id/documents    # List documents
GET  /api/project/:id/tool-calls   # List tool calls
PATCH /api/memory-items/:id        # Update memory item
DELETE /api/memory-items/:id       # Delete memory item
```

All endpoints except `/health`, `/docs/*`, and static files require `X-AGENT-KEY` header.

## Testing Configuration

Tests use mock providers:
```bash
EMBEDDING_PROVIDER=mock EMBEDDING_DIMS=384 npm test
```

Test setup in `tests/setup.ts` configures env before imports.
