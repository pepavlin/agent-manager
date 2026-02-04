import { config } from '../../config.js';
import { createChildLogger } from '../../utils/logger.js';
import { IChatProvider } from './IChatProvider.js';
import { OpenAIChatProvider } from './openai.js';
import { AnthropicChatProvider } from './anthropic.js';
import { ClaudeCliChatProvider } from './claude-cli.js';

const logger = createChildLogger('chat-provider');

let instance: IChatProvider | null = null;

export function getChatProvider(): IChatProvider {
  if (instance) {
    return instance;
  }

  const provider = config.chatProvider;
  logger.info({ provider }, 'Initializing chat provider');

  switch (provider) {
    case 'openai':
      instance = new OpenAIChatProvider();
      break;
    case 'anthropic':
      instance = new AnthropicChatProvider();
      break;
    case 'claude_cli':
      instance = new ClaudeCliChatProvider();
      break;
    default:
      throw new Error(`Unknown chat provider: ${provider}`);
  }

  return instance;
}

export type { IChatProvider } from './IChatProvider.js';
