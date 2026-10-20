import { normaliseForMatch, verifyQuotes } from './verify-quotes.js';

const CV =
  'Senior engineer.\nBuilt REST APIs with NestJS\tand PostgreSQL.\n\nSkills: TypeScript';
const GITHUB =
  '<github>\nProfile: https://github.com/jane\n\n## alpha (language: Go, stars: 5)\nDescription: A fast Go service\n</github>';

type Resp = Parameters<typeof verifyQuotes>[0];

function response(
  overrides: Array<Partial<Resp['criteria'][number]>> = [],
): Resp {
  const base: Resp['criteria'] = [
    {
      criterionId: 'c1',
      score: 80,
      quotes: [{ source: 'cv', text: 'Built REST APIs with NestJS' }],
    },
    {
      criterionId: 'c2',
      score: 60,
      quotes: [{ source: 'cv', text: 'Skills: TypeScript' }],
    },
  ];
  return {
    criteria: base.map((c, i) => ({ ...c, ...(overrides[i] ?? {}) })),
  };
}

const sources = { cv: CV, github: GITHUB };
const ids = ['c1', 'c2'];

describe('normaliseForMatch', () => {
  it('collapses whitespace, applies NFKC and trims', () => {
    expect(normaliseForMatch('  a\t\tb\n\nc d  ')).toBe('a b c d');
    expect(normaliseForMatch('ﬁnance Ａ')).toBe('finance a');
  });
});

describe('verifyQuotes', () => {
  it('accepts a valid response', () => {
    expect(verifyQuotes(response(), sources, ids)).toEqual({
      valid: true,
      problems: [],
    });
  });

  it('matches across tabs, newlines and NBSP', () => {
    const result = verifyQuotes(
      response([
        {
          quotes: [
            { source: 'cv', text: 'Senior   engineer. Built REST APIs' },
            { source: 'cv', text: 'NestJS and PostgreSQL.\nSkills:' },
          ],
        },
      ]),
      sources,
      ids,
    );
    expect(result.valid).toBe(true);
  });

  it('matches after NFKC normalisation of the source', () => {
    const result = verifyQuotes(
      response([{ quotes: [{ source: 'cv', text: 'office documents' }] }]),
      { cv: 'Wrote oﬃce documents daily', github: null },
      ids,
    );
    expect(result.problems.filter((p) => p.includes('c1'))).toEqual([]);
  });

  it('rejects a quote that is not in the CV', () => {
    const result = verifyQuotes(
      response([
        { quotes: [{ source: 'cv', text: 'Led 40 engineers at Acme' }] },
      ]),
      sources,
      ids,
    );
    expect(result.valid).toBe(false);
    expect(result.problems).toEqual([
      expect.stringMatching(
        /c1.*Led 40 engineers.*not a verbatim excerpt of <cv>/,
      ),
    ]);
  });

  it('checks quotes against the source they name', () => {
    const cvQuoteTaggedGithub = verifyQuotes(
      response([{ quotes: [{ source: 'github', text: 'Built REST APIs' }] }]),
      sources,
      ids,
    );
    expect(cvQuoteTaggedGithub.valid).toBe(false);

    const githubQuoteTaggedCv = verifyQuotes(
      response([{ quotes: [{ source: 'cv', text: 'A fast Go service' }] }]),
      sources,
      ids,
    );
    expect(githubQuoteTaggedCv.valid).toBe(false);

    const ok = verifyQuotes(
      response([{ quotes: [{ source: 'github', text: 'A fast Go service' }] }]),
      sources,
      ids,
    );
    expect(ok.valid).toBe(true);
  });

  it('rejects github quotes when there is no github source', () => {
    const result = verifyQuotes(
      response([{ quotes: [{ source: 'github', text: 'A fast Go service' }] }]),
      { cv: CV, github: null },
      ids,
    );
    expect(result.valid).toBe(false);
    expect(result.problems[0]).toMatch(/no <github> data/);
  });

  it('rejects quotes shorter than 2 characters', () => {
    const result = verifyQuotes(
      response([{ quotes: [{ source: 'cv', text: ' S ' }] }]),
      sources,
      ids,
    );
    expect(result.valid).toBe(false);
    expect(result.problems[0]).toMatch(/shorter than 2/);
  });

  it('accepts a short quote only as a whole token', () => {
    const cv = 'Skills: Go, gRPC, MongoDB';
    const check = (text: string) =>
      verifyQuotes(
        {
          criteria: [
            { criterionId: 'c1', score: 50, quotes: [{ source: 'cv', text }] },
          ],
        },
        { cv, github: null },
        ['c1'],
      ).valid;
    expect(check('Go')).toBe(true);
    expect(check('gRPC')).toBe(true);
    expect(check('Mongo')).toBe(false);
    expect(check('DB')).toBe(false);
  });

  it('matches case-insensitively and across PDF line-wrap hyphens', () => {
    const cv = 'Dashboards for small e-\ncommerce clients.\nMOVY: Go';
    const check = (text: string) =>
      verifyQuotes(
        {
          criteria: [
            { criterionId: 'c1', score: 50, quotes: [{ source: 'cv', text }] },
          ],
        },
        { cv, github: null },
        ['c1'],
      ).valid;
    expect(check('small e-commerce clients')).toBe(true);
    expect(check('Movy: Go')).toBe(true);
    expect(check('small ecommerce clients')).toBe(false);
  });

  it('reports missing, duplicate and unknown criterion ids', () => {
    const missing = verifyQuotes(
      { criteria: [response().criteria[0]] },
      sources,
      ids,
    );
    expect(missing.problems).toEqual(['Criterion c2 is missing']);

    const duplicate = verifyQuotes(
      { criteria: [...response().criteria, response().criteria[0]] },
      sources,
      ids,
    );
    expect(duplicate.problems).toEqual(['Criterion c1 appears more than once']);

    const unknown = verifyQuotes(
      response([{}, { criterionId: 'c9' }]),
      sources,
      ids,
    );
    expect(unknown.problems).toEqual([
      expect.stringContaining('Unknown criterion id "c9"'),
      'Criterion c2 is missing',
    ]);
  });

  it('requires quotes for a criterion scored above 0', () => {
    const result = verifyQuotes(response([{ quotes: [] }]), sources, ids);
    expect(result.valid).toBe(false);
    expect(result.problems).toEqual([
      'Criterion c1 has a score above 0 but no quotes',
    ]);
  });

  it('allows a score of 0 without quotes if another criterion is quoted', () => {
    const result = verifyQuotes(
      response([{ score: 0, quotes: [] }]),
      sources,
      ids,
    );
    expect(result.valid).toBe(true);
  });

  it('requires at least one quote overall', () => {
    const result = verifyQuotes(
      response([
        { score: 0, quotes: [] },
        { score: 0, quotes: [] },
      ]),
      sources,
      ids,
    );
    expect(result.valid).toBe(false);
    expect(result.problems).toEqual(['The response contains no quotes']);
  });
});
