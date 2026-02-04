import { describe, it, expect } from 'vitest';
import { chunkText } from '../src/utils/chunking.js';

describe('chunkText', () => {
  it('should return empty array for empty text', () => {
    const chunks = chunkText('');
    expect(chunks).toEqual([]);
  });

  it('should return empty array for whitespace-only text', () => {
    const chunks = chunkText('   \n\n   ');
    expect(chunks).toEqual([]);
  });

  it('should chunk simple text', () => {
    const text = 'This is a simple test text that should be chunked.';
    const chunks = chunkText(text);

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].text).toContain('simple test');
    expect(chunks[0].index).toBe(0);
  });

  it('should preserve markdown headers', () => {
    const text = `# Header 1

This is content under header 1.

## Header 2

This is content under header 2.`;

    const chunks = chunkText(text);

    expect(chunks.length).toBeGreaterThan(0);
    // At least one chunk should contain a header
    const hasHeader = chunks.some(
      (c) => c.text.includes('# Header 1') || c.text.includes('## Header 2')
    );
    expect(hasHeader).toBe(true);
  });

  it('should respect target token size', () => {
    // Generate long text
    const longParagraph = 'This is a test sentence. '.repeat(200);
    const chunks = chunkText(longParagraph, { targetTokens: 100 });

    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should be roughly within target size (with generous tolerance for overlap)
    chunks.forEach((chunk) => {
      // Rough token estimate: chars / 4
      const estimatedTokens = chunk.text.length / 4;
      expect(estimatedTokens).toBeLessThan(300); // Allow some overshoot due to chunking logic
    });
  });

  it('should handle overlap correctly', () => {
    const text = 'Sentence one. Sentence two. Sentence three. Sentence four. '.repeat(20);
    const chunks = chunkText(text, { targetTokens: 50, overlapTokens: 10 });

    if (chunks.length >= 2) {
      // Check that consecutive chunks have some overlap
      // This is a heuristic check - chunks should share some content
      const chunk1End = chunks[0].text.slice(-50);
      const chunk2Start = chunks[1].text.slice(0, 100);

      // At least some words should appear in both
      const words1 = chunk1End.split(/\s+/);
      const words2 = chunk2Start.split(/\s+/);
      const commonWords = words1.filter((w) => words2.includes(w));
      expect(commonWords.length).toBeGreaterThan(0);
    }
  });

  it('should handle text with multiple paragraphs', () => {
    const text = `First paragraph with some content.

Second paragraph with different content.

Third paragraph with more content.`;

    const chunks = chunkText(text);

    expect(chunks.length).toBeGreaterThan(0);
    const allText = chunks.map((c) => c.text).join(' ');
    expect(allText).toContain('First paragraph');
    expect(allText).toContain('Second paragraph');
    expect(allText).toContain('Third paragraph');
  });

  it('should have correct chunk indices', () => {
    const text = 'Some text. '.repeat(100);
    const chunks = chunkText(text, { targetTokens: 50 });

    chunks.forEach((chunk, i) => {
      expect(chunk.index).toBe(i);
    });
  });

  it('should have valid start and end offsets', () => {
    const text = 'Hello world. This is a test. More content here.';
    const chunks = chunkText(text);

    chunks.forEach((chunk) => {
      expect(chunk.startOffset).toBeGreaterThanOrEqual(0);
      expect(chunk.endOffset).toBeGreaterThan(chunk.startOffset);
    });
  });

  it('should handle large documents efficiently', () => {
    // Generate a large document
    const largeParagraph = 'This is a paragraph with meaningful content. '.repeat(50);
    const largeDoc = Array(20)
      .fill(0)
      .map((_, i) => `## Section ${i}\n\n${largeParagraph}`)
      .join('\n\n');

    const startTime = Date.now();
    const chunks = chunkText(largeDoc);
    const duration = Date.now() - startTime;

    expect(chunks.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(1000); // Should complete within 1 second
  });

  it('should not create chunks smaller than minChunkTokens', () => {
    const text = 'Short text that is small.';
    const chunks = chunkText(text, { minChunkTokens: 3 });

    // Even small text should produce at least one chunk if it meets minimum
    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toBe(text);
  });
});
