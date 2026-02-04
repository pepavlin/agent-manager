import { config } from '../../config.js';
import { createChildLogger } from '../../utils/logger.js';
import { IEmbeddingProvider } from './IEmbeddingProvider.js';
import { OpenAIEmbeddingProvider } from './openai.js';
import { OllamaEmbeddingProvider } from './ollama.js';
import { MockEmbeddingProvider } from './mock.js';

const logger = createChildLogger('embedding-provider');

let instance: IEmbeddingProvider | null = null;

export function getEmbeddingProvider(): IEmbeddingProvider {
  if (instance) {
    return instance;
  }

  const provider = config.embeddingProvider;
  logger.info({ provider }, 'Initializing embedding provider');

  switch (provider) {
    case 'openai':
      instance = new OpenAIEmbeddingProvider();
      break;
    case 'ollama':
      instance = new OllamaEmbeddingProvider();
      break;
    case 'mock':
      instance = new MockEmbeddingProvider();
      break;
    default:
      throw new Error(`Unknown embedding provider: ${provider}`);
  }

  return instance;
}

export type { IEmbeddingProvider } from './IEmbeddingProvider.js';
