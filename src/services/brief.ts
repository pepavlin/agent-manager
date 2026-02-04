import { prisma } from '../db/client.js';
import { getChatProvider } from '../providers/chat/index.js';
import { createChildLogger } from '../utils/logger.js';
import { extractJson } from '../utils/json-repair.js';
import { NotFoundError } from '../utils/errors.js';

const logger = createChildLogger('brief');

interface BriefGenerationResult {
  briefMarkdown: string;
  kbIndexMarkdown: string;
  missingInfoJson: string[];
}

const BRIEF_SYSTEM_PROMPT = `You generate project documentation summaries. Respond ONLY with valid JSON.`;

const BRIEF_USER_PROMPT = (projectName: string, documents: Array<{ category: string; text: string }>) => `
Analyze the following project documents for "${projectName}" and generate:

1. A brief_markdown: 1-page project summary covering:
   - What the project is
   - Main goals and objectives
   - Key constraints or requirements
   - Current state (if state documents provided)

2. A kb_index_markdown: Table of contents / topic map:
   - Main topics covered
   - Key entities (people, systems, concepts)
   - Document categories

3. A missing_info array: 5-15 questions that would help a project manager better understand and manage this project.

Documents:
${documents.map((d) => `[${d.category}]\n${d.text.slice(0, 5000)}`).join('\n\n---\n\n')}

Respond with ONLY this JSON structure:
{
  "brief_markdown": "# Project Brief\\n...",
  "kb_index_markdown": "# Knowledge Base Index\\n...",
  "missing_info": ["Question 1?", "Question 2?", ...]
}`;

export async function generateProjectBrief(projectId: string): Promise<BriefGenerationResult> {
  logger.info({ projectId }, 'Generating project brief');

  // Get project
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new NotFoundError('Project', projectId);
  }

  // Get all documents for the project
  const documents = await prisma.document.findMany({
    where: { projectId },
    include: {
      kbChunks: {
        orderBy: { chunkIndex: 'asc' },
        take: 20, // Limit chunks per document
      },
    },
  });

  if (documents.length === 0) {
    // Return empty brief if no documents
    const emptyBrief: BriefGenerationResult = {
      briefMarkdown: `# ${project.name}\n\nNo documents uploaded yet.`,
      kbIndexMarkdown: '# Knowledge Base Index\n\nEmpty',
      missingInfoJson: [
        'What is the main goal of this project?',
        'Who are the stakeholders?',
        'What are the key deliverables?',
        'What is the timeline?',
        'What resources are available?',
      ],
    };

    await saveBrief(projectId, emptyBrief);
    return emptyBrief;
  }

  // Prepare document texts
  const docTexts = documents.map((doc) => ({
    category: doc.category,
    text: doc.kbChunks.map((c) => c.text).join('\n\n'),
  }));

  // Generate brief using LLM
  const chatProvider = getChatProvider();
  const response = await chatProvider.generateJSON({
    system: BRIEF_SYSTEM_PROMPT,
    user: BRIEF_USER_PROMPT(project.name, docTexts),
  });

  // Parse response
  const extracted = extractJson(response);
  if (!extracted) {
    logger.error({ response }, 'Failed to parse brief generation response');
    throw new Error('Failed to generate project brief: invalid JSON response');
  }

  const parsed = JSON.parse(extracted) as {
    brief_markdown: string;
    kb_index_markdown: string;
    missing_info: string[];
  };

  const result: BriefGenerationResult = {
    briefMarkdown: parsed.brief_markdown || `# ${project.name}\n\nBrief generation incomplete.`,
    kbIndexMarkdown: parsed.kb_index_markdown || '# Knowledge Base Index\n\nIndex generation incomplete.',
    missingInfoJson: parsed.missing_info || [],
  };

  await saveBrief(projectId, result);

  logger.info({ projectId, missingQuestions: result.missingInfoJson.length }, 'Project brief generated');
  return result;
}

async function saveBrief(projectId: string, brief: BriefGenerationResult): Promise<void> {
  await prisma.projectBrief.upsert({
    where: { projectId },
    update: {
      briefMarkdown: brief.briefMarkdown,
      kbIndexMarkdown: brief.kbIndexMarkdown,
      missingInfoJson: JSON.stringify(brief.missingInfoJson),
      updatedAt: new Date(),
    },
    create: {
      projectId,
      briefMarkdown: brief.briefMarkdown,
      kbIndexMarkdown: brief.kbIndexMarkdown,
      missingInfoJson: JSON.stringify(brief.missingInfoJson),
    },
  });
}

export async function getProjectBrief(projectId: string): Promise<BriefGenerationResult | null> {
  const brief = await prisma.projectBrief.findUnique({
    where: { projectId },
  });

  if (!brief) {
    return null;
  }

  return {
    briefMarkdown: brief.briefMarkdown,
    kbIndexMarkdown: brief.kbIndexMarkdown,
    missingInfoJson: JSON.parse(brief.missingInfoJson) as string[],
  };
}
