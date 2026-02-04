import { createChildLogger } from './logger.js';

const logger = createChildLogger('json-repair');

/**
 * Attempt to extract and parse JSON from text that may contain
 * markdown code blocks or other wrapping.
 */
export function extractJson(text: string): string | null {
  // Try direct parse first
  try {
    JSON.parse(text);
    return text;
  } catch {
    // Continue to extraction attempts
  }

  // Try extracting from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try {
      JSON.parse(codeBlockMatch[1]);
      return codeBlockMatch[1];
    } catch {
      // Continue
    }
  }

  // Try finding JSON object in text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      JSON.parse(jsonMatch[0]);
      return jsonMatch[0];
    } catch {
      // Try to fix common issues
      return tryFixJson(jsonMatch[0]);
    }
  }

  return null;
}

function tryFixJson(text: string): string | null {
  let fixed = text;

  // Remove trailing commas before } or ]
  fixed = fixed.replace(/,\s*([\]}])/g, '$1');

  // Try to fix unescaped quotes in strings (very basic)
  // This is a heuristic and may not work for all cases

  try {
    JSON.parse(fixed);
    return fixed;
  } catch {
    logger.debug({ original: text }, 'Could not fix JSON');
    return null;
  }
}

/**
 * Create a prompt to ask the model to fix invalid JSON.
 */
export function createJsonRepairPrompt(invalidJson: string, error: string): string {
  return `The following JSON is invalid. Fix it and return ONLY the corrected JSON, nothing else.

Error: ${error}

Invalid JSON:
${invalidJson}

Return ONLY valid JSON:`;
}
