import {
  findMissingSnippets,
  normalizeForMatch,
  requiredSnippets,
  validateCvContent,
} from './cv-check.js';
import { BACKEND_EN, INJECTION_EN } from './test-cvs.js';

describe('normalizeForMatch', () => {
  it('folds ligatures and compatibility forms (NFKC)', () => {
    expect(normalizeForMatch('ﬁnd the ﬂow, eﬃcient')).toBe(
      normalizeForMatch('find the flow, efficient'),
    );
    expect(normalizeForMatch('ＡＢＣ １２３')).toBe('abc123');
  });

  it('drops soft hyphens and zero-width characters', () => {
    expect(normalizeForMatch('micro­services​')).toBe(
      normalizeForMatch('microservices'),
    );
  });

  it('ignores line wraps and hyphenation across lines', () => {
    const source = 'Built end-to-end microservices with Node.js';
    expect(
      normalizeForMatch('Built end-to-\nend micro-\nservices with\nNode.js'),
    ).toBe(normalizeForMatch(source));
    expect(
      normalizeForMatch('Built   end-to-end\n microservices with Node.js'),
    ).toBe(normalizeForMatch(source));
  });

  it('unifies quotes, dashes and case', () => {
    expect(normalizeForMatch('“It’s” a – b — c')).toBe(
      normalizeForMatch('"It\'s" a - b - c'),
    );
    expect(normalizeForMatch('React')).toBe(normalizeForMatch('REACT'));
  });

  it('keeps different text different', () => {
    expect(normalizeForMatch('Java')).not.toBe(normalizeForMatch('JavaScript'));
  });
});

describe('findMissingSnippets', () => {
  const extracted = (): string => requiredSnippets(BACKEND_EN).join('\n');

  it('finds nothing missing when all text is extracted', () => {
    expect(findMissingSnippets(BACKEND_EN, extracted())).toEqual([]);
  });

  it('survives wrapping, hyphenation and ligatures in the extracted text', () => {
    const text = extracted()
      .replace('end-to-end', 'end-to-\nend')
      .replace(/ the /g, '\n the ')
      .replace('efficient', 'eﬃcient')
      .replace('Kafka', 'Kaf­ka');
    expect(findMissingSnippets(BACKEND_EN, text)).toEqual([]);
  });

  it('reports a dropped bullet, skill and employer', () => {
    const bullet = BACKEND_EN.roles[1].bullets[2];
    const text = requiredSnippets(BACKEND_EN)
      .filter(
        (s) => ![bullet, 'Domain-driven design', 'Vantage Reed'].includes(s),
      )
      .join('\n');
    expect(findMissingSnippets(BACKEND_EN, text).sort()).toEqual(
      [bullet, 'Domain-driven design', 'Vantage Reed'].sort(),
    );
  });

  it('exempts the injection text and dates', () => {
    expect(requiredSnippets(INJECTION_EN).join(' ')).not.toContain('PWNED');
    expect(
      findMissingSnippets(
        INJECTION_EN,
        requiredSnippets(INJECTION_EN).join('\n'),
      ),
    ).toEqual([]);
  });

  it('requires the GitHub URL when the CV has one', () => {
    expect(requiredSnippets(BACKEND_EN)).toContain(
      'github.com/synth-jonas-hartmann',
    );
    expect(requiredSnippets(INJECTION_EN).join(' ')).not.toContain('github');
  });
});

describe('validateCvContent', () => {
  it('accepts a fixture and rejects broken content', () => {
    expect(validateCvContent(BACKEND_EN)).toEqual([]);
    expect(validateCvContent(null)).toEqual(['not an object']);
    const broken = { ...BACKEND_EN, roles: 'nope', language: 'de' };
    expect(validateCvContent(broken)).toEqual([
      'language must be "en" or "uk"',
      'roles must be an array',
    ]);
  });
});
