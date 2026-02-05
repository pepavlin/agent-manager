import { describe, it, expect } from 'vitest';
import { sha256, deterministicVector } from '../src/utils/hashing.js';

describe('Hashing Utilities', () => {
  describe('sha256', () => {
    it('should hash a string', () => {
      const result = sha256('hello');
      expect(result).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('should hash a Buffer', () => {
      const result = sha256(Buffer.from('hello'));
      expect(result).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('should return different hashes for different inputs', () => {
      const h1 = sha256('hello');
      const h2 = sha256('world');
      expect(h1).not.toBe(h2);
    });

    it('should return consistent hashes for same input', () => {
      expect(sha256('test')).toBe(sha256('test'));
    });

    it('should handle empty string', () => {
      const result = sha256('');
      expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });
  });

  describe('deterministicVector', () => {
    it('should generate vector with correct dimensions', () => {
      const vector = deterministicVector('test', 384);
      expect(vector).toHaveLength(384);
    });

    it('should generate deterministic output for same input', () => {
      const v1 = deterministicVector('hello', 128);
      const v2 = deterministicVector('hello', 128);
      expect(v1).toEqual(v2);
    });

    it('should generate different vectors for different inputs', () => {
      const v1 = deterministicVector('hello', 128);
      const v2 = deterministicVector('world', 128);
      expect(v1).not.toEqual(v2);
    });

    it('should produce a unit vector (magnitude ~1)', () => {
      const vector = deterministicVector('test', 384);
      const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
      expect(magnitude).toBeCloseTo(1.0, 5);
    });

    it('should have values in [-1, 1] range before normalization', () => {
      const vector = deterministicVector('test', 10);
      for (const v of vector) {
        expect(Math.abs(v)).toBeLessThanOrEqual(1.0);
      }
    });

    it('should handle small dimensions', () => {
      const vector = deterministicVector('test', 1);
      expect(vector).toHaveLength(1);
      expect(Math.abs(vector[0])).toBeCloseTo(1.0, 5);
    });

    it('should handle large dimensions (wrapping)', () => {
      const vector = deterministicVector('test', 1000);
      expect(vector).toHaveLength(1000);
      const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
      expect(magnitude).toBeCloseTo(1.0, 5);
    });
  });
});
