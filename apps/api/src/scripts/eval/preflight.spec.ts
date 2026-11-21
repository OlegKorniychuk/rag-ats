import { vacancyCriteriaHash } from '../../scoring/criteria-hash.js';
import type { PersonaSpec, VacancySpec } from '../synth/types.js';
import type { SyntheticSet } from './data.js';
import {
  buildEvalDataset,
  findPreflightProblems,
  PreflightError,
  type CandidateDbState,
  type DbState,
  type VacancyDbState,
} from './preflight.js';

const persona = (id: string): PersonaSpec => ({
  id,
  name: `Persona ${id}`,
  email: `${id}@example.com`,
  language: 'en',
  layout: '1-col',
  roles: [],
  projects: [],
  skills: [],
  github: null,
  kind: 'targeted',
  flags: [],
  applyTo: ['alpha'],
});

const vacancy = (id: string): VacancySpec => ({
  id,
  title: `Vacancy ${id}`,
  intro: '',
  requirements: [],
  text: `- 3+ years of ${id}`,
});

const SET: SyntheticSet = {
  personas: [persona('p1'), persona('p2')],
  vacancies: [vacancy('alpha')],
  groundTruth: {
    pairs: [
      {
        vacancyId: 'alpha',
        personaId: 'p1',
        score: 80,
        band: 'strong',
        requirements: [],
      },
    ],
  },
  queries: [{ id: 'q1', query: 'q', tags: [], relevant: ['p1'] }],
  taxonomy: { description: '', tags: [] },
  spotCheckLabels: [
    { pair: 1, vacancyId: 'alpha', personaId: 'p1', band: 'strong', note: '' },
  ],
};

const embedded = (id: string): CandidateDbState => ({
  candidateId: `cand-${id}`,
  parseStatus: 'parsed',
  parsedCvDocumentId: `cv-${id}`,
  latestCvDocumentId: `cv-${id}`,
  embeddedCvDocumentId: `cv-${id}`,
});

const goodVacancy = (spec: VacancySpec): VacancyDbState => ({
  id: `db-${spec.id}`,
  title: spec.title,
  requirements: spec.text,
  criteria: [{ id: 'c1', text: 'Something', importance: 'must' }],
  criteriaHash: vacancyCriteriaHash(spec.title, spec.text),
});

function db(overrides: Partial<DbState> = {}): DbState {
  return {
    recruiterEmail: 'seed@example.com',
    recruiterFound: true,
    candidatesByEmail: new Map([
      ['p1@example.com', embedded('p1')],
      ['p2@example.com', embedded('p2')],
    ]),
    vacanciesByTitle: new Map([
      ['Vacancy alpha', [goodVacancy(SET.vacancies[0])]],
    ]),
    ...overrides,
  };
}

describe('findPreflightProblems', () => {
  it('finds nothing wrong with a fully seeded set', () => {
    expect(findPreflightProblems(SET, db())).toEqual([]);
  });

  it('reports a persona without a candidate', () => {
    const state = db({
      candidatesByEmail: new Map([
        ['p1@example.com', embedded('p1')],
        ['p2@example.com', null],
      ]),
    });
    expect(findPreflightProblems(SET, state)).toEqual([
      'persona p2 (p2@example.com): no candidate with this email',
    ]);
  });

  it('matches the email case-insensitively', () => {
    const upper = {
      ...SET,
      personas: [{ ...persona('p1'), email: 'P1@Example.com' }],
    };
    const state = db({
      candidatesByEmail: new Map([['p1@example.com', embedded('p1')]]),
    });
    expect(findPreflightProblems(upper, state)).toEqual([]);
  });

  it('reports candidates that are not parsed or not embedded for the current CV', () => {
    const state = db({
      candidatesByEmail: new Map<string, CandidateDbState>([
        ['p1@example.com', { ...embedded('p1'), parseStatus: 'failed' }],
        ['p2@example.com', { ...embedded('p2'), embeddedCvDocumentId: null }],
      ]),
    });
    expect(findPreflightProblems(SET, state)).toEqual([
      'persona p1 (p1@example.com): parse status is "failed", not "parsed"',
      'persona p2 (p2@example.com): chunks are not embedded for the parsed CV',
    ]);
  });

  it('reports chunks built from another CV than the parsed one, and a stale profile', () => {
    const state = db({
      candidatesByEmail: new Map<string, CandidateDbState>([
        [
          'p1@example.com',
          { ...embedded('p1'), embeddedCvDocumentId: 'cv-old' },
        ],
        ['p2@example.com', { ...embedded('p2'), latestCvDocumentId: 'cv-new' }],
      ]),
    });
    expect(findPreflightProblems(SET, state)).toEqual([
      'persona p1 (p1@example.com): chunks are not embedded for the parsed CV',
      'persona p2 (p2@example.com): the profile is parsed from an older CV than the current one',
    ]);
  });

  it('lists every problem at once', () => {
    const state = db({
      candidatesByEmail: new Map(),
      vacanciesByTitle: new Map(),
    });
    const problems = findPreflightProblems(SET, state);
    expect(problems).toHaveLength(3);
    expect(problems.join('\n')).toContain('persona p1');
    expect(problems.join('\n')).toContain('persona p2');
    expect(problems.join('\n')).toContain(
      'vacancy alpha ("Vacancy alpha"): not found for recruiter seed@example.com',
    );
  });

  it('reports a missing recruiter once, not per vacancy', () => {
    expect(findPreflightProblems(SET, db({ recruiterFound: false }))).toEqual([
      'seed recruiter seed@example.com not found',
    ]);
  });

  it('reports vacancies without criteria, with outdated criteria, or with edited text', () => {
    const spec = SET.vacancies[0];
    const cases: Array<[Partial<VacancyDbState>, string]> = [
      [{ criteria: null, criteriaHash: null }, 'no extracted criteria'],
      [{ criteria: [] }, 'no extracted criteria'],
      [
        { criteriaHash: vacancyCriteriaHash(spec.title, 'older text') },
        'the criteria are outdated',
      ],
      [
        {
          requirements: 'edited text',
          criteriaHash: vacancyCriteriaHash(spec.title, 'edited text'),
        },
        'the stored requirements differ from vacancies.json',
      ],
    ];
    for (const [change, expected] of cases) {
      const state = db({
        vacanciesByTitle: new Map([
          ['Vacancy alpha', [{ ...goodVacancy(spec), ...change }]],
        ]),
      });
      expect(findPreflightProblems(SET, state).join('\n')).toContain(expected);
    }
  });

  it('ignores whitespace-only differences in the stored requirements', () => {
    const spec = SET.vacancies[0];
    const row = { ...goodVacancy(spec), requirements: `  ${spec.text}\n\n` };
    const state = db({ vacanciesByTitle: new Map([['Vacancy alpha', [row]]]) });
    expect(findPreflightProblems(SET, state)).toEqual([]);
  });

  it('reports vacancies sharing a title', () => {
    const row = goodVacancy(SET.vacancies[0]);
    const state = db({
      vacanciesByTitle: new Map([
        ['Vacancy alpha', [row, { ...row, id: 'other' }]],
      ]),
    });
    expect(findPreflightProblems(SET, state).join('\n')).toContain(
      '2 vacancies share this title',
    );
  });

  it('reports dangling ids in the ground truth, queries and labels, and unlabelled pairs', () => {
    const broken: SyntheticSet = {
      ...SET,
      groundTruth: {
        pairs: [
          {
            vacancyId: 'ghost',
            personaId: 'p9',
            score: 1,
            band: 'weak',
            requirements: [],
          },
        ],
      },
      queries: [
        {
          id: 'q1',
          query: 'q',
          tags: [],
          relevant: ['p7'],
          partiallyRelevant: ['p1'],
        },
      ],
      spotCheckLabels: [
        { pair: 1, vacancyId: 'alpha', personaId: 'p1', band: null, note: '' },
        {
          pair: 2,
          vacancyId: 'alpha',
          personaId: 'p8',
          band: 'weak',
          note: '',
        },
      ],
    };
    const problems = findPreflightProblems(broken, db());
    expect(problems).toEqual(
      expect.arrayContaining([
        'ground-truth.json: unknown persona id(s): p9',
        'ground-truth.json: unknown vacancy id(s): ghost',
        'spot-check/labels.json: unknown persona id(s): p8',
        'queries.json: unknown persona id(s): p7',
        'spot-check/labels.json: no band for pair(s) 1',
      ]),
    );
    expect(problems).toHaveLength(5);
  });

  it('reports personas that share an email', () => {
    const twins: SyntheticSet = {
      ...SET,
      personas: [persona('p1'), { ...persona('p2'), email: 'P1@example.com' }],
    };
    expect(findPreflightProblems(twins, db())).toEqual([
      'personas p1 and p2 share the email P1@example.com',
    ]);
  });
});

describe('PreflightError', () => {
  it('carries the full list in its message', () => {
    const error = new PreflightError(['a', 'b']);
    expect(error.problems).toEqual(['a', 'b']);
    expect(error.message).toContain('2 problems');
    expect(error.message).toContain('  - a\n  - b');
  });
});

describe('buildEvalDataset', () => {
  it('maps personas to candidates and vacancy specs to rows, both ways', () => {
    const dataset = buildEvalDataset(SET, db());
    expect(dataset.candidateIdByPersonaId.get('p1')).toBe('cand-p1');
    expect(dataset.personaIdByCandidateId.get('cand-p2')).toBe('p2');
    expect(dataset.vacancyIdBySpecId.get('alpha')).toBe('db-alpha');
    expect(dataset.specIdByVacancyId.get('db-alpha')).toBe('alpha');
    expect(dataset.vacancies[0]).toMatchObject({
      id: 'db-alpha',
      criteria: [{ id: 'c1' }],
      criteriaHash: vacancyCriteriaHash('Vacancy alpha', '- 3+ years of alpha'),
    });
    expect(dataset.personas).toHaveLength(2);
    expect(dataset.groundTruth).toBe(SET.groundTruth);
    expect(dataset.queries).toBe(SET.queries);
    expect(dataset.spotCheck).toEqual([
      { pair: 1, vacancyId: 'alpha', personaId: 'p1', band: 'strong' },
    ]);
  });

  it('refuses a set that has not passed the preflight', () => {
    expect(() =>
      buildEvalDataset(SET, db({ candidatesByEmail: new Map() })),
    ).toThrow('No candidate for persona p1');
  });
});
