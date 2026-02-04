import { randomUUID } from 'crypto';
import { prisma } from '../db/client.js';
import { storeFile, readStoredFile } from '../utils/storage.js';
import { chunkText, extractText } from '../utils/chunking.js';
import { getEmbeddingProvider } from '../providers/embeddings/index.js';
import { ensureCollection, upsertPoints, deleteByDocumentId, QdrantPoint } from './qdrant.js';
import { DocumentCategory } from '../types/index.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('docs');

export interface DocumentUploadResult {
  id: string;
  projectId: string;
  category: DocumentCategory;
  filename: string;
  chunksCount: number;
  status: 'indexed' | 'pending' | 'failed';
  error?: string;
}

export async function uploadDocument(
  projectId: string,
  category: DocumentCategory,
  filename: string,
  content: Buffer,
  mime: string
): Promise<DocumentUploadResult> {
  logger.info({ projectId, category, filename, size: content.length }, 'Uploading document');

  // Store file
  const stored = await storeFile(projectId, filename, content);

  // Create document record
  const document = await prisma.document.create({
    data: {
      projectId,
      category,
      filename,
      mime,
      sha256: stored.sha256,
      storagePath: stored.path,
      version: 1,
    },
  });

  // Extract text and index
  try {
    const text = await extractText(content, mime);
    await indexDocument(projectId, document.id, category, text, 1);

    logger.info({ documentId: document.id, filename }, 'Document indexed successfully');

    const chunksCount = await prisma.kbChunk.count({
      where: { documentId: document.id },
    });

    return {
      id: document.id,
      projectId,
      category,
      filename,
      chunksCount,
      status: 'indexed',
    };
  } catch (error) {
    logger.error({ error, documentId: document.id }, 'Failed to index document');

    return {
      id: document.id,
      projectId,
      category,
      filename,
      chunksCount: 0,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function indexDocument(
  projectId: string,
  documentId: string,
  category: DocumentCategory,
  text: string,
  version: number
): Promise<void> {
  logger.debug({ documentId, textLength: text.length }, 'Indexing document');

  // Ensure Qdrant collection exists
  await ensureCollection(projectId);

  // Chunk the text
  const chunks = chunkText(text);

  if (chunks.length === 0) {
    logger.warn({ documentId }, 'No chunks generated from document');
    return;
  }

  // Generate embeddings
  const embeddingProvider = getEmbeddingProvider();
  const vectors = await embeddingProvider.embed(chunks.map((c) => c.text));

  // Prepare points for Qdrant
  const points: QdrantPoint[] = chunks.map((chunk, i) => ({
    id: randomUUID(),
    vector: vectors[i],
    payload: {
      document_id: documentId,
      category,
      chunk_index: chunk.index,
      text: chunk.text,
      version,
    },
  }));

  // Delete old chunks for this document (if updating)
  await deleteByDocumentId(projectId, documentId);
  await prisma.kbChunk.deleteMany({ where: { documentId } });

  // Upsert to Qdrant
  await upsertPoints(projectId, points);

  // Store chunks in Postgres
  await prisma.kbChunk.createMany({
    data: points.map((p, i) => ({
      projectId,
      documentId,
      chunkIndex: i,
      text: chunks[i].text,
      qdrantPointId: p.id,
    })),
  });

  logger.info({ documentId, chunksCount: chunks.length }, 'Document indexed');
}

export async function getDocumentText(documentId: string): Promise<string | null> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!document) {
    return null;
  }

  const content = await readStoredFile(document.storagePath);
  return extractText(content, document.mime);
}

export async function getDocumentsByProject(
  projectId: string,
  category?: DocumentCategory
): Promise<Array<{ id: string; category: string; filename: string; createdAt: Date }>> {
  const where: { projectId: string; category?: DocumentCategory } = { projectId };
  if (category) {
    where.category = category;
  }

  return prisma.document.findMany({
    where,
    select: {
      id: true,
      category: true,
      filename: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}
