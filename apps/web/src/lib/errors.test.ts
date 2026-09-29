import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { errorMessage, isNotFound } from './errors';

describe('isNotFound', () => {
  it('is true for a 404 ApiError', () => {
    expect(isNotFound(new ApiError(404, ['Not found']))).toBe(true);
  });

  it('is true for a 400 ApiError', () => {
    expect(isNotFound(new ApiError(400, ['Bad id']))).toBe(true);
  });

  it('is false for other ApiError statuses', () => {
    expect(isNotFound(new ApiError(500, ['Boom']))).toBe(false);
  });

  it('is false for non-ApiError values', () => {
    expect(isNotFound(new Error('oops'))).toBe(false);
    expect(isNotFound('oops')).toBe(false);
    expect(isNotFound(null)).toBe(false);
  });
});

describe('errorMessage', () => {
  it('returns the ApiError message', () => {
    expect(errorMessage(new ApiError(500, ['Boom']))).toBe('Boom');
  });

  it('returns a fixed message for network failures', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe(
      'Could not reach the server',
    );
  });

  it('returns the message for other Errors', () => {
    expect(errorMessage(new Error('oops'))).toBe('oops');
  });

  it('returns a generic message for non-Error values', () => {
    expect(errorMessage('oops')).toBe('Something went wrong');
    expect(errorMessage(null)).toBe('Something went wrong');
    expect(errorMessage(undefined)).toBe('Something went wrong');
  });
});
