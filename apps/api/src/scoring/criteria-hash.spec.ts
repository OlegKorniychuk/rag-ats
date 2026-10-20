import { vacancyCriteriaHash } from './criteria-hash.js';

describe('vacancyCriteriaHash', () => {
  it('is a stable sha256 hex digest', () => {
    const hash = vacancyCriteriaHash('Backend Engineer', '5+ years Node.js');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(vacancyCriteriaHash('Backend Engineer', '5+ years Node.js')).toBe(
      hash,
    );
  });

  it('ignores surrounding and repeated whitespace', () => {
    expect(
      vacancyCriteriaHash('  Backend   Engineer ', '5+ years\n\n Node.js \t'),
    ).toBe(vacancyCriteriaHash('Backend Engineer', '5+ years Node.js'));
  });

  it('changes when the title or requirements change', () => {
    const base = vacancyCriteriaHash('Backend Engineer', 'Node.js');
    expect(vacancyCriteriaHash('Frontend Engineer', 'Node.js')).not.toBe(base);
    expect(vacancyCriteriaHash('Backend Engineer', 'Node.js, Go')).not.toBe(
      base,
    );
  });

  it('does not confuse the title/requirements boundary', () => {
    expect(vacancyCriteriaHash('a b', 'c')).not.toBe(
      vacancyCriteriaHash('a', 'b c'),
    );
  });
});
