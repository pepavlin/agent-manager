import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from '../config.js';
import { createChildLogger } from '../utils/logger.js';
import { getEmbeddingProvider } from '../providers/embeddings/index.js';
import { MemoryPointPayload, MemoryItemType } from '../types/index.js';

const logger = createChildLogger('qdrant');

let client: QdrantClient | null = null;

export function getQdrantClient(): QdrantClient {
  if (client) {
    return client;
  }

  client = new QdrantClient({
    url: config.qdrantUrl,
    apiKey: config.qdrantApiKey || undefined,
  });

  logger.info({ url: config.qdrantUrl }, 'Qdrant client initialized');
  return client;
}

export function getCollectionName(projectId: string): string {
  return `kb_${projectId}`;
}

export async function ensureCollection(projectId: string): Promise<void> {
  const qdrant = getQdrantClient();
  const collectionName = getCollectionName(projectId);
  const embeddingProvider = getEmbeddingProvider();
  const dims = embeddingProvider.dims();

  try {
    const collections = await qdrant.getCollections();
    const exists = collections.collections.some((c) => c.name === collectionName);

    if (!exists) {
      await qdrant.createCollection(collectionName, {
        vectors: {
          size: dims,
          distance: 'Cosine',
        },
      });
      logger.info({ collection: collectionName, dims }, 'Created Qdrant collection');
    }
  } catch (error) {
    logger.error({ error, collection: collectionName }, 'Failed to ensure collection');
    throw error;
  }
}

export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: {
    document_id: string;
    category: string;
    chunk_index: number;
    text: string;
    version: number;
  };
}

export async function upsertPoints(projectId: string, points: QdrantPoint[]): Promise<void> {
  if (points.length === 0) {
    return;
  }

  const qdrant = getQdrantClient();
  const collectionName = getCollectionName(projectId);

  try {
    await qdrant.upsert(collectionName, {
      wait: true,
      points: points.map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload,
      })),
    });
    logger.debug({ collection: collectionName, count: points.length }, 'Upserted points');
  } catch (error) {
    logger.error({ error, collection: collectionName }, 'Failed to upsert points');
    throw error;
  }
}

export interface SearchResult {
  id: string;
  score: number;
  payload: {
    document_id: string;
    category: string;
    chunk_index: number;
    text: string;
    version: number;
  };
}

export async function searchSimilar(
  projectId: string,
  queryVector: number[],
  limit: number = 10,
  filter?: { category?: string[] }
): Promise<SearchResult[]> {
  const qdrant = getQdrantClient();
  const collectionName = getCollectionName(projectId);

  try {
    const filterConditions: { must?: Array<{ key: string; match: { any: string[] } }> } = {};
    if (filter?.category && filter.category.length > 0) {
      filterConditions.must = [
        {
          key: 'category',
          match: { any: filter.category },
        },
      ];
    }

    const results = await qdrant.search(collectionName, {
      vector: queryVector,
      limit,
      with_payload: true,
      filter: filterConditions.must ? filterConditions : undefined,
    });

    return results.map((r) => ({
      id: String(r.id),
      score: r.score,
      payload: r.payload as SearchResult['payload'],
    }));
  } catch (error) {
    logger.error({ error, collection: collectionName }, 'Failed to search');
    throw error;
  }
}

export async function deleteByDocumentId(projectId: string, documentId: string): Promise<void> {
  const qdrant = getQdrantClient();
  const collectionName = getCollectionName(projectId);

  try {
    await qdrant.delete(collectionName, {
      wait: true,
      filter: {
        must: [
          {
            key: 'document_id',
            match: { value: documentId },
          },
        ],
      },
    });
    logger.debug({ collection: collectionName, documentId }, 'Deleted points by document');
  } catch (error) {
    logger.error({ error, collection: collectionName, documentId }, 'Failed to delete points');
    throw error;
  }
}

export async function deleteCollection(projectId: string): Promise<void> {
  const qdrant = getQdrantClient();
  const collectionName = getCollectionName(projectId);

  try {
    await qdrant.deleteCollection(collectionName);
    logger.info({ collection: collectionName }, 'Deleted collection');
  } catch (error) {
    // Collection may not exist
    logger.warn({ error, collection: collectionName }, 'Failed to delete collection');
  }
}

// ==================== Memory Collection Functions ====================

export function getMemoryCollectionName(projectId: string): string {
  return `mem_${projectId}`;
}

export async function ensureMemoryCollection(projectId: string): Promise<void> {
  const qdrant = getQdrantClient();
  const collectionName = getMemoryCollectionName(projectId);
  const embeddingProvider = getEmbeddingProvider();
  const dims = embeddingProvider.dims();

  try {
    const collections = await qdrant.getCollections();
    const exists = collections.collections.some((c) => c.name === collectionName);

    if (!exists) {
      await qdrant.createCollection(collectionName, {
        vectors: {
          size: dims,
          distance: 'Cosine',
        },
      });
      logger.info({ collection: collectionName, dims }, 'Created memory collection');
    }
  } catch (error) {
    logger.error({ error, collection: collectionName }, 'Failed to ensure memory collection');
    throw error;
  }
}

export interface MemoryQdrantPoint {
  id: string;
  vector: number[];
  payload: MemoryPointPayload;
}

export async function upsertMemoryPoints(
  projectId: string,
  points: MemoryQdrantPoint[]
): Promise<void> {
  if (points.length === 0) {
    return;
  }

  const qdrant = getQdrantClient();
  const collectionName = getMemoryCollectionName(projectId);

  try {
    await ensureMemoryCollection(projectId);
    await qdrant.upsert(collectionName, {
      wait: true,
      points: points.map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload,
      })),
    });
    logger.debug({ collection: collectionName, count: points.length }, 'Upserted memory points');
  } catch (error) {
    logger.error({ error, collection: collectionName }, 'Failed to upsert memory points');
    throw error;
  }
}

export interface MemorySearchResult {
  id: string;
  score: number;
  payload: MemoryPointPayload;
}

export interface MemorySearchFilter {
  types?: MemoryItemType[];
  userId?: string;
  excludeExpired?: boolean;
}

export async function searchMemory(
  projectId: string,
  queryVector: number[],
  limit: number = 10,
  filter?: MemorySearchFilter
): Promise<MemorySearchResult[]> {
  const qdrant = getQdrantClient();
  const collectionName = getMemoryCollectionName(projectId);

  try {
    // Check if collection exists
    const collections = await qdrant.getCollections();
    const exists = collections.collections.some((c) => c.name === collectionName);
    if (!exists) {
      return [];
    }

    // Build filter conditions
    const mustConditions: Array<{
      key: string;
      match?: { any?: string[]; value?: string };
      range?: { gt?: string };
    }> = [];

    if (filter?.types && filter.types.length > 0) {
      mustConditions.push({
        key: 'type',
        match: { any: filter.types },
      });
    }

    if (filter?.userId) {
      mustConditions.push({
        key: 'user_id',
        match: { value: filter.userId },
      });
    }

    // NOTE: excludeExpired is handled at the application level (in searchMemoryItems)
    // rather than in Qdrant, because items with expires_at=null (e.g. facts that never expire)
    // would be incorrectly excluded by a range filter.

    const results = await qdrant.search(collectionName, {
      vector: queryVector,
      limit,
      with_payload: true,
      filter: mustConditions.length > 0 ? { must: mustConditions } : undefined,
    });

    return results.map((r) => ({
      id: String(r.id),
      score: r.score,
      payload: r.payload as MemoryPointPayload,
    }));
  } catch (error) {
    logger.error({ error, collection: collectionName }, 'Failed to search memory');
    throw error;
  }
}

export async function deleteMemoryPoint(projectId: string, pointId: string): Promise<void> {
  const qdrant = getQdrantClient();
  const collectionName = getMemoryCollectionName(projectId);

  try {
    await qdrant.delete(collectionName, {
      wait: true,
      points: [pointId],
    });
    logger.debug({ collection: collectionName, pointId }, 'Deleted memory point');
  } catch (error) {
    logger.error({ error, collection: collectionName, pointId }, 'Failed to delete memory point');
    throw error;
  }
}

export async function deleteMemoryCollection(projectId: string): Promise<void> {
  const qdrant = getQdrantClient();
  const collectionName = getMemoryCollectionName(projectId);

  try {
    await qdrant.deleteCollection(collectionName);
    logger.info({ collection: collectionName }, 'Deleted memory collection');
  } catch (error) {
    // Collection may not exist
    logger.warn({ error, collection: collectionName }, 'Failed to delete memory collection');
  }
}
