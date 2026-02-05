import { spawn } from 'child_process';
import { IChatProvider } from './IChatProvider.js';
import { config } from '../../config.js';
import { createChildLogger } from '../../utils/logger.js';
import { extractJson, createJsonRepairPrompt } from '../../utils/json-repair.js';
import { ProviderError } from '../../utils/errors.js';

const logger = createChildLogger('claude-cli-chat');

const MAX_STDOUT_SIZE = 100000; // 100KB
const MAX_RETRIES = 2;

const OAUTH_TOKEN_URL = 'https://console.anthropic.com/api/oauth/token';
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
  stop_reason: string;
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export class ClaudeCliChatProvider implements IChatProvider {
  readonly name = 'claude_cli';
  private mode: 'cli' | 'api';

  // CLI mode
  private command: string;
  private timeout: number;

  // API mode
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiresAt: number | null = null;
  private model: string;

  constructor() {
    this.command = config.claudeCliCmd;
    this.timeout = config.claudeCliTimeout;
    this.model = config.anthropicModel;

    if (config.claudeOauthToken) {
      this.mode = 'api';
      this.accessToken = config.claudeOauthToken;
      this.refreshToken = config.claudeOauthRefreshToken || null;
      // Assume token is valid for now; will refresh on 401
      this.tokenExpiresAt = null;
      logger.info({ model: this.model }, 'Claude CLI provider initialized in API mode (OAuth)');
    } else {
      this.mode = 'cli';
      logger.info({ command: this.command, timeout: this.timeout }, 'Claude CLI provider initialized in CLI mode');
    }
  }

  async generateJSON(input: { system: string; user: string }): Promise<string> {
    logger.debug({ mode: this.mode, systemLength: input.system.length, userLength: input.user.length }, 'Generating JSON');

    if (this.mode === 'api') {
      return this.generateJsonViaApi(input);
    }
    return this.generateJsonViaCli(input);
  }

  // ─── API mode ───────────────────────────────────────────────────────

  private async generateJsonViaApi(input: { system: string; user: string }): Promise<string> {
    let lastOutput = '';
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const userContent = attempt === 0
          ? `${input.user}\n\nRespond with ONLY valid JSON, no markdown formatting or explanation.`
          : createJsonRepairPrompt(lastOutput, lastError?.message || 'Invalid JSON');

        const systemPrompt = attempt === 0 ? input.system : undefined;
        const output = await this.callAnthropicApi(systemPrompt || input.system, userContent);
        lastOutput = output;

        const extracted = extractJson(output);
        if (extracted) {
          JSON.parse(extracted);
          logger.debug({ attempt, responseLength: extracted.length }, 'Valid JSON extracted (API mode)');
          return extracted;
        }

        throw new Error('Could not extract valid JSON from response');
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn({ attempt, error: lastError.message }, 'JSON generation attempt failed (API mode)');

        if (attempt === MAX_RETRIES) {
          logger.error({ attempts: MAX_RETRIES + 1 }, 'All JSON generation attempts failed (API mode)');
          throw lastError;
        }
      }
    }

    throw new Error('Failed to generate valid JSON');
  }

  private async callAnthropicApi(system: string, user: string): Promise<string> {
    await this.ensureValidToken();

    const response = await this.doApiCall(system, user);

    // If 401, try refreshing token once and retry
    if (response.status === 401 && this.refreshToken) {
      logger.info('Got 401, attempting token refresh');
      await this.refreshAccessToken();
      const retryResponse = await this.doApiCall(system, user);

      if (!retryResponse.ok) {
        const errorText = await retryResponse.text();
        logger.error({ status: retryResponse.status, error: errorText }, 'Anthropic API error after token refresh');
        throw new ProviderError('claude_cli', `Anthropic API error: ${retryResponse.status} - ${errorText}`);
      }

      return this.extractTextFromResponse(retryResponse);
    }

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'Anthropic API error');
      throw new ProviderError('claude_cli', `Anthropic API error: ${response.status} - ${errorText}`);
    }

    return this.extractTextFromResponse(response);
  }

  private async doApiCall(system: string, user: string): Promise<Response> {
    return fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.accessToken!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
  }

  private async extractTextFromResponse(response: Response): Promise<string> {
    const data = (await response.json()) as AnthropicResponse;
    const content = data.content.find((c) => c.type === 'text')?.text;

    if (!content) {
      throw new ProviderError('claude_cli', 'Empty response from Anthropic API');
    }

    return content;
  }

  private async ensureValidToken(): Promise<void> {
    if (!this.tokenExpiresAt || !this.refreshToken) return;

    const now = Date.now();
    if (now >= this.tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
      logger.info('Token near expiry, refreshing proactively');
      await this.refreshAccessToken();
    }
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new ProviderError('claude_cli', 'No refresh token available, cannot refresh access token');
    }

    logger.info('Refreshing OAuth access token');

    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: OAUTH_CLIENT_ID,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'OAuth token refresh failed');
      throw new ProviderError('claude_cli', `OAuth token refresh failed: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as OAuthTokenResponse;
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;

    logger.info({ expiresIn: data.expires_in }, 'OAuth token refreshed successfully');
  }

  // ─── CLI mode ───────────────────────────────────────────────────────

  private async generateJsonViaCli(input: { system: string; user: string }): Promise<string> {
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

      const proc = spawn(this.command, ['--print', '-'], {
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
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr || 'No error output'}`));
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
