import type { PersonaSpec, VacancySpec } from '../synth/types.js';
import {
  buildPlan,
  pairKey,
  requiredFiles,
  validateInputs,
  type SeedState,
} from './planner.js';

function persona(
  id: string,
  applyTo: string[],
  github: string | null = null,
): PersonaSpec {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    language: 'en',
    layout: '1-col',
    roles: [],
    projects: [],
    skills: [],
    github: github ? { username: github } : null,
    kind: 'targeted',
    flags: [],
    applyTo,
  };
}

const vacancy = (id: string): VacancySpec => ({
  id,
  title: `Vacancy ${id}`,
  intro: '',
  requirements: [],
  text: `text of ${id}`,
});

const VACANCIES = [vacancy('a'), vacancy('b'), vacancy('c')];

describe('validateInputs', () => {
  it('passes when everything exists', () => {
    const personas = [persona('p1', ['a'], 'jane'), persona('p2', ['b'])];
    expect(validateInputs(personas, VACANCIES, () => true)).toEqual([]);
  });

  it('lists every missing file at once', () => {
    const personas = [
      persona('p1', ['a'], 'jane'),
      persona('p2', ['b']),
      persona('p3', ['c'], 'bob'),
    ];
    const present = new Set(['pdf/p2.pdf']);
    const errors = validateInputs(personas, VACANCIES, (f) => present.has(f));
    expect(errors).toHaveLength(1);
    for (const file of [
      'pdf/p1.pdf',
      'github/jane.json',
      'pdf/p3.pdf',
      'github/bob.json',
    ]) {
      expect(errors[0]).toContain(file);
    }
    expect(errors[0]).not.toContain('pdf/p2.pdf');
    expect(errors[0]).toContain('Missing 4 file(s)');
  });

  it('reports unknown vacancy ids', () => {
    const errors = validateInputs(
      [persona('p1', ['a', 'zzz'])],
      VACANCIES,
      () => true,
    );
    expect(errors).toEqual([
      'Unknown vacancy ids in applyTo (persona -> vacancy): p1 -> zzz',
    ]);
  });

  it('needs no files for a persona without applications', () => {
    expect(requiredFiles([persona('p1', [], 'jane')])).toEqual([]);
  });
});

describe('buildPlan', () => {
  const personas = [
    persona('p1', ['b', 'a']),
    persona('p2', ['c']),
    persona('p3', []),
  ];

  it('keeps persona order, applyTo order, and counts the work', () => {
    const plan = buildPlan(personas, VACANCIES);
    expect(plan.items.map((i) => [i.persona.id, i.apply])).toEqual([
      ['p1', ['b', 'a']],
      ['p2', ['c']],
    ]);
    expect(plan.vacancyIds.sort()).toEqual(['a', 'b', 'c']);
    expect(plan.counts).toEqual({
      personas: 2,
      applications: 3,
      parses: 2,
      embeddings: 2,
      criteriaExtractions: 3,
      scores: 3,
    });
  });

  it('skips applied pairs and parsed candidates', () => {
    const state: SeedState = {
      parsedPersonaIds: new Set(['p1']),
      appliedPairs: new Set([pairKey('p1', 'b'), pairKey('p2', 'c')]),
      vacanciesWithCriteria: new Set(['b']),
    };
    const plan = buildPlan(personas, VACANCIES, state);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({
      apply: ['a'],
      alreadyApplied: ['b'],
      needsParse: false,
    });
    expect(plan.counts).toMatchObject({
      personas: 1,
      applications: 1,
      parses: 0,
      criteriaExtractions: 1,
    });
    expect(plan.criteriaVacancyIds).toEqual(['a']);
  });

  it('is empty when everything is applied', () => {
    const state: SeedState = {
      parsedPersonaIds: new Set(['p1', 'p2']),
      appliedPairs: new Set([
        pairKey('p1', 'a'),
        pairKey('p1', 'b'),
        pairKey('p2', 'c'),
      ]),
      vacanciesWithCriteria: new Set(['a', 'b', 'c']),
    };
    const plan = buildPlan(personas, VACANCIES, state);
    expect(plan.items).toEqual([]);
    expect(plan.counts.applications).toBe(0);
  });
});
