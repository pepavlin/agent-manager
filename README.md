# Agent Manager

A document-first project manager AI agent that learns from uploaded documents, maintains a knowledge base per project, and provides chat-based project management assistance.

## Features

- **Document-first onboarding**: Upload project documents (FACTS, RULES, STATE) to build project knowledge
- **RAG-based retrieval**: Uses Qdrant for vector search to find relevant context
- **Memory system**: Stores user preferences and lessons learned
- **Tool execution**: Integrates with n8n for external tool execution
- **Provider agnostic**: Supports OpenAI, Anthropic, Claude CLI for chat; OpenAI, Ollama, Mock for embeddings
- **Multi-project support**: Manage multiple projects with separate knowledge bases

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│   Messenger     │────▶│      n8n        │
│   (User)        │     │  (Orchestrator) │
└─────────────────┘     └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │   Agent API     │
                        │   (This Repo)   │
                        └────────┬────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
      ┌───────────┐      ┌───────────┐      ┌───────────┐
      │  Postgres │      │  Qdrant   │      │  LLM API  │
      │  (Data)   │      │ (Vectors) │      │(Chat/Emb) │
      └───────────┘      └───────────┘      └───────────┘
```

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for local development)
- OpenAI API key (or Claude CLI for local testing)

### 1. Setup Environment

```bash
# Clone and enter directory
cd agent-manager

# Copy environment file
cp .env.example .env

# Edit .env with your settings
# At minimum, set:
# - AGENT_API_KEY (any secret string)
# - OPENAI_API_KEY (if using OpenAI)
```

### 2. Start with Docker Compose

```bash
# Start all services (Postgres, Qdrant, Agent API)
docker compose up -d

# Check logs
docker compose logs -f agent-api

# Run database migrations
docker compose exec agent-api npx prisma migrate deploy
```

### 3. Local Development

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Start Postgres and Qdrant
docker compose up -d postgres qdrant

# Run migrations
npx prisma migrate dev

# Start development server
npm run dev
```

## Configuration

### Provider Selection

#### Chat Providers

| Provider | Env Value | Requirements |
|----------|-----------|--------------|
| OpenAI | `CHAT_PROVIDER=openai` | `OPENAI_API_KEY` |
| Anthropic | `CHAT_PROVIDER=anthropic` | `ANTHROPIC_API_KEY` |
| Claude CLI | `CHAT_PROVIDER=claude_cli` | Claude Code installed |

#### Embedding Providers

| Provider | Env Value | Requirements |
|----------|-----------|--------------|
| OpenAI | `EMBEDDING_PROVIDER=openai` | `OPENAI_API_KEY` |
| Ollama | `EMBEDDING_PROVIDER=ollama` | Ollama running with model |
| Mock | `EMBEDDING_PROVIDER=mock` | None (for testing) |

### Fully Local Setup (No API Keys)

```bash
# Start with Ollama profile
docker compose --profile local up -d

# Pull embedding model
docker compose exec ollama ollama pull nomic-embed-text

# Set environment variables
export CHAT_PROVIDER=claude_cli
export EMBEDDING_PROVIDER=ollama
export EMBEDDING_DIMS=768  # nomic-embed-text dimensions

npm run dev
```

### Production Setup (OpenAI)

```bash
export CHAT_PROVIDER=openai
export EMBEDDING_PROVIDER=openai
export OPENAI_API_KEY=sk-...
export EMBEDDING_DIMS=3072  # text-embedding-3-large dimensions

docker compose up -d
```

## API Reference

### Authentication

All endpoints (except `/healthz`) require the `X-AGENT-KEY` header:

```bash
curl -H "X-AGENT-KEY: your-api-key" http://localhost:3000/projects
```

### Endpoints

#### Health Check

```bash
GET /healthz
```

#### Projects

```bash
# Create project
POST /projects
Content-Type: application/json

{
  "name": "My Project",
  "roleStatement": "You are a project manager for a mobile app development team."
}

# Response
{
  "id": "clxxxxx",
  "name": "My Project",
  "role_statement": "...",
  "created_at": "2024-01-01T00:00:00.000Z"
}
```

```bash
# Get project
GET /projects/:id

# List projects
GET /projects

# Delete project
DELETE /projects/:id
```

#### Documents

```bash
# Upload document
POST /projects/:id/docs
Content-Type: multipart/form-data

# Fields:
# - file: the document file
# - category: FACTS | RULES | STATE

# Response
{
  "id": "doc-id",
  "project_id": "project-id",
  "category": "FACTS",
  "filename": "requirements.md",
  "chunks_count": 15,
  "status": "indexed"
}
```

```bash
# List documents
GET /projects/:id/docs?category=FACTS

# Get project brief
GET /projects/:id/brief

# Regenerate brief
POST /projects/:id/brief/regenerate
```

#### Chat

```bash
# Send message
POST /chat
Content-Type: application/json

{
  "project_id": "project-id",
  "user_id": "user-123",
  "thread_id": "optional-thread-id",
  "message": "What are the main features we need to build?",
  "context": {
    "source": "messenger",
    "meta": {}
  }
}

# Response
{
  "thread_id": "thread-id",
  "response_json": {
    "mode": "NOOP",
    "message": "Based on the requirements document, the main features are...",
    "tool_request": null,
    "memory_updates": {
      "preferences_add": [],
      "preferences_remove": [],
      "lessons_add": []
    }
  },
  "render": {
    "text_to_send_to_user": "Based on the requirements document, the main features are..."
  }
}
```

```bash
# Get thread messages
GET /threads/:id?limit=50

# List project threads
GET /projects/:id/threads?user_id=user-123
```

#### Tools

```bash
# List available tools
GET /tools

# Get pending tool calls
GET /projects/:id/tools/pending

# Approve tool call
POST /tools/:id/approve

# Reject tool call
POST /tools/:id/reject
Content-Type: application/json
{"reason": "Not approved"}

# Submit tool result (from n8n)
POST /tools/result
Content-Type: application/json

{
  "tool_call_id": "tool-call-id",
  "project_id": "project-id",
  "ok": true,
  "data": {"item_id": "created-item-123"}
}
```

## Document Categories

| Category | Purpose | Example |
|----------|---------|---------|
| FACTS | What the project is | Requirements, specs, architecture docs |
| RULES | How to decide | Playbook, guidelines, constraints |
| STATE | Current status | Backlog snapshot, sprint status |

## Agent Behavior

The agent always responds in one of three modes:

1. **ACT**: Request a tool execution
   - Returns `tool_request` with tool name and arguments
   - Write actions always have `requires_approval: true`
   - n8n executes and calls back with result

2. **ASK**: Ask a clarifying question
   - Default when uncertain
   - Returns question in `message`

3. **NOOP**: Provide information without tools
   - Reports, summaries, suggestions
   - Default for informational queries

## n8n Integration

### Webhook Flow

1. Messenger webhook → n8n
2. n8n calls `POST /chat` with user message
3. Agent responds with `mode` and optional `tool_request`
4. If `mode: ACT`:
   - n8n checks `requires_approval`
   - If approved, executes tool
   - Calls `POST /tools/result` with outcome
5. n8n sends `render.text_to_send_to_user` back to Messenger

### Tool Execution Example

```javascript
// n8n JavaScript node
const response = await $http.post('http://agent-api:3000/chat', {
  body: {
    project_id: '...',
    user_id: '...',
    message: input.message
  },
  headers: {
    'X-AGENT-KEY': 'your-api-key'
  }
});

const { response_json, render } = response.data;

if (response_json.mode === 'ACT' && response_json.tool_request) {
  const tool = response_json.tool_request;

  if (tool.requires_approval && !isApproved(tool)) {
    return { text: `Approval needed: ${tool.name}` };
  }

  // Execute tool based on tool.name
  const result = await executeTool(tool.name, tool.args);

  // Report result back
  await $http.post('http://agent-api:3000/tools/result', {
    body: {
      tool_call_id: '...',
      project_id: '...',
      ok: result.success,
      data: result.data,
      error: result.error
    }
  });
}

return { text: render.text_to_send_to_user };
```

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test -- --coverage

# Run specific test file
npm test tests/chunker.test.ts
```

### Test Configuration

```bash
# For tests, use mock providers
export CHAT_PROVIDER=claude_cli  # or implement MockChatProvider
export EMBEDDING_PROVIDER=mock
export EMBEDDING_DIMS=384
```

## Development

### File Structure

```
src/
├── server.ts           # Fastify server entry
├── config.ts           # Environment configuration
├── routes/
│   ├── projects.ts     # Project CRUD + docs
│   ├── chat.ts         # Chat endpoint
│   ├── tools.ts        # Tool callbacks
│   └── health.ts       # Health check
├── services/
│   ├── agent.ts        # Core agent loop
│   ├── rag.ts          # RAG retrieval
│   ├── memory.ts       # Preferences/lessons
│   ├── docs.ts         # Document processing
│   ├── prompts.ts      # Prompt assembly
│   ├── brief.ts        # Brief generation
│   └── qdrant.ts       # Vector DB client
├── providers/
│   ├── chat/           # Chat providers
│   └── embeddings/     # Embedding providers
├── tools/
│   ├── registry.ts     # Tool registry
│   └── definitions.ts  # Tool definitions
└── utils/
    ├── chunking.ts     # Text chunking
    ├── hashing.ts      # SHA256 + vectors
    ├── storage.ts      # File storage
    └── logger.ts       # Pino logger
```

### Adding a New Tool

1. Add schema in `src/tools/definitions.ts`:

```typescript
export const MyToolArgsSchema = z.object({
  param1: z.string(),
  param2: z.number().optional(),
});

export const TOOLS = {
  // ...existing tools
  'my.tool': {
    name: 'my.tool',
    description: 'Does something useful',
    argsSchema: MyToolArgsSchema,
    requiresApproval: true,
    defaultRisk: 'medium' as RiskLevel,
  },
};
```

2. Handle in n8n based on tool name

### Adding a New Provider

1. Implement the interface in `src/providers/chat/` or `src/providers/embeddings/`
2. Add to factory in the `index.ts` file
3. Add env variable option to `src/config.ts`

## Troubleshooting

### Database Connection Issues

```bash
# Check Postgres is running
docker compose ps postgres

# Check logs
docker compose logs postgres

# Reset database
docker compose down -v
docker compose up -d postgres
npx prisma migrate deploy
```

### Qdrant Connection Issues

```bash
# Check Qdrant is running
curl http://localhost:6333/

# Check collections
curl http://localhost:6333/collections
```

### Claude CLI Issues

```bash
# Check Claude is installed
which claude
claude --version

# Test Claude CLI
claude --print "Hello, respond with: OK"
```

### Ollama Issues

```bash
# Check Ollama is running
curl http://localhost:11434/api/tags

# Pull embedding model
docker compose exec ollama ollama pull nomic-embed-text

# Test embeddings
curl http://localhost:11434/api/embeddings \
  -d '{"model": "nomic-embed-text", "prompt": "test"}'
```

## License

MIT
