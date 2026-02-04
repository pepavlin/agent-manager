import { createHash } from 'crypto';

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Generate deterministic vectors from text using SHA256.
 * Useful for mock embeddings in tests.
 */
export function deterministicVector(text: string, dims: number): number[] {
  const hash = sha256(text);
  const vector: number[] = [];

  // Use hash bytes to seed pseudo-random values
  for (let i = 0; i < dims; i++) {
    const idx = i % 32;
    const byte = parseInt(hash.slice(idx * 2, idx * 2 + 2), 16);
    // Normalize to [-1, 1] range
    vector.push((byte / 255) * 2 - 1);
  }

  // Normalize to unit vector
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return vector.map((v) => v / magnitude);
}
