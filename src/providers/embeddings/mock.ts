import { IEmbeddingProvider } from './IEmbeddingProvider.js';
import { deterministicVector } from '../../utils/hashing.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('mock-embeddings');

const MOCK_DIMS = 384;

export class MockEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'mock';
  private dimensions: number;

  constructor(dims: number = MOCK_DIMS) {
    this.dimensions = dims;
    logger.info({ dims: this.dimensions }, 'Mock embedding provider initialized');
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    logger.debug({ count: texts.length }, 'Generating mock embeddings');

    // Generate deterministic vectors based on text content
    const vectors = texts.map((text) => deterministicVector(text, this.dimensions));

    return vectors;
  }

  dims(): number {
    return this.dimensions;
  }
}
