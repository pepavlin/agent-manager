import { spawn } from 'child_process';
import { IChatProvider } from './IChatProvider.js';
import { config } from '../../config.js';
import { createChildLogger } from '../../utils/logger.js';
import { extractJson, createJsonRepairPrompt } from '../../utils/json-repair.js';
import { ProviderError } from '../../utils/errors.js';

const logger = createChildLogger('claude-cli-chat');

const MAX_STDOUT_SIZE = 100000; // 100KB
const MAX_RETRIES = 2;

export class ClaudeCliChatProvider implements IChatProvider {
  readonly name = 'claude_cli';
  private command: string;
  private timeout: number;
  private model: string | undefined;

  constructor() {
    this.command = config.claudeCliCmd;
    this.timeout = config.claudeCliTimeout;
    this.model = config.claudeCliModel;
    logger.info({ command: this.command, timeout: this.timeout, model: this.model || '(default)' }, 'Claude CLI provider initialized');
  }

  async generateJSON(input: { system: string; user: string }): Promise<string> {
    logger.debug({ systemLength: input.system.length, userLength: input.user.length }, 'Generating JSON');

    const fullPrompt = `${input.system}\n\n---\n\nUser message:\n${input.user}\n\nRespond with ONLY valid JSON, no markdown formatting or explanation.`;

    let lastOutput = '';
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const promptToUse = attempt === 0 ? fullPrompt : createJsonRepairPrompt(lastOutput, lastError?.message || 'Invalid JSON');

        const output = await this.runCli(promptToUse);
        lastOutput = output;

        const extracted = extractJson(output);
        if (extracted) {
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

  private runCli(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      const args = ['--print'];
      if (this.model) {
        args.push('--model', this.model);
      }
      args.push('-');

      const proc = spawn(this.command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: this.timeout,
      });

      const timer = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
        reject(new ProviderError('claude_cli', `Timed out after ${this.timeout}ms`));
      }, this.timeout);

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        if (stdout.length > MAX_STDOUT_SIZE) {
          killed = true;
          proc.kill('SIGTERM');
          reject(new Error('Response too large'));
        }
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        clearTimeout(timer);
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error(`Claude CLI command not found: ${this.command}. Ensure Claude Code is installed and in PATH.`));
        } else {
          reject(error);
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (killed) return;

        if (stderr) {
          logger.warn({ stderr }, 'CLI stderr output');
        }

        if (code !== 0) {
          logger.error({ code, stderr: stderr || '(empty)', stdout: stdout?.substring(0, 500) || '(empty)' }, 'CLI exited with non-zero code');
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr || stdout || 'No error output'}`));
          return;
        }

        if (!stdout || stdout.trim().length === 0) {
          reject(new ProviderError('claude_cli', 'Empty response'));
          return;
        }

        resolve(stdout.trim());
      });

      proc.stdin.write(prompt);
      proc.stdin.end();
    });
  }
}
