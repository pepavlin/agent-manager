import { describe, it, expect } from 'vitest';
import { extractJson } from '../src/utils/json-repair.js';

describe('JSON Repair', () => {
  describe('extractJson', () => {
    it('should extract valid JSON directly', () => {
      const input = '{"mode": "ACT", "message": "hello"}';
      expect(extractJson(input)).toBe(input);
    });

    it('should extract JSON from markdown code block', () => {
      const json = '{"mode": "NOOP", "message": "test"}';
      const input = '```json\n' + json + '\n```';
      expect(extractJson(input)).toBe(json);
    });

    it('should extract JSON from code block without language tag', () => {
      const json = '{"mode": "ASK", "message": "question"}';
      const input = '```\n' + json + '\n```';
      expect(extractJson(input)).toBe(json);
    });

    it('should extract JSON from text with surrounding content', () => {
      const json = '{"mode": "NOOP", "message": "response"}';
      const input = 'Here is my response:\n' + json + '\n\nLet me know if you need more.';
      expect(extractJson(input)).toBe(json);
    });

    it('should fix trailing commas', () => {
      const input = '{"mode": "ACT", "message": "test", }';
      const result = extractJson(input);
      expect(result).not.toBeNull();
      expect(() => JSON.parse(result!)).not.toThrow();
      expect(JSON.parse(result!).mode).toBe('ACT');
    });

    it('should fix unquoted keys', () => {
      const input = '{mode: "NOOP", message: "test"}';
      const result = extractJson(input);
      expect(result).not.toBeNull();
      expect(() => JSON.parse(result!)).not.toThrow();
      expect(JSON.parse(result!).mode).toBe('NOOP');
    });

    it('should fix single quotes', () => {
      const input = '{"mode": \'ASK\', "message": \'question\'}';
      const result = extractJson(input);
      expect(result).not.toBeNull();
      expect(() => JSON.parse(result!)).not.toThrow();
      expect(JSON.parse(result!).mode).toBe('ASK');
    });

    it('should handle JSON with trailing text', () => {
      const input = '{"mode": "NOOP"}. That is my response.';
      const result = extractJson(input);
      expect(result).not.toBeNull();
      expect(() => JSON.parse(result!)).not.toThrow();
    });

    it('should return null for completely invalid input', () => {
      const input = 'This is not JSON at all, no curly braces here.';
      expect(extractJson(input)).toBeNull();
    });

    it('should handle nested objects', () => {
      const json = '{"mode": "ACT", "tool_request": {"name": "test", "args": {}}}';
      expect(extractJson(json)).toBe(json);
    });

    it('should extract from <json> tags', () => {
      const json = '{"mode": "NOOP", "message": "test"}';
      const input = '<json>' + json + '</json>';
      expect(extractJson(input)).toBe(json);
    });
  });
});
