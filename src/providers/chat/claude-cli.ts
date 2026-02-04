import { execFile } from 'child_process';
import { promisify } from 'util';
import { IChatProvider } from './IChatProvider.js';
import { config } from '../../config.js';
import { createChildLogger } from '../../utils/logger.js';
import { extractJson, createJsonRepairPrompt } from '../../utils/json-repair.js';

const execFileAsync = promisify(execFile);
const logger = createChildLogger('claude-cli-chat');

const MAX_STDOUT_SIZE = 100000; // 100KB
const MAX_RETRIES = 2;

export class ClaudeCliChatProvider implements IChatProvider {
  readonly name = 'claude_cli';
  private command: string;
  private timeout: number;

  constructor() {
    this.command = config.claudeCliCmd;
    this.timeout = config.claudeCliTimeout;
    logger.info({ command: this.command, timeout: this.timeout }, 'Claude CLI chat provider initialized');
  }

  async generateJSON(input: { system: string; user: string }): Promise<string> {
    logger.debug({ systemLength: input.system.length, userLength: input.user.length }, 'Generating JSON via CLI');

    // Combine system and user into a single prompt for CLI
    const fullPrompt = `${input.system}\n\n---\n\nUser message:\n${input.user}\n\nRespond with ONLY valid JSON, no markdown formatting or explanation.`;

    let lastOutput = '';
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const promptToUse = attempt === 0 ? fullPrompt : createJsonRepairPrompt(lastOutput, lastError?.message || 'Invalid JSON');

        const output = await this.runCli(promptToUse);
        lastOutput = output;

        // Try to extract valid JSON
        const extracted = extractJson(output);
        if (extracted) {
          // Validate it parses
          JSON.parse(extracted);
          logger.debug({ attempt, responseLength: extracted.length }, 'Valid JSON extracted');
          return extracted;
        }

        throw new Error('Could not extract valid JSON from response');
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn({ attempt, error: lastError.message }, 'JSON generation attempt failed');

        if (attempt === MAX_RETRIES) {
          logger.error({ attempts: MAX_RETRIES + 1 }, 'All JSON generation attempts failed');
          throw lastError;
        }
      }
    }

    throw new Error('Failed to generate valid JSON');
  }

  private async runCli(prompt: string): Promise<string> {
    const args = ['--print', prompt];

    try {
      const { stdout, stderr } = await execFileAsync(this.command, args, {
        timeout: this.timeout,
        maxBuffer: MAX_STDOUT_SIZE,
        encoding: 'utf-8',
      });

      if (stderr) {
        logger.warn({ stderr }, 'CLI stderr output');
      }

      if (!stdout || stdout.trim().length === 0) {
        throw new Error('Empty response from Claude CLI');
      }

      return stdout.trim();
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'killed' in error && error.killed) {
        throw new Error(`Claude CLI timed out after ${this.timeout}ms`);
      }
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        throw new Error(`Claude CLI command not found: ${this.command}. Ensure Claude Code is installed and in PATH.`);
      }
      throw error;
    }
  }
}
