import { OnlyError, parseOnly } from './only.js';

const vacancies = ['backend-java', 'data-ml'];
const cvs = ['01-a', '02-b', '03-c'];

describe('parseOnly', () => {
  it('selects every pair when the flag is absent', () => {
    const sel = parseOnly(undefined, vacancies, cvs);
    expect(sel.has('data-ml', '03-c')).toBe(true);
  });

  it('selects exact pairs', () => {
    const sel = parseOnly('backend-java:01-a, data-ml:03-c', vacancies, cvs);
    expect(sel.has('backend-java', '01-a')).toBe(true);
    expect(sel.has('data-ml', '03-c')).toBe(true);
    expect(sel.has('backend-java', '02-b')).toBe(false);
    expect(sel.has('data-ml', '01-a')).toBe(false);
  });

  it('expands vacancyId:* to every CV', () => {
    const sel = parseOnly('data-ml:*', vacancies, cvs);
    expect(cvs.every((cv) => sel.has('data-ml', cv))).toBe(true);
    expect(sel.has('backend-java', '01-a')).toBe(false);
  });

  it('rejects malformed and unknown entries, listing all of them', () => {
    expect(() =>
      parseOnly('nope:01-a,backend-java:99-x,data-ml', vacancies, cvs),
    ).toThrow(OnlyError);
    try {
      parseOnly('nope:01-a,backend-java:99-x,data-ml', vacancies, cvs);
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('unknown vacancy "nope"');
      expect(message).toContain('unknown CV "99-x"');
      expect(message).toContain('"data-ml"');
    }
  });

  it('rejects an empty value', () => {
    expect(() => parseOnly(' , ', vacancies, cvs)).toThrow(OnlyError);
  });
});
