import { prisma } from '../db/client.js';
import { getEmbeddingProvider } from '../providers/embeddings/index.js';
import { searchSimilar, SearchResult } from './qdrant.js';
import { RetrievedContext } from '../types/index.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('rag');

const KB_CHUNKS_LIMIT = 8;
const PREFERENCES_LIMIT = 10;
const LESSONS_LIMIT = 5;
const RECENT_MESSAGES_LIMIT = 20;

export interface RAGOptions {
  kbLimit?: number;
  preferencesLimit?: number;
  lessonsLimit?: number;
  messagesLimit?: number;
  categories?: string[];
}

export async function retrieveContext(
  projectId: string,
  userId: string,
  query: string,
  threadId?: string,
  options: RAGOptions = {}
): Promise<RetrievedContext> {
  const {
    kbLimit = KB_CHUNKS_LIMIT,
    preferencesLimit = PREFERENCES_LIMIT,
    lessonsLimit = LESSONS_LIMIT,
    messagesLimit = RECENT_MESSAGES_LIMIT,
    categories,
  } = options;

  logger.debug({ projectId, userId, query: query.slice(0, 100) }, 'Retrieving context');

  // Get embedding for query
  const embeddingProvider = getEmbeddingProvider();
  const [queryVector] = await embeddingProvider.embed([query]);

  // Search KB chunks
  let kbResults: SearchResult[] = [];
  try {
    kbResults = await searchSimilar(projectId, queryVector, kbLimit, {
      category: categories,
    });
  } catch (error) {
    logger.warn({ error, projectId }, 'Failed to search KB, continuing without');
  }

  const kbChunks = kbResults.map((r) => ({
    text: r.payload.text,
    documentId: r.payload.document_id,
    category: r.payload.category,
    score: r.score,
  }));

  // Get active preferences for user+project
  const preferencesData = await prisma.preference.findMany({
    where: {
      projectId,
      userId,
      isActive: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: preferencesLimit,
  });
  const preferences = preferencesData.map((p) => p.ruleText);

  // Get lessons for user+project
  const lessonsData = await prisma.lesson.findMany({
    where: {
      projectId,
      userId,
    },
    orderBy: { createdAt: 'desc' },
    take: lessonsLimit,
  });
  const lessons = lessonsData.map((l) => l.lessonText);

  // Get playbook (RULES documents content)
  const playbookDocs = await prisma.document.findMany({
    where: {
      projectId,
      category: 'RULES',
    },
    orderBy: { createdAt: 'desc' },
    take: 1,
  });
  let playbook: string | null = null;
  if (playbookDocs.length > 0 && kbResults.some((r) => r.payload.category === 'RULES')) {
    // Extract RULES text from KB results
    const rulesChunks = kbResults.filter((r) => r.payload.category === 'RULES');
    if (rulesChunks.length > 0) {
      playbook = rulesChunks.map((r) => r.payload.text).join('\n\n');
    }
  }

  // Get project brief
  const briefData = await prisma.projectBrief.findUnique({
    where: { projectId },
  });
  const brief = briefData?.briefMarkdown || null;

  // Get recent messages from thread
  let recentMessages: Array<{ role: string; content: string }> = [];
  if (threadId) {
    const messagesData = await prisma.message.findMany({
      where: { threadId },
      orderBy: { createdAt: 'desc' },
      take: messagesLimit,
    });
    recentMessages = messagesData.reverse().map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  logger.debug(
    {
      kbChunks: kbChunks.length,
      preferences: preferences.length,
      lessons: lessons.length,
      hasPlaybook: !!playbook,
      hasBrief: !!brief,
      messages: recentMessages.length,
    },
    'Context retrieved'
  );

  return {
    kbChunks,
    preferences,
    lessons,
    playbook,
    brief,
    recentMessages,
  };
}
