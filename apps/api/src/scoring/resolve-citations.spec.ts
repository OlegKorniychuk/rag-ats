import type { EvidenceUnit } from './evidence-units.js';
import {
  citationProblems,
  isNoEvidenceProblem,
  MAX_QUOTES_PER_CRITERION,
  normaliseUnitId,
  resolveCitations,
} from './resolve-citations.js';

const unit = (
  id: string,
  source: 'cv' | 'github' = 'cv',
  text = `text of ${id}`,
): EvidenceUnit => ({ id, source, text });

const units = new Map<string, EvidenceUnit>(
  [
    unit('S1'),
    unit('S2'),
    unit('S3'),
    unit('S4'),
    unit('S14', 'cv', 'Built NestJS services'),
    unit('G3', 'github', 'Maintains a Go CLI'),
  ].map((u) => [u.id, u]),
);

const criterion = (criterionId: string, score: number, evidence: string[]) => ({
  criterionId,
  score,
  evidence,
});

describe('normaliseUnitId', () => {
  it.each([
    ['[s14]', 'S14'],
    [' S14. ', 'S14'],
    ['"G3"', 'G3'],
    ['[S14].', 'S14'],
    ['"G3".', 'G3'],
    [' [s14]. ', 'S14'],
  ])('normalises %j to %s', (raw, expected) => {
    expect(normaliseUnitId(raw)).toBe(expected);
  });
});

describe('citationProblems', () => {
  it('renders the exact problem strings', () => {
    expect(citationProblems.unknownCriterion('zz')).toBe(
      'Unknown criterion id "zz"',
    );
    expect(citationProblems.duplicateCriterion('c1')).toBe(
      'Criterion c1 appears more than once',
    );
    expect(citationProblems.missingCriterion('c2')).toBe(
      'Criterion c2 is missing',
    );
    expect(citationProblems.unknownEvidence('c1', 'S99')).toBe(
      'Criterion c1 cites unknown evidence id "S99"',
    );
    expect(citationProblems.noEvidence('c1')).toBe(
      'Criterion c1 has a score above 0 but cites no evidence',
    );
  });
});

describe('resolveCitations', () => {
  it('resolves cited ids to the unit source and exact text', () => {
    const result = resolveCitations(
      { criteria: [criterion('c1', 80, ['S14', 'G3'])] },
      units,
      ['c1'],
    );
    expect(result).toEqual({
      valid: true,
      problems: [],
      zeroed: [],
      criteria: [
        {
          criterionId: 'c1',
          score: 80,
          quotes: [
            { source: 'cv', text: 'Built NestJS services' },
            { source: 'github', text: 'Maintains a Go CLI' },
          ],
        },
      ],
    });
  });

  it('normalises ids before lookup', () => {
    const result = resolveCitations(
      { criteria: [criterion('c1', 50, ['[s14]', ' g3. '])] },
      units,
      ['c1'],
    );
    expect(result.valid).toBe(true);
    expect(result.criteria[0].quotes.map((q) => q.text)).toEqual([
      'Built NestJS services',
      'Maintains a Go CLI',
    ]);
  });

  it('dedupes after normalisation and keeps order', () => {
    const result = resolveCitations(
      { criteria: [criterion('c1', 50, ['S2', 's2', '[S1]', 'S2.', 'S1'])] },
      units,
      ['c1'],
    );
    expect(result.valid).toBe(true);
    expect(result.criteria[0].quotes.map((q) => q.text)).toEqual([
      'text of S2',
      'text of S1',
    ]);
  });

  it('keeps only the first MAX_QUOTES_PER_CRITERION distinct units', () => {
    expect(MAX_QUOTES_PER_CRITERION).toBe(3);
    const result = resolveCitations(
      { criteria: [criterion('c1', 50, ['S4', 'S3', 'S4', 'S2', 'S1'])] },
      units,
      ['c1'],
    );
    expect(result.criteria[0].quotes.map((q) => q.text)).toEqual([
      'text of S4',
      'text of S3',
      'text of S2',
    ]);
  });

  it('reports unknown evidence ids with the raw value', () => {
    const result = resolveCitations(
      { criteria: [criterion('c1', 50, ['S14', 'S99'])] },
      units,
      ['c1'],
    );
    expect(result.valid).toBe(false);
    expect(result.problems).toEqual([
      citationProblems.unknownEvidence('c1', 'S99'),
    ]);
  });

  it('still reports an unknown id beyond the cap', () => {
    const result = resolveCitations(
      { criteria: [criterion('c1', 50, ['S1', 'S2', 'S3', 'S4', 'S99'])] },
      units,
      ['c1'],
    );
    expect(result.valid).toBe(false);
    expect(result.problems).toEqual([
      citationProblems.unknownEvidence('c1', 'S99'),
    ]);
    expect(result.criteria[0].quotes).toHaveLength(MAX_QUOTES_PER_CRITERION);
  });

  it('reports a score above 0 with no evidence by default', () => {
    const result = resolveCitations(
      { criteria: [criterion('c1', 10, [])] },
      units,
      ['c1'],
    );
    expect(result.valid).toBe(false);
    expect(result.problems).toEqual([citationProblems.noEvidence('c1')]);
    expect(result.zeroed).toEqual([]);
    expect(result.criteria[0].score).toBe(10);
  });

  it('with zeroUnsupported: false, behaves like the default', () => {
    const result = resolveCitations(
      { criteria: [criterion('c1', 10, [])] },
      units,
      ['c1'],
      { zeroUnsupported: false },
    );
    expect(result.problems).toEqual([citationProblems.noEvidence('c1')]);
  });

  it('with zeroUnsupported, zeroes a score above 0 with no evidence and lists it', () => {
    const result = resolveCitations(
      { criteria: [criterion('c1', 10, []), criterion('c2', 70, ['S1'])] },
      units,
      ['c1', 'c2'],
      { zeroUnsupported: true },
    );
    expect(result.valid).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.zeroed).toEqual(['c1']);
    expect(result.criteria).toEqual([
      { criterionId: 'c1', score: 0, quotes: [] },
      {
        criterionId: 'c2',
        score: 70,
        quotes: [{ source: 'cv', text: 'text of S1' }],
      },
    ]);
  });

  it('with zeroUnsupported, keeps zeroed ids in response order', () => {
    const result = resolveCitations(
      {
        criteria: [
          criterion('c3', 5, []),
          criterion('c1', 90, []),
          criterion('c2', 0, []),
        ],
      },
      units,
      ['c1', 'c2', 'c3'],
      { zeroUnsupported: true },
    );
    expect(result.valid).toBe(true);
    expect(result.zeroed).toEqual(['c3', 'c1']);
  });

  it.each([false, true])(
    'reports blank citations as unknown ids, not a zeroing (zeroUnsupported: %s)',
    (zeroUnsupported) => {
      const result = resolveCitations(
        { criteria: [criterion('c1', 40, ['', ' [] '])] },
        units,
        ['c1'],
        { zeroUnsupported },
      );
      expect(result.valid).toBe(false);
      expect(result.problems).toHaveLength(1);
      expect(result.zeroed).toEqual([]);
    },
  );

  it.each([false, true])(
    'reports a score above 0 citing only unknown ids as an unknown-id problem (zeroUnsupported: %s)',
    (zeroUnsupported) => {
      const result = resolveCitations(
        { criteria: [criterion('c1', 50, ['S99'])] },
        units,
        ['c1'],
        { zeroUnsupported },
      );
      expect(result.valid).toBe(false);
      expect(result.problems).toEqual([
        citationProblems.unknownEvidence('c1', 'S99'),
      ]);
      expect(result.zeroed).toEqual([]);
    },
  );

  it('does not zero a score above 0 with one resolvable and one unknown id', () => {
    const result = resolveCitations(
      { criteria: [criterion('c1', 50, ['S1', 'S99'])] },
      units,
      ['c1'],
      { zeroUnsupported: true },
    );
    expect(result.valid).toBe(false);
    expect(result.zeroed).toEqual([]);
    expect(result.criteria[0].score).toBe(50);
  });

  it('does not list a score of 0 with no evidence as zeroed', () => {
    const result = resolveCitations(
      { criteria: [criterion('c1', 0, [])] },
      units,
      ['c1'],
      { zeroUnsupported: true },
    );
    expect(result.valid).toBe(true);
    expect(result.zeroed).toEqual([]);
  });

  it('still reports structural problems with zeroUnsupported', () => {
    const result = resolveCitations(
      { criteria: [criterion('c1', 50, []), criterion('zz', 0, [])] },
      units,
      ['c1', 'c2'],
      { zeroUnsupported: true },
    );
    expect(result.valid).toBe(false);
    expect(result.problems).toEqual([
      citationProblems.unknownCriterion('zz'),
      citationProblems.missingCriterion('c2'),
    ]);
  });

  it('reports unknown, duplicate and missing criteria', () => {
    const result = resolveCitations(
      {
        criteria: [
          criterion('c1', 0, []),
          criterion('c1', 0, []),
          criterion('zz', 0, []),
        ],
      },
      units,
      ['c1', 'c2'],
    );
    expect(result.valid).toBe(false);
    expect(result.problems).toEqual([
      citationProblems.duplicateCriterion('c1'),
      citationProblems.unknownCriterion('zz'),
      citationProblems.missingCriterion('c2'),
    ]);
  });

  it('accepts score 0 everywhere with no evidence', () => {
    const result = resolveCitations(
      { criteria: [criterion('c1', 0, []), criterion('c2', 0, [])] },
      units,
      ['c1', 'c2'],
    );
    expect(result.valid).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.zeroed).toEqual([]);
    expect(result.criteria).toEqual([
      { criterionId: 'c1', score: 0, quotes: [] },
      { criterionId: 'c2', score: 0, quotes: [] },
    ]);
  });

  it('accepts a score of 0 that cites a contrary unit', () => {
    const result = resolveCitations(
      { criteria: [criterion('c1', 0, ['S1'])] },
      units,
      ['c1'],
    );
    expect(result.valid).toBe(true);
    expect(result.criteria[0].quotes).toEqual([
      { source: 'cv', text: 'text of S1' },
    ]);
  });
});

describe('isNoEvidenceProblem', () => {
  it('matches the no-evidence problem for any criterion id', () => {
    expect(isNoEvidenceProblem(citationProblems.noEvidence('c1'))).toBe(true);
    expect(isNoEvidenceProblem(citationProblems.noEvidence('crit-12'))).toBe(
      true,
    );
  });

  it('does not match the other problems', () => {
    expect(isNoEvidenceProblem(citationProblems.missingCriterion('c1'))).toBe(
      false,
    );
    expect(
      isNoEvidenceProblem(citationProblems.unknownEvidence('c1', 'S999')),
    ).toBe(false);
    expect(isNoEvidenceProblem(citationProblems.duplicateCriterion('c1'))).toBe(
      false,
    );
    expect(isNoEvidenceProblem(citationProblems.unknownCriterion('c9'))).toBe(
      false,
    );
  });
});
