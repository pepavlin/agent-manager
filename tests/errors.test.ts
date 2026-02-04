import { describe, it, expect } from 'vitest';
import {
  AppError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ProviderError,
  RateLimitError,
  isAppError,
} from '../src/utils/errors.js';

describe('Error Classes', () => {
  describe('AppError', () => {
    it('should create error with all properties', () => {
      const error = new AppError('Test error', 400, 'TEST_ERROR', { field: 'value' });
      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('TEST_ERROR');
      expect(error.details).toEqual({ field: 'value' });
      expect(error.name).toBe('AppError');
    });

    it('should be instance of Error', () => {
      const error = new AppError('Test', 500, 'TEST');
      expect(error instanceof Error).toBe(true);
    });
  });

  describe('NotFoundError', () => {
    it('should create error with resource and id', () => {
      const error = new NotFoundError('Project', 'abc123');
      expect(error.message).toBe('Project not found: abc123');
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('NOT_FOUND');
      expect(error.name).toBe('NotFoundError');
    });

    it('should create error with only resource', () => {
      const error = new NotFoundError('Document');
      expect(error.message).toBe('Document not found');
    });
  });

  describe('ValidationError', () => {
    it('should create error with details', () => {
      const details = { field: 'email', issue: 'invalid format' };
      const error = new ValidationError('Invalid input', details);
      expect(error.message).toBe('Invalid input');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details).toEqual(details);
    });
  });

  describe('UnauthorizedError', () => {
    it('should create error with default message', () => {
      const error = new UnauthorizedError();
      expect(error.message).toBe('Unauthorized');
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('UNAUTHORIZED');
    });

    it('should create error with custom message', () => {
      const error = new UnauthorizedError('Invalid API key');
      expect(error.message).toBe('Invalid API key');
    });
  });

  describe('ProviderError', () => {
    it('should create error with provider name', () => {
      const error = new ProviderError('openai', 'Rate limited');
      expect(error.message).toBe('openai: Rate limited');
      expect(error.statusCode).toBe(502);
      expect(error.code).toBe('PROVIDER_ERROR');
      expect(error.provider).toBe('openai');
    });
  });

  describe('RateLimitError', () => {
    it('should create error with retry after', () => {
      const error = new RateLimitError('Too many requests', 60);
      expect(error.message).toBe('Too many requests');
      expect(error.statusCode).toBe(429);
      expect(error.code).toBe('RATE_LIMIT');
      expect(error.retryAfter).toBe(60);
    });

    it('should create error with default message', () => {
      const error = new RateLimitError();
      expect(error.message).toBe('Rate limit exceeded');
    });
  });

  describe('isAppError', () => {
    it('should return true for AppError instances', () => {
      expect(isAppError(new AppError('test', 400, 'TEST'))).toBe(true);
      expect(isAppError(new NotFoundError('Resource'))).toBe(true);
      expect(isAppError(new ValidationError('Invalid'))).toBe(true);
      expect(isAppError(new UnauthorizedError())).toBe(true);
      expect(isAppError(new ProviderError('test', 'error'))).toBe(true);
      expect(isAppError(new RateLimitError())).toBe(true);
    });

    it('should return false for regular errors', () => {
      expect(isAppError(new Error('test'))).toBe(false);
      expect(isAppError('string')).toBe(false);
      expect(isAppError(null)).toBe(false);
      expect(isAppError(undefined)).toBe(false);
    });
  });
});
