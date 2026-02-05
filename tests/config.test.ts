import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

// Replicate the config schema locally to test validation logic
// without importing the actual module (which has singleton caching and dotenv)
const configSchema = z.object({
  port: z.coerce.number().default(3000),
  host: z.string().default('0.0.0.0'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  agentApiKey: z.string().min(1),
  databaseUrl: z.string().url(),
  qdrantUrl: z.string().url(),
  qdrantApiKey: z.string().optional(),
  chatProvider: z.enum(['openai', 'anthropic', 'claude_cli']).default('openai'),
  embeddingProvider: z.enum(['openai', 'ollama', 'mock']).default('openai'),
  openaiApiKey: z.string().optional(),
  openaiChatModel: z.string().default('gpt-4o'),
  openaiEmbeddingModel: z.string().default('text-embedding-3-large'),
  anthropicApiKey: z.string().optional(),
  anthropicModel: z.string().default('claude-sonnet-4-20250514'),
  claudeCliCmd: z.string().default('claude'),
  claudeCliTimeout: z.coerce.number().default(60000),
  ollamaBaseUrl: z.string().default('http://localhost:11434'),
  ollamaEmbeddingModel: z.string().default('nomic-embed-text'),
  embeddingDims: z.coerce.number().default(3072),
  storagePath: z.string().default('./data/uploads'),
  maxUploadSizeMb: z.coerce.number().default(50),
  rateLimitMax: z.coerce.number().default(100),
  rateLimitWindowMs: z.coerce.number().default(60000),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

function parseConfig(env: Record<string, string | undefined>) {
  const raw = {
    port: env.PORT,
    host: env.HOST,
    nodeEnv: env.NODE_ENV,
    agentApiKey: env.AGENT_API_KEY,
    databaseUrl: env.DATABASE_URL,
    qdrantUrl: env.QDRANT_URL,
    qdrantApiKey: env.QDRANT_API_KEY,
    chatProvider: env.CHAT_PROVIDER,
    embeddingProvider: env.EMBEDDING_PROVIDER,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiChatModel: env.OPENAI_CHAT_MODEL,
    openaiEmbeddingModel: env.OPENAI_EMBEDDING_MODEL,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    anthropicModel: env.ANTHROPIC_MODEL,
    claudeCliCmd: env.CLAUDE_CLI_CMD,
    claudeCliTimeout: env.CLAUDE_CLI_TIMEOUT,
    ollamaBaseUrl: env.OLLAMA_BASE_URL,
    ollamaEmbeddingModel: env.OLLAMA_EMBEDDING_MODEL,
    embeddingDims: env.EMBEDDING_DIMS,
    storagePath: env.STORAGE_PATH,
    maxUploadSizeMb: env.MAX_UPLOAD_SIZE_MB,
    rateLimitMax: env.RATE_LIMIT_MAX,
    rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
    logLevel: env.LOG_LEVEL,
  };

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Configuration validation failed: ${JSON.stringify(result.error.format())}`);
  }
  return result.data;
}

// Minimal valid env
const validEnv: Record<string, string> = {
  AGENT_API_KEY: 'test-key',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  QDRANT_URL: 'http://localhost:6333',
};

describe('Config Validation', () => {
  it('should load config with required vars', () => {
    const config = parseConfig(validEnv);
    expect(config.agentApiKey).toBe('test-key');
    expect(config.databaseUrl).toBe('postgresql://test:test@localhost:5432/test');
    expect(config.qdrantUrl).toBe('http://localhost:6333');
  });

  it('should apply default values', () => {
    const config = parseConfig(validEnv);
    expect(config.port).toBe(3000);
    expect(config.host).toBe('0.0.0.0');
    expect(config.chatProvider).toBe('openai');
    expect(config.embeddingProvider).toBe('openai');
    expect(config.embeddingDims).toBe(3072);
    expect(config.maxUploadSizeMb).toBe(50);
    expect(config.rateLimitMax).toBe(100);
    expect(config.logLevel).toBe('info');
    expect(config.claudeCliCmd).toBe('claude');
    expect(config.claudeCliTimeout).toBe(60000);
    expect(config.anthropicModel).toBe('claude-sonnet-4-20250514');
  });

  it('should override defaults with env vars', () => {
    const config = parseConfig({
      ...validEnv,
      PORT: '8080',
      CHAT_PROVIDER: 'anthropic',
      EMBEDDING_PROVIDER: 'mock',
      EMBEDDING_DIMS: '384',
      LOG_LEVEL: 'debug',
    });

    expect(config.port).toBe(8080);
    expect(config.chatProvider).toBe('anthropic');
    expect(config.embeddingProvider).toBe('mock');
    expect(config.embeddingDims).toBe(384);
    expect(config.logLevel).toBe('debug');
  });

  it('should accept claude_cli as chat provider', () => {
    const config = parseConfig({ ...validEnv, CHAT_PROVIDER: 'claude_cli' });
    expect(config.chatProvider).toBe('claude_cli');
  });

  it('should throw on missing AGENT_API_KEY', () => {
    const env = { ...validEnv };
    delete env.AGENT_API_KEY;
    expect(() => parseConfig(env)).toThrow();
  });

  it('should throw on missing DATABASE_URL', () => {
    const env = { ...validEnv };
    delete env.DATABASE_URL;
    expect(() => parseConfig(env)).toThrow();
  });

  it('should throw on invalid DATABASE_URL', () => {
    expect(() => parseConfig({ ...validEnv, DATABASE_URL: 'not-a-url' })).toThrow();
  });

  it('should throw on missing QDRANT_URL', () => {
    const env = { ...validEnv };
    delete env.QDRANT_URL;
    expect(() => parseConfig(env)).toThrow();
  });

  it('should throw on invalid chat provider', () => {
    expect(() => parseConfig({ ...validEnv, CHAT_PROVIDER: 'invalid_provider' })).toThrow();
  });

  it('should throw on invalid embedding provider', () => {
    expect(() => parseConfig({ ...validEnv, EMBEDDING_PROVIDER: 'invalid_provider' })).toThrow();
  });

  it('should coerce PORT to number', () => {
    const config = parseConfig({ ...validEnv, PORT: '9000' });
    expect(config.port).toBe(9000);
    expect(typeof config.port).toBe('number');
  });

  it('should coerce EMBEDDING_DIMS to number', () => {
    const config = parseConfig({ ...validEnv, EMBEDDING_DIMS: '768' });
    expect(config.embeddingDims).toBe(768);
    expect(typeof config.embeddingDims).toBe('number');
  });

  it('should accept optional API keys', () => {
    const config = parseConfig({
      ...validEnv,
      OPENAI_API_KEY: 'sk-test',
      ANTHROPIC_API_KEY: 'sk-ant-test',
    });
    expect(config.openaiApiKey).toBe('sk-test');
    expect(config.anthropicApiKey).toBe('sk-ant-test');
  });

  it('should accept valid node environments', () => {
    for (const env of ['development', 'production', 'test'] as const) {
      const config = parseConfig({ ...validEnv, NODE_ENV: env });
      expect(config.nodeEnv).toBe(env);
    }
  });

  it('should throw on invalid node environment', () => {
    expect(() => parseConfig({ ...validEnv, NODE_ENV: 'staging' })).toThrow();
  });

  it('should throw on invalid log level', () => {
    expect(() => parseConfig({ ...validEnv, LOG_LEVEL: 'verbose' })).toThrow();
  });

  it('should accept all valid log levels', () => {
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
      const config = parseConfig({ ...validEnv, LOG_LEVEL: level });
      expect(config.logLevel).toBe(level);
    }
  });
});
