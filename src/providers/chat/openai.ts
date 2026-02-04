import OpenAI from 'openai';
import { IChatProvider } from './IChatProvider.js';
import { config } from '../../config.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('openai-chat');

export class OpenAIChatProvider implements IChatProvider {
  readonly name = 'openai';
  private client: OpenAI;
  private model: string;

  constructor() {
    if (!config.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is required for OpenAI chat provider');
    }
    this.client = new OpenAI({ apiKey: config.openaiApiKey });
    this.model = config.openaiChatModel;
    logger.info({ model: this.model }, 'OpenAI chat provider initialized');
  }

  async generateJSON(input: { system: string; user: string }): Promise<string> {
    logger.debug({ systemLength: input.system.length, userLength: input.user.length }, 'Generating JSON');

    const response = await this.client.chat.completions.create({
      model: this.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      temperature: 0.2,
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    logger.debug({ responseLength: content.length }, 'Generated response');
    return content;
  }
}
