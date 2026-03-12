import { prisma } from '../db/client.js';
import { getEmbeddingProvider } from '../providers/embeddings/index.js';
import { searchMemory, MemorySearchResult } from './qdrant.js';
import {
  updateMemoryItem,
  deleteMemoryItem,
  purgeExpiredItems,
} from './memory-items.js';
import { MemoryItemType } from '../types/index.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('memory-consolidation');

// Threshold for considering two items as similar enough to consolidate
const CONSOLIDATION_SIMILARITY_THRESHOLD = 0.80;

// Max items to process per consolidation run
const MAX_ITEMS_PER_RUN = 100;

export interface ConsolidationResult {
  projectId: string;
  purgedExpired: number;
  mergedDuplicates: number;
  archivedStale: number;
  totalProcessed: number;
}

/**
 * Memory v2 Consolidation Service.
 *
 * Performs periodic memory hygiene:
 * 1. Purge expired items (TTL-based)
 * 2. Merge near-duplicate items (semantic similarity)
 * 3. Archive stale open_loops
 */
export async function consolidateMemory(projectId: string): Promise<ConsolidationResult> {
  logger.info({ projectId }, 'Starting memory consolidation');

  const result: ConsolidationResult = {
    projectId,
    purgedExpired: 0,
    mergedDuplicates: 0,
    archivedStale: 0,
    totalProcessed: 0,
  };

  // Step 1: Purge expired items
  result.purgedExpired = await purgeExpiredItems(projectId);
  logger.info({ projectId, purged: result.purgedExpired }, 'Purged expired items');

  // Step 2: Find and merge near-duplicate items
  result.mergedDuplicates = await mergeDuplicates(projectId);
  logger.info({ projectId, merged: result.mergedDuplicates }, 'Merged duplicate items');

  // Step 3: Archive stale open_loops (older than 30 days, untouched)
  result.archivedStale = await archiveStaleOpenLoops(projectId);
  logger.info({ projectId, archived: result.archivedStale }, 'Archived stale open loops');

  result.totalProcessed = result.purgedExpired + result.mergedDuplicates + result.archivedStale;

  logger.info({ projectId, result }, 'Memory consolidation completed');
  return result;
}

/**
 * Find and merge near-duplicate memory items within the same type.
 * Keeps the newer item and merges content from the older one.
 */
async function mergeDuplicates(projectId: string): Promise<number> {
  let mergedCount = 0;
  const processedIds = new Set<string>();

  // Types where duplicates are problematic
  const typesToCheck: MemoryItemType[] = ['fact', 'decision', 'lesson', 'rule', 'preference'];

  for (const type of typesToCheck) {
    const items = await prisma.memoryItem.findMany({
      where: {
        projectId,
        type,
        status: { in: ['accepted', 'proposed', 'active'] },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_ITEMS_PER_RUN,
    });

    if (items.length < 2) continue;

    const embeddingProvider = getEmbeddingProvider();

    for (const item of items) {
      if (processedIds.has(item.id)) continue;

      // Generate embedding for this item
      const contentText = `${item.title}\n${JSON.stringify(item.content)}`;
      let vector: number[];
      try {
        [vector] = await embeddingProvider.embed([contentText]);
      } catch {
        continue;
      }

      // Search for similar items of the same type
      let results: MemorySearchResult[];
      try {
        results = await searchMemory(projectId, vector, 5, {
          types: [type],
        });
      } catch {
        continue;
      }

      // Find duplicates (excluding self)
      for (const r of results) {
        if (r.payload.memory_item_id === item.id) continue;
        if (processedIds.has(r.payload.memory_item_id)) continue;
        if (r.score < CONSOLIDATION_SIMILARITY_THRESHOLD) continue;

        // Merge: keep the newer item (current), delete the older duplicate
        const duplicate = await prisma.memoryItem.findUnique({
          where: { id: r.payload.memory_item_id },
        });

        if (!duplicate) continue;

        // Merge content from duplicate into current item
        const currentContent = item.content as Record<string, unknown>;
        const dupContent = duplicate.content as Record<string, unknown>;
        const mergedContent = { ...dupContent, ...currentContent };

        // Merge tags
        const mergedTags = [...new Set([...item.tags, ...duplicate.tags])];

        // Update current item with merged content
        try {
          await updateMemoryItem(item.id, {
            content: mergedContent,
            tags: mergedTags,
            confidence: Math.max(item.confidence, duplicate.confidence),
          });

          // Delete the duplicate
          await deleteMemoryItem(duplicate.id);
          processedIds.add(duplicate.id);
          mergedCount++;

          logger.debug(
            { keptId: item.id, deletedId: duplicate.id, score: r.score, type },
            'Merged duplicate memory items'
          );
        } catch (err) {
          logger.warn({ err, itemId: item.id, dupId: duplicate.id }, 'Failed to merge duplicate');
        }
      }

      processedIds.add(item.id);
    }
  }

  return mergedCount;
}

/**
 * Archive stale open_loops that haven't been updated in 30+ days.
 * Marks them as 'done' with a note about auto-archival.
 */
async function archiveStaleOpenLoops(projectId: string): Promise<number> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  const staleLoops = await prisma.memoryItem.findMany({
    where: {
      projectId,
      type: 'open_loop',
      status: { in: ['proposed', 'accepted', 'active'] },
      updatedAt: { lt: thirtyDaysAgo },
    },
    take: 50,
  });

  let archivedCount = 0;
  for (const loop of staleLoops) {
    try {
      const content = loop.content as Record<string, unknown>;
      await updateMemoryItem(loop.id, {
        status: 'done',
        content: {
          ...content,
          auto_archived: true,
          archive_reason: 'Stale for 30+ days without updates',
          archived_at: new Date().toISOString(),
        },
      });
      archivedCount++;
    } catch (err) {
      logger.warn({ err, loopId: loop.id }, 'Failed to archive stale open loop');
    }
  }

  return archivedCount;
}
