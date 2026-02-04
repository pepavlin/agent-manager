import { z } from 'zod';
import { TOOLS } from './definitions.js';
import { ToolDefinition, ToolRequest } from '../types/index.js';

export function getToolDefinition(name: string): ToolDefinition | null {
  return TOOLS[name] || null;
}

export function getAllToolDefinitions(): ToolDefinition[] {
  return Object.values(TOOLS);
}

export function validateToolRequest(request: ToolRequest): {
  valid: boolean;
  error?: string;
  tool?: ToolDefinition;
} {
  const tool = getToolDefinition(request.name);

  if (!tool) {
    return {
      valid: false,
      error: `Unknown tool: ${request.name}`,
    };
  }

  try {
    tool.argsSchema.parse(request.args);
    return { valid: true, tool };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        valid: false,
        error: `Invalid arguments for ${request.name}: ${error.errors.map((e) => e.message).join(', ')}`,
      };
    }
    return {
      valid: false,
      error: `Validation error: ${String(error)}`,
    };
  }
}

export function getToolsForPrompt(): string {
  const tools = getAllToolDefinitions();

  const toolDescriptions = tools.map((t) => {
    const schema = t.argsSchema;
    let argsDescription = '';

    if (schema instanceof z.ZodObject) {
      const shape = schema.shape;
      const args = Object.entries(shape).map(([key, value]) => {
        const zodValue = value as z.ZodTypeAny;
        return `    - ${key}: ${zodValue.description || 'no description'}`;
      });
      argsDescription = args.join('\n');
    }

    return `- ${t.name}: ${t.description}
  requires_approval: ${t.requiresApproval}
  default_risk: ${t.defaultRisk}
  args:
${argsDescription}`;
  });

  return toolDescriptions.join('\n\n');
}
