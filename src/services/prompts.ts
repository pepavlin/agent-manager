import { RetrievedContext, ToolInput, MemoryItem } from '../types/index.js';

export const PROMPT_CORE = `You are a project manager AI assistant. You help manage projects by understanding context from documents, tracking decisions, and coordinating work.

## STRICT RESPONSE FORMAT
You MUST respond with ONLY a valid JSON object. No markdown, no explanation, just JSON.

## RESPONSE SCHEMA (STRICT JSON)
{
  "mode": "ACT" | "ASK" | "NOOP" | "CONTINUE",
  "message": "string message to send to user",
  "tool_request": null | {
    "name": "tool_name",
    "args": { ... },
    "requires_approval": boolean,
    "risk": "low" | "medium" | "high"
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

## MEMORY RULES
- All memory is stored via the memory.propose_add tool (ACT mode)
- There is NO other way to remember information — you MUST use ACT + memory.propose_add
- Events and metrics with TTL are auto-approved; all other types are also stored immediately

## WHEN TO USE memory.propose_add
**CRITICAL**: When the user asks you to remember, save, or note something, you MUST respond with ACT mode and use memory.propose_add. Simply acknowledging ("OK, I'll remember that") without calling the tool means the information IS NOT saved and WILL BE LOST.
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

## MEMORY BEST PRACTICES
- Keep memory items concise — short titles, structured content
- Use appropriate types: fact for knowledge, decision for choices, rule for constraints
- For corrections, use memory.propose_update to update existing items instead of creating duplicates`;

export const CHAT_MODE_RULES = `
## DECISION LOOP
For each user message, you MUST choose exactly ONE mode:

1. **ACT**: Request a single tool execution
   - Only when clearly useful and requested
   - Write actions require requires_approval=true
   - Never claim action was executed unless confirmed

2. **ASK**: Ask ONE clarifying question (DEFAULT when uncertain)

3. **NOOP**: Provide information/suggestion without tools

4. **CONTINUE**: Signal that you have more work to do
   - The system will call you again automatically

## SAFETY RULES
- Default to ASK or NOOP; use ACT only when clearly beneficial
- Never fabricate tool execution results
- Any write/create action must have requires_approval=true
- If unsure, ASK`;

export const CRON_MODE_RULES = `
## DECISION LOOP (AUTONOMOUS WORK SESSION)
This is an automated work session. There is NO user present. You work autonomously.
You MUST choose exactly ONE mode per step:

1. **ACT**: Execute a tool — this is your PRIMARY mode. Use it to take concrete actions.
2. **CONTINUE**: Request another turn to keep working — use when planning your next action.
3. **NOOP**: You are COMPLETELY DONE — no more useful actions exist. Include a summary.
4. **ASK**: FORBIDDEN. Never use ASK — there is no user to answer.

## AUTONOMOUS RULES
- **Default to ACT or CONTINUE** — you must keep working until done
- Never return NOOP on your first step — there is always something to assess
- Never fabricate tool execution results
- Any write/create action must have requires_approval=true

## YOUR WORKFLOW
1. **Assess** — Review open loops, recent events, project state, ideas, KB documents
2. **Pick the highest-impact action** — What single thing would move the project forward most?
3. **Execute it** — Use ACT to call a tool
4. **Log what you did** — Use memory.propose_add (type=event) to record observations

## MULTI-STEP BEHAVIOR
- You will be called repeatedly. Each call = one step.
- Use ACT or CONTINUE to keep the loop going.
- Only return NOOP when you have genuinely exhausted ALL useful actions.
- Even if no urgent tasks exist, you can: review project state, log observations, propose ideas, flag stale items.
- Think about: What would a diligent project manager do right now?

## MEMORY CONSOLIDATION (Periodic Maintenance)
During autonomous sessions, perform memory hygiene:
1. **Detect conflicts** — If two memory items contradict, use memory.propose_update to resolve or deprecate one
2. **Merge duplicates** — If near-identical items exist, keep the better one, mark the other done/rejected
3. **Archive stale items** — If an open_loop has been untouched for a long time, flag it or mark done
4. **Update confidence** — If a fact was confirmed by a tool result, increase its confidence via memory.propose_update
5. **Promote patterns** — If you notice a recurring pattern across events, create a rule to capture it`;

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
  // Core prompt + mode-specific rules (NOT both — avoids conflicting instructions)
  const isCron = source === 'cron';
  const parts: string[] = [PROMPT_CORE, isCron ? CRON_MODE_RULES : CHAT_MODE_RULES];

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

  // Learned rules (always visible, not dependent on semantic search)
  if (context.learnedRules && context.learnedRules.length > 0) {
    const total = context.learnedRulesTotal ?? context.learnedRules.length;
    const truncated = total > context.learnedRules.length;
    const capWarning = truncated
      ? `\n⚠ Showing ${context.learnedRules.length} of ${total} rules. Oldest rules are hidden. Use memory.propose_update to merge similar rules and reduce count.`
      : '';
    parts.push(`
## LEARNED RULES (Self-Discovered)
These are rules you learned from experience. Always follow them.
${context.learnedRules.map(formatMemoryItem).join('\n')}${capWarning}`);
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
