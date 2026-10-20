import { renderMarkdown } from './report.js';
import type { EvalResult } from './result.js';

const usage = (i: number, o: number) => ({
  model: 'gpt-5.4-mini',
  inputTokens: i,
  outputTokens: o,
  totalTokens: i + o,
});

const result: EvalResult = {
  label: 'baseline',
  model: 'gpt-5.4-mini',
  date: '2026-10-20T10:00:00.000Z',
  runsPerCv: 2,
  pricing: { inputPerMillion: 0.75, outputPerMillion: 4.5 },
  cvs: [
    {
      id: '01-junior-frontend',
      file: '01.pdf',
      layout: '1-col',
      language: 'en',
      githubUrl: null,
      githubStatus: 'none',
      textLength: 1234,
      error: null,
      runs: [
        {
          run: 1,
          error: null,
          profile: {
            skills: ['React', 'Teacher'],
            experience: 'Dev at Acme',
            projects: ['Pixel Board'],
            summary: 'Junior dev.',
          },
          usage: usage(2000, 400),
          costUsd: 0.0033,
          checks: [
            { kind: 'mustHaveSkills', target: 'React', passed: true },
            { kind: 'forbiddenInSkills', target: 'Teacher', passed: false },
          ],
          checksPassed: 1,
          checksTotal: 2,
        },
        {
          run: 2,
          error: null,
          profile: {
            skills: ['React'],
            experience: 'Dev at Acme',
            projects: [],
            summary: 'Junior dev.',
          },
          usage: usage(2200, 600),
          costUsd: 0.0043,
          checks: [
            { kind: 'mustHaveSkills', target: 'React', passed: true },
            { kind: 'forbiddenInSkills', target: 'Teacher', passed: true },
          ],
          checksPassed: 2,
          checksTotal: 2,
        },
      ],
    },
    {
      id: '02-broken',
      file: '02.pdf',
      layout: '2-col',
      language: 'uk',
      githubUrl: 'https://github.com/x',
      githubStatus: 'ok',
      textLength: 99,
      error: null,
      runs: [
        {
          run: 1,
          error: 'The model could not extract a profile from the CV',
          profile: null,
          usage: usage(1000, 0),
          costUsd: 0.0008,
          checks: [
            { kind: 'expectedEmployers', target: 'Globex', passed: false },
          ],
          checksPassed: 0,
          checksTotal: 1,
        },
      ],
    },
  ],
};

describe('renderMarkdown', () => {
  const md = renderMarkdown(result);

  it('renders the header with pricing and caveat', () => {
    expect(md).toContain('# Parse eval: baseline');
    expect(md).toContain('Model: gpt-5.4-mini');
    expect(md).toContain('Date: 2026-10-20');
    expect(md).toContain('Runs per CV: 2');
    expect(md).toContain('$0.75 / $4.5 per 1M');
    expect(md).toContain('unverified');
  });

  it('renders per-CV table rows', () => {
    expect(md).toContain(
      '| 01-junior-frontend | 1-col | en | none | 1/2, 2/2 | 2100 | 500 | $0.0038 |',
    );
    expect(md).toContain('| 02-broken | 2-col | uk | ok | err | 1000 | 0 |');
  });

  it('renders the totals row', () => {
    expect(md).toContain('| **Total** |');
    expect(md).toContain('3/5 (60.0%)');
    expect(md).toContain('Total tokens: 6200 (5200 in, 1000 out)');
    expect(md).toContain('Total cost: $0.0084');
  });

  it('lists failed checks and failed runs', () => {
    expect(md).toContain('## Failed checks');
    expect(md).toContain(
      '- 01-junior-frontend, run 1: forbiddenInSkills "Teacher"',
    );
    expect(md).toContain('- 02-broken, run 1: expectedEmployers "Globex"');
    expect(md).toContain('- 02-broken, run 1: no profile (');
    expect(md).not.toContain('01-junior-frontend, run 2: forbidden');
  });

  it('renders per-CV details with profiles', () => {
    expect(md).toContain('<details>');
    expect(md).toContain('<summary>01-junior-frontend (1234 chars extracted');
    expect(md).toContain('- React\n- Teacher');
    expect(md).toContain('Dev at Acme');
    expect(md).toContain('#### Run 2');
    expect(md).toContain('No profile: The model could not');
    expect(md).toContain('</details>');
  });

  it('says none when nothing failed', () => {
    const clean = renderMarkdown({
      ...result,
      cvs: [{ ...result.cvs[0], runs: [result.cvs[0].runs[1]] }],
    });
    expect(clean).toContain('## Failed checks\n\n_none_');
  });
});
