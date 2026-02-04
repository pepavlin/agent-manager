import { IChatProvider } from './IChatProvider.js';
import { config } from '../../config.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('anthropic-chat');

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
  stop_reason: string;
}

export class AnthropicChatProvider implements IChatProvider {
  readonly name = 'anthropic';
  private apiKey: string;
  private model: string;
  private baseUrl = 'https://api.anthropic.com/v1/messages';

  constructor() {
    if (!config.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for Anthropic chat provider');
    }
    this.apiKey = config.anthropicApiKey;
    this.model = config.anthropicModel;
    logger.info({ model: this.model }, 'Anthropic chat provider initialized');
  }

  async generateJSON(input: { system: string; user: string }): Promise<string> {
    logger.debug({ systemLength: input.system.length, userLength: input.user.length }, 'Generating JSON');

    const messages: AnthropicMessage[] = [{ role: 'user', content: input.user }];

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2000,
        system: input.system,
        messages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'Anthropic API error');
      throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as AnthropicResponse;
    const content = data.content.find((c) => c.type === 'text')?.text;

    if (!content) {
      throw new Error('Empty response from Anthropic');
    }

    logger.debug({ responseLength: content.length }, 'Generated response');
    return content;
  }
}
