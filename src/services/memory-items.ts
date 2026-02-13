import { prisma } from '../db/client.js';
import { MemoryItem as PrismaMemoryItem } from '@prisma/client';
import { getEmbeddingProvider } from '../providers/embeddings/index.js';
import {
  upsertMemoryPoints,
  deleteMemoryPoint,
  searchMemory,
  MemoryQdrantPoint,
  MemorySearchResult,
  MemorySearchFilter,
} from './qdrant.js';
import {
  CreateMemoryItemRequest,
  UpdateMemoryItemRequest,
  MemoryItem,
  MemoryItemType,
  MemoryItemStatus,
  MemoryPointPayload,
} from '../types/index.js';
import { createChildLogger } from '../utils/logger.js';
import { randomUUID } from 'crypto';

const logger = createChildLogger('memory-items');

/**
 * Convert Prisma MemoryItem to our interface type
 */
function toMemoryItem(prismaItem: PrismaMemoryItem): MemoryItem {
  return {
    ...prismaItem,
    type: prismaItem.type as MemoryItemType,
    status: prismaItem.status as MemoryItemStatus | null,
    source: prismaItem.source as MemoryItem['source'],
    content: prismaItem.content as Record<string, unknown>,
  };
}

/**
 * Flatten memory item content to text for embedding
 */
function contentToText(title: string, content: Record<string, unknown>): string {
  const contentStr = Object.entries(content)
    .map(([key, value]) => {
      if (typeof value === 'string') {
        return `${key}: ${value}`;
      }
      return `${key}: ${JSON.stringify(value)}`;
    })
    .join('\n');
  return `${title}\n${contentStr}`;
}

/**
 * Create a new memory item with embedding and Qdrant storage
 */
export async function createMemoryItem(
  data: CreateMemoryItemRequest
): Promise<MemoryItem> {
  logger.debug({ projectId: data.projectId, type: data.type, title: data.title }, 'Creating memory item');

  // Generate embedding for the content
  const embeddingProvider = getEmbeddingProvider();
  const contentText = contentToText(data.title, data.content);
  const [vector] = await embeddingProvider.embed([contentText]);

  // Generate point ID for Qdrant
  const qdrantPointId = randomUUID();

  // Calculate expiresAt if expires_in_seconds was provided
  const expiresAt = data.expiresAt || undefined;

  // Create memory item in database
  const memoryItem = await prisma.memoryItem.create({
    data: {
      projectId: data.projectId,
      userId: data.userId || null,
      type: data.type,
      title: data.title,
      content: data.content as object,
      status: data.status || 'proposed',
      source: data.source || 'user_chat',
      confidence: data.confidence ?? 0.5,
      expiresAt: expiresAt,
      supersedesId: data.supersedesId || null,
      tags: data.tags || [],
      qdrantPointId,
    },
  });

  // Build Qdrant point payload
  const payload: MemoryPointPayload = {
    memory_item_id: memoryItem.id,
    type: memoryItem.type as MemoryItemType,
    title: memoryItem.title,
    content_text: contentText,
    status: memoryItem.status,
    created_at: memoryItem.createdAt.toISOString(),
    expires_at: memoryItem.expiresAt?.toISOString() || null,
    user_id: memoryItem.userId,
  };

  // Upsert to Qdrant
  const point: MemoryQdrantPoint = {
    id: qdrantPointId,
    vector,
    payload,
  };
  await upsertMemoryPoints(data.projectId, [point]);

  logger.info(
    { id: memoryItem.id, type: memoryItem.type, status: memoryItem.status },
    'Memory item created'
  );

  return toMemoryItem(memoryItem);
}

/**
 * Update an existing memory item
 */
export async function updateMemoryItem(
  id: string,
  patch: UpdateMemoryItemRequest
): Promise<MemoryItem> {
  logger.debug({ id, patch }, 'Updating memory item');

  // Get existing item
  const existing = await prisma.memoryItem.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new Error(`Memory item not found: ${id}`);
  }

  // Check if content changed (requires re-embedding)
  const contentChanged = patch.content !== undefined || patch.title !== undefined;

  // Build update data
  const updateData: Record<string, unknown> = {};
  if (patch.title !== undefined) updateData.title = patch.title;
  if (patch.content !== undefined) updateData.content = patch.content;
  if (patch.status !== undefined) updateData.status = patch.status;
  if (patch.confidence !== undefined) updateData.confidence = patch.confidence;
  if (patch.expiresAt !== undefined) updateData.expiresAt = patch.expiresAt;
  if (patch.tags !== undefined) updateData.tags = patch.tags;

  // Update in database
  const updated = await prisma.memoryItem.update({
    where: { id },
    data: updateData,
  });

  // Re-embed and update Qdrant if content changed
  if (contentChanged && existing.qdrantPointId) {
    const embeddingProvider = getEmbeddingProvider();
    const title = patch.title || existing.title;
    const content = (patch.content || existing.content) as Record<string, unknown>;
    const contentText = contentToText(title, content);
    const [vector] = await embeddingProvider.embed([contentText]);

    const payload: MemoryPointPayload = {
      memory_item_id: updated.id,
      type: updated.type as MemoryItemType,
      title: updated.title,
      content_text: contentText,
      status: updated.status,
      created_at: updated.createdAt.toISOString(),
      expires_at: updated.expiresAt?.toISOString() || null,
      user_id: updated.userId,
    };

    const point: MemoryQdrantPoint = {
      id: existing.qdrantPointId,
      vector,
      payload,
    };
    await upsertMemoryPoints(existing.projectId, [point]);
  }

  logger.info({ id: updated.id, status: updated.status }, 'Memory item updated');

  return toMemoryItem(updated);
}

/**
 * Get memory items with optional filtering
 */
export interface GetMemoryItemsOptions {
  types?: MemoryItemType[];
  userId?: string;
  statuses?: MemoryItemStatus[];
  excludeExpired?: boolean;
  limit?: number;
  orderBy?: 'createdAt' | 'updatedAt';
  orderDir?: 'asc' | 'desc';
}

export async function getMemoryItems(
  projectId: string,
  options: GetMemoryItemsOptions = {}
): Promise<MemoryItem[]> {
  const {
    types,
    userId,
    statuses,
    excludeExpired = true,
    limit = 50,
    orderBy = 'createdAt',
    orderDir = 'desc',
  } = options;

  const where: Record<string, unknown> = {
    projectId,
  };

  if (types && types.length > 0) {
    where.type = { in: types };
  }

  if (userId) {
    where.userId = userId;
  }

  if (statuses && statuses.length > 0) {
    where.status = { in: statuses };
  }

  if (excludeExpired) {
    where.OR = [
      { expiresAt: null },
      { expiresAt: { gt: new Date() } },
    ];
  }

  const items = await prisma.memoryItem.findMany({
    where,
    orderBy: { [orderBy]: orderDir },
    take: limit,
  });

  return items.map(toMemoryItem);
}

/**
 * Propose a new memory item (creates with status=proposed)
 */
export async function proposeMemoryItem(
  data: Omit<CreateMemoryItemRequest, 'status'>
): Promise<MemoryItem> {
  return createMemoryItem({
    ...data,
    status: 'proposed',
  });
}

/**
 * Accept a proposed memory item
 */
export async function acceptProposal(id: string): Promise<MemoryItem> {
  const item = await prisma.memoryItem.findUnique({
    where: { id },
  });

  if (!item) {
    throw new Error(`Memory item not found: ${id}`);
  }

  if (item.status !== 'proposed') {
    logger.warn({ id, status: item.status }, 'Attempted to accept non-proposed item');
  }

  return updateMemoryItem(id, { status: 'accepted' });
}

/**
 * Reject a proposed memory item
 */
export async function rejectProposal(id: string): Promise<MemoryItem> {
  const item = await prisma.memoryItem.findUnique({
    where: { id },
  });

  if (!item) {
    throw new Error(`Memory item not found: ${id}`);
  }

  return updateMemoryItem(id, { status: 'rejected' });
}

/**
 * Mark a memory item as done (for open_loops)
 */
export async function markDone(id: string): Promise<MemoryItem> {
  return updateMemoryItem(id, { status: 'done' });
}

/**
 * Delete a memory item (removes from both database and Qdrant)
 */
export async function deleteMemoryItem(id: string): Promise<void> {
  const item = await prisma.memoryItem.findUnique({
    where: { id },
  });

  if (!item) {
    throw new Error(`Memory item not found: ${id}`);
  }

  // Delete from Qdrant
  if (item.qdrantPointId) {
    try {
      await deleteMemoryPoint(item.projectId, item.qdrantPointId);
    } catch (error) {
      logger.warn({ error, id, pointId: item.qdrantPointId }, 'Failed to delete Qdrant point');
    }
  }

  // Delete from database
  await prisma.memoryItem.delete({
    where: { id },
  });

  logger.info({ id }, 'Memory item deleted');
}

/**
 * Search memory items semantically
 */
export async function searchMemoryItems(
  projectId: string,
  query: string,
  limit: number = 10,
  filter?: MemorySearchFilter
): Promise<Array<MemoryItem & { score: number }>> {
  // Generate query embedding
  const embeddingProvider = getEmbeddingProvider();
  const [queryVector] = await embeddingProvider.embed([query]);

  // Search in Qdrant
  const results: MemorySearchResult[] = await searchMemory(projectId, queryVector, limit, filter);

  if (results.length === 0) {
    return [];
  }

  // Get full memory items from database (with expiry filtering at DB level)
  const itemIds = results.map((r) => r.payload.memory_item_id);
  const where: Record<string, unknown> = {
    id: { in: itemIds },
  };
  if (filter?.excludeExpired) {
    where.OR = [
      { expiresAt: null },
      { expiresAt: { gt: new Date() } },
    ];
  }
  const items = await prisma.memoryItem.findMany({
    where,
  });

  // Map items with scores
  const itemMap = new Map(items.map((item) => [item.id, toMemoryItem(item)]));
  return results
    .map((r) => {
      const item = itemMap.get(r.payload.memory_item_id);
      if (!item) return null;
      return {
        ...item,
        score: r.score,
      };
    })
    .filter((item): item is MemoryItem & { score: number } => item !== null);
}

/**
 * Get open loops for a project (status != done)
 */
export async function getOpenLoops(
  projectId: string,
  userId?: string,
  limit: number = 10
): Promise<MemoryItem[]> {
  return getMemoryItems(projectId, {
    types: ['open_loop'],
    userId,
    statuses: ['proposed', 'accepted', 'active', 'blocked'],
    limit,
    orderBy: 'createdAt',
    orderDir: 'desc',
  });
}

/**
 * Get recent events for a project
 */
export async function getRecentEvents(
  projectId: string,
  limit: number = 5
): Promise<MemoryItem[]> {
  return getMemoryItems(projectId, {
    types: ['event'],
    statuses: ['accepted'],
    limit,
    orderBy: 'createdAt',
    orderDir: 'desc',
  });
}

/**
 * Get active ideas for a project
 */
export async function getActiveIdeas(
  projectId: string,
  limit: number = 10
): Promise<MemoryItem[]> {
  return getMemoryItems(projectId, {
    types: ['idea'],
    statuses: ['proposed', 'accepted'],
    limit,
    orderBy: 'createdAt',
    orderDir: 'desc',
  });
}

/**
 * Get accepted rules for a project (always-visible in system prompt)
 */
export async function getAcceptedRules(
  projectId: string,
  limit: number = 20
): Promise<MemoryItem[]> {
  return getMemoryItems(projectId, {
    types: ['rule'],
    statuses: ['accepted'],
    limit,
    orderBy: 'createdAt',
    orderDir: 'desc',
  });
}

/**
 * Count all accepted rules for a project (regardless of limit)
 */
export async function countAcceptedRules(projectId: string): Promise<number> {
  return prisma.memoryItem.count({
    where: {
      projectId,
      type: 'rule',
      status: 'accepted',
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
  });
}

/**
 * Purge expired memory items from both Postgres and Qdrant.
 * Returns the number of items purged.
 */
export async function purgeExpiredItems(projectId: string): Promise<number> {
  const expired = await prisma.memoryItem.findMany({
    where: {
      projectId,
      expiresAt: { lt: new Date() },
    },
    select: { id: true, qdrantPointId: true },
  });

  if (expired.length === 0) return 0;

  // Delete from Qdrant first (best-effort)
  for (const item of expired) {
    if (item.qdrantPointId) {
      try {
        await deleteMemoryPoint(projectId, item.qdrantPointId);
      } catch (err) {
        logger.warn({ err, id: item.id, pointId: item.qdrantPointId }, 'Failed to delete expired Qdrant point');
      }
    }
  }

  // Delete from Postgres
  const result = await prisma.memoryItem.deleteMany({
    where: {
      id: { in: expired.map((e) => e.id) },
    },
  });

  logger.info({ projectId, purged: result.count }, 'Purged expired memory items');
  return result.count;
}

/**
 * Create event memory item (auto-approved)
 */
export async function createEvent(
  projectId: string,
  title: string,
  content: Record<string, unknown>,
  options?: {
    userId?: string;
    source?: 'user_chat' | 'doc_upload' | 'tool_result' | 'cron' | 'system';
    tags?: string[];
  }
): Promise<MemoryItem> {
  return createMemoryItem({
    projectId,
    userId: options?.userId,
    type: 'event',
    title,
    content,
    status: 'accepted', // Events are auto-approved
    source: options?.source || 'system',
    confidence: 1.0,
    tags: options?.tags || [],
  });
}

/**
 * Create metric memory item (auto-approved with TTL)
 */
export async function createMetric(
  projectId: string,
  title: string,
  content: Record<string, unknown>,
  expiresInSeconds: number,
  options?: {
    userId?: string;
    tags?: string[];
  }
): Promise<MemoryItem> {
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

  return createMemoryItem({
    projectId,
    userId: options?.userId,
    type: 'metric',
    title,
    content,
    status: 'accepted', // Metrics with TTL are auto-approved
    source: 'system',
    confidence: 1.0,
    expiresAt,
    tags: options?.tags || [],
  });
}
