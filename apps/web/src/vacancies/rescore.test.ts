import { describe, expect, it } from 'vitest';
import { changesCriteria } from './rescore';

const before = { title: 'Backend Dev', requirements: 'TypeScript and SQL' };

describe('changesCriteria', () => {
  it('is false when nothing changed', () => {
    expect(changesCriteria(before, { ...before })).toBe(false);
  });

  it('is false for whitespace-only edits', () => {
    expect(
      changesCriteria(before, {
        title: '  Backend   Dev ',
        requirements: 'TypeScript\n and\tSQL\n',
      }),
    ).toBe(false);
  });

  it('is true when the title changes', () => {
    expect(changesCriteria(before, { ...before, title: 'Senior Dev' })).toBe(
      true,
    );
  });

  it('is true when the requirements change', () => {
    expect(
      changesCriteria(before, { ...before, requirements: 'TypeScript' }),
    ).toBe(true);
  });

  it('is true for a case-only change', () => {
    expect(
      changesCriteria(before, {
        ...before,
        requirements: 'typescript and sql',
      }),
    ).toBe(true);
  });
});
