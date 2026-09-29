import { describe, expect, it } from 'vitest';
import { ApiError } from './api/client';
import { queryClient } from './queryClient';

const retry = queryClient.getDefaultOptions().queries?.retry as (
  failureCount: number,
  error: unknown,
) => boolean;

describe('queryClient retry policy', () => {
  it.each([400, 401, 404, 409])('does not retry %i responses', (status) => {
    expect(retry(0, new ApiError(status, ['x']))).toBe(false);
  });

  it('retries 5xx and network errors up to 3 times', () => {
    expect(retry(0, new ApiError(500, ['x']))).toBe(true);
    expect(retry(2, new TypeError('Failed to fetch'))).toBe(true);
    expect(retry(3, new TypeError('Failed to fetch'))).toBe(false);
  });
});
