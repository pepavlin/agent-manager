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

// ── Memory v2: Default TTLs per type (in seconds) ──
// Volatile types get automatic expiry to prevent memory bloat and negativity bias.
// Permanent types (fact, rule, decision, open_loop) have no default TTL.
const DEFAULT_TTL_SECONDS: Partial<Record<MemoryItemType, number>> = {
  event: 7 * 24 * 3600,       // 7 days
  finding: 30 * 24 * 3600,    // 30 days
  lesson: 90 * 24 * 3600,     // 90 days
  idea: 30 * 24 * 3600,       // 30 days
  metric: 24 * 3600,          // 1 day (fallback, usually set explicitly)
};

// Memory v2: Type weights for retrieval scoring
export const MEMORY_TYPE_WEIGHTS: Record<MemoryItemType, number> = {
  rule: 1.0,
  decision: 0.9,
  fact: 0.85,
  open_loop: 0.8,
  impl_task: 0.8,
  finding: 0.75,
  preference: 0.7,
  lesson: 0.7,
  idea: 0.6,
  event: 0.5,
  metric: 0.4,
};

// Memory v2: Max age for recency decay (per type, in days)
const MAX_AGE_DAYS: Partial<Record<MemoryItemType, number>> = {
  event: 7,
  finding: 30,
  lesson: 90,
  idea: 30,
  metric: 1,
  // Permanent types default to 365
};

const DEFAULT_MAX_AGE_DAYS = 365;

// Memory v2: Similarity threshold for duplicate detection in write gate
const DUPLICATE_SIMILARITY_THRESHOLD = 0.85;

/**
 * Calculate composite retrieval score for a memory item.
 * score = semantic_similarity × recency_factor × type_weight × confidence
 */
export function calculateCompositeScore(
  semanticScore: number,
  item: { type: MemoryItemType; confidence: number; createdAt: Date }
): number {
  const ageDays = (Date.now() - item.createdAt.getTime()) / (1000 * 3600 * 24);
  const maxAge = MAX_AGE_DAYS[item.type] ?? DEFAULT_MAX_AGE_DAYS;
  const recencyFactor = Math.max(0.3, 1 - ageDays / maxAge);
  const typeWeight = MEMORY_TYPE_WEIGHTS[item.type] ?? 0.5;
  const confidence = item.confidence ?? 0.5;

  return semanticScore * recencyFactor * typeWeight * confidence;
}

/**
 * Apply default TTL to a memory item if no explicit expiresAt is set.
 */
function applyDefaultTTL(type: MemoryItemType, expiresAt?: Date): Date | undefined {
  if (expiresAt) return expiresAt;
  const ttlSeconds = DEFAULT_TTL_SECONDS[type];
  if (ttlSeconds) {
    return new Date(Date.now() + ttlSeconds * 1000);
  }
  return undefined;
}

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
 * Memory v2 Write Gate: Check for duplicate/similar items before storing.
 * Returns the existing item if a duplicate is found (score > threshold), null otherwise.
 */
export async function findDuplicate(
  projectId: string,
  type: MemoryItemType,
  queryVector: number[]
): Promise<(MemoryItem & { score: number }) | null> {
  try {
    const results: MemorySearchResult[] = await searchMemory(
      projectId,
      queryVector,
      3,
      { types: [type] }
    );

    if (results.length === 0) return null;

    // Check top result against threshold
    const topResult = results[0];
    if (topResult.score >= DUPLICATE_SIMILARITY_THRESHOLD) {
      // Fetch full item from DB
      const existing = await prisma.memoryItem.findUnique({
        where: { id: topResult.payload.memory_item_id },
      });
      if (existing) {
        logger.info(
          { existingId: existing.id, score: topResult.score, type },
          'Write gate: duplicate detected'
        );
        return { ...toMemoryItem(existing), score: topResult.score };
      }
    }

    return null;
  } catch (err) {
    logger.warn({ err }, 'Write gate: duplicate check failed, proceeding with create');
    return null;
  }
}

/**
 * Create a new memory item with embedding and Qdrant storage.
 * Memory v2: Applies write gate (duplicate detection) and auto-TTL.
 */
export async function createMemoryItem(
  data: CreateMemoryItemRequest
): Promise<MemoryItem> {
  logger.debug({ projectId: data.projectId, type: data.type, title: data.title }, 'Creating memory item');

  // Generate embedding for the content
  const embeddingProvider = getEmbeddingProvider();
  const contentText = contentToText(data.title, data.content);
  const [vector] = await embeddingProvider.embed([contentText]);

  // ── Memory v2 Write Gate: duplicate detection ──
  // Skip for events (append-only log) and metrics (time-series)
  if (data.type !== 'event' && data.type !== 'metric') {
    const duplicate = await findDuplicate(data.projectId, data.type, vector);
    if (duplicate) {
      // Update existing item instead of creating duplicate
      logger.info(
        { existingId: duplicate.id, type: data.type, score: duplicate.score },
        'Write gate: updating existing item instead of creating duplicate'
      );
      const mergedContent = { ...duplicate.content as Record<string, unknown>, ...data.content };
      return updateMemoryItem(duplicate.id, {
        title: data.title,
        content: mergedContent,
        confidence: Math.max(duplicate.confidence, data.confidence ?? 0.5),
        ...(data.tags && data.tags.length > 0 && {
          tags: [...new Set([...duplicate.tags, ...data.tags])],
        }),
      });
    }
  }

  // Generate point ID for Qdrant
  const qdrantPointId = randomUUID();

  // ── Memory v2: Apply default TTL ──
  const expiresAt = applyDefaultTTL(data.type, data.expiresAt || undefined);

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

  // Map items with composite scores (Memory v2)
  const itemMap = new Map(items.map((item) => [item.id, toMemoryItem(item)]));
  const scored = results
    .map((r) => {
      const item = itemMap.get(r.payload.memory_item_id);
      if (!item) return null;
      const compositeScore = calculateCompositeScore(r.score, item);
      return {
        ...item,
        score: compositeScore,
        rawScore: r.score,
      };
    })
    .filter((item): item is MemoryItem & { score: number; rawScore: number } => item !== null);

  // Re-sort by composite score (descending)
  scored.sort((a, b) => b.score - a.score);
  return scored;
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
 * Get recent findings for a project (not yet resolved)
 */
export async function getRecentFindings(
  projectId: string,
  limit: number = 10
): Promise<MemoryItem[]> {
  return getMemoryItems(projectId, {
    types: ['finding'],
    statuses: ['proposed', 'accepted', 'active'],
    limit,
    orderBy: 'createdAt',
    orderDir: 'desc',
  });
}

/**
 * Get pending implementation tasks for a project
 */
export async function getPendingTasks(
  projectId: string,
  limit: number = 10
): Promise<MemoryItem[]> {
  return getMemoryItems(projectId, {
    types: ['impl_task'],
    statuses: ['proposed', 'accepted', 'active'],
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
