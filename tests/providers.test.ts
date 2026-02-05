import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Provider Factories', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe('Mock Embedding Provider', () => {
    it('should generate deterministic vectors', async () => {
      vi.doMock('../src/config.js', () => ({
        config: { logLevel: 'error', nodeEnv: 'test' },
      }));

      const { MockEmbeddingProvider } = await import('../src/providers/embeddings/mock.js');
      const provider = new MockEmbeddingProvider(384);

      const vectors = await provider.embed(['hello', 'world']);
      expect(vectors).toHaveLength(2);
      expect(vectors[0]).toHaveLength(384);
      expect(vectors[1]).toHaveLength(384);
    });

    it('should return correct dimensions', async () => {
      vi.doMock('../src/config.js', () => ({
        config: { logLevel: 'error', nodeEnv: 'test' },
      }));

      const { MockEmbeddingProvider } = await import('../src/providers/embeddings/mock.js');
      const provider = new MockEmbeddingProvider(256);
      expect(provider.dims()).toBe(256);
    });

    it('should return empty array for empty input', async () => {
      vi.doMock('../src/config.js', () => ({
        config: { logLevel: 'error', nodeEnv: 'test' },
      }));

      const { MockEmbeddingProvider } = await import('../src/providers/embeddings/mock.js');
      const provider = new MockEmbeddingProvider();

      const vectors = await provider.embed([]);
      expect(vectors).toEqual([]);
    });

    it('should generate different vectors for different texts', async () => {
      vi.doMock('../src/config.js', () => ({
        config: { logLevel: 'error', nodeEnv: 'test' },
      }));

      const { MockEmbeddingProvider } = await import('../src/providers/embeddings/mock.js');
      const provider = new MockEmbeddingProvider(384);

      const vectors = await provider.embed(['hello', 'world']);
      expect(vectors[0]).not.toEqual(vectors[1]);
    });

    it('should generate same vector for same text', async () => {
      vi.doMock('../src/config.js', () => ({
        config: { logLevel: 'error', nodeEnv: 'test' },
      }));

      const { MockEmbeddingProvider } = await import('../src/providers/embeddings/mock.js');
      const provider = new MockEmbeddingProvider(384);

      const v1 = await provider.embed(['hello']);
      const v2 = await provider.embed(['hello']);
      expect(v1[0]).toEqual(v2[0]);
    });
  });

  describe('ClaudeCliChatProvider', () => {
    it('should have correct name', async () => {
      vi.doMock('../src/config.js', () => ({
        config: {
          claudeCliCmd: 'claude',
          claudeCliTimeout: 60000,
          logLevel: 'error',
          nodeEnv: 'test',
        },
      }));

      const { ClaudeCliChatProvider } = await import('../src/providers/chat/claude-cli.js');
      const provider = new ClaudeCliChatProvider();
      expect(provider.name).toBe('claude_cli');
    });
  });

  describe('AnthropicChatProvider', () => {
    it('should have correct name', async () => {
      vi.doMock('../src/config.js', () => ({
        config: {
          anthropicApiKey: 'test-anthropic-key',
          anthropicModel: 'claude-sonnet-4-20250514',
          logLevel: 'error',
          nodeEnv: 'test',
        },
      }));

      const { AnthropicChatProvider } = await import('../src/providers/chat/anthropic.js');
      const provider = new AnthropicChatProvider();
      expect(provider.name).toBe('anthropic');
    });

    it('should throw without API key', async () => {
      vi.doMock('../src/config.js', () => ({
        config: {
          anthropicApiKey: undefined,
          anthropicModel: 'claude-sonnet-4-20250514',
          logLevel: 'error',
          nodeEnv: 'test',
        },
      }));

      const { AnthropicChatProvider } = await import('../src/providers/chat/anthropic.js');
      expect(() => new AnthropicChatProvider()).toThrow('ANTHROPIC_API_KEY');
    });
  });

  describe('OpenAIChatProvider', () => {
    it('should have correct name', async () => {
      vi.doMock('../src/config.js', () => ({
        config: {
          openaiApiKey: 'test-openai-key',
          openaiChatModel: 'gpt-4o',
          logLevel: 'error',
          nodeEnv: 'test',
        },
      }));

      const { OpenAIChatProvider } = await import('../src/providers/chat/openai.js');
      const provider = new OpenAIChatProvider();
      expect(provider.name).toBe('openai');
    });
  });
});
