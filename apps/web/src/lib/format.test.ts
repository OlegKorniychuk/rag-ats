import { describe, expect, it } from 'vitest';
import { formatDate } from './format';

describe('formatDate', () => {
  it('returns a non-empty string containing the year', () => {
    const result = formatDate('2024-01-15T00:00:00.000Z');
    expect(result).not.toBe('');
    expect(result).toContain('2024');
  });
});
