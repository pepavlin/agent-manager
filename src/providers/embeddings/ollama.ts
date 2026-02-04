import { IEmbeddingProvider } from './IEmbeddingProvider.js';
import { config } from '../../config.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('ollama-embeddings');

interface OllamaEmbeddingResponse {
  embedding: number[];
}

export class OllamaEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'ollama';
  private baseUrl: string;
  private model: string;
  private dimensions: number;

  constructor() {
    this.baseUrl = config.ollamaBaseUrl;
    this.model = config.ollamaEmbeddingModel;
    this.dimensions = config.embeddingDims;
    logger.info({ baseUrl: this.baseUrl, model: this.model, dims: this.dimensions }, 'Ollama embedding provider initialized');
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    logger.debug({ count: texts.length }, 'Generating embeddings');

    const vectors: number[][] = [];

    // Ollama API embeds one at a time
    for (const text of texts) {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          prompt: text,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, error: errorText }, 'Ollama API error');
        throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as OllamaEmbeddingResponse;
      vectors.push(data.embedding);
    }

    logger.debug({ count: vectors.length, dims: vectors[0]?.length }, 'Generated embeddings');
    return vectors;
  }

  dims(): number {
    return this.dimensions;
  }
}
