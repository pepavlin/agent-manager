/**
 * Interface for embedding providers.
 * All providers must implement this interface to be interchangeable.
 */
export interface IEmbeddingProvider {
  /**
   * Generate embeddings for an array of texts.
   * @param texts - Array of text strings to embed
   * @returns Array of embedding vectors
   */
  embed(texts: string[]): Promise<number[][]>;

  /**
   * Get the dimension of embedding vectors.
   */
  dims(): number;

  /**
   * Provider name for logging/debugging
   */
  readonly name: string;
}
