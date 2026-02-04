# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run dev          # Start dev server with hot reload (tsx watch)
npm run build        # Compile TypeScript to dist/
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
CHAT_PROVIDER=claude_cli|openai|anthropic # LLM provider
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

### Tool System

Tools defined in `src/tools/definitions.ts` with Zod schemas. Agent sees tools in system prompt and can request execution. n8n executes and calls `POST /tools/result` with outcome.

### Document Processing

Documents uploaded via `POST /projects/:id/docs` are:
1. Stored to filesystem (`data/uploads/`)
2. Chunked by markdown headers (`src/utils/chunking.ts`)
3. Embedded and stored in Qdrant (collection per project: `kb_<projectId>`)
4. Metadata stored in Postgres (`kb_chunks` table)

### Memory System

- **Preferences**: User rules extracted from conversation, stored per project+user
- **Lessons**: Outcomes learned from tool execution results

Both injected into system prompt via `src/services/rag.ts`.

## Database Schema

Key tables in `prisma/schema.prisma`:
- `projects` - Project with name + roleStatement
- `documents` - Uploaded files (FACTS/RULES/STATE categories)
- `kb_chunks` - Text chunks with Qdrant point references
- `threads` / `messages` - Conversation history
- `tool_calls` - Pending/completed tool executions
- `preferences` / `lessons` - Memory system

## API Endpoints (Simplified)

```
GET  /health              # Health check (no auth)
POST /projects            # Create project
POST /projects/:id/docs   # Upload document
POST /chat                # Chat with agent
POST /tools/result        # Tool execution callback
```

All endpoints except `/health` and `/docs/*` require `X-AGENT-KEY` header.

## Testing Configuration

Tests use mock providers:
```bash
EMBEDDING_PROVIDER=mock EMBEDDING_DIMS=384 npm test
```

Test setup in `tests/setup.ts` configures env before imports.
