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

  // Try extracting from markdown code block (various formats)
  const codeBlockPatterns = [
    /```json\s*([\s\S]*?)\s*```/,
    /```\s*([\s\S]*?)\s*```/,
    /<json>\s*([\s\S]*?)\s*<\/json>/i,
    /\[JSON\]\s*([\s\S]*?)\s*\[\/JSON\]/i,
  ];

  for (const pattern of codeBlockPatterns) {
    const match = text.match(pattern);
    if (match) {
      try {
        JSON.parse(match[1]);
        return match[1];
      } catch {
        // Try fixing it
        const fixed = tryFixJson(match[1]);
        if (fixed) return fixed;
      }
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

  // Remove single-line comments
  fixed = fixed.replace(/\/\/[^\n]*/g, '');

  // Remove multi-line comments
  fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, '');

  // Fix unquoted keys (simple cases like { mode: "ACT" })
  fixed = fixed.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');

  // Fix single quotes to double quotes (outside of already quoted strings)
  fixed = fixed.replace(/:\s*'([^']*)'/g, ': "$1"');

  // Remove trailing text after the JSON object
  const lastBrace = fixed.lastIndexOf('}');
  if (lastBrace !== -1 && lastBrace < fixed.length - 1) {
    fixed = fixed.slice(0, lastBrace + 1);
  }

  try {
    JSON.parse(fixed);
    return fixed;
  } catch {
    logger.debug({ original: text.slice(0, 200) }, 'Could not fix JSON');
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
