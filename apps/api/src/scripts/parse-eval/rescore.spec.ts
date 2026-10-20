import type { Manifest } from './manifest.js';
import { rescore } from './rescore.js';
import type { EvalResult, RunResult } from './result.js';

const expectNone = {
  mustHaveSkills: [],
  forbiddenInSkills: [],
  expectedProjects: [],
  expectedEmployers: [],
  experienceMustMention: [],
  forbiddenInProjects: [],
  forbiddenAnywhere: [],
};

const run = (overrides: Partial<RunResult>): RunResult => ({
  run: 1,
  error: null,
  profile: {
    skills: ['React'],
    experience: 'Dev at Acme: cut latency by 40%',
    projects: ['Pixel Board'],
    summary: 'Dev.',
  },
  usage: null,
  costUsd: 0.002,
  checks: [],
  checksPassed: 0,
  checksTotal: 0,
  ...overrides,
});

const result: EvalResult = {
  label: 'old',
  model: 'gpt-5.4-mini',
  date: '2026-10-20T10:00:00.000Z',
  runsPerCv: 2,
  pricing: { inputPerMillion: 0.75, outputPerMillion: 4.5 },
  cvs: ['a', 'gone'].map((id) => ({
    id,
    file: `${id}.pdf`,
    layout: '1-col',
    language: 'en',
    githubUrl: null,
    githubStatus: 'none' as const,
    textLength: 100,
    error: null,
    runs: [run({}), run({ run: 2, error: 'boom', profile: null })],
  })),
};

const manifest: Manifest = {
  cvs: [
    {
      id: 'a',
      file: 'a.pdf',
      githubUrl: null,
      language: 'en',
      layout: '1-col',
      notes: '',
      expect: { ...expectNone, experienceMustMention: ['40%', '99%'] },
    },
  ],
};

describe('rescore', () => {
  const rescored = rescore(result, manifest);

  it('re-runs the current checks on stored profiles, keeping cost', () => {
    const first = rescored.cvs[0].runs[0];
    expect(first.checks.map((c) => [c.target, c.passed])).toEqual([
      ['40%', true],
      ['99%', false],
    ]);
    expect([first.checksPassed, first.checksTotal]).toEqual([1, 2]);
    expect(first.costUsd).toBe(0.002);
  });

  it('counts every check as failed for a run without a profile', () => {
    const second = rescored.cvs[0].runs[1];
    expect([second.checksPassed, second.checksTotal]).toEqual([0, 2]);
  });

  it('leaves CVs that are no longer in the manifest unchanged', () => {
    expect(rescored.cvs[1]).toBe(result.cvs[1]);
  });
});
