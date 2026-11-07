import {
  bandOf,
  bandResult,
  checkCoverage,
  checkGrounded,
  findFillerSuspects,
  scorerSources,
  spread,
  type CheckCriterion,
} from './checks.js';

const cvText =
  'Senior engineer.   Built Kafka   pipelines at Acme.\n\n\n\nLed 4 devs.';
const sources = {
  cv: 'Senior engineer. Built Kafka pipelines at Acme.\n\nLed 4 devs.',
  github: 'Repo: foo-bar (Go)',
};

const criterion = (
  id: string,
  score: number,
  ...quotes: Array<['cv' | 'github', string]>
): CheckCriterion => ({
  id,
  score,
  quotes: quotes.map(([source, text]) => ({ source, text })),
});

describe('scorerSources', () => {
  it('normalises the CV text like the scorer and omits non-ok GitHub', () => {
    const s = scorerSources(cvText, null);
    expect(s.cv).toBe(
      'Senior engineer. Built Kafka pipelines at Acme.\n\nLed 4 devs.',
    );
    expect(s.github).toBeNull();
  });
});

describe('checkGrounded', () => {
  it('passes when every quote is verbatim and scored criteria have quotes', () => {
    const result = checkGrounded(
      [
        criterion('c1', 80, ['cv', 'Built Kafka pipelines at Acme']),
        criterion('c2', 60, ['github', 'foo-bar (Go)']),
        criterion('c3', 0, ['cv', 'Led 4 devs']),
      ],
      sources,
    );
    expect(result).toEqual({ ok: true, problems: [] });
  });

  it('flags a score above 0 without quotes', () => {
    const result = checkGrounded([criterion('c1', 40)], sources);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('c1: score 40 but no quotes');
  });

  it('allows a score of 0 without quotes', () => {
    expect(checkGrounded([criterion('c1', 0)], sources).ok).toBe(true);
  });

  it('flags a quote that is not in the source it names', () => {
    const result = checkGrounded(
      [
        criterion('c1', 50, ['cv', 'Rewrote the billing system']),
        criterion('c2', 50, ['github', 'Built Kafka pipelines']),
      ],
      sources,
    );
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(2);
    expect(result.problems[0]).toContain('c1 q1');
    expect(result.problems[1]).toContain('c2 q1');
  });

  it('flags a github quote when no github block was sent', () => {
    const result = checkGrounded([criterion('c1', 50, ['github', 'foo-bar'])], {
      cv: sources.cv,
      github: null,
    });
    expect(result.ok).toBe(false);
  });

  it('matches case- and whitespace-insensitively like verifyQuotes', () => {
    const result = checkGrounded(
      [criterion('c1', 50, ['cv', 'BUILT   kafka\npipelines'])],
      sources,
    );
    expect(result.ok).toBe(true);
  });
});

describe('bandOf / bandResult', () => {
  it('maps overalls to bands at the boundaries', () => {
    expect(bandOf(100)).toBe('strong');
    expect(bandOf(75)).toBe('strong');
    expect(bandOf(74)).toBe('partial');
    expect(bandOf(40)).toBe('partial');
    expect(bandOf(39)).toBe('weak');
    expect(bandOf(0)).toBe('weak');
  });

  it('reports match, miss and none', () => {
    expect(bandResult(80, 'strong')).toBe('match');
    expect(bandResult(60, 'strong')).toBe('miss');
    expect(bandResult(60, null)).toBe('none');
    expect(bandResult(null, null)).toBe('none');
    expect(bandResult(null, 'weak')).toBe('miss');
  });
});

describe('findFillerSuspects', () => {
  it('flags a zero-score criterion sharing a quote with another criterion', () => {
    const suspects = findFillerSuspects([
      criterion('c1', 70, ['cv', 'Built Kafka pipelines at Acme']),
      criterion('c2', 0, ['cv', 'built  kafka pipelines at acme']),
      criterion('c3', 0, ['cv', 'Led 4 devs']),
    ]);
    expect(suspects).toEqual([
      {
        criterionId: 'c2',
        quote: 'built  kafka pipelines at acme',
        sharedWith: ['c1'],
      },
    ]);
  });

  it('ignores shared quotes on criteria scored above 0', () => {
    expect(
      findFillerSuspects([
        criterion('c1', 70, ['cv', 'Led 4 devs']),
        criterion('c2', 20, ['cv', 'Led 4 devs']),
      ]),
    ).toEqual([]);
  });
});

describe('checkCoverage', () => {
  it('splits terms into covered and missing, case-insensitively', () => {
    const result = checkCoverage(
      ['PyTorch', 'dbt', 'A/B', 'Spark'],
      ['Deep learning with pytorch', 'Experience designing A/B tests'],
    );
    expect(result.covered).toEqual(['PyTorch', 'A/B']);
    expect(result.missing).toEqual(['dbt', 'Spark']);
  });
});

describe('spread', () => {
  it('is max minus min, and null for fewer than two runs', () => {
    expect(spread([82, 75, 79])).toBe(7);
    expect(spread([80, 80])).toBe(0);
    expect(spread([80])).toBeNull();
    expect(spread([])).toBeNull();
  });
});
