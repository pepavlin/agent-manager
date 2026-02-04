import OpenAI from 'openai';
import { IEmbeddingProvider } from './IEmbeddingProvider.js';
import { config } from '../../config.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('openai-embeddings');

export class OpenAIEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'openai';
  private client: OpenAI;
  private model: string;
  private dimensions: number;

  constructor() {
    if (!config.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is required for OpenAI embedding provider');
    }
    this.client = new OpenAI({ apiKey: config.openaiApiKey });
    this.model = config.openaiEmbeddingModel;
    this.dimensions = config.embeddingDims;
    logger.info({ model: this.model, dims: this.dimensions }, 'OpenAI embedding provider initialized');
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    logger.debug({ count: texts.length }, 'Generating embeddings');

    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
    });

    const vectors = response.data.map((d) => d.embedding);
    logger.debug({ count: vectors.length, dims: vectors[0]?.length }, 'Generated embeddings');

    return vectors;
  }

  dims(): number {
    return this.dimensions;
  }
}
