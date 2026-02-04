import { createChildLogger } from './logger.js';

const logger = createChildLogger('chunking');

export interface ChunkOptions {
  targetTokens?: number;
  overlapTokens?: number;
  minChunkTokens?: number;
}

export interface Chunk {
  index: number;
  text: string;
  startOffset: number;
  endOffset: number;
}

const DEFAULT_OPTIONS: Required<ChunkOptions> = {
  targetTokens: 800,
  overlapTokens: 100,
  minChunkTokens: 50,
};

// Approximate tokens (roughly 4 chars per token for English)
// Export for potential future use
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function charsForTokens(tokens: number): number {
  return tokens * 4;
}

/**
 * Markdown-aware text splitter.
 * Tries to split at natural boundaries (headers, paragraphs, sentences).
 */
export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const chunks: Chunk[] = [];

  if (!text.trim()) {
    return [];
  }

  const targetChars = charsForTokens(opts.targetTokens);
  const overlapChars = charsForTokens(opts.overlapTokens);
  const minChunkChars = charsForTokens(opts.minChunkTokens);

  // Split into sections by markdown headers
  const sections = splitByHeaders(text);

  let currentChunk = '';
  let chunkStartOffset = 0;
  let currentOffset = 0;

  for (const section of sections) {
    const sectionText = section.text;

    // If adding this section would exceed target and we have content, finalize current chunk
    if (currentChunk.length > 0 && currentChunk.length + sectionText.length > targetChars) {
      // If current chunk is big enough, save it
      if (currentChunk.length >= minChunkChars) {
        chunks.push({
          index: chunks.length,
          text: currentChunk.trim(),
          startOffset: chunkStartOffset,
          endOffset: currentOffset,
        });

        // Start new chunk with overlap
        const overlapStart = Math.max(0, currentChunk.length - overlapChars);
        currentChunk = currentChunk.slice(overlapStart);
        chunkStartOffset = currentOffset - currentChunk.length;
      }
    }

    // If section itself is too large, split it further
    if (sectionText.length > targetChars) {
      const subChunks = splitLargeSection(sectionText, targetChars, overlapChars, minChunkChars);
      for (const sub of subChunks) {
        if (currentChunk.length > 0 && currentChunk.length + sub.length > targetChars) {
          if (currentChunk.length >= minChunkChars) {
            chunks.push({
              index: chunks.length,
              text: currentChunk.trim(),
              startOffset: chunkStartOffset,
              endOffset: currentOffset,
            });
            const overlapStart = Math.max(0, currentChunk.length - overlapChars);
            currentChunk = currentChunk.slice(overlapStart);
            chunkStartOffset = currentOffset - currentChunk.length;
          }
        }
        currentChunk += sub;
        currentOffset += sub.length;
      }
    } else {
      currentChunk += sectionText;
      currentOffset += sectionText.length;
    }
  }

  // Save final chunk
  if (currentChunk.trim().length >= minChunkChars) {
    chunks.push({
      index: chunks.length,
      text: currentChunk.trim(),
      startOffset: chunkStartOffset,
      endOffset: currentOffset,
    });
  } else if (currentChunk.trim().length > 0 && chunks.length > 0) {
    // Append small remainder to last chunk
    const last = chunks[chunks.length - 1];
    last.text += '\n' + currentChunk.trim();
    last.endOffset = currentOffset;
  } else if (currentChunk.trim().length > 0) {
    // Only chunk, even if small
    chunks.push({
      index: 0,
      text: currentChunk.trim(),
      startOffset: chunkStartOffset,
      endOffset: currentOffset,
    });
  }

  logger.debug(`Created ${chunks.length} chunks from ${text.length} chars`);
  return chunks;
}

interface Section {
  text: string;
  level: number;
}

function splitByHeaders(text: string): Section[] {
  const sections: Section[] = [];
  const lines = text.split('\n');
  let currentSection = '';
  let currentLevel = 0;

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,6})\s+/);
    if (headerMatch) {
      if (currentSection.trim()) {
        sections.push({ text: currentSection, level: currentLevel });
      }
      currentSection = line + '\n';
      currentLevel = headerMatch[1].length;
    } else {
      currentSection += line + '\n';
    }
  }

  if (currentSection.trim()) {
    sections.push({ text: currentSection, level: currentLevel });
  }

  return sections;
}

function splitLargeSection(
  text: string,
  targetChars: number,
  overlapChars: number,
  minChunkChars: number
): string[] {
  const subChunks: string[] = [];

  // Try splitting by paragraphs first
  const paragraphs = text.split(/\n\n+/);
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > targetChars && current.length >= minChunkChars) {
      subChunks.push(current);
      const overlapStart = Math.max(0, current.length - overlapChars);
      current = current.slice(overlapStart) + '\n\n' + para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }

  if (current.trim()) {
    // If still too large, split by sentences
    if (current.length > targetChars * 1.5) {
      const sentences = splitBySentences(current, targetChars, overlapChars);
      subChunks.push(...sentences);
    } else {
      subChunks.push(current);
    }
  }

  return subChunks;
}

function splitBySentences(text: string, targetChars: number, overlapChars: number): string[] {
  const chunks: string[] = [];
  // Simple sentence split (handles ., !, ?)
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g) || [text];
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length > targetChars && current.length > 0) {
      chunks.push(current.trim());
      const overlapStart = Math.max(0, current.length - overlapChars);
      current = current.slice(overlapStart) + sentence;
    } else {
      current += sentence;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

/**
 * Extract text from PDF buffer.
 * Falls back gracefully if pdf-parse fails.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    // Dynamic import to handle missing dependency
    const pdfParse = await import('pdf-parse');
    const data = await pdfParse.default(buffer);
    return data.text;
  } catch (error) {
    logger.error({ error }, 'Failed to extract PDF text');
    throw new Error('PDF extraction failed. Ensure pdf-parse is installed.');
  }
}

/**
 * Get file content as text based on mime type.
 */
export async function extractText(buffer: Buffer, mime: string): Promise<string> {
  if (mime === 'application/pdf') {
    return extractPdfText(buffer);
  }

  // For text/plain, text/markdown, etc.
  if (mime.startsWith('text/')) {
    return buffer.toString('utf-8');
  }

  // Default: try as text
  return buffer.toString('utf-8');
}
