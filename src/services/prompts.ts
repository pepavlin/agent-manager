import { RetrievedContext, ToolInput, MemoryItem } from '../types/index.js';

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

## MEMORY LAYERS
You have access to multiple memory layers:

1. **KB Documents** (authoritative source of truth)
   - FACTS: Project information, specs, documentation
   - RULES: Guidelines and processes you must follow
   - STATE: Current project state and updates

2. **Memory Items** (secondary, learnable)
   - EVENTS: What happened (append-only log)
   - DECISIONS: Agreed-upon choices
   - OPEN_LOOPS: Commitments and pending items
   - IDEAS: Proposed improvements
   - METRICS: Time-limited measurements

## SAFE LEARNING RULES
- You CANNOT write facts directly to the knowledge base
- To learn new information, use memory.propose_add tool
- Facts/decisions/open_loops require user approval
- Events and metrics with TTL can be auto-approved
- Always state confidence level for proposed facts

## WHEN TO USE memory.propose_add
Use memory.propose_add when the user:
- States a **fact**: "The project uses Python", "Our budget is $50k", "John is the team lead"
- Makes a **decision**: "We decided to use Kubernetes", "We chose Stripe for payments"
- Gives a **commitment/task** (open_loop): "I need to fix the login bug", "We must deploy by Friday"
- Shares an **idea/suggestion**: "What if we added dark mode?", "How about caching?", "Maybe we should add notifications", "A cool feature would be X", "It might be worth exploring Y", "One thought - what about Z?"
- Explicitly asks to **remember**: "Remember that...", "Save this...", "Make a note...", "Don't forget..."

**Idea detection**: The following patterns are ALL ideas and should use type="idea":
- "What if we..." / "What about..."
- "How about..." / "How would it be if..."
- "Maybe we should..." / "Perhaps we could..."
- "It might be worth..." / "It could be useful to..."
- "One thought..." / "A cool feature would be..."
- "We could potentially..." / "I'm thinking we could..."
- "Idea:" / "Suggestion:" / "Here is a suggestion:"

Do NOT use memory.propose_add for:
- Questions asking for information ("What is the budget?", "Who is the lead?")
- Greetings, small talk, or emotional expressions
- Vague/filler messages ("Hmm, let me think about that")

## HANDLING CONTRADICTIONS & CORRECTIONS
When the user corrects or updates a previously stated fact:
- Use **memory.propose_update** to update the existing memory item
- If you cannot find the exact item to update, use memory.propose_add with **supersedes_id** pointing to the old item
- Look for correction signals: "Actually...", "I was wrong...", "Correction:", "The X is now Y, not Z"
- The new fact should replace or supersede the old one, never just add a duplicate

## MEMORY EXTRACTION
- Only add preferences that are stable, actionable, and explicitly stated by user
- Only add lessons from confirmed outcomes (success or failure)
- Keep preferences/lessons concise (1 sentence each)
- Newer preferences override older conflicting ones`;

function formatToolsForPrompt(tools: ToolInput[]): string {
  if (tools.length === 0) {
    return 'No tools available. Use NOOP or ASK mode only.';
  }

  return tools.map((t) => {
    let paramsDescription = '';
    if (t.parameters) {
      const params = Object.entries(t.parameters).map(([key, value]) => {
        const required = value.required ? '(required)' : '(optional)';
        return `    - ${key}: ${value.type} ${required} - ${value.description || 'no description'}`;
      });
      paramsDescription = params.join('\n');
    }

    return `- ${t.name}: ${t.description}
  requires_approval: ${t.requires_approval}
  risk: ${t.risk}
  parameters:
${paramsDescription || '    (none)'}`;
  }).join('\n\n');
}

function formatMemoryItem(item: MemoryItem): string {
  const content = item.content as Record<string, unknown>;
  const contentStr = Object.entries(content)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(', ');
  const status = item.status ? ` [${item.status}]` : '';
  return `- [${item.type}]${status} ${item.title}: ${contentStr}`;
}

function formatSituationalPicture(context: RetrievedContext): string {
  const parts: string[] = [];

  if (!context.memoryContext) {
    return '';
  }

  const { openLoops, recentEvents, activeIdeas, relevantMemory } = context.memoryContext;

  // Open loops (commitments, pending items)
  if (openLoops.length > 0) {
    parts.push('### Open Loops (Commitments/Pending)');
    parts.push(openLoops.map(formatMemoryItem).join('\n'));
  }

  // Recent events
  if (recentEvents.length > 0) {
    parts.push('### Recent Events');
    parts.push(recentEvents.map(formatMemoryItem).join('\n'));
  }

  // Active ideas
  if (activeIdeas.length > 0) {
    parts.push('### Active Ideas');
    parts.push(activeIdeas.map(formatMemoryItem).join('\n'));
  }

  // Relevant memory (semantic match)
  if (relevantMemory.length > 0) {
    parts.push('### Relevant Memory');
    parts.push(relevantMemory.map(formatMemoryItem).join('\n'));
  }

  if (parts.length === 0) {
    return '';
  }

  return '\n## SITUATIONAL PICTURE\n' + parts.join('\n\n');
}

export function assembleSystemPrompt(
  projectName: string,
  roleStatement: string,
  context: RetrievedContext,
  tools: ToolInput[],
  source?: string
): string {
  const parts: string[] = [BASE_SYSTEM_PROMPT];

  // Proactive mode for cron-triggered reviews
  if (source === 'cron') {
    parts.push(`
## PROACTIVE MODE (SCHEDULED REVIEW)
This is an automated scheduled check, NOT a user message. Your job is to:

1. **Review open loops** — Are there pending commitments? What's overdue or stuck?
2. **Assess project state** — What changed recently? Any blockers or risks?
3. **Propose next steps** — What concrete actions should be taken to move the project forward?
4. **Surface ideas** — Are there accepted ideas worth acting on?
5. **Flag risks** — Any deadlines approaching, decisions needed, or dependencies at risk?

Guidelines for proactive mode:
- Prefer ACT mode — use tools to create tasks, send notifications, update statuses
- If no action is needed, use NOOP with a concise status summary
- Do NOT ask questions (no ASK mode) — this is unattended, there is no user to answer
- Be specific and actionable, not vague
- Focus on what matters most RIGHT NOW
- Log important observations as events via memory.propose_add`);
  }

  // Project overlay
  parts.push(`
## PROJECT: ${projectName}
Role: ${roleStatement}`);

  // Tools available
  parts.push(`
## AVAILABLE TOOLS
${formatToolsForPrompt(tools)}`);

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

  // Situational picture (memory context)
  const situationalPicture = formatSituationalPicture(context);
  if (situationalPicture) {
    parts.push(situationalPicture);
  }

  // Recent conversation (with per-message and total budget limits)
  if (context.recentMessages.length > 0) {
    const MAX_MSG_CHARS = 1000;
    const MAX_CONVERSATION_CHARS = 6000;
    let conversationBudget = MAX_CONVERSATION_CHARS;
    const conversationLines: string[] = [];

    // Include most recent messages first (reverse, then re-reverse)
    const reversed = [...context.recentMessages].reverse();
    for (const msg of reversed) {
      let content = msg.content;
      if (content.length > MAX_MSG_CHARS) {
        content = content.slice(0, MAX_MSG_CHARS) + '... [truncated]';
      }
      const line = `${msg.role.toUpperCase()}: ${content}`;
      if (conversationBudget - line.length < 0) break;
      conversationBudget -= line.length;
      conversationLines.unshift(line);
    }

    if (conversationLines.length > 0) {
      parts.push('\n## RECENT CONVERSATION');
      parts.push(...conversationLines);
    }
  }

  // Current user message
  parts.push(`\n## CURRENT USER MESSAGE
${userMessage}

Respond with ONLY valid JSON following the schema above.`);

  return parts.join('\n');
}
