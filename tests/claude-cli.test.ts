import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process for CLI mode tests
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

describe('ClaudeCliChatProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with correct name', async () => {
    vi.resetModules();

    vi.doMock('../src/config.js', () => ({
      config: {
        claudeCliCmd: 'claude',
        claudeCliTimeout: 5000,
        logLevel: 'error',
        nodeEnv: 'test',
      },
    }));

    const { ClaudeCliChatProvider } = await import('../src/providers/chat/claude-cli.js');
    const provider = new ClaudeCliChatProvider();
    expect(provider.name).toBe('claude_cli');
  });

  it('should throw on CLI not found (ENOENT)', async () => {
    vi.resetModules();

    vi.doMock('../src/config.js', () => ({
      config: {
        claudeCliCmd: 'nonexistent-claude',
        claudeCliTimeout: 5000,
        logLevel: 'error',
        nodeEnv: 'test',
      },
    }));

    const { spawn } = await import('child_process');
    const mockSpawn = vi.mocked(spawn);

    // Simulate ENOENT error
    mockSpawn.mockImplementation(() => {
      const proc = {
        stdin: { write: vi.fn(), end: vi.fn() },
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          if (event === 'error') {
            setTimeout(() => {
              const err = new Error('spawn nonexistent-claude ENOENT') as NodeJS.ErrnoException;
              err.code = 'ENOENT';
              cb(err);
            }, 0);
          }
        }),
        kill: vi.fn(),
      };
      return proc as unknown as ReturnType<typeof spawn>;
    });

    const { ClaudeCliChatProvider } = await import('../src/providers/chat/claude-cli.js');
    const provider = new ClaudeCliChatProvider();

    await expect(
      provider.generateJSON({ system: 'Test', user: 'Hello' })
    ).rejects.toThrow('command not found');
  });
});
