import { describe, expect, it } from 'vitest';
import { safeExternalUrl } from './safeUrl';

describe('safeExternalUrl', () => {
  it('allows http urls', () => {
    expect(safeExternalUrl('http://example.com')).toBe('http://example.com');
  });

  it('allows https urls', () => {
    expect(safeExternalUrl('https://example.com')).toBe('https://example.com');
  });

  it('rejects javascript: urls', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
  });

  it('rejects data: urls', () => {
    expect(
      safeExternalUrl('data:text/html,<script>alert(1)</script>'),
    ).toBeNull();
  });

  it('rejects ftp: urls', () => {
    expect(safeExternalUrl('ftp://example.com')).toBeNull();
  });

  it('rejects garbage strings', () => {
    expect(safeExternalUrl('not a url')).toBeNull();
  });

  it('returns null for null', () => {
    expect(safeExternalUrl(null)).toBeNull();
  });
});
