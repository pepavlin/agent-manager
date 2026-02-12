import { prisma } from '../db/client.js';
/** Legacy memory updates format (kept for backward compat) */
interface MemoryUpdates {
  preferences_add?: string[];
  preferences_remove?: string[];
  lessons_add?: string[];
}
import { createChildLogger } from '../utils/logger.js';
import { createMemoryItem } from './memory-items.js';

const logger = createChildLogger('memory');

export async function applyMemoryUpdates(
  projectId: string,
  userId: string,
  updates: MemoryUpdates
): Promise<void> {
  const { preferences_add = [], preferences_remove = [], lessons_add = [] } = updates;

  logger.debug(
    {
      projectId,
      userId,
      prefsAdd: preferences_add.length,
      prefsRemove: preferences_remove.length,
      lessonsAdd: lessons_add.length,
    },
    'Applying memory updates'
  );

  // Add new preferences (deduplicate)
  for (const ruleText of preferences_add) {
    if (!ruleText.trim()) continue;

    // Check if similar preference exists
    const existing = await prisma.preference.findFirst({
      where: {
        projectId,
        userId,
        ruleText: ruleText.trim(),
        isActive: true,
      },
    });

    if (!existing) {
      // Write to old table (backward compatibility)
      await prisma.preference.create({
        data: {
          projectId,
          userId,
          ruleText: ruleText.trim(),
          scope: 'project',
          isActive: true,
        },
      });

      // Write-through to new memory_items table
      try {
        await createMemoryItem({
          projectId,
          userId,
          type: 'preference',
          title: ruleText.trim().slice(0, 100),
          content: { rule_text: ruleText.trim() },
          status: 'accepted',
          source: 'user_chat',
          confidence: 0.8,
          tags: [],
        });
      } catch (error) {
        logger.warn({ error, ruleText: ruleText.slice(0, 50) }, 'Failed to write preference to memory_items');
      }

      logger.debug({ ruleText: ruleText.slice(0, 50) }, 'Added preference');
    }
  }

  // Deactivate preferences (soft delete)
  for (const ruleText of preferences_remove) {
    if (!ruleText.trim()) continue;

    await prisma.preference.updateMany({
      where: {
        projectId,
        userId,
        ruleText: {
          contains: ruleText.trim(),
        },
        isActive: true,
      },
      data: {
        isActive: false,
        updatedAt: new Date(),
      },
    });
    logger.debug({ ruleText: ruleText.slice(0, 50) }, 'Deactivated preference');
  }

  // Add new lessons (deduplicate)
  for (const lessonText of lessons_add) {
    if (!lessonText.trim()) continue;

    // Check if similar lesson exists
    const existing = await prisma.lesson.findFirst({
      where: {
        projectId,
        userId,
        lessonText: lessonText.trim(),
      },
    });

    if (!existing) {
      // Write to old table (backward compatibility)
      await prisma.lesson.create({
        data: {
          projectId,
          userId,
          lessonText: lessonText.trim(),
        },
      });

      // Write-through to new memory_items table
      try {
        await createMemoryItem({
          projectId,
          userId,
          type: 'lesson',
          title: lessonText.trim().slice(0, 100),
          content: { lesson_text: lessonText.trim() },
          status: 'accepted',
          source: 'user_chat',
          confidence: 0.7,
          tags: [],
        });
      } catch (error) {
        logger.warn({ error, lessonText: lessonText.slice(0, 50) }, 'Failed to write lesson to memory_items');
      }

      logger.debug({ lessonText: lessonText.slice(0, 50) }, 'Added lesson');
    }
  }
}

export async function getPreferences(projectId: string, userId: string): Promise<string[]> {
  const prefs = await prisma.preference.findMany({
    where: {
      projectId,
      userId,
      isActive: true,
    },
    orderBy: { updatedAt: 'desc' },
  });
  return prefs.map((p) => p.ruleText);
}

export async function getLessons(projectId: string, userId: string): Promise<string[]> {
  const lessons = await prisma.lesson.findMany({
    where: {
      projectId,
      userId,
    },
    orderBy: { createdAt: 'desc' },
  });
  return lessons.map((l) => l.lessonText);
}
