import {
  bandOf,
  checkDistribution,
  computeGroundTruth,
  evaluateRequirement,
  scoreVacancy,
  searchRelevance,
  skillStatus,
} from './ground-truth.js';
import type { Evidence, Requirement, Skill, VacancySpec } from './types.js';

const skill = (tag: string, years: number, evidence: Evidence): Skill => ({
  tag,
  years,
  evidence,
});
const req = (
  id: string,
  kind: 'must' | 'nice',
  tags: string[],
  minYears?: number,
): Requirement => ({ id, text: id, kind, tags, minYears });
const persona = (id: string, skills: Skill[]) => ({ id, skills });
const vacancy = (id: string, requirements: Requirement[]): VacancySpec => ({
  id,
  title: id,
  intro: '',
  requirements,
  text: '',
});

describe('skillStatus', () => {
  it('is not_met without the skill', () => {
    expect(skillStatus(undefined)).toBe('not_met');
  });

  it.each<[Evidence]>([['cv_role'], ['cv_project'], ['github_only']])(
    '%s counts as met when no minimum is required',
    (evidence) => {
      expect(skillStatus(skill('a', 0, evidence))).toBe('met');
    },
  );

  it('cv_skills_only is only ever partial', () => {
    expect(skillStatus(skill('a', 10, 'cv_skills_only'))).toBe('partial');
    expect(skillStatus(skill('a', 0, 'cv_skills_only'), 5)).toBe('partial');
  });

  it('respects the minYears boundary', () => {
    expect(skillStatus(skill('a', 3, 'cv_role'), 3)).toBe('met');
    expect(skillStatus(skill('a', 2.92, 'cv_role'), 3)).toBe('partial');
  });

  it('applies minYears to github_only and gives projects zero years', () => {
    expect(skillStatus(skill('a', 4, 'github_only'), 3)).toBe('met');
    expect(skillStatus(skill('a', 1, 'github_only'), 3)).toBe('partial');
    expect(skillStatus(skill('a', 0, 'cv_project'), 2)).toBe('partial');
  });
});

describe('evaluateRequirement', () => {
  it('takes the best status among alternative tags', () => {
    const r = req('r', 'must', ['react', 'vue', 'angular']);
    const p = persona('p', [
      skill('react', 0, 'cv_skills_only'),
      skill('vue', 2, 'cv_role'),
    ]);
    expect(evaluateRequirement(p, r)).toEqual({
      requirementId: 'r',
      status: 'met',
      tag: 'vue',
    });
  });

  it('reports not_met with no tag', () => {
    expect(
      evaluateRequirement(persona('p', []), req('r', 'must', ['go'])),
    ).toEqual({ requirementId: 'r', status: 'not_met' });
  });
});

describe('scoreVacancy', () => {
  it('weights must 2 and nice 1', () => {
    const v = vacancy('v', [req('m', 'must', ['a']), req('n', 'nice', ['b'])]);
    expect(
      scoreVacancy(persona('p', [skill('a', 1, 'cv_role')]), v).score,
    ).toBe(67);
    expect(
      scoreVacancy(persona('p', [skill('b', 1, 'cv_role')]), v).score,
    ).toBe(33);
  });

  it('counts partial as half', () => {
    const v = vacancy('v', [req('m', 'must', ['a'])]);
    const p = persona('p', [skill('a', 0, 'cv_skills_only')]);
    expect(scoreVacancy(p, v)).toMatchObject({ score: 50, band: 'partial' });
  });

  it('scores an empty vacancy as 0', () => {
    expect(scoreVacancy(persona('p', []), vacancy('v', [])).score).toBe(0);
  });

  it('returns per-requirement statuses', () => {
    const v = vacancy('v', [req('m', 'must', ['a']), req('n', 'nice', ['b'])]);
    const result = scoreVacancy(
      persona('p', [skill('a', 1, 'github_only')]),
      v,
    );
    expect(result.requirements.map((r) => r.status)).toEqual([
      'met',
      'not_met',
    ]);
  });
});

describe('bandOf', () => {
  it.each([
    [0, 'weak'],
    [39, 'weak'],
    [40, 'partial'],
    [74, 'partial'],
    [75, 'strong'],
    [100, 'strong'],
  ])('%d is %s', (score, band) => {
    expect(bandOf(score)).toBe(band);
  });
});

describe('computeGroundTruth', () => {
  it('covers every persona x vacancy pair', () => {
    const vs = [
      vacancy('v1', [req('a', 'must', ['x'])]),
      vacancy('v2', [req('b', 'must', ['y'])]),
    ];
    const ps = [
      persona('p1', [skill('x', 1, 'cv_role')]),
      persona('p2', []),
      persona('p3', [skill('y', 1, 'cv_project')]),
    ];
    const gt = computeGroundTruth(ps, vs);
    expect(gt.pairs).toHaveLength(6);
    expect(
      gt.pairs.find((p) => p.personaId === 'p1' && p.vacancyId === 'v1')?.band,
    ).toBe('strong');
    expect(
      gt.pairs.find((p) => p.personaId === 'p2' && p.vacancyId === 'v2')?.band,
    ).toBe('weak');
  });
});

describe('searchRelevance', () => {
  const ps = [
    persona('all', [
      skill('kafka', 2, 'cv_role'),
      skill('java', 1, 'github_only'),
    ]),
    persona('stuffed', [
      skill('kafka', 0, 'cv_skills_only'),
      skill('java', 3, 'cv_role'),
    ]),
    persona('one', [skill('kafka', 3, 'cv_project')]),
    persona('none', []),
  ];

  it('requires every tag; skills-only makes it partially relevant', () => {
    expect(searchRelevance(ps, { tags: ['kafka', 'java'] })).toEqual({
      relevant: ['all'],
      partiallyRelevant: ['stuffed'],
    });
  });

  it('single-tag queries', () => {
    expect(searchRelevance(ps, { tags: ['kafka'] })).toEqual({
      relevant: ['all', 'one'],
      partiallyRelevant: ['stuffed'],
    });
  });

  it('an empty tag list matches nothing', () => {
    expect(searchRelevance(ps, { tags: [] })).toEqual({
      relevant: [],
      partiallyRelevant: [],
    });
  });
});

describe('checkDistribution', () => {
  it('lists vacancies below the thresholds', () => {
    const v = vacancy('v', [req('a', 'must', ['x'])]);
    const ps = Array.from({ length: 3 }, (_, i) =>
      persona(`p${i}`, [skill('x', 1, 'cv_role')]),
    );
    const gt = computeGroundTruth(ps, [v]);
    expect(
      checkDistribution(gt, ['v'], { minStrong: 3, minPartial: 0 }),
    ).toEqual([]);
    expect(
      checkDistribution(gt, ['v'], { minStrong: 4, minPartial: 1 }),
    ).toEqual(['v: 3 strong (need 4)', 'v: 0 partial (need 1)']);
  });
});
