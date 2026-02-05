import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const configSchema = z.object({
  // Server
  port: z.coerce.number().default(3000),
  host: z.string().default('0.0.0.0'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),

  // API Security
  agentApiKey: z.string().min(1),

  // Database
  databaseUrl: z.string().url(),

  // Qdrant
  qdrantUrl: z.string().url(),
  qdrantApiKey: z.string().optional(),

  // Provider Selection
  chatProvider: z.enum(['openai', 'anthropic', 'claude_cli']).default('openai'),
  embeddingProvider: z.enum(['openai', 'ollama', 'mock']).default('openai'),

  // OpenAI
  openaiApiKey: z.string().optional(),
  openaiChatModel: z.string().default('gpt-4o'),
  openaiEmbeddingModel: z.string().default('text-embedding-3-large'),

  // Anthropic
  anthropicApiKey: z.string().optional(),
  anthropicModel: z.string().default('claude-sonnet-4-20250514'),

  // Claude CLI
  claudeCliCmd: z.string().default('claude'),
  claudeCliTimeout: z.coerce.number().default(60000),

  // Claude OAuth (enables API mode for claude_cli provider in Docker)
  claudeOauthToken: z.string().optional(),
  claudeOauthRefreshToken: z.string().optional(),

  // Ollama
  ollamaBaseUrl: z.string().default('http://localhost:11434'),
  ollamaEmbeddingModel: z.string().default('nomic-embed-text'),

  // Embeddings
  embeddingDims: z.coerce.number().default(3072),

  // Storage
  storagePath: z.string().default('./data/uploads'),
  maxUploadSizeMb: z.coerce.number().default(50),

  // Rate Limiting
  rateLimitMax: z.coerce.number().default(100),
  rateLimitWindowMs: z.coerce.number().default(60000),

  // Logging
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

function loadConfig(): z.infer<typeof configSchema> {
  const raw = {
    port: process.env.PORT,
    host: process.env.HOST,
    nodeEnv: process.env.NODE_ENV,
    agentApiKey: process.env.AGENT_API_KEY,
    databaseUrl: process.env.DATABASE_URL,
    qdrantUrl: process.env.QDRANT_URL,
    qdrantApiKey: process.env.QDRANT_API_KEY,
    chatProvider: process.env.CHAT_PROVIDER,
    embeddingProvider: process.env.EMBEDDING_PROVIDER,
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiChatModel: process.env.OPENAI_CHAT_MODEL,
    openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicModel: process.env.ANTHROPIC_MODEL,
    claudeCliCmd: process.env.CLAUDE_CLI_CMD,
    claudeCliTimeout: process.env.CLAUDE_CLI_TIMEOUT,
    claudeOauthToken: process.env.CLAUDE_OAUTH_TOKEN,
    claudeOauthRefreshToken: process.env.CLAUDE_OAUTH_REFRESH_TOKEN,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
    ollamaEmbeddingModel: process.env.OLLAMA_EMBEDDING_MODEL,
    embeddingDims: process.env.EMBEDDING_DIMS,
    storagePath: process.env.STORAGE_PATH,
    maxUploadSizeMb: process.env.MAX_UPLOAD_SIZE_MB,
    rateLimitMax: process.env.RATE_LIMIT_MAX,
    rateLimitWindowMs: process.env.RATE_LIMIT_WINDOW_MS,
    logLevel: process.env.LOG_LEVEL,
  };

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    // In test environment, throw instead of exit
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      throw new Error(`Configuration validation failed: ${JSON.stringify(result.error.format())}`);
    }
    console.error('Configuration validation failed:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

// Lazy load config to allow env vars to be set before validation
let _config: z.infer<typeof configSchema> | null = null;

export function getConfig(): z.infer<typeof configSchema> {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

// For backwards compatibility, export config as a getter
export const config = new Proxy({} as z.infer<typeof configSchema>, {
  get(_target, prop: string) {
    return getConfig()[prop as keyof z.infer<typeof configSchema>];
  },
});
export type Config = z.infer<typeof configSchema>;
