import { RetrievedContext } from '../types/index.js';
import { getToolsForPrompt } from '../tools/registry.js';

const BASE_SYSTEM_PROMPT = `You are a project manager AI assistant. You help manage projects by understanding context from documents, tracking decisions, and coordinating work.

## STRICT RESPONSE FORMAT
You MUST respond with ONLY a valid JSON object. No markdown, no explanation, just JSON.

## DECISION LOOP
For each user message, you MUST choose exactly ONE mode:

1. ACT: Request a single tool execution
   - Only when clearly useful and requested
   - Write actions require requires_approval=true
   - Never claim action was executed unless confirmed

2. ASK: Ask ONE clarifying question
   - When you need more information
   - When the request is ambiguous
   - Default to this when uncertain

3. NOOP: Provide information/suggestion without tools
   - Reports, summaries, suggestions
   - When no action is needed

## SAFETY RULES
- Default to ASK or NOOP; use ACT only when clearly beneficial
- Never fabricate tool execution results
- Any write/create action must have requires_approval=true
- If unsure, ASK

## RESPONSE SCHEMA (STRICT JSON)
{
  "mode": "ACT" | "ASK" | "NOOP",
  "message": "string message to send to user",
  "tool_request": null | {
    "name": "tool_name",
    "args": { ... },
    "requires_approval": boolean,
    "risk": "low" | "medium" | "high"
  },
  "memory_updates": {
    "preferences_add": ["stable user preferences to remember"],
    "preferences_remove": ["preferences user wants to revoke"],
    "lessons_add": ["lessons learned from outcomes"]
  }
}

## MEMORY EXTRACTION
- Only add preferences that are stable, actionable, and explicitly stated by user
- Only add lessons from confirmed outcomes (success or failure)
- Keep preferences/lessons concise (1 sentence each)
- Newer preferences override older conflicting ones`;

export function assembleSystemPrompt(
  projectName: string,
  roleStatement: string,
  context: RetrievedContext
): string {
  const parts: string[] = [BASE_SYSTEM_PROMPT];

  // Project overlay
  parts.push(`
## PROJECT: ${projectName}
Role: ${roleStatement}`);

  // Tools available
  parts.push(`
## AVAILABLE TOOLS
${getToolsForPrompt()}`);

  // Playbook / Rules
  if (context.playbook) {
    parts.push(`
## PROJECT RULES (PLAYBOOK)
${context.playbook}`);
  }

  // User preferences
  if (context.preferences.length > 0) {
    parts.push(`
## USER PREFERENCES
${context.preferences.map((p, i) => `${i + 1}. ${p}`).join('\n')}`);
  }

  // Lessons learned
  if (context.lessons.length > 0) {
    parts.push(`
## LESSONS LEARNED
${context.lessons.map((l, i) => `${i + 1}. ${l}`).join('\n')}`);
  }

  // Project brief
  if (context.brief) {
    parts.push(`
## PROJECT BRIEF
${context.brief}`);
  }

  return parts.join('\n');
}

export function assembleUserPrompt(
  userMessage: string,
  context: RetrievedContext
): string {
  const parts: string[] = [];

  // KB context chunks
  if (context.kbChunks.length > 0) {
    parts.push('## RELEVANT KNOWLEDGE BASE CONTEXT');
    for (const chunk of context.kbChunks) {
      parts.push(`[${chunk.category}] (score: ${chunk.score.toFixed(3)})`);
      parts.push(chunk.text);
      parts.push('---');
    }
  }

  // Recent conversation
  if (context.recentMessages.length > 0) {
    parts.push('\n## RECENT CONVERSATION');
    for (const msg of context.recentMessages) {
      parts.push(`${msg.role.toUpperCase()}: ${msg.content}`);
    }
  }

  // Current user message
  parts.push(`\n## CURRENT USER MESSAGE
${userMessage}

Respond with ONLY valid JSON following the schema above.`);

  return parts.join('\n');
}
