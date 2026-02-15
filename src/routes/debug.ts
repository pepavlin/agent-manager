import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { createChildLogger } from '../utils/logger.js';
import { ErrorResponse } from '../schemas/index.js';
import { PROMPT_CORE, CHAT_MODE_RULES, CRON_MODE_RULES } from '../services/prompts.js';
import {
  getOpenLoops,
  getRecentEvents,
  getActiveIdeas,
  getAcceptedRules,
  countAcceptedRules,
} from '../services/memory-items.js';

const logger = createChildLogger('routes:debug');

interface SectionInfo {
  chars: number;
  estimated_tokens: number;
  content: string;
  items_count?: number;
}

function makeSection(content: string, itemsCount?: number): SectionInfo {
  return {
    chars: content.length,
    estimated_tokens: Math.ceil(content.length / 4),
    content,
    ...(itemsCount !== undefined ? { items_count: itemsCount } : {}),
  };
}

export async function debugRoutes(app: FastifyInstance): Promise<void> {
  // GET /projects/:id/prompt-debug - Show all always-sent prompt sections with sizes
  app.get('/projects/:id/prompt-debug', {
    schema: {
      tags: ['Debug'],
      summary: 'Inspect prompt context for a project',
      description: `Returns all "always-sent" sections of the system/user prompt for a given project, with character counts and estimated token counts. Useful for debugging token consumption.

Query params:
- \`user_id\` - User ID for preferences/lessons (default: "default")
- \`mode\` - "chat" or "cron" (default: "chat")`,
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Project ID' },
        },
        required: ['id'],
      },
      querystring: {
        type: 'object',
        properties: {
          user_id: { type: 'string', default: 'default', description: 'User ID for preferences/lessons' },
          mode: { type: 'string', enum: ['chat', 'cron'], default: 'chat' },
        },
      },
      response: {
        404: ErrorResponse,
      },
    },
  }, async (
    request: FastifyRequest<{
      Params: { id: string };
      Querystring: { user_id?: string; mode?: string };
    }>,
    reply: FastifyReply,
  ) => {
    const { id: projectId } = request.params;
    const userId = request.query.user_id || 'default';
    const mode = request.query.mode || 'chat';

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Fetch all sections in parallel
    const [
      playbookChunks,
      briefData,
      preferencesData,
      lessonsData,
      learnedRules,
      rulesTotal,
      openLoops,
      recentEvents,
      activeIdeas,
    ] = await Promise.all([
      // Playbook: all RULES chunks from KB
      prisma.kbChunk.findMany({
        where: {
          document: { projectId, category: 'RULES' },
        },
        orderBy: { chunkIndex: 'asc' },
        select: { text: true, chunkIndex: true },
      }),
      // Brief
      prisma.projectBrief.findUnique({
        where: { projectId },
      }),
      // Preferences
      prisma.preference.findMany({
        where: { projectId, userId, isActive: true },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      // Lessons
      prisma.lesson.findMany({
        where: { projectId, userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      // Learned rules
      getAcceptedRules(projectId),
      countAcceptedRules(projectId),
      // Memory context
      getOpenLoops(projectId, userId, 10).catch(() => []),
      getRecentEvents(projectId, 5).catch(() => []),
      getActiveIdeas(projectId, 5).catch(() => []),
    ]);

    // Build sections
    const modeRules = mode === 'cron' ? CRON_MODE_RULES : CHAT_MODE_RULES;

    const playbookText = playbookChunks.map((c) => c.text).join('\n\n');
    const briefText = briefData?.briefMarkdown || '';
    const prefsText = preferencesData.map((p, i) => `${i + 1}. ${p.ruleText}`).join('\n');
    const lessonsText = lessonsData.map((l, i) => `${i + 1}. ${l.lessonText}`).join('\n');

    const formatMemoryItem = (item: { type: string; status: string | null; title: string; content: unknown }) => {
      const content = item.content as Record<string, unknown>;
      const contentStr = Object.entries(content)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(', ');
      const status = item.status ? ` [${item.status}]` : '';
      return `- [${item.type}]${status} ${item.title}: ${contentStr}`;
    };

    const rulesText = learnedRules.map(formatMemoryItem).join('\n');
    const openLoopsText = openLoops.map(formatMemoryItem).join('\n');
    const eventsText = recentEvents.map(formatMemoryItem).join('\n');
    const ideasText = activeIdeas.map(formatMemoryItem).join('\n');

    const sections: Record<string, SectionInfo> = {
      prompt_core: makeSection(PROMPT_CORE),
      mode_rules: makeSection(modeRules),
      project_header: makeSection(`## PROJECT: ${project.name}\nRole: ${project.roleStatement}`),
      playbook: makeSection(playbookText, playbookChunks.length),
      project_brief: makeSection(briefText),
      preferences: makeSection(prefsText, preferencesData.length),
      lessons: makeSection(lessonsText, lessonsData.length),
      learned_rules: makeSection(rulesText, learnedRules.length),
      open_loops: makeSection(openLoopsText, openLoops.length),
      recent_events: makeSection(eventsText, recentEvents.length),
      active_ideas: makeSection(ideasText, activeIdeas.length),
    };

    // Totals
    const totalChars = Object.values(sections).reduce((sum, s) => sum + s.chars, 0);
    const totalEstimatedTokens = Object.values(sections).reduce((sum, s) => sum + s.estimated_tokens, 0);

    // Sorted breakdown (largest first)
    const breakdown = Object.entries(sections)
      .map(([name, info]) => ({
        section: name,
        chars: info.chars,
        estimated_tokens: info.estimated_tokens,
        pct: totalChars > 0 ? Math.round((info.chars / totalChars) * 1000) / 10 : 0,
        items_count: info.items_count,
      }))
      .sort((a, b) => b.chars - a.chars);

    logger.info({ projectId, totalChars, totalEstimatedTokens }, 'Prompt debug requested');

    return reply.status(200).send({
      project_id: projectId,
      project_name: project.name,
      mode,
      user_id: userId,
      learned_rules_total: rulesTotal,
      totals: {
        chars: totalChars,
        estimated_tokens: totalEstimatedTokens,
      },
      breakdown,
      sections,
    });
  });
}
