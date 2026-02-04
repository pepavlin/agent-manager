// Setup environment variables before any tests run
process.env.VITEST = 'true';
process.env.NODE_ENV = 'test';
process.env.AGENT_API_KEY = 'test-api-key';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.QDRANT_URL = 'http://localhost:6333';
process.env.CHAT_PROVIDER = 'claude_cli';
process.env.EMBEDDING_PROVIDER = 'mock';
process.env.EMBEDDING_DIMS = '384';
process.env.LOG_LEVEL = 'error';
